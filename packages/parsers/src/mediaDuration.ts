/** The one rule for a media element's timeline length; hosts only supply the source length. */

import { parseNumeric } from "./compositionContract.js";

export type MediaTag = "video" | "audio" | "img";

/** Reads a named attribute's raw string value. Works for a DOM Element's `getAttribute`
 *  (browser or linkedom) or a plain attrs-record lookup -- callers pick whichever they have. */
export type AttrReader = (name: string) => string | null | undefined;

const nonNegative = (raw: string | null | undefined): number | null => {
  const value = parseNumeric(raw);
  return value !== null && value >= 0 ? value : null;
};

/** Playback offset into the source: `data-playback-start`, falling back to the older
 *  `data-media-start`; an invalid or negative value falls through to the next. One reader for
 *  every host -- the runtime and `htmlParser` used to read this two different ways. */
export function readMediaOffsetSeconds(getAttr: AttrReader): number {
  return (
    nonNegative(getAttr("data-playback-start")) ?? nonNegative(getAttr("data-media-start")) ?? 0
  );
}

/** The one bound on a clip's playback rate; core re-exports it for the rate lane. */
export const MIN_PLAYBACK_RATE = 0.1;
export const MAX_PLAYBACK_RATE = 10;

/** A playback rate clamped to the bounds above; anything non-positive or non-finite is 1. */
export function clampPlaybackRate(raw: number): number {
  return Number.isFinite(raw) && raw > 0
    ? Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, raw))
    : 1;
}

/** `data-playback-rate`, parsed like the browser parses a native rate (`"2x"` is 2), else
 *  `fallback` (a media element's own `defaultPlaybackRate` in the browser), clamped. */
export function readPlaybackRate(getAttr: AttrReader, fallback = 1): number {
  const authored = Number.parseFloat(getAttr("data-playback-rate") ?? "");
  return clampPlaybackRate(Number.isFinite(authored) && authored > 0 ? authored : fallback);
}

/** `data-duration` when it is a positive number, else null. */
export function readDataDurationSeconds(getAttr: AttrReader): number | null {
  const duration = parseNumeric(getAttr("data-duration"));
  return duration !== null && duration > 0 ? duration : null;
}

/** An authored trim: `data-duration` if positive, else `data-end - start` if `data-end` is
 *  authored, else null (nothing authored). */
export function readAuthoredDurationSeconds(
  getAttr: AttrReader,
  startSeconds: number,
): number | null {
  const duration = readDataDurationSeconds(getAttr);
  if (duration !== null) return duration;
  const end = parseNumeric(getAttr("data-end"));
  return end !== null ? end - startSeconds : null;
}

/** The dropped-image default: what Studio gives a freshly dropped image before any trim.
 *  One owner; everything needing an untrimmed image length imports this. */
export const DEFAULT_IMAGE_TIMELINE_DURATION_SECONDS = 3;

/** The arithmetic alone: no attribute reading, no DOM, no probing. */
export function resolveNaturalDurationSeconds(
  sourceDurationSeconds: number,
  mediaStartSeconds: number,
  playbackRate: number,
): number | null {
  if (!Number.isFinite(sourceDurationSeconds)) return null;
  const remaining = Math.max(0, sourceDurationSeconds - mediaStartSeconds);
  return remaining / clampPlaybackRate(playbackRate);
}

export type MediaDurationSource = "authored" | "media" | "default" | "pending";

export interface MediaDurationResult {
  seconds: number | null;
  source: MediaDurationSource;
  /** Set only when source is "pending": why nothing could be resolved yet. */
  reason?: string;
}

export interface ResolveMediaDurationInput {
  tag: MediaTag;
  /** From `readAuthoredDurationSeconds`, or null when nothing is authored. */
  authoredDurationSeconds: number | null;
  /** The source's own length once a probe has answered, else null. Ignored for `img`. */
  sourceDurationSeconds: number | null;
  mediaStartSeconds: number;
  playbackRate: number;
}

export function resolveMediaDuration(input: ResolveMediaDurationInput): MediaDurationResult {
  const { tag, authoredDurationSeconds, sourceDurationSeconds, mediaStartSeconds, playbackRate } =
    input;
  if (authoredDurationSeconds !== null && authoredDurationSeconds > 0) {
    return { seconds: authoredDurationSeconds, source: "authored" };
  }
  if (tag === "img") {
    return { seconds: DEFAULT_IMAGE_TIMELINE_DURATION_SECONDS, source: "default" };
  }
  if (sourceDurationSeconds === null) {
    return { seconds: null, source: "pending", reason: "source duration not yet probed" };
  }
  const seconds = resolveNaturalDurationSeconds(
    sourceDurationSeconds,
    mediaStartSeconds,
    playbackRate,
  );
  if (seconds === null) {
    return { seconds: null, source: "pending", reason: "source reported a non-finite duration" };
  }
  return { seconds, source: "media" };
}

/** Readers not yet converted to `resolveMediaDuration`; each reader PR removes its entry, so this only shrinks. */
export const PENDING_MEDIA_DURATION_READERS = [
  "core/src/runtime/init.ts (visibility end, clock, seek, WebAudio scheduling)",
  "core/src/compiler/timingCompiler.ts compileTag",
  "core/src/compiler/htmlCompiler.ts compileHtml",
  "producer/src/services/htmlCompiler.ts resolveMediaDuration",
  "engine/src/services/videoFrameExtractor.ts (extraction window)",
  "engine/src/services/audioMixer.ts",
  "parsers/src/htmlParser.ts (defaults to 5s, reads only data-media-start)",
  "studio (timelineDOM.ts, timelineElementHelpers.ts, useTimelineSyncCallbacks.ts)",
] as const;
