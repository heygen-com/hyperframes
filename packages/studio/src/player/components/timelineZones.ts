import type { TimelineElement } from "../store/playerStore";
import { isAudioTimelineElement } from "../../utils/timelineInspector";

/** CapCut-style vertical zones, top → bottom: overlay, main, audio. */
export type TrackZone = "overlay" | "main" | "audio";

function sortedDistinct(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/**
 * The authored track index treated as the single "main" video track: the lowest
 * track that carries a `video` clip. null when the timeline has no video.
 */
export function resolveMainOriginTrack(elements: TimelineElement[]): number | null {
  const videoTracks = elements
    .filter((el) => el.tag === "video" && !isAudioTimelineElement(el))
    .map((el) => el.track);
  return videoTracks.length > 0 ? Math.min(...videoTracks) : null;
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
