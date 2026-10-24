import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join } from "node:path";
import type { AnalysisQuality } from "@hyperframes/core/audio-analysis";
import { loadTranscript } from "../../whisper/normalize.js";
import { findEffects } from "./effects.js";
import { formatRead } from "./format.js";
import { readMusic } from "./music.js";
import { pitchTrack } from "./pitch.js";
import { PITCH_RATE, READ_RATE, decodeMono, mixed, round } from "./signal.js";
import { DRUM_STEM, VOICE_STEM, cachedStems, fetchStems, stemsAccess } from "./stems.js";
import { READ_VERSION, type ReadAudio } from "./types.js";
import { voiceFromActivity, voiceFromWords, type TimedWord } from "./voice.js";

export interface ReadOptions {
  /** Where analyses and stems are kept, normally the project's `.hyperframes/read-audio`. */
  cacheDir: string;
  /** A transcript of the recording; `<file>.transcript.json` next to it is used when absent. */
  transcript?: string;
  quality?: AnalysisQuality;
}

export interface ReadResult {
  analysis: ReadAudio;
  /** The whole recording as text, for grep. */
  textPath: string;
  jsonPath: string;
  cached: boolean;
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function transcriptFor(path: string, given?: string): string | null {
  if (given) return given;
  const sidecar = `${path}.transcript.json`;
  return existsSync(sidecar) ? sidecar : null;
}

function wordsOf(transcript: string): TimedWord[] {
  return loadTranscript(transcript).words.map(({ text, start, end }) => ({ text, start, end }));
}

const fingerprint = (path: string | null) =>
  path ? createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16) : "none";

function writeAtomic(path: string, content: string) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}

interface CacheEntry {
  analysis: ReadAudio;
  transcriptKey: string;
}

async function stemsFor(
  path: string,
  dir: string,
  quality: AnalysisQuality,
  warnings: string[],
): Promise<Record<string, string> | null> {
  const cached = cachedStems(dir);
  if (cached) return cached;
  if (quality !== "best") {
    warnings.push(
      `not separated into stems: quality ${quality} keeps audio on this machine; --quality best separates it through HeyGen`,
    );
    return null;
  }
  const access = await stemsAccess();
  if (typeof access === "string") {
    warnings.push(`not separated into stems: ${access}`);
    return null;
  }
  try {
    return await fetchStems(path, dir, access);
  } catch (error) {
    warnings.push(`not separated into stems: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/** Effects from the drums and the music from the other non-voice stems, measured against the whole recording. */
async function fromStems(path: string, stemPaths: Record<string, string>) {
  const pitched: Record<string, Float32Array> = {};
  for (const [name, stemPath] of Object.entries(stemPaths))
    if (name !== VOICE_STEM && name !== DRUM_STEM) pitched[name] = await decodeMono(stemPath);
  const drums = stemPaths[DRUM_STEM] ? await decodeMono(stemPaths[DRUM_STEM]) : null;
  const bed = Object.keys(pitched).length ? mixed(Object.values(pitched)) : null;
  const { music, beats } = bed
    ? readMusic({ stems: pitched, drums, sampleRate: READ_RATE })
    : { music: null, beats: [] };
  const effects = findEffects({
    source: drums ?? bed ?? new Float32Array(0),
    sampleRate: READ_RATE,
    music: bed,
    heard: await decodeMono(path),
    beats,
    speech: [],
  });
  return { effects, music };
}

const transcribeHint = (file: string) => `run hyperframes transcribe ${file} and pass --transcript`;

async function analyze(
  path: string,
  file: string,
  sha: string,
  transcript: string | null,
  stemDir: string,
  quality: AnalysisQuality,
): Promise<ReadAudio> {
  const warnings: string[] = [];
  const stemPaths = await stemsFor(path, stemDir, quality, warnings);
  const words = transcript ? wordsOf(transcript) : [];
  const voicePath = stemPaths?.[VOICE_STEM] ?? path;
  const voiceSamples = await decodeMono(voicePath);
  const about = base(file, sha, round(voiceSamples.length / READ_RATE, 3), stemPaths, transcript);
  if (!stemPaths && !words.length) {
    warnings.push(
      `no transcript and no stems: voice and effects are not read, because the mix alone does not tell speech from music; ${transcribeHint(file)}`,
    );
    return { ...about, voice: null, effects: null, music: null, warnings };
  }
  if (!words.length)
    warnings.push(`no transcript: voice lines carry no words; ${transcribeHint(file)}`);
  const pitch = pitchTrack(await decodeMono(voicePath, PITCH_RATE));
  const voice = words.length
    ? voiceFromWords(words, pitch)
    : voiceFromActivity(voiceSamples, READ_RATE, pitch);
  if (stemPaths) return { ...about, voice, ...(await fromStems(path, stemPaths)), warnings };
  warnings.push("without stems, effects under speech are not found and music is not read");
  const effects = findEffects({
    source: voiceSamples,
    sampleRate: READ_RATE,
    music: null,
    heard: null,
    beats: [],
    speech: voice.sentences,
  });
  return { ...about, voice, effects, music: null, warnings };
}

function base(
  file: string,
  sha: string,
  duration: number,
  stemPaths: Record<string, string> | null,
  transcript: string | null,
): Omit<ReadAudio, "voice" | "effects" | "music" | "warnings"> {
  return {
    version: READ_VERSION,
    file,
    sha256: sha,
    duration,
    separation: stemPaths ? "stems" : "mix",
    stems: stemPaths ? Object.keys(stemPaths).sort() : [],
    transcript: transcript ? basename(transcript) : null,
  };
}

/** Read a recording as time-stamped voice, effect and music events, computed once per file content. */
export async function readAudio(
  path: string,
  file: string,
  options: ReadOptions,
): Promise<ReadResult> {
  const quality = options.quality ?? "local";
  const sha = await sha256(path);
  const transcript = transcriptFor(path, options.transcript);
  const transcriptKey = fingerprint(transcript);
  const stem = `${basename(file, extname(file)).replace(/[^\w.-]/g, "_")}-${sha.slice(0, 12)}`;
  mkdirSync(options.cacheDir, { recursive: true });
  const jsonPath = join(options.cacheDir, `${stem}.json`);
  const textPath = join(options.cacheDir, `${stem}.txt`);
  const stemDir = join(options.cacheDir, "stems", sha.slice(0, 12));
  if (existsSync(jsonPath) && existsSync(textPath)) {
    const entry = JSON.parse(readFileSync(jsonPath, "utf8")) as CacheEntry;
    const stemsNowPossible =
      entry.analysis.separation === "mix" &&
      quality === "best" &&
      (cachedStems(stemDir) !== null || typeof (await stemsAccess()) !== "string");
    if (
      (entry.analysis.separation !== "stems" || cachedStems(stemDir) !== null) &&
      entry.analysis.version === READ_VERSION &&
      entry.transcriptKey === transcriptKey &&
      !stemsNowPossible
    )
      return { analysis: entry.analysis, textPath, jsonPath, cached: true };
  }
  const analysis = await analyze(path, file, sha, transcript, stemDir, quality);
  writeAtomic(jsonPath, JSON.stringify({ analysis, transcriptKey } satisfies CacheEntry));
  writeAtomic(textPath, formatRead(analysis));
  return { analysis, textPath, jsonPath, cached: false };
}
