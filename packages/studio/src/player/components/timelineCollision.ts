import type { TimelineElement } from "../store/playerStore";

/** Half-open overlap test: [aStart, aEnd) intersects [bStart, bEnd). */
export function timeRangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * True when no clip on `track` overlaps [start, end) — excluding the clip
 * identified by `excludeKey` (the one being dragged).
 */
export function isLaneFree(
  elements: TimelineElement[],
  track: number,
  start: number,
  end: number,
  excludeKey: string | null,
): boolean {
  return !elements.some(
    (el) =>
      (el.key ?? el.id) !== excludeKey &&
      el.track === track &&
      timeRangesOverlap(start, end, el.start, el.start + el.duration),
  );
}

export interface PlacementInput {
  elements: TimelineElement[];
  desiredTrack: number;
  start: number;
  duration: number;
  trackOrder: number[];
  excludeKey: string | null;
}

export interface PlacementResult {
  /** The lane the clip should land on. */
  track: number;
  /**
   * True when no existing lane was free and the caller should insert a new
   * track instead of landing on `track` (which is then the desired lane as a
   * last-resort fallback). Consumed in later stages (2b/2c); stage 2a ignores it.
   */
  needsInsert: boolean;
}

/**
 * Resolve where a dragged clip should land, avoiding overlap. If the desired
 * lane is free, keep it. Otherwise search the nearest free lane, **preferring
 * up** (all lanes above, nearest first), then down. If none is free, signal an
 * insert and fall back to the desired lane.
 */
export function resolvePlacement({
  elements,
  desiredTrack,
  start,
  duration,
  trackOrder,
  excludeKey,
}: PlacementInput): PlacementResult {
  const end = start + duration;
  if (isLaneFree(elements, desiredTrack, start, end, excludeKey)) {
    return { track: desiredTrack, needsInsert: false };
  }
  const idx = trackOrder.indexOf(desiredTrack);
  if (idx === -1) return { track: desiredTrack, needsInsert: false };

  // Prefer up: nearest lane above first, then the rest above.
  for (let up = idx - 1; up >= 0; up--) {
    if (isLaneFree(elements, trackOrder[up], start, end, excludeKey)) {
      return { track: trackOrder[up], needsInsert: false };
    }
  }
  // Then down: nearest lane below first.
  for (let down = idx + 1; down < trackOrder.length; down++) {
    if (isLaneFree(elements, trackOrder[down], start, end, excludeKey)) {
      return { track: trackOrder[down], needsInsert: false };
    }
  }
  return { track: desiredTrack, needsInsert: true };
}
