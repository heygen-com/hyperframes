import { existsSync } from "node:fs";
import {
  envelope,
  tempoOf,
  type AudioCapability,
  type AudioSignal,
  type LadderStep,
  type Section,
  type Tempo,
} from "@hyperframes/core/audio-analysis";
import { analyzeSignal, type Analysis, type AnalyzeOptions, type MarkedBeats } from "./analyze.js";
import { decodeAudio, probeAudio, type AudioStreamInfo } from "./decode.js";
import type { AudioTarget, Placement } from "./targets.js";
import {
  cacheKindAnalysis,
  kindCacheFile,
  kindSourceIdentity,
  readKindCache,
  type KindCacheSource,
} from "./kindCache.js";

export interface AudioItem {
  file: string;
  ref: string | null;
  /** The clip's element in the film; `null` for a file given by path. */
  element: "audio" | "video" | null;
  placement: Placement | null;
  /** Times below are file seconds; film time = placement.start + (t − placement.mediaStart) / placement.playbackRate. */
  timebase: "file";
  window: { from: number; to: number } | null;
  duration: number | null;
  sampleRate: number | null;
  channels: number | null;
  provenance: Partial<Record<AudioCapability, string | null>>;
  ladder?: Partial<Record<AudioCapability, LadderStep[]>>;
  warnings: string[];
  error?: string;
  [capability: string]: unknown;
}

export interface AudioReport {
  version: 1;
  items: AudioItem[];
}

const round = (t: number) => Math.round(t * 1000) / 1000;

/** Onsets at a window's edges need the audio just past them to tell a hit from the cut. */
const EDGE_CONTEXT_SECONDS = 0.1;
const KIND_SAMPLE_RATE = 16_000;
const KIND_DECODE_BYTES = 256 * 1024 * 1024;
const RHYTHM_SAMPLE_RATE = 22_050;
const RHYTHM: readonly AudioCapability[] = ["beats", "downbeats", "bpm", "sections"];

/** A file the film does not play yet, placed where the caller would put it. */
export async function previewTarget(
  path: string,
  file: string,
  at: number | null,
  mediaStart = 0,
): Promise<AudioTarget> {
  if (at === null) return { path, file, ref: null, kind: "file", placement: null };
  const stream = existsSync(path) ? await probeAudio(path) : null;
  if (stream && mediaStart >= stream.duration)
    throw new Error(
      `skipping ${mediaStart} s leaves nothing of ${file}, which is ${round(stream.duration)} s long`,
    );
  const length = stream ? stream.duration - mediaStart : 0;
  return {
    path,
    file,
    ref: null,
    kind: "file",
    placement: {
      start: at,
      end: round(at + length),
      dataStart: at,
      mediaStart,
      playbackRate: 1,
      volume: 1,
    },
    window: { from: mediaStart, seconds: length },
  };
}

const emptyItem = (target: AudioTarget): AudioItem => ({
  file: target.file,
  ref: target.ref,
  element: target.kind === "file" ? null : target.kind,
  placement: target.placement,
  timebase: "file",
  window: null,
  duration: null,
  sampleRate: null,
  channels: null,
  provenance: {},
  warnings: [],
});

function unreadable(target: AudioTarget): string | null {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(target.file)) return "remote sources are not analyzed";
  if (!existsSync(target.path)) return "file not found";
  return null;
}

/** The part of the file to decode: the window, with up to `EDGE_CONTEXT_SECONDS` either side the file has. */
function decodeSpan(target: AudioTarget, stream: AudioStreamInfo) {
  const from = target.window?.from ?? 0;
  const seconds = target.window?.seconds ?? stream.duration - from;
  const before = Math.min(from, EDGE_CONTEXT_SECONDS);
  const after = Math.max(0, Math.min(EDGE_CONTEXT_SECONDS, stream.duration - from - seconds));
  return {
    from,
    read: { from: from - before, seconds: seconds + before + after },
    context: { before, after },
  };
}

const loudest = (signal: AudioSignal) =>
  envelope(signal, { hopMs: 10, scale: "linear" }).values.reduce(
    (max, value) => Math.max(max, value),
    0,
  );

/** The decoded span without the margin added so an onset at the window edge is not the cut. */
function retained(signal: AudioSignal, before: number, after: number): AudioSignal {
  const skip = Math.round(before * signal.sampleRate);
  const length = signal.channels[0]?.length ?? 0;
  const end = Math.max(skip, length - Math.round(after * signal.sampleRate));
  if (!skip && end >= length) return signal;
  return { ...signal, channels: signal.channels.map((channel) => channel.subarray(skip, end)) };
}

/** A file placed after cutting its head says so when the cut part held its loudest moment. */
async function skippedPeak(target: AudioTarget, kept: AudioSignal, stream: AudioStreamInfo) {
  const skipped = target.kind === "file" ? (target.window?.from ?? 0) : 0;
  if (skipped <= 0) return [];
  const head = await decodeAudio(target.path, { from: 0, seconds: skipped }, stream);
  if (!head || loudest(head.signal) <= loudest(kept)) return [];
  return [
    `the loudest part of ${target.file} is in the first ${round(skipped)} s, which is skipped`,
  ];
}

function coversPart({ window, clip }: AudioTarget): boolean {
  return (
    !!window &&
    !!clip &&
    (window.from > clip.from || window.from + window.seconds < clip.from + clip.seconds)
  );
}

function clipKindRate(target: AudioTarget, stream: AudioStreamInfo): number {
  const seconds = Math.min(target.clip!.seconds, Math.max(0, stream.duration - target.clip!.from));
  const bytes = seconds * stream.sampleRate * stream.channels * 4;
  return bytes <= KIND_DECODE_BYTES
    ? stream.sampleRate
    : Math.min(stream.sampleRate, KIND_SAMPLE_RATE);
}

async function clipKindSignal(
  target: AudioTarget,
  stream: AudioStreamInfo,
  sampleRate: number,
  windowSignal?: AudioSignal,
  purpose = "kind",
): Promise<AudioSignal | undefined> {
  if (windowSignal) return windowSignal;
  const seconds = Math.min(target.clip!.seconds, Math.max(0, stream.duration - target.clip!.from));
  if (seconds * sampleRate * stream.channels * 4 > KIND_DECODE_BYTES)
    throw new Error(`whole clip exceeds the ${purpose} analysis decode limit`);
  return (await decodeAudio(target.path, target.clip!, stream, { sampleRate }))?.signal;
}

async function clipKind(
  target: AudioTarget,
  request: AnalyzeOptions,
  stream: AudioStreamInfo,
  cache?: KindCacheSource,
  windowSignal?: AudioSignal,
) {
  const sampleRate = windowSignal ? stream.sampleRate : clipKindRate(target, stream);
  const file = cache ? kindCacheFile(cache.dir, target, request, sampleRate, cache.identity) : null;
  const cached = readKindCache(file);
  if (cached) return cached;
  const signal = await clipKindSignal(target, stream, sampleRate, windowSignal);
  if (!signal) return null;
  const analysis = await analyzeSignal(signal, {
    ...request,
    capabilities: ["kind"],
    fileOffset: target.clip!.from,
    context: windowSignal ? request.context : undefined,
  });
  if (file && cache && file === kindCacheFile(cache.dir, target, request, sampleRate))
    cacheKindAnalysis(file, analysis);
  return analysis;
}

async function wholeClipKind(
  target: AudioTarget,
  signal: AudioSignal,
  request: AnalyzeOptions,
  stream: AudioStreamInfo,
  cache?: KindCacheSource,
): Promise<Analysis> {
  try {
    const kind = await clipKind(
      target,
      request,
      stream,
      cache,
      coversPart(target) ? undefined : signal,
    );
    if (!kind) throw new Error("no audio stream");
    return kind;
  } catch (error) {
    const kind = await analyzeSignal(signal, { ...request, capabilities: ["kind"] });
    kind.warnings.push(
      `kind uses only the selected range: could not analyze the whole clip (${firstLine(error)})`,
    );
    return kind;
  }
}

const firstLine = (error: unknown) =>
  error instanceof Error ? error.message.split("\n")[0] : String(error);

const between = (from: number, to: number) => (t: number) => t >= from && t < to;

function beatsBetween(value: MarkedBeats, from: number, to: number): MarkedBeats {
  const keep = value.times.map(between(from, to));
  return {
    ...value,
    times: value.times.filter((_, i) => keep[i]),
    unheard: value.unheard.filter((_, i) => keep[i]),
  };
}

/** A window keeps the clip's beats when at least two, and at least half, of them are heard there. */
const PULSE_BEATS = 2;

const heardTimes = (beats: MarkedBeats) => beats.times.filter((_, i) => !beats.unheard[i]);

interface RhythmWindow {
  from: number;
  to: number;
  beats: MarkedBeats | null;
  pulse: boolean;
}

const CUTS: Partial<Record<AudioCapability, (value: unknown, window: RhythmWindow) => unknown>> = {
  beats: (_value, { beats, pulse }) =>
    pulse ? beats : { times: [], unheard: [], confidence: 0, reason: "no steady beat" },
  downbeats: (value, { from, to, pulse }) =>
    pulse
      ? beatsBetween(value as MarkedBeats, from, to)
      : { times: [], unheard: [], meter: null, confidence: "low" },
  bpm: (value, { from, to, beats, pulse }): Tempo =>
    pulse && beats
      ? {
          value: tempoOf(heardTimes(beats)).value,
          curve: (value as Tempo).curve.filter((point) => between(from, to)(point.t)),
        }
      : { value: null, curve: [] },
  sections: (value, { from, to }) => {
    const sections = value as { spans: Section[] };
    return { ...sections, spans: sections.spans.filter((s) => s.end > from && s.start < to) };
  },
};

const beatsIn = (values: Analysis["values"], from: number, to: number) =>
  values.beats ? beatsBetween(values.beats as MarkedBeats, from, to) : null;

const pulseIn = (beats: MarkedBeats | null) =>
  !!beats && heardTimes(beats).length >= Math.max(PULSE_BEATS, beats.times.length / 2);

function rhythmBetween(
  values: Analysis["values"],
  asked: readonly AudioCapability[],
  from: number,
  to: number,
): Analysis["values"] {
  const beats = beatsIn(values, from, to);
  const window = { from, to, beats, pulse: pulseIn(beats) };
  return Object.fromEntries(
    asked.map((capability) => {
      const value = values[capability];
      return [capability, value == null ? value : (CUTS[capability]?.(value, window) ?? value)];
    }),
  );
}

/** Rhythm read off the whole clip and cut to the window: a window alone is too short to hear a beat, a bar or a section. */
async function wholeClipRhythm(
  target: AudioTarget,
  signal: AudioSignal,
  request: AnalyzeOptions,
  stream: AudioStreamInfo,
): Promise<Analysis> {
  const asked = request.capabilities.filter((capability) => RHYTHM.includes(capability));
  try {
    const rate = Math.min(stream.sampleRate, RHYTHM_SAMPLE_RATE);
    const clip = await clipKindSignal(target, stream, rate, undefined, "rhythm");
    if (!clip) throw new Error("no audio stream");
    const needsBeats = asked.some((c) => c === "bpm" || c === "downbeats");
    const measure = needsBeats && !asked.includes("beats") ? [...asked, "beats" as const] : asked;
    const whole = await analyzeSignal(clip, {
      ...request,
      capabilities: measure,
      fileOffset: target.clip!.from,
      context: undefined,
    });
    const from = request.fileOffset ?? 0;
    const to = from + target.window!.seconds;
    const cut = rhythmBetween(whole.values, asked, from, to);
    const beatAnswers = asked.filter((capability) => capability !== "sections");
    if (!beatAnswers.length || pulseIn(beatsIn(whole.values, from, to)))
      return { ...whole, values: cut };
    // No pulse on the clip's grid here can be a section far under the clip's loudest: the window reads it alone.
    const own = await analyzeSignal(signal, { ...request, capabilities: beatAnswers });
    return {
      ...own,
      values: { ...cut, ...own.values },
      provenance: { ...whole.provenance, ...own.provenance },
      ladder: { ...whole.ladder, ...own.ladder },
      warnings: [...new Set([...whole.warnings, ...own.warnings])],
    };
  } catch (error) {
    const rhythm = await analyzeSignal(signal, { ...request, capabilities: asked });
    rhythm.warnings.push(
      `beats, bars and sections use only the selected range: could not analyze the whole clip (${firstLine(error)})`,
    );
    return rhythm;
  }
}

/** Analyzes the window, except a kind and a rhythm the window would misjudge, which come from the whole clip. */
async function analyzeWindow(
  target: AudioTarget,
  signal: AudioSignal,
  request: AnalyzeOptions,
  stream: AudioStreamInfo,
  cache?: KindCacheSource,
) {
  const kindApart = request.capabilities.includes("kind") && target.clip !== undefined;
  const rhythmApart =
    coversPart(target) && request.capabilities.some((capability) => RHYTHM.includes(capability));
  if (!kindApart && !rhythmApart) return analyzeSignal(signal, request);
  const apart = (capability: AudioCapability) =>
    (kindApart && capability === "kind") || (rhythmApart && RHYTHM.includes(capability));
  const parts = [
    await analyzeSignal(signal, {
      ...request,
      capabilities: request.capabilities.filter((capability) => !apart(capability)),
    }),
    ...(kindApart ? [await wholeClipKind(target, signal, request, stream, cache)] : []),
    ...(rhythmApart ? [await wholeClipRhythm(target, signal, request, stream)] : []),
  ];
  const [window] = parts;
  return {
    ...window!,
    values: Object.assign({}, ...parts.map((part) => part.values)),
    provenance: Object.assign({}, ...parts.map((part) => part.provenance)),
    ladder: Object.assign({}, ...parts.map((part) => part.ladder)),
    warnings: [...new Set(parts.flatMap((part) => part.warnings))],
  };
}

async function analyzeTarget(
  target: AudioTarget,
  request: AnalyzeOptions,
  full: boolean,
  cacheDir?: string,
): Promise<AudioItem> {
  const item = emptyItem(target);
  const problem = unreadable(target);
  if (problem) return { ...item, error: problem };
  const stream = await probeAudio(target.path);
  if (!stream) return { ...item, error: "no audio stream" };
  const cache = cacheDir ? { dir: cacheDir, identity: kindSourceIdentity(target.path) } : undefined;
  const { from, read, context } = decodeSpan(target, stream);
  const decoded = await decodeAudio(target.path, read, stream);
  if (!decoded) return { ...item, error: "no audio stream" };
  const analysis = await analyzeWindow(
    target,
    decoded.signal,
    { ...request, fileOffset: from, context },
    stream,
    cache,
  );
  return {
    ...item,
    window: { from: round(from), to: round(from + analysis.analyzed) },
    duration: round(stream.duration),
    sampleRate: stream.sampleRate,
    channels: stream.channels,
    ...analysis.values,
    provenance: analysis.provenance,
    ...(full ? { ladder: analysis.ladder } : {}),
    warnings: [
      ...analysis.warnings,
      ...(await skippedPeak(
        target,
        retained(decoded.signal, context.before, context.after),
        stream,
      )),
    ],
  };
}

export async function analyzeTargets(
  targets: readonly AudioTarget[],
  request: AnalyzeOptions,
  full = false,
  cacheDir?: string,
): Promise<AudioReport> {
  const items: AudioItem[] = [];
  for (const target of targets) {
    try {
      items.push(await analyzeTarget(target, request, full, cacheDir));
    } catch (error) {
      const reason = error instanceof Error ? error.message.split("\n")[0]! : String(error);
      items.push({ ...emptyItem(target), error: `could not read: ${reason}` });
    }
  }
  return { version: 1, items };
}
