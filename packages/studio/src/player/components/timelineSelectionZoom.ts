import { usePlayerStore } from "../store/playerStore";
import type { TimelineElement } from "../store/timelineElement";
import { zoomTimelineToRange, type TimelineZoomResult } from "./timelineZoomInput";

type ClipSpan = Pick<TimelineElement, "id" | "key" | "start" | "duration">;

/** The seconds from the first selected clip's start to the last one's end, or null with none. */
export function selectedClipsRange(
  elements: readonly ClipSpan[],
  selectedIds: Iterable<string>,
): { start: number; end: number } | null {
  const ids = new Set(selectedIds);
  let start = Infinity;
  let end = -Infinity;
  for (const el of elements) {
    if (!ids.has(el.key ?? el.id)) continue;
    start = Math.min(start, el.start);
    end = Math.max(end, el.start + el.duration);
  }
  return end > start ? { start, end } : null;
}

function currentSelectedClipsRange(): { start: number; end: number } | null {
  const { elements, selectedElementIds, selectedElementId } = usePlayerStore.getState();
  const ids = new Set(selectedElementIds);
  if (selectedElementId) ids.add(selectedElementId);
  return selectedClipsRange(elements, ids);
}

export function zoomToSelectedClips(): Promise<TimelineZoomResult> {
  const range = currentSelectedClipsRange();
  if (!range) return Promise.resolve("cancelled");
  return zoomTimelineToRange(range.start, range.end);
}
