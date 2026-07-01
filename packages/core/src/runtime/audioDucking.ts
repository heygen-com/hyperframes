import type { VolumeKeyframe } from "./mediaVolumeEnvelope.js";

export type DuckAmount = number | string;

export interface DuckTimelineLike {
  set: (target: DuckTrack, vars: { volume: number }, atSeconds?: number) => unknown;
  to: (
    target: DuckTrack,
    vars: { volume: number; duration: number; ease: "none"; overwrite: false },
    atSeconds?: number,
  ) => unknown;
}

export interface DuckOptions {
  /**
   * Duck amount as a linear gain (0.25) or dB string/negative number ("-12dB", -12).
   * Defaults to -12 dB.
   */
  amount?: DuckAmount;
  /** Fade-in/fade-out ramp duration in seconds. Defaults to 0.3. */
  fade?: number;
  /** GSAP-compatible paused timeline that receives the generated volume ramps. */
  timeline?: DuckTimelineLike;
}

export interface DuckTrackTiming {
  start: number;
  end?: number;
  duration?: number;
  volume?: number;
  muted?: boolean;
  hasAudio?: boolean;
}

export type DuckTrack = HTMLAudioElement | HTMLVideoElement | DuckTrackTiming;

interface DuckInterval {
  start: number;
  end: number;
}

interface ResolvedDuckTrack extends DuckInterval {
  volume: number;
  muted: boolean;
  hasAudio: boolean;
}

const DEFAULT_DUCK_AMOUNT = "-12dB";
const DEFAULT_DUCK_FADE_SECONDS = 0.3;

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  return Math.max(0, Math.min(1, volume));
}

function finiteNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const parsed = typeof raw === "number" ? raw : Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function signedAmountToGain(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return value < 0 ? Math.pow(10, value / 20) : value;
}

function stringAmountToGain(raw: string): number {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return 1;

  if (trimmed.endsWith("db")) {
    const db = Number.parseFloat(trimmed.slice(0, -2));
    return Number.isFinite(db) ? Math.pow(10, db / 20) : 1;
  }

  return signedAmountToGain(Number.parseFloat(trimmed));
}

function amountToGain(amount: DuckAmount | undefined): number {
  const raw = amount ?? DEFAULT_DUCK_AMOUNT;
  if (typeof raw === "number") return signedAmountToGain(raw);
  return stringAmountToGain(raw);
}

function timingEnd(
  start: number,
  end: number | undefined,
  duration: number | undefined,
): number | null {
  const explicitEnd = finiteNumber(end);
  if (explicitEnd !== null) return explicitEnd;
  const resolvedDuration = finiteNumber(duration);
  return resolvedDuration === null ? null : start + resolvedDuration;
}

function elementEnd(el: HTMLAudioElement | HTMLVideoElement, start: number): number | null {
  const authoredEnd = finiteNumber(el.dataset.end);
  if (authoredEnd !== null) return authoredEnd;

  const authoredDuration = finiteNumber(el.dataset.duration);
  if (authoredDuration !== null) return start + authoredDuration;

  return Number.isFinite(el.duration) && el.duration > 0 ? start + el.duration : null;
}

function isHtmlMediaTrack(track: DuckTrack): track is HTMLAudioElement | HTMLVideoElement {
  return (
    typeof HTMLAudioElement !== "undefined" &&
    typeof HTMLVideoElement !== "undefined" &&
    (track instanceof HTMLAudioElement || track instanceof HTMLVideoElement)
  );
}

function hasUsableEnd(start: number, end: number | null): end is number {
  return end !== null && end > start;
}

function resolveElementTrack(track: HTMLAudioElement | HTMLVideoElement): ResolvedDuckTrack | null {
  const start = finiteNumber(track.dataset.start) ?? 0;
  const end = elementEnd(track, start);
  if (!hasUsableEnd(start, end)) return null;
  const staticVolume = finiteNumber(track.dataset.volume);
  return {
    start,
    end,
    volume: clampVolume(staticVolume ?? track.volume),
    muted: track.muted,
    hasAudio: track instanceof HTMLAudioElement || track.dataset.hasAudio === "true",
  };
}

function resolveTimingTrack(track: DuckTrackTiming): ResolvedDuckTrack | null {
  const start = finiteNumber(track.start);
  if (start === null) return null;
  const end = timingEnd(start, track.end, track.duration);
  if (!hasUsableEnd(start, end)) return null;
  return {
    start,
    end,
    volume: clampVolume(track.volume ?? 1),
    muted: track.muted === true,
    hasAudio: track.hasAudio !== false,
  };
}

function resolveTrack(track: DuckTrack): ResolvedDuckTrack | null {
  return isHtmlMediaTrack(track) ? resolveElementTrack(track) : resolveTimingTrack(track);
}

function isAudible(track: ResolvedDuckTrack): boolean {
  return track.hasAudio && !track.muted && track.volume > 0;
}

function mergeIntervals(intervals: DuckInterval[], maxGap: number): DuckInterval[] {
  const sorted = intervals
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start);
  const merged: DuckInterval[] = [];

  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end + maxGap) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }

  return merged;
}

function intersectIntervals(track: DuckInterval, intervals: DuckInterval[]): DuckInterval[] {
  const overlaps: DuckInterval[] = [];
  for (const interval of intervals) {
    const start = Math.max(track.start, interval.start);
    const end = Math.min(track.end, interval.end);
    if (end > start) overlaps.push({ start, end });
  }
  return overlaps;
}

function roundedPoint(time: number, volume: number): VolumeKeyframe {
  return {
    time: Number(time.toFixed(6)),
    volume: Number(clampVolume(volume).toFixed(6)),
  };
}

function addPoint(keyframes: VolumeKeyframe[], time: number, volume: number): void {
  const point = roundedPoint(time, volume);
  const previous = keyframes.at(-1);
  if (previous && Math.abs(previous.time - point.time) < 0.000001) {
    previous.volume = point.volume;
  } else {
    keyframes.push(point);
  }
}

function appendDuckedWindow(
  keyframes: VolumeKeyframe[],
  music: ResolvedDuckTrack,
  overlap: DuckInterval,
  duckVolume: number,
  fade: number,
): void {
  const duration = overlap.end - overlap.start;
  const rampDuration = Math.min(fade, duration / 2);
  const rampStart = Math.max(music.start, overlap.start - rampDuration);
  const rampEnd = Math.min(music.end, overlap.end + rampDuration);

  if (rampStart < overlap.start) addPoint(keyframes, rampStart, music.volume);
  addPoint(keyframes, overlap.start, duckVolume);
  addPoint(keyframes, overlap.end, duckVolume);
  if (rampEnd > overlap.end) addPoint(keyframes, rampEnd, music.volume);
}

function buildDuckKeyframes(
  music: ResolvedDuckTrack,
  voiceIntervals: DuckInterval[],
  options: DuckOptions,
): VolumeKeyframe[] {
  if (!isAudible(music)) return [];

  const fade = Math.max(0, finiteNumber(options.fade) ?? DEFAULT_DUCK_FADE_SECONDS);
  const duckVolume = clampVolume(music.volume * amountToGain(options.amount));
  if (duckVolume >= music.volume - 0.000001) return [];

  const overlaps = mergeIntervals(intersectIntervals(music, voiceIntervals), fade * 2);
  const keyframes: VolumeKeyframe[] = [];
  for (const overlap of overlaps) appendDuckedWindow(keyframes, music, overlap, duckVolume, fade);
  return keyframes;
}

function resolveVoiceIntervals(voiceTracks: DuckTrack | DuckTrack[]): DuckInterval[] {
  const tracks = Array.isArray(voiceTracks) ? voiceTracks : [voiceTracks];
  return mergeIntervals(
    tracks
      .map((track) => resolveTrack(track))
      .filter((track): track is ResolvedDuckTrack => track !== null && isAudible(track))
      .map((track) => ({ start: track.start, end: track.end })),
    0,
  );
}

function writeKeyframes(
  target: DuckTrack,
  timeline: DuckTimelineLike | undefined,
  keyframes: VolumeKeyframe[],
): void {
  const [first, ...rest] = keyframes;
  if (!timeline || !first) return;

  timeline.set(target, { volume: first.volume }, first.time);
  let previous = first;

  for (const current of rest) {
    const duration = current.time - previous.time;
    if (duration <= 0.000001) {
      timeline.set(target, { volume: current.volume }, current.time);
    } else {
      timeline.to(
        target,
        { volume: current.volume, duration, ease: "none", overwrite: false },
        previous.time,
      );
    }
    previous = current;
  }
}

/**
 * Programmatically author deterministic music ducking.
 *
 * The helper computes overlap windows from already-authored media timings and
 * writes linear volume ramps onto the supplied GSAP-compatible timeline. The
 * producer's existing volume-automation probe then turns those timeline writes
 * into the same render-time volume keyframes used by hand-authored fades.
 */
export function duck(
  musicTrack: DuckTrack,
  voiceTracks: DuckTrack | DuckTrack[],
  options: DuckOptions = {},
): VolumeKeyframe[] {
  const music = resolveTrack(musicTrack);
  if (!music) return [];

  const keyframes = buildDuckKeyframes(music, resolveVoiceIntervals(voiceTracks), options);
  writeKeyframes(musicTrack, options.timeline, keyframes);
  return keyframes;
}
