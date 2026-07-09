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

/**
 * Lay a single authored track's clips onto sub-lanes so NO two overlap in time
 * (first-fit interval packing): sequential clips share a lane; overlapping ones
 * spill onto the next. Writes each clip's absolute display lane (`base + sub`) into
 * `laneOf` and returns the number of lanes used (≥ 1).
 */
function packTrackLanes(
  clips: TimelineElement[],
  base: number,
  laneOf: Map<string, number>,
): number {
  const laneEnds: number[] = []; // running end time of the last clip on each sub-lane
  for (const clip of [...clips].sort(
    (a, b) => a.start - b.start || (keyOf(a) < keyOf(b) ? -1 : 1),
  )) {
    let sub = laneEnds.findIndex((end) => end <= clip.start + 1e-6);
    if (sub === -1) {
      sub = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[sub] = clip.start + clip.duration;
    laneOf.set(keyOf(clip), base + sub);
  }
  return Math.max(1, laneEnds.length);
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
