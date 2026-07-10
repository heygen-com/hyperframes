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
 *
 * NOTE: this only orders clips WITHIN one authored track. Cross-track lane order
 * is decided by `orderTrackBlocksByZ` (see normalizeToZones), which stacks the
 * higher-z tracks on top — so a z=26 icon on its own authored track lands above a
 * z=0 video on a different track, matching the canvas.
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
 * Order a zone's authored tracks top → bottom so the HIGHER-z track sits on the
 * upper (lower-index) lane, matching the canvas's CSS stacking. Each track's
 * "representative z" is the MAX z among its clips (a track is as high as its
 * top-most clip). Ties fall back to the ascending authored track index, so an
 * all-equal-z composition keeps its original authored track order (the prior
 * behavior). Returns groups of the same track's clips, in display order.
 *
 * Without this, lanes were laid out by ascending authored `data-track-index`
 * alone, so a z=0 video on track 0 sat ABOVE a z=26 icon on track 1 — the
 * timeline contradicted the canvas. z→lane within a track (packTrackLanes) never
 * reached across tracks, which is exactly where the conflict is visible.
 */
function orderTrackBlocksByZ(zoneClips: TimelineElement[]): TimelineElement[][] {
  const byTrack = new Map<number, TimelineElement[]>();
  for (const el of zoneClips) {
    const list = byTrack.get(el.track);
    if (list) list.push(el);
    else byTrack.set(el.track, [el]);
  }
  return [...byTrack.entries()]
    .map(([track, clips]) => ({
      track,
      clips,
      repZ: clips.reduce((max, c) => Math.max(max, zOf(c)), Number.NEGATIVE_INFINITY),
    }))
    .sort((a, b) => b.repZ - a.repZ || a.track - b.track)
    .map((entry) => entry.clips);
}

/**
 * Assign display lanes for the timeline: visual lanes on top, audio lanes below.
 * Within each zone, authored tracks are stacked so the higher-z track is on the
 * upper lane (see orderTrackBlocksByZ) — so the timeline's vertical order matches
 * the canvas's CSS stacking. Within each authored track, time-overlapping clips
 * split onto separate lanes so the timeline NEVER shows two clips overlapping on
 * one track (standard NLE behavior); sequential clips still share a lane; distinct
 * authored tracks stay distinct. Pure — returns a new array; unchanged clips keep
 * their identity.
 *
 * Display-only (runs on discovery); it does not rewrite the source. Idempotent.
 */
export function normalizeToZones(elements: TimelineElement[]): TimelineElement[] {
  if (elements.length === 0) return elements;

  const laneOf = new Map<string, number>();
  let nextLane = 0;
  for (const zone of ["visual", "audio"] as const) {
    const zoneClips = elements.filter((el) => classifyZone(el) === zone);
    for (const trackClips of orderTrackBlocksByZ(zoneClips)) {
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
