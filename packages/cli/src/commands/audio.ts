import { join, resolve } from "node:path";
import { defineCommand } from "citty";
import type {
  AnalysisQuality,
  AudioCapability,
  OnsetMethod,
} from "@hyperframes/core/audio-analysis";
import type { Example } from "./_examples.js";
import { DEFAULT_CAPABILITIES, type AnalyzeOptions } from "../audio/analysis/analyze.js";
import { formatReport } from "../audio/analysis/format.js";
import { analyzeTargets, previewTarget } from "../audio/analysis/run.js";
import { filmTargets, type AudioTarget, type FilmQuery } from "../audio/analysis/targets.js";
import { formatRead } from "../audio/read/format.js";
import { readAudio } from "../audio/read/read.js";
import { describeProject } from "../timeline/describeProject.js";
import { CliUsageError } from "../utils/commandResult.js";
import { ensureDOMParser } from "../utils/dom.js";
import { resolveProject } from "../utils/project.js";
import { assertKnownFlags } from "../utils/reject-unknown-flags.js";
import { withMeta } from "../utils/updateCheck.js";

export const examples: Example[] = [
  ["Where a sound effect lands, its hits and loudness", "hyperframes audio sfx/whoosh.mp3"],
  [
    "Where a file not in the film yet would land if it started at 4.2 s",
    "hyperframes audio sfx/hit.wav --place-at 4.2",
  ],
  ["Every sound playing at 12 s in the film", "hyperframes audio --at 12"],
  ["One clip of the film, as JSON", "hyperframes audio --element '#riser' --json"],
  [
    "The beat grid, tempo and sections of a music bed",
    "hyperframes audio music.mp3 --only beats,downbeats,bpm,sections",
  ],
  [
    "A whole recording as voice, effect and music lines, 60–70 s shown",
    "hyperframes audio refs/episode.mp4 --read --range 60,70",
  ],
  [
    "Only onsets, from 60–200 Hz, finer",
    "hyperframes audio drums.wav --only onsets --band 60,200 --hop-ms 2",
  ],
];

const CAPABILITIES = new Set<string>([
  ...DEFAULT_CAPABILITIES,
  "beats",
  "downbeats",
  "bpm",
  "sections",
  "describe",
]);
const QUALITIES = new Set<AnalysisQuality>(["best", "local", "fast"]);

function number(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new CliUsageError(`--${name} must be a number, got ${raw}`);
  return value;
}

function pair(name: string, raw: string | undefined): [number, number] | undefined {
  if (raw === undefined) return undefined;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n)) || parts[0]! >= parts[1]!)
    throw new CliUsageError(`--${name} takes two increasing numbers, like 2.5,4`);
  return parts as [number, number];
}

function capabilities(raw: string | undefined): AudioCapability[] {
  if (!raw) return [...DEFAULT_CAPABILITIES];
  const asked = raw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (asked.includes("words"))
    throw new CliUsageError("words come from hyperframes transcribe, not hyperframes audio");
  const unknown = asked.filter((c) => !CAPABILITIES.has(c));
  if (unknown.length)
    throw new CliUsageError(
      `--only does not know ${unknown.join(", ")}; use ${[...CAPABILITIES].join(", ")}`,
    );
  return asked as AudioCapability[];
}

function pins(raw: string | undefined): AnalyzeOptions["provider"] {
  if (!raw) return undefined;
  return Object.fromEntries(
    raw.split(",").map((entry) => {
      const [capability, id] = entry.split("=").map((s) => s.trim());
      if (!capability || !id || !CAPABILITIES.has(capability))
        throw new CliUsageError(`--provider takes capability=provider pairs, like onsets=signal`);
      return [capability, id];
    }),
  );
}

function filmQuery(args: AudioFlags): FilmQuery | null {
  const given = (["element", "at", "range"] as const).filter((k) => args[k] !== undefined);
  if (given.length > 1) throw new CliUsageError(`use one of --element, --at, --range`);
  if (args.element) return { by: "element", ref: args.element };
  if (args.at !== undefined) return { by: "at", t: number("at", args.at)! };
  const range = pair("range", args.range);
  return range ? { by: "range", start: range[0], end: range[1] } : null;
}

interface AudioFlags {
  dir?: string;
  element?: string;
  at?: string;
  range?: string;
  "place-at"?: string;
  "skip-file-seconds"?: string;
  only?: string;
  quality?: string;
  provider?: string;
  "onset-method"?: string;
  threshold?: string;
  band?: string;
  "hop-ms"?: string;
  "onset-ratio"?: string;
  "tail-db"?: string;
  "silence-db"?: string;
  read?: boolean;
  transcript?: string;
  json?: boolean;
}

function parseQuality(flags: AudioFlags): AnalysisQuality {
  const quality = (flags.quality ?? "local") as AnalysisQuality;
  if (!QUALITIES.has(quality)) throw new CliUsageError("--quality is local, best or fast");
  return quality;
}

function analyzeRequest(flags: AudioFlags): AnalyzeOptions {
  const quality = parseQuality(flags);
  const method = flags["onset-method"] as OnsetMethod | undefined;
  if (method && method !== "spectral-flux" && method !== "energy")
    throw new CliUsageError("--onset-method is spectral-flux or energy");
  const band = pair("band", flags.band);
  return {
    capabilities: capabilities(flags.only),
    quality,
    provider: pins(flags.provider),
    options: {
      onsets: { method, band, threshold: number("threshold", flags.threshold) },
      envelope: { band, hopMs: number("hop-ms", flags["hop-ms"]) },
      moments: {
        onsetRatio: number("onset-ratio", flags["onset-ratio"]),
        tailDb: number("tail-db", flags["tail-db"]),
      },
      silence: { thresholdDb: number("silence-db", flags["silence-db"]) },
    },
  };
}

async function fileTargets(files: string[], flags: AudioFlags): Promise<AudioTarget[]> {
  const start = number("place-at", flags["place-at"]);
  if (start !== undefined && files.length !== 1)
    throw new CliUsageError("--place-at places exactly one file");
  const skip = number("skip-file-seconds", flags["skip-file-seconds"]);
  if (skip !== undefined && start === undefined)
    throw new CliUsageError("--skip-file-seconds only works with --place-at");
  const mediaStart = skip ?? 0;
  const cwd = process.cwd();
  return Promise.all(
    files.map((file) => previewTarget(resolve(cwd, file), file, start ?? null, mediaStart)),
  );
}

async function clipTargets(flags: AudioFlags, query: FilmQuery | null): Promise<AudioTarget[]> {
  const project = resolveProject(flags.dir);
  ensureDOMParser();
  const timeline = await describeProject(project.indexPath);
  return filmTargets(project.dir, timeline, query ?? { by: "all" });
}

function readQuality(files: string[], flags: AudioFlags): AnalysisQuality {
  if (files.length !== 1) throw new CliUsageError("--read reads exactly one file");
  if (flags.element || flags.at || flags["place-at"])
    throw new CliUsageError("--read takes a file and --range, not a film query");
  return parseQuality(flags);
}

async function read(files: string[], flags: AudioFlags) {
  const quality = readQuality(files, flags);
  const range = pair("range", flags.range);
  const result = await readAudio(resolve(process.cwd(), files[0]!), files[0]!, {
    cacheDir: join(resolve(flags.dir ?? process.cwd()), ".hyperframes", "read-audio"),
    transcript: flags.transcript ? resolve(process.cwd(), flags.transcript) : undefined,
    quality,
  });
  if (flags.json) {
    console.log(JSON.stringify(withMeta(result)));
    return;
  }
  console.log(`${formatRead(result.analysis, range)}\n\nwhole recording: ${result.textPath}`);
}

export default defineCommand({
  meta: {
    name: "audio",
    description: "Measure how sound moves in time: where it lands, its hits, loudness and silence",
  },
  args: {
    files: { type: "positional", description: "Audio or video files to analyze", required: false },
    dir: { type: "string", description: "Project directory, for film queries (default: current)" },
    element: {
      type: "string",
      description: "One audio or video clip of the film: #id, hf:id or audio/N",
    },
    at: { type: "string", description: "Every sound playing at this film second" },
    range: { type: "string", description: "Every sound playing in start,end film seconds" },
    "place-at": {
      type: "string",
      description: "For one file not in the film yet: the film second it would start at",
    },
    "skip-file-seconds": {
      type: "string",
      description: "With --place-at: seconds cut from the start of the file",
    },
    only: {
      type: "string",
      description: `Capabilities to measure (default ${DEFAULT_CAPABILITIES.join(",")}; also beats,downbeats,bpm,sections,describe)`,
    },
    quality: {
      type: "string",
      description:
        "local (this machine, the default), best (also uploads to HeyGen's audio services, which may bill your account), fast (signal only)",
    },
    provider: { type: "string", description: "Pin capabilities to providers: onsets=signal,..." },
    "onset-method": { type: "string", description: "spectral-flux (default) or energy" },
    threshold: { type: "string", description: "Onset strength floor, 0–1 (default 0.1)" },
    band: { type: "string", description: "Measure onsets and envelope in lo,hi Hz only" },
    "hop-ms": {
      type: "string",
      description: "Envelope hop in ms (default: about 2,000 values per item)",
    },
    "onset-ratio": {
      type: "string",
      description: "Moments: onset is where RMS first reaches this share of the peak (0.2)",
    },
    "tail-db": {
      type: "string",
      description: "Moments: the tail ends this many dB under the peak (-40)",
    },
    "silence-db": { type: "string", description: "Silence below this level in dBFS (-50)" },
    full: {
      type: "boolean",
      description: "Include each capability's provider ladder",
      default: false,
    },
    read: {
      type: "boolean",
      description:
        "Read one whole recording as voice, effect and music lines (--range picks what is shown)",
      default: false,
    },
    transcript: {
      type: "string",
      description: "With --read: the recording's transcript (default <file>.transcript.json)",
    },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  setup({ rawArgs, cmd }) {
    assertKnownFlags({ args: cmd.args }, rawArgs);
  },
  async run({ args }) {
    const flags = args as unknown as AudioFlags;
    const files = args._.map(String);
    if (flags.read) return read(files, flags);
    if (flags.transcript) throw new CliUsageError("--transcript only works with --read");
    const query = filmQuery(flags);
    if (files.length && query) throw new CliUsageError("give files or a film query, not both");
    const targets = files.length
      ? await fileTargets(files, flags)
      : await clipTargets(flags, query);
    const report = await analyzeTargets(targets, analyzeRequest(flags), Boolean(args.full));
    console.log(args.json ? JSON.stringify(withMeta(report)) : formatReport(report));
  },
});
