import type { TimelineElement } from "../store/playerStore";
import { isAudioTimelineElement } from "../../utils/timelineInspector";

/**
 * Free-form vertical zones, top → bottom: visual, audio. There is no "main track"
 * — layering is CSS z-index (the renderer ignores track index), so the timeline's
 * only job is to keep visual clips grouped above audio clips.
 */
export type TrackZone = "visual" | "audio";

function sortedDistinct(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/** Which zone a clip belongs to: audio elements sink to the bottom, everything
 *  else (video / image / text / sub-comp) is a visual lane on top. */
export function classifyZone(el: TimelineElement): TrackZone {
  return isAudioTimelineElement(el) ? "audio" : "visual";
}

const keyOf = (el: TimelineElement) => el.key ?? el.id;

/** Stacking order for a clip: missing / "auto" z is treated as 0. */
const zOf = (el: TimelineElement) => (Number.isFinite(el.zIndex) ? (el.zIndex as number) : 0);

const EPS = 1e-6;

/** Two clips overlap when their half-open [start, end) intervals intersect. */
function overlaps(a: TimelineElement, b: TimelineElement): boolean {
  return a.start < b.start + b.duration - EPS && b.start < a.start + a.duration - EPS;
}

/**
 * Lay a single authored track's clips onto sub-lanes so NO two overlap in time
 * (first-fit interval packing): sequential clips share a lane; overlapping ones
 * spill onto the next. Writes each clip's absolute display lane (`base + sub`) into
 * `laneOf` and returns the number of lanes used (≥ 1).
 *
 * Reverse z→lane mapping: clips are packed in DESCENDING z order (tie-break on
 * the STABLE key — never the mutated lane/track index, which historically caused
 * an oscillation bug: see the "stable tie-break" fix in this file's history).
 * First-fit grabs the lowest free sub-lane, but a lane is only "free" for a clip
 * when it holds NO clip that OVERLAPS IN TIME (not merely "ended before start").
 * So a higher-z clip is placed first and claims the upper (lower-index) lane
 * among the clips it overlaps, while a sequential (non-overlapping) clip still
 * settles onto the earliest lane it fits — sharing regardless of z, since z is
 * meaningless without a time overlap. This converges with the lane→z forward
 * mapping (lower lane ⇒ higher z) to a fixed point. Equal/absent z degrades to
 * start-ordered packing (identical to the prior behavior).
 */
function packTrackLanes(
  clips: TimelineElement[],
  base: number,
  laneOf: Map<string, number>,
): number {
  // Highest z first (tie-break: earlier start, then stable key). z-desc placement
  // is what makes higher z land on the upper lane among overlapping clips.
  const ordered = [...clips].sort(
    (a, b) => zOf(b) - zOf(a) || a.start - b.start || (keyOf(a) < keyOf(b) ? -1 : 1),
  );
  const lanes: TimelineElement[][] = []; // clips already placed on each sub-lane
  for (const clip of ordered) {
    // First lane with no time-overlapping occupant (so sequential clips share,
    // overlapping clips spill), independent of placement order.
    let sub = lanes.findIndex((occupants) => occupants.every((o) => !overlaps(o, clip)));
    if (sub === -1) {
      sub = lanes.length;
      lanes.push([]);
    }
    lanes[sub].push(clip);
    laneOf.set(keyOf(clip), base + sub);
  }
  return Math.max(1, lanes.length);
}

/**
 * Assign display lanes for the timeline: visual lanes on top, audio lanes below,
 * and — within each authored track — split time-overlapping clips onto separate
 * lanes so the timeline NEVER shows two clips overlapping on one track (standard
 * NLE behavior). Sequential clips still share a lane; distinct authored tracks stay
 * distinct. Pure — returns a new array; unchanged clips keep their identity.
 *
 * Display-only (runs on discovery); it does not rewrite the source. Idempotent.
 */
export function normalizeToZones(elements: TimelineElement[]): TimelineElement[] {
  if (elements.length === 0) return elements;

  const laneOf = new Map<string, number>();
  let nextLane = 0;
  for (const zone of ["visual", "audio"] as const) {
    const zoneClips = elements.filter((el) => classifyZone(el) === zone);
    for (const track of sortedDistinct(zoneClips.map((el) => el.track))) {
      const trackClips = zoneClips.filter((el) => el.track === track);
      nextLane += packTrackLanes(trackClips, nextLane, laneOf);
    }
  }

  let changed = false;
  const remapped = elements.map((el) => {
    const lane = laneOf.get(keyOf(el));
    if (lane == null || lane === el.track) return el;
    changed = true;
    return { ...el, track: lane };
  });
  return changed ? remapped : elements;
}
