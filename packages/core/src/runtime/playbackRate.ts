export function normalizePlaybackRate(raw: number): number {
  return Number.isFinite(raw) && raw > 0 ? Math.max(0.1, Math.min(5, raw)) : 1;
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
      : typeof HTMLMediaElement !== "undefined" && el instanceof HTMLMediaElement
        ? el.defaultPlaybackRate
        : 1;
  return normalizePlaybackRate(raw);
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
    readElementPlaybackRate(el),
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
  playbackRate: number,
): number | null {
  if (!Number.isFinite(sourceDuration)) return null;
  const remaining = Math.max(0, sourceDuration - mediaStart);
  return remaining / normalizePlaybackRate(playbackRate);
}
import { parseNumeric } from "./startExpression";
