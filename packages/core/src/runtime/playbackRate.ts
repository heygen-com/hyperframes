import { MAX_PLAYBACK_RATE, MIN_PLAYBACK_RATE } from "../playbackRateBounds";
import { resolveRateSpec, timeAtSourceTime, type RateSpec } from "../speedRamp";
import { isMediaElement } from "./domRealm";

export function normalizePlaybackRate(raw: number): number {
  return Number.isFinite(raw) && raw > 0
    ? Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, raw))
    : 1;
}

/** Parse a literal numeric timing attribute without accepting trailing units or garbage. */
export function parseStrictFiniteTimingNumber(raw: string | null | undefined): number | null {
  return parseNumeric(raw);
}

export function readElementPlaybackRate(el: Pick<Element, "getAttribute">): number {
  const authored = Number.parseFloat(el.getAttribute("data-playback-rate") ?? "");
  const raw =
    Number.isFinite(authored) && authored > 0
      ? authored
      : isMediaElement(el)
        ? el.defaultPlaybackRate
        : 1;
  return normalizePlaybackRate(raw);
}

/** A constant rate clamped to the shared range; a lane is already normalised by its parser. */
export function normalizeRateSpec(spec: RateSpec | undefined): RateSpec {
  return typeof spec === "object" ? spec : normalizePlaybackRate(spec ?? 1);
}

/** The clip's rate: its `rate` lane when present, otherwise the constant rate. */
export function readElementRateSpec(el: Pick<Element, "getAttribute">): RateSpec {
  return resolveRateSpec(el.getAttribute("data-automation"), readElementPlaybackRate(el));
}

export function readMediaStart(el: Pick<Element, "getAttribute">): number {
  const parse = (raw: string | null): number | null => {
    const value = parseStrictFiniteTimingNumber(raw);
    if (value == null) return null;
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  return (
    parse(el.getAttribute("data-playback-start")) ?? parse(el.getAttribute("data-media-start")) ?? 0
  );
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
 * How long a media element occupies the timeline: an explicit `data-duration`
 * trim if authored, otherwise the natural source length adjusted for playback
 * start and rate. `null` when the source has not reported a duration yet.
 *
 * Single owner for the media-window scan run by BOTH the runtime's duration
 * floor and the clip manifest.
 */
export function resolveMediaElementDurationSeconds(
  el: Pick<Element, "getAttribute"> & { duration: number },
): number | null {
  const declaredDuration = parseStrictFiniteTimingNumber(el.getAttribute("data-duration"));
  if (declaredDuration != null && declaredDuration > 0) return declaredDuration;
  if (Number.isFinite(el.duration)) return resolveNaturalMediaTimelineDuration(el, el.duration);
  return null;
}

export function resolveNaturalMediaTimelineDurationFromValues(
  sourceDuration: number,
  mediaStart: number,
  playbackRate: RateSpec,
): number | null {
  if (!Number.isFinite(sourceDuration)) return null;
  const remaining = Math.max(0, sourceDuration - mediaStart);
  return timeAtSourceTime(
    typeof playbackRate === "number" ? normalizePlaybackRate(playbackRate) : playbackRate,
    remaining,
  );
}
import { parseNumeric } from "./startExpression";
