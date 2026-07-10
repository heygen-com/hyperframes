import type { TimelineElement } from "../store/playerStore";
import { isAudioTimelineElement } from "../../utils/timelineInspector";

/**
 * Free-form vertical zones, top → bottom: visual, audio. There is no "main track"
 * — layering is CSS z-index (the renderer ignores track index), so the timeline's
 * only job is to keep visual clips grouped above audio clips.
 */
export type TrackZone = "visual" | "audio";

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

/** A clip paired with its position in the discovery/document (input) order. */
interface IndexedClip {
  el: TimelineElement;
  /** Index in the input `elements` array = discovery/DOM order. */
  domIndex: number;
}

/** One display lane: the clips packed onto it, in placement order. */
interface Lane {
  occupants: IndexedClip[];
  /** The single authored track all occupants share, or null once mixed (never
   *  happens — we only ever add same-track clips to an existing lane). */
  track: number;
}

/**
 * Lowest lane index a clip may occupy: strictly above every already-placed lane
 * holding a clip it overlaps in time (all of which out-stack it by the z-desc
 * placement order).
 */
function lowestAllowedLane(lanes: Lane[], item: IndexedClip): number {
  let minLane = 0;
  for (let i = 0; i < lanes.length; i++) {
    if (lanes[i].occupants.some((o) => overlaps(o.el, item.el))) minLane = i + 1;
  }
  return minLane;
}

/**
 * First lane at index ≥ minLane that holds solely this clip's authored track and
 * nothing overlapping (so sequential same-track clips share a lane); -1 when none
 * qualifies and a fresh lane must open.
 */
function findReusableLane(lanes: Lane[], minLane: number, item: IndexedClip): number {
  for (let i = minLane; i < lanes.length; i++) {
    const lane = lanes[i];
    if (lane.track !== item.el.track) continue;
    if (lane.occupants.some((o) => overlaps(o.el, item.el))) continue;
    return i;
  }
  return -1;
}

/**
 * Pack a WHOLE zone's clips onto display lanes with a single constrained pass so
 * that, for EVERY pair of time-overlapping clips, lane order (upper = lower index)
 * equals canvas stacking order. This replaces the old two-stage
 * `orderTrackBlocksByZ` + per-track `packTrackLanes`, which ordered whole authored
 * tracks by their MAX z and so lifted a low-z clip above a clip that covers it
 * whenever it shared a track with a high-z clip (the qa-clean ralu/video bug — a
 * low-z image rode its z=3 trackmate above the z=2 video that paints over it). No
 * whole-track mapping can fix that; the mapping must be per-clip.
 *
 * Algorithm:
 *   1. Order clips by z DESC; z-tie → INPUT-ARRAY-INDEX (DOM order) DESC (CSS
 *      paints equal-z siblings by DOM order — LATER in DOM paints on top, so it
 *      must place first / upper); final tie → stable key. NEVER tie-break on the
 *      mutated lane/track index (historic oscillation bug — the tie-break must be
 *      a stable function of the input, not of the output being computed).
 *   2. Place each clip at lane ≥ (1 + highest lane among already-placed clips it
 *      OVERLAPS IN TIME). By z-desc placement every already-placed overlapping
 *      clip out-stacks this one (higher z, or equal z but later in DOM), so this
 *      guarantees lane order == stacking order for every overlapping pair.
 *   3. To preserve the "distinct authored tracks stay distinct / sequential
 *      same-track clips share a lane" feel, reuse an existing lane at index ≥ that
 *      minimum ONLY when the lane's occupants are all from the SAME authored track
 *      AND none overlaps this clip in time; otherwise open a fresh lane.
 *
 * Writes each clip's absolute display lane (`base + laneIndex`) into `laneOf` and
 * returns the number of lanes used (≥ 1 when non-empty).
 */
function packZoneLanes(clips: IndexedClip[], base: number, laneOf: Map<string, number>): number {
  const ordered = [...clips].sort(
    (a, b) =>
      zOf(b.el) - zOf(a.el) || b.domIndex - a.domIndex || (keyOf(a.el) < keyOf(b.el) ? -1 : 1),
  );
  const lanes: Lane[] = [];
  for (const item of ordered) {
    const minLane = lowestAllowedLane(lanes, item);
    let placed = findReusableLane(lanes, minLane, item);
    if (placed === -1) {
      placed = lanes.length;
      lanes.push({ occupants: [], track: item.el.track });
    }
    lanes[placed].occupants.push(item);
    laneOf.set(keyOf(item.el), base + placed);
  }
  return lanes.length;
}

/**
 * Legacy per-track interval packing for the AUDIO zone (no z semantics): pack one
 * authored track's clips onto sub-lanes so no two overlap in time — sequential
 * clips share a lane, overlapping ones spill onto the next (first-fit). Ordered by
 * start (then stable key) so the layout is deterministic and idempotent. Returns
 * the number of lanes used (≥ 1 when non-empty).
 */
function packAudioTrackLanes(
  clips: IndexedClip[],
  base: number,
  laneOf: Map<string, number>,
): number {
  const ordered = [...clips].sort(
    (a, b) => a.el.start - b.el.start || (keyOf(a.el) < keyOf(b.el) ? -1 : 1),
  );
  const lanes: IndexedClip[][] = [];
  for (const item of ordered) {
    let sub = lanes.findIndex((occ) => occ.every((o) => !overlaps(o.el, item.el)));
    if (sub === -1) {
      sub = lanes.length;
      lanes.push([]);
    }
    lanes[sub].push(item);
    laneOf.set(keyOf(item.el), base + sub);
  }
  return Math.max(1, lanes.length);
}

/**
 * Assign display lanes for the timeline: visual lanes on top, audio lanes below.
 *
 * The VISUAL zone is packed per-clip (packZoneLanes) so the timeline's vertical
 * order matches the canvas's CSS stacking for EVERY time-overlapping pair — a
 * low-z clip sinks below a clip that covers it even if it shares an authored track
 * with a higher-z clip. Time-overlapping clips still split onto separate lanes
 * (standard NLE), sequential same-track clips still share a lane, and distinct
 * authored tracks stay distinct.
 *
 * The AUDIO zone keeps the original behavior — authored-track order, per-track
 * interval packing — because audio has no z / stacking semantics.
 *
 * Pure — returns a new array; unchanged clips keep their identity. Display-only
 * (runs on discovery); it does not rewrite the source. Idempotent (running it on
 * its own output is a fixed point).
 */
export function normalizeToZones(elements: TimelineElement[]): TimelineElement[] {
  if (elements.length === 0) return elements;

  const laneOf = new Map<string, number>();
  let nextLane = 0;

  const visual: IndexedClip[] = [];
  const audio: IndexedClip[] = [];
  elements.forEach((el, domIndex) => {
    (classifyZone(el) === "audio" ? audio : visual).push({ el, domIndex });
  });

  nextLane += packZoneLanes(visual, nextLane, laneOf);

  // Audio: preserve legacy behavior — group by authored track (ascending), pack
  // each track's overlapping clips onto sub-lanes.
  const audioByTrack = new Map<number, IndexedClip[]>();
  for (const item of audio) {
    const list = audioByTrack.get(item.el.track);
    if (list) list.push(item);
    else audioByTrack.set(item.el.track, [item]);
  }
  for (const track of [...audioByTrack.keys()].sort((a, b) => a - b)) {
    nextLane += packAudioTrackLanes(audioByTrack.get(track)!, nextLane, laneOf);
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
