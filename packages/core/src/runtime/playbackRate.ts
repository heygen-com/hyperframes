import {
  clampPlaybackRate,
  readAuthoredDurationSeconds,
  readDataDurationSeconds,
  readMediaOffsetSeconds,
  readPlaybackRate,
  resolveMediaDuration,
  resolveNaturalDurationSeconds,
} from "@hyperframes/parsers/media-duration";
import { resolveRateSpec, timeAtSourceTime, type RateSpec } from "../speedRamp";
import { isImageElement, isMediaElement } from "./domRealm";
import { parseNumeric } from "./startExpression";

export const normalizePlaybackRate = clampPlaybackRate;

/** Parse a literal numeric timing attribute without accepting trailing units or garbage. */
export function parseStrictFiniteTimingNumber(raw: string | null | undefined): number | null {
  return parseNumeric(raw);
}

export function readElementPlaybackRate(el: Pick<Element, "getAttribute">): number {
  return readPlaybackRate(
    (name) => el.getAttribute(name),
    isMediaElement(el) ? el.defaultPlaybackRate : 1,
  );
}

/** The clip's rate: its `rate` lane when present, otherwise the constant rate. */
export function readElementRateSpec(el: Pick<Element, "getAttribute">): RateSpec {
  return resolveRateSpec(el.getAttribute("data-automation"), readElementPlaybackRate(el));
}

export function readMediaStart(el: Pick<Element, "getAttribute">): number {
  return readMediaOffsetSeconds((name) => el.getAttribute(name));
}

export function resolveNaturalMediaTimelineDuration(
  el: Pick<Element, "getAttribute">,
  sourceDuration: number,
): number | null {
  return resolveNaturalMediaTimelineDurationFromValues(
    sourceDuration,
    readMediaStart(el),
    readElementRateSpec(el),
  );
}

/**
 * How long a media element occupies the timeline: an authored `data-duration` trim, otherwise
 * the source's natural length adjusted for playback start and rate (lane-aware). `null` while
 * the source has not reported a duration yet. The authored/pending decision is the shared
 * parsers resolver's; only a `rate` lane's arithmetic stays here, because lanes live in core.
 */
export function resolveMediaElementDurationSeconds(
  el: Pick<Element, "getAttribute"> & { duration: number },
): number | null {
  const resolved = resolveMediaDuration({
    tag: "video", // video and audio resolve identically
    authoredDurationSeconds: readDataDurationSeconds((name) => el.getAttribute(name)),
    sourceDurationSeconds: Number.isFinite(el.duration) ? el.duration : null,
    mediaStartSeconds: readMediaStart(el),
    playbackRate: readElementPlaybackRate(el),
  });
  return resolved.source === "media"
    ? resolveNaturalMediaTimelineDuration(el, el.duration)
    : resolved.seconds;
}

/** A timed `<img>` (`data-start` or `data-track-index`) gets the dropped-image default unless
 *  trimmed by `data-duration` or `data-end`; a bare `<img>` is a static layer. `null` otherwise. */
export function resolveTimedImageDurationSeconds(el: Element, startSeconds = 0): number | null {
  if (!isImageElement(el)) return null;
  if (!el.hasAttribute("data-start") && !el.hasAttribute("data-track-index")) return null;
  return resolveMediaDuration({
    tag: "img",
    authoredDurationSeconds: readAuthoredDurationSeconds(
      (name) => el.getAttribute(name),
      startSeconds,
    ),
    sourceDurationSeconds: null,
    mediaStartSeconds: 0,
    playbackRate: 1,
  }).seconds;
}

/** A constant rate goes through the shared arithmetic; a `rate` lane integrates over its points. */
export function resolveNaturalMediaTimelineDurationFromValues(
  sourceDuration: number,
  mediaStart: number,
  playbackRate: RateSpec,
): number | null {
  if (typeof playbackRate === "number") {
    return resolveNaturalDurationSeconds(sourceDuration, mediaStart, playbackRate);
  }
  if (!Number.isFinite(sourceDuration)) return null;
  return timeAtSourceTime(playbackRate, Math.max(0, sourceDuration - mediaStart));
}
