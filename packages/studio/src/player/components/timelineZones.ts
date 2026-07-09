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

/**
 * Group lanes by kind for display: visual lanes get contiguous indices on top,
 * audio lanes below, each zone preserving the authored relative order. Pure —
 * returns a new array; clips whose track is unchanged keep their identity.
 *
 * This is display normalization only (applied to in-memory elements on
 * discovery); it does not rewrite the source. No main-track concept — free-form.
 */
export function normalizeToZones(elements: TimelineElement[]): TimelineElement[] {
  if (elements.length === 0) return elements;

  const visualTracks = sortedDistinct(
    elements.filter((el) => classifyZone(el) === "visual").map((el) => el.track),
  );
  const audioTracks = sortedDistinct(
    elements.filter((el) => classifyZone(el) === "audio").map((el) => el.track),
  );

  // Contiguous new indices: visual lanes first (top), then audio lanes (bottom).
  const newIndexByZoneTrack = new Map<string, number>();
  let next = 0;
  for (const t of visualTracks) newIndexByZoneTrack.set(`visual:${t}`, next++);
  for (const t of audioTracks) newIndexByZoneTrack.set(`audio:${t}`, next++);

  let changed = false;
  const remapped = elements.map((el) => {
    const zone = classifyZone(el);
    const nextTrack = newIndexByZoneTrack.get(`${zone}:${el.track}`) ?? el.track;
    if (nextTrack === el.track) return el;
    changed = true;
    return { ...el, track: nextTrack };
  });
  return changed ? remapped : elements;
}
