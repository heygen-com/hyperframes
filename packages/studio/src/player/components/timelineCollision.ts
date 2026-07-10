import type { TimelineElement } from "../store/playerStore";

/**
 * Keep a landing track inside the dragged clip's kind-zone: visual clips stay in
 * the rows ABOVE the first audio lane; audio clips stay AT/BELOW it. Prevents a
 * clip from appearing to land in the wrong zone mid-drag (which normalizeToZones
 * would then snap back). `audioRow` = index in `trackOrder` of the first audio
 * lane, or -1 when there is no audio zone yet (then it's a no-op).
 */
export function clampTrackToZone(
  targetTrack: number,
  trackOrder: number[],
  audioRow: number,
  isAudio: boolean,
): number {
  if (audioRow < 0) return targetTrack;
  const row = trackOrder.indexOf(targetTrack);
  if (row < 0) return targetTrack;
  if (isAudio) return row >= audioRow ? targetTrack : (trackOrder[audioRow] ?? targetTrack);
  return row < audioRow ? targetTrack : (trackOrder[audioRow - 1] ?? targetTrack);
}

/**
 * Whether a new-track insert at boundary `insertRow` is allowed for a clip of the
 * given kind. Visual clips may only insert visual lanes (boundary at/above the top
 * of the audio zone); audio clips may only insert audio lanes (boundary at/below
 * it) — so audio clips CAN create a new audio track, and neither kind inserts into
 * the other's zone. `audioRow` = first audio lane row, or -1 (no audio zone) → any.
 */
export function isInsertAllowedForZone(
  insertRow: number,
  audioRow: number,
  isAudio: boolean,
): boolean {
  if (audioRow < 0) return true;
  return isAudio ? insertRow >= audioRow : insertRow <= audioRow;
}

/**
 * The full drop-placement decision for a dragged clip — one pure, testable unit.
 * Enforces: NO time-overlap on a single track; a clip stays in its kind-zone;
 * a new track is created only when needed. Order of resolution:
 *   1. Deliberate boundary insert (pointer near a lane edge), if it's in the
 *      clip's own zone → create a new track there.
 *   2. Otherwise land on a lane: clamp the aimed track to the clip's zone, take it
 *      if free at [start, start+duration), else the nearest FREE lane in the zone
 *      (prefer up), else auto-create a new track right below the aimed lane.
 * `audioTracks` = the set of track indices that currently hold audio (so the fn
 * needs no element-kind import). Returns the landing `track` and, when a new track
 * should be created, the `insertRow` boundary (else null).
 */
export function resolveZoneDropPlacement(input: {
  order: number[];
  audioTracks: ReadonlySet<number>;
  elements: TimelineElement[];
  desiredTrack: number;
  deliberateInsertRow: number | null;
  start: number;
  duration: number;
  dragKey: string;
  isAudio: boolean;
}): { track: number; insertRow: number | null } {
  const { order, audioTracks, elements, desiredTrack, deliberateInsertRow } = input;
  const { start, duration, dragKey, isAudio } = input;
  const audioRow = order.findIndex((t) => audioTracks.has(t));

  if (
    deliberateInsertRow !== null &&
    isInsertAllowedForZone(deliberateInsertRow, audioRow, isAudio)
  ) {
    return { track: desiredTrack, insertRow: deliberateInsertRow };
  }

  const desired = clampTrackToZone(desiredTrack, order, audioRow, isAudio);
  const zoneTracks = order.filter((t) => audioTracks.has(t) === isAudio);
  const placement = resolvePlacement({
    elements,
    desiredTrack: desired,
    start,
    duration,
    trackOrder: zoneTracks,
    excludeKey: dragKey,
  });
  if (placement.needsInsert) {
    const desiredRow = order.indexOf(desired);
    return { track: desired, insertRow: desiredRow >= 0 ? desiredRow + 1 : order.length };
  }
  return { track: placement.track, insertRow: null };
}

/**
 * Fraction of a track height near a lane boundary that switches a vertical drag
 * from "target this lane" into "insert a new track at this boundary". Tuned by
 * feel — bigger = easier to hit boundaries (harder to land on a lane).
 */
const INSERT_BAND = 0.32;

/**
 * Decide whether a vertical drag is inserting a new track at a lane boundary.
 * `rowFloat` is the pointer's position in track-height units from the top of the
 * first lane (0 = top of lane 0). Returns the boundary row to insert at
 * (0 = above the top lane, `trackCount` = below the bottom), or null when the
 * pointer is over a lane's middle band (a normal move/target).
 */
export function resolveInsertRow(
  rowFloat: number,
  trackCount: number,
  band: number = INSERT_BAND,
): number | null {
  if (trackCount === 0) return 0;
  if (rowFloat <= 0) return 0;
  if (rowFloat >= trackCount) return trackCount;
  const lane = Math.floor(rowFloat);
  const frac = rowFloat - lane;
  if (frac < band) return lane;
  if (frac > 1 - band) return lane + 1;
  return null;
}

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
