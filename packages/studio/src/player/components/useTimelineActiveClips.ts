import type { TimelineElement } from "../store/playerStore";

/** Model-first active state. Rendered nodes receive this on their first mount. */
export function isTimelineClipActive(element: TimelineElement, time: number): boolean {
  if (!Number.isFinite(time) || element.hidden === true) return false;
  const start = element.start;
  const end = start + Math.max(0, element.duration);
  return Number.isFinite(start) && Number.isFinite(end) && time >= start && time <= end;
}
