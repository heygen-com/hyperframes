import type { TimelineElement } from "../store/playerStore";
import { isAudioTimelineElement } from "../../utils/timelineInspector";

/** CapCut-style vertical zones, top → bottom: overlay, main, audio. */
export type TrackZone = "overlay" | "main" | "audio";

function sortedDistinct(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/**
 * The track index of the single "main" video track. Resolution is **stable under
 * re-zoning** (so normalizeToZones is idempotent even with multiple video tracks):
 *   1. An explicit `data-timeline-role="main"` designation wins (persisted metadata).
 *   2. Otherwise the primary sequence = the video track with the most total clip
 *      duration. Ties break to the track holding the smallest stable clip id (NOT
 *      the track index — normalizeToZones mutates the index every pass, so tie-
 *      breaking on it made equal-duration videos oscillate between tracks on every
 *      re-zone; the id is invariant).
 * Returns null when the timeline has no video. Works on authored OR zoned elements
 * (on zoned elements it returns the current main lane index).
 */
export function resolveMainOriginTrack(elements: TimelineElement[]): number | null {
  const videos = elements.filter((el) => el.tag === "video" && !isAudioTimelineElement(el));
  if (videos.length === 0) return null;

  const designated = videos.find((v) => v.timelineRole === "main");
  if (designated) return designated.track;

  const byTrack = new Map<number, { total: number; minId: string }>();
  for (const v of videos) {
    const id = v.key ?? v.id;
    const cur = byTrack.get(v.track);
    if (cur) {
      cur.total += v.duration;
      if (id < cur.minId) cur.minId = id;
    } else {
      byTrack.set(v.track, { total: v.duration, minId: id });
    }
  }

  let bestTrack = Number.POSITIVE_INFINITY;
  let bestTotal = -1;
  let bestMinId = "";
  for (const [track, { total, minId }] of byTrack) {
    if (total > bestTotal || (total === bestTotal && minId < bestMinId)) {
      bestTotal = total;
      bestTrack = track;
      bestMinId = minId;
    }
  }
  return bestTrack;
}

/** Which zone a clip belongs to under the enforced model. The main lane holds
 *  only video on the main track; non-video on that track goes to overlay. */
export function classifyZone(el: TimelineElement, mainOriginTrack: number | null): TrackZone {
  if (isAudioTimelineElement(el)) return "audio";
  if (mainOriginTrack !== null && el.track === mainOriginTrack && el.tag === "video") return "main";
  return "overlay";
}

/**
 * Enforced CapCut zoning: remap every clip's track so ascending index runs
 * overlay → main → audio (overlays on top, the single main video track in the
 * middle, audio at the bottom). Relative order within the overlay and audio
 * zones is preserved from the authored indices. Pure — returns a new array;
 * clips whose track is unchanged keep their identity.
 */
export function normalizeToZones(elements: TimelineElement[]): TimelineElement[] {
  if (elements.length === 0) return elements;
  const mainOrigin = resolveMainOriginTrack(elements);
  const zoneOf = (el: TimelineElement) => classifyZone(el, mainOrigin);

  const overlayTracks = sortedDistinct(
    elements.filter((el) => zoneOf(el) === "overlay").map((el) => el.track),
  );
  const audioTracks = sortedDistinct(
    elements.filter((el) => zoneOf(el) === "audio").map((el) => el.track),
  );

  // Assign contiguous new indices in visual order: overlays, then main, then audio.
  const newIndexByZoneTrack = new Map<string, number>();
  let next = 0;
  for (const t of overlayTracks) newIndexByZoneTrack.set(`overlay:${t}`, next++);
  const mainIndex = mainOrigin !== null ? next++ : null;
  for (const t of audioTracks) newIndexByZoneTrack.set(`audio:${t}`, next++);

  let changed = false;
  const remapped = elements.map((el) => {
    const zone = zoneOf(el);
    const nextTrack =
      zone === "main" && mainIndex !== null
        ? mainIndex
        : (newIndexByZoneTrack.get(`${zone}:${el.track}`) ?? el.track);
    if (nextTrack === el.track) return el;
    changed = true;
    return { ...el, track: nextTrack };
  });
  return changed ? remapped : elements;
}
