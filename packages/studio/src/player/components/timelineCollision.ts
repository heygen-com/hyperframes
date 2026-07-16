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
 *
 * `preferInsertAbove` biases the auto-created track (occupied-aim → new adjacent
 * track) toward the boundary ABOVE the aimed row instead of below it, so the new
 * lane opens on whichever side of the aimed clip the pointer is nearer (the drag
 * preview passes the pointer's sub-row half). A clip whose aimed span is occupied
 * never snaps back to its origin — it relocates to a free lane, or (none free)
 * gets a fresh track next to the aim. Default (below) preserves prior behaviour.
 */
/**
 * Insert-row boundary for an out-of-range aim — a `desired` track that isn't a
 * real lane: the sentinel minTrack-1 an upward create-drag emits (#2214-adjacent
 * repro) or a beyond-the-bottom index a downward one does. Anchors the new track
 * to a boundary of the clip's OWN kind-zone so a visual insert can never land
 * past the audio zone (the old below = order.length fallback dropped it BELOW the
 * audio lanes). Above the zone (`desired` < the zone's min lane) → the zone's TOP
 * boundary; otherwise → its BOTTOM boundary (for a visual clip, the top of the
 * audio zone). `zoneTracks` = this kind's lanes, in `order` sequence.
 */
function outOfRangeZoneInsertRow(
  order: number[],
  zoneTracks: number[],
  audioRow: number,
  desired: number,
): number {
  // No lane of this kind yet: fall to the split (audioRow) or the very top.
  // A visual-only timeline has audioRow -1 (top); an all-audio one has it at 0.
  if (zoneTracks.length === 0) return audioRow < 0 ? 0 : audioRow;
  // zoneTracks preserves `order` sequence, so its ends map to the zone boundary
  // rows: above the zone's min lane → its top boundary, else its bottom.
  const zoneTop = order.indexOf(zoneTracks[0]);
  const zoneBottom = order.indexOf(zoneTracks[zoneTracks.length - 1]) + 1;
  return desired < Math.min(...zoneTracks) ? zoneTop : zoneBottom;
}

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
  preferInsertAbove?: boolean;
}): { track: number; insertRow: number | null } {
  const { order, audioTracks, elements, desiredTrack, deliberateInsertRow } = input;
  const { start, duration, dragKey, isAudio, preferInsertAbove } = input;
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
    if (desiredRow < 0) {
      return {
        track: desired,
        insertRow: outOfRangeZoneInsertRow(order, zoneTracks, audioRow, desired),
      };
    }
    // Prefer the gap NEAREST the pointer: insert above the aimed row when the
    // pointer sits in its upper half AND that boundary is in the clip's own zone
    // (else the visual/audio split would be crossed) — otherwise fall to below.
    // `desired` is clamped into the zone, so both boundaries stay in-zone.
    const insertRow =
      preferInsertAbove && isInsertAllowedForZone(desiredRow, audioRow, isAudio)
        ? desiredRow
        : desiredRow + 1;
    return { track: desired, insertRow };
  }
  return { track: placement.track, insertRow: null };
}

/**
 * Fallback half-width (fraction of a track height) of the insert band straddling
 * a lane boundary — used only when the caller passes no explicit band. Production
 * threads the geometry-exact `INSERT_BOUNDARY_BAND` (timelineLayout.ts, = the clip
 * inset `CLIP_Y / TRACK_H`) so the band matches the rendered inter-clip gutter and
 * NEVER reaches into a clip body. Kept in sync with that constant; do not widen it
 * back toward the old 0.32 (which armed an insert across ~64% of every row — the
 * misfire that turned a plain horizontal drag into a phantom track insert).
 */
const INSERT_BAND = 3 / 48;

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
  const idx = trackOrder.indexOf(desiredTrack);
  // desiredTrack is not one of the zone's lanes — the clip's kind-zone has no lane
  // yet (e.g. an audio clip dropped on a visual-only timeline). This MUST be checked
  // BEFORE the isLaneFree short-circuit below: a free-aimed span on a foreign-zone
  // lane (an audio clip aimed at an empty stretch of a visual-only timeline) is
  // "free" only because that lane belongs to the wrong zone. Landing there would
  // put the clip in the wrong kind-zone, so signal an insert to create the zone's
  // first lane instead — regardless of whether the aimed span is occupied (#2195).
  if (idx === -1) return { track: desiredTrack, needsInsert: true };

  if (isLaneFree(elements, desiredTrack, start, end, excludeKey)) {
    return { track: desiredTrack, needsInsert: false };
  }

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
