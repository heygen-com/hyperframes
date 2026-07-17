import type { TimelineRowGeometry } from "./timelineLayout";
import { RULER_H } from "./timelineLayout";
import type { TimelineScrollViewportSnapshot } from "./useTimelineScrollViewport";

export function getTimelineVisibleTimeRange(
  viewport: Pick<TimelineScrollViewportSnapshot, "scrollLeft" | "clientWidth">,
  pixelsPerSecond: number,
  contentOrigin: number,
  duration: number,
): { start: number; end: number } {
  if (!(pixelsPerSecond > 0) || !(duration > 0)) return { start: 0, end: 0 };
  const start = Math.max(0, (viewport.scrollLeft - contentOrigin) / pixelsPerSecond);
  const end = Math.min(
    duration,
    Math.max(start, (viewport.scrollLeft + viewport.clientWidth - contentOrigin) / pixelsPerSecond),
  );
  return { start: Math.min(start, duration), end };
}

export function getTimelineScrollTopForGeometryChange(
  previous: TimelineRowGeometry,
  next: TimelineRowGeometry,
  scrollTop: number,
): number {
  const anchor = previous.getRowPositionFromY(scrollTop + RULER_H);
  if (anchor.row < 0 || anchor.row >= previous.rowKeys.length) return scrollTop;
  const anchorKey = previous.rowKeys[anchor.row];
  if (anchorKey === undefined) return scrollTop;
  const nextRow = next.getRowIndex(anchorKey);
  if (nextRow < 0) return scrollTop;
  return Math.max(0, scrollTop + next.getRowTop(nextRow) - previous.getRowTop(anchor.row));
}
