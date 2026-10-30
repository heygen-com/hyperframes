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
import { loudness, type AnalysisQuality, type Span } from "@hyperframes/core/audio-analysis";
import { loadTranscript } from "../../whisper/normalize.js";
import { findEffects } from "./effects.js";
import { formatRead } from "./format.js";
import { readMusic } from "./music.js";
import { pitchTrack } from "./pitch.js";
import {
  PITCH_RATE,
  READ_RATE,
  asSignal,
  decodeMono,
  levelWhileHeardDb,
  mixed,
  round,
  spanDb,
} from "./signal.js";
import { DRUM_STEM, VOICE_STEM, cachedStems, fetchStems, stemsAccess } from "./stems.js";
import { READ_VERSION, type ReadAudio, type AudibleStem, type Voice } from "./types.js";
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

function heardStems(tracks: Record<string, Float32Array>): AudibleStem[] {
  return Object.entries(tracks)
    .map(([name, samples]) => ({ name, db: levelWhileHeardDb(samples, READ_RATE) }))
    .filter((stem): stem is AudibleStem => stem.db !== null)
    .sort((a, b) => b.db - a.db || a.name.localeCompare(b.name));
}

async function decodedStems(stemPaths: Record<string, string>) {
  const pitched: Record<string, Float32Array> = {};
  for (const [name, stemPath] of Object.entries(stemPaths))
    if (name !== VOICE_STEM && name !== DRUM_STEM) pitched[name] = await decodeMono(stemPath);
  const drums = stemPaths[DRUM_STEM] ? await decodeMono(stemPaths[DRUM_STEM]) : null;
  return { pitched, drums };
}

const present = (tracks: (Float32Array | null)[]) =>
  tracks.filter((t): t is Float32Array => t !== null);

function musicOf(
  pitched: Record<string, Float32Array>,
  drums: Float32Array | null,
  bed: Float32Array | null,
) {
  return bed
    ? readMusic({ stems: pitched, drums, sampleRate: READ_RATE })
    : { music: null, ambience: null, beats: [] };
}

function separatedStems(
  stemPaths: Record<string, string>,
  pitched: Record<string, Float32Array>,
  drums: Float32Array | null,
  vocals: Float32Array,
): AudibleStem[] {
  return heardStems({
    ...pitched,
    ...(drums ? { [DRUM_STEM]: drums } : {}),
    ...(stemPaths[VOICE_STEM] ? { [VOICE_STEM]: vocals } : {}),
  });
}

const recording = (path: string, separated: boolean, voiceSamples: Float32Array) =>
  separated ? decodeMono(path) : Promise.resolve(voiceSamples);

function excerpt(samples: Float32Array, spans: readonly Span[]): Float32Array {
  const parts = spans.map((span) =>
    samples.subarray(Math.round(span.start * READ_RATE), Math.round(span.end * READ_RATE)),
  );
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function againstMusic(
  voice: Voice,
  vocals: Float32Array,
  music: Float32Array,
  segments: readonly Span[],
): Voice {
  const sentences = voice.sentences.map((sentence) => {
    const under = segments
      .map((m) => ({
        start: Math.max(m.start, sentence.start),
        end: Math.min(m.end, sentence.end),
      }))
      .filter((span) => span.end > span.start);
    if (!under.length) return sentence;
    const voiceLufs = loudness(asSignal(excerpt(vocals, under))).lufsIntegrated;
    const musicLufs = loudness(asSignal(excerpt(music, under))).lufsIntegrated;
    return voiceLufs === null || musicLufs === null
      ? sentence
      : { ...sentence, againstMusic: { voiceLufs, musicLufs } };
  });
  return { ...voice, sentences };
}

/** Effects from the drums and from the bed where it plays neither music nor ambience, each level from the whole recording. */
async function fromStems(
  stemPaths: Record<string, string>,
  voice: Voice,
  vocals: Float32Array,
  mix: Float32Array,
) {
  const { pitched, drums } = await decodedStems(stemPaths);
  const bed = Object.keys(pitched).length ? mixed(Object.values(pitched)) : null;
  const { music, ambience, beats } = musicOf(pitched, drums, bed);
  const segments = music?.segments ?? [];
  const everythingElse = mixed(present([bed, drums]));
  const effects = findEffects({
    sources: [
      ...(drums ? [{ samples: drums }] : []),
      ...(bed ? [{ samples: bed, heldBy: [...segments, ...(ambience ?? [])] }] : []),
    ],
    sampleRate: READ_RATE,
    mix,
    music: bed && everythingElse,
    musicSegments: segments,
    beats,
    speech: [],
  });
  const stems = separatedStems(stemPaths, pitched, drums, vocals);
  const read = music ? againstMusic(voice, vocals, everythingElse, music.segments) : voice;
  return { voice: read, stems, effects, music, ambience };
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
    return { ...about, voice: null, effects: null, music: null, ambience: null, warnings };
  }
  if (!words.length)
    warnings.push(`no transcript: voice lines carry no words; ${transcribeHint(file)}`);
  const pitch = pitchTrack(await decodeMono(voicePath, PITCH_RATE));
  const mix = await recording(path, stemPaths !== null, voiceSamples);
  const levelOf = (span: Span) => spanDb(mix, READ_RATE, span.start, span.end);
  const voice = words.length
    ? voiceFromWords(words, pitch, levelOf)
    : voiceFromActivity(voiceSamples, READ_RATE, pitch, levelOf);
  if (stemPaths)
    return { ...about, ...(await fromStems(stemPaths, voice, voiceSamples, mix)), warnings };
  warnings.push("without stems, effects under speech are not found and music is not read");
  const effects = findEffects({
    sources: [{ samples: voiceSamples }],
    sampleRate: READ_RATE,
    mix,
    music: null,
    beats: [],
    speech: voice.sentences,
  });
  return { ...about, voice, effects, music: null, ambience: null, warnings };
}

function base(
  file: string,
  sha: string,
  duration: number,
  stemPaths: Record<string, string> | null,
  transcript: string | null,
): Omit<ReadAudio, "voice" | "effects" | "music" | "ambience" | "warnings"> {
  return {
    version: READ_VERSION,
    file,
    sha256: sha,
    duration,
    separation: stemPaths ? "stems" : "mix",
    stems: [],
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
