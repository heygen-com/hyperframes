import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AudioAnalysisProvider, AudioSignal } from "@hyperframes/core/audio-analysis";
import { AVAILABLE, runFile, unavailable, withWavFile } from "./shared.js";

const SOUND_ANALYSIS = "/System/Library/Frameworks/SoundAnalysis.framework";
const MUSIC_UNDERSTANDING_MACOS = 27;

/** Apple's built-in sound classifier over the whole file: each label's mean confidence across its windows. */
const SOUND_TAGGER = `
import Foundation
import SoundAnalysis

final class Collector: NSObject, SNResultsObserving {
  var sums: [String: Double] = [:]
  var windows = 0
  var failure: Error?
  func request(_ request: SNRequest, didProduce result: SNResult) {
    guard let result = result as? SNClassificationResult else { return }
    windows += 1
    for c in result.classifications { sums[c.identifier, default: 0] += c.confidence }
  }
  func request(_ request: SNRequest, didFailWithError error: Error) { failure = error }
}

do {
  let analyzer = try SNAudioFileAnalyzer(url: URL(fileURLWithPath: CommandLine.arguments[1]))
  let collector = Collector()
  try analyzer.add(try SNClassifySoundRequest(classifierIdentifier: .version1), withObserver: collector)
  analyzer.analyze()
  if let failure = collector.failure { throw failure }
  let count = Double(max(1, collector.windows))
  var tags: [[String: Any]] = []
  for (label, sum) in collector.sums.sorted(by: { $0.value > $1.value }).prefix(10) {
    let score: Double = sum / count
    if score >= 0.01 { tags.append(["label": label, "score": (score * 1000).rounded() / 1000]) }
  }
  let json = try JSONSerialization.data(withJSONObject: ["tags": tags, "windows": collector.windows])
  FileHandle.standardOutput.write(json)
} catch {
  FileHandle.standardError.write(Data("\\(error)".utf8))
  exit(1)
}
`;

/** The classifier listens in windows of about three seconds and says nothing about a shorter file. */
const CLASSIFIER_WINDOW_SECONDS = 3;

function atLeastOneWindow(signal: AudioSignal): AudioSignal {
  const length = Math.ceil(CLASSIFIER_WINDOW_SECONDS * signal.sampleRate);
  if ((signal.channels[0]?.length ?? 0) >= length) return signal;
  return {
    ...signal,
    channels: signal.channels.map((channel) => {
      const padded = new Float32Array(length);
      padded.set(channel);
      return padded;
    }),
  };
}

const helperDir = () => join(homedir(), ".cache", "hyperframes", "audio-helpers");

function helperPath(name: string, source: string): string {
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
  return join(helperDir(), `${name}-${hash}`);
}

async function hasSwiftCompiler(): Promise<boolean> {
  try {
    await runFile("xcrun", ["--find", "swiftc"], { timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

const firstLine = (error: unknown) =>
  ((error as { stderr?: string }).stderr || String(error)).trim().split("\n")[0];

// The compiler's module cache sits beside the helper: the default one is outside an agent's sandbox.
export function swiftcArgs(source: string, output: string): string[] {
  return [
    "--sdk",
    "macosx",
    "swiftc",
    "-O",
    "-swift-version",
    "5",
    "-module-cache-path",
    join(helperDir(), "module-cache"),
    source,
    "-o",
    output,
  ];
}

const builds = new Map<string, Promise<string>>();

/** The helper compiled from `source`, built once per source into the cache; Swift is never fetched. */
function compiled(name: string, source: string): Promise<string> {
  const binary = helperPath(name, source);
  if (existsSync(binary)) return Promise.resolve(binary);
  let build = builds.get(binary);
  if (!build) {
    build = (async () => {
      await mkdir(helperDir(), { recursive: true });
      const file = `${binary}.swift`;
      await writeFile(file, source);
      const args = swiftcArgs(file, `${binary}.tmp`);
      await runFile("xcrun", args, { timeout: 5 * 60_000 }).catch((error: unknown) => {
        throw new Error(`could not build the ${name} helper: ${firstLine(error)}`);
      });
      await rename(`${binary}.tmp`, binary);
      return binary;
    })();
    builds.set(binary, build);
  }
  return build;
}

/** The macOS major version, or null off macOS. */
async function macosMajor(): Promise<number | null> {
  if (process.platform !== "darwin") return null;
  const { stdout } = await runFile("sw_vers", ["-productVersion"], { timeout: 10_000 });
  return Number.parseInt(stdout, 10) || null;
}

/** Labels for what the audio holds, from Apple's on-device sound classifier (SoundAnalysis, macOS 12+). */
export const appleSoundProvider: AudioAnalysisProvider<AudioSignal> = {
  id: "apple-sound",
  local: true,
  capabilities: ["describe"],
  async available() {
    if (process.platform !== "darwin") return unavailable("macOS only");
    if (!existsSync(SOUND_ANALYSIS))
      return unavailable("SoundAnalysis.framework is not on this Mac");
    if (existsSync(helperPath("apple-sound", SOUND_TAGGER))) return AVAILABLE;
    if (!(await hasSwiftCompiler())) return unavailable("no Swift compiler to build the helper");
    return AVAILABLE;
  },
  async analyze(_capability, signal) {
    const helper = await compiled("apple-sound", SOUND_TAGGER);
    const { stdout } = await withWavFile(atLeastOneWindow(signal), (wav) =>
      runFile(helper, [wav], { timeout: 5 * 60_000, maxBuffer: 8 * 1024 * 1024 }),
    );
    const { tags } = JSON.parse(stdout) as { tags: { label: string; score: number }[] };
    return {
      tags: tags.map((t) => ({ label: t.label, score: Math.round(t.score * 1000) / 1000 })),
    };
  },
};

/**
 * Apple's on-device Music Understanding (WWDC26, macOS 27). No SDK this CLI has been built against offers it, so the
 * helper is not written yet: the provider reports why it cannot run instead of answering.
 */
export const appleMuProvider: AudioAnalysisProvider<AudioSignal> = {
  id: "apple-mu",
  local: true,
  capabilities: ["beats", "downbeats", "sections"],
  async available() {
    const major = await macosMajor();
    if (major === null) return unavailable("macOS only");
    if (major < MUSIC_UNDERSTANDING_MACOS)
      return unavailable(
        `Music Understanding needs macOS ${MUSIC_UNDERSTANDING_MACOS}; this Mac runs ${major}`,
      );
    return unavailable("no Music Understanding helper yet: it needs the macOS 27 SDK to build");
  },
  analyze() {
    return Promise.reject(new Error("Music Understanding is not available"));
  },
};
