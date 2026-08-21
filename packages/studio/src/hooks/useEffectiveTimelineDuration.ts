import { useMemo } from "react";
import type { TimelineElement } from "../player/store/timelineElement";

/**
 * The stored `duration` lags a moment behind an edit that pushes an element
 * past it (drag, trim, paste) — this is the actual end of the timeline, the
 * later of the stored duration and the furthest element's end.
 */
export function useEffectiveTimelineDuration(
  timelineDuration: number,
  timelineElements: readonly TimelineElement[],
): number {
  return useMemo(() => {
    const maxEnd =
      timelineElements.length > 0
        ? Math.max(...timelineElements.map((el) => el.start + el.duration))
        : 0;
    return Math.max(timelineDuration, maxEnd);
  }, [timelineDuration, timelineElements]);
}
