import type { TimelineElement } from "../store/playerStore";

/**
 * Fraction of a track height near a lane boundary that switches a vertical drag
 * from "target this lane" into "insert a new track at this boundary". Tuned by
 * feel — bigger = easier to hit boundaries (harder to land on a lane).
 */
const INSERT_BAND = 0.22;

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

/**
 * Snap a clip's start forward so it doesn't overlap any of `laneClips` — used on
 * the magnetic main track, where clips can't stack. Walks the lane's clips in time
 * order and, on each overlap, butts the clip flush after that clip (cascading past
 * a run of adjacent clips). `laneClips` should already be the target lane's clips.
 */
export function snapClearOfClips(
  laneClips: TimelineElement[],
  start: number,
  duration: number,
  excludeKey: string | null,
): number {
  const others = laneClips
    .filter((c) => (c.key ?? c.id) !== excludeKey)
    .slice()
    .sort((a, b) => a.start - b.start);
  let s = Math.max(0, start);
  for (const c of others) {
    const ce = c.start + c.duration;
    if (s < ce && c.start < s + duration) s = ce; // overlap → butt flush after c
  }
  return Math.round(s * 100) / 100;
}

export interface TrackShift {
  key: string;
  toTrack: number;
}

export interface TrackInsertPlan {
  /** Track index the dragged clip should take. */
  draggedTrack: number;
  /** Other clips that must move (down by one lane) to open the gap. */
  shifts: TrackShift[];
}

/**
 * Plan a new-track insert at visual row `insertRow` (0 = above the top lane,
 * `trackOrder.length` = below the bottom). Minimal-shift: keeps authored track
 * indices and only bumps clips when there is no integer gap to slot into.
 * - Edge inserts (row 0 / row N): one-below-top / one-above-bottom, no shifts.
 * - Interior with a gap (next - prev ≥ 2): slot into the gap, no shifts.
 * - Interior, consecutive: bump every clip on track ≥ `next` down one lane.
 */
export function buildTrackInsert(
  elements: TimelineElement[],
  trackOrder: number[],
  insertRow: number,
  draggedKey: string | null,
): TrackInsertPlan {
  const n = trackOrder.length;
  if (n === 0) return { draggedTrack: 0, shifts: [] };
  const row = Math.max(0, Math.min(n, insertRow));
  if (row === 0) return { draggedTrack: trackOrder[0] - 1, shifts: [] };
  if (row === n) return { draggedTrack: trackOrder[n - 1] + 1, shifts: [] };

  const prev = trackOrder[row - 1];
  const next = trackOrder[row];
  if (next - prev >= 2) {
    return { draggedTrack: prev + 1, shifts: [] };
  }
  const shifts: TrackShift[] = [];
  for (const el of elements) {
    const key = el.key ?? el.id;
    if (key === draggedKey) continue;
    if (el.track >= next) shifts.push({ key, toTrack: el.track + 1 });
  }
  return { draggedTrack: next, shifts };
}
