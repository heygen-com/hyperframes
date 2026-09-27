import { getTimelinePlayheadLeft } from "./timelineLayout";

/** Playback moves the playhead by transform, no relayout; snapped to device pixels so its 1px line stays sharp. */
export function getTimelinePlayheadTransform(
  time: number,
  pixelsPerSecond: number,
  contentOrigin: number,
  devicePixelRatio = globalThis.devicePixelRatio || 1,
): string {
  const left = getTimelinePlayheadLeft(time, pixelsPerSecond, contentOrigin);
  return `translateX(${Math.round(left * devicePixelRatio) / devicePixelRatio}px)`;
}
