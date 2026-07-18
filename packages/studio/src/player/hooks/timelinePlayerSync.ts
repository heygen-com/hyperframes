import type { TimelineElement } from "../store/playerStore";

/** Whether a derived timeline changes any field that affects rendering. */
export function timelineElementsChanged(
  previous: TimelineElement[],
  next: TimelineElement[],
): boolean {
  if (next.length !== previous.length) return true;
  return next.some((element, index) => {
    const prior = previous[index];
    return (
      !prior ||
      element.id !== prior.id ||
      element.start !== prior.start ||
      element.duration !== prior.duration ||
      element.track !== prior.track ||
      element.sourceDuration !== prior.sourceDuration
    );
  });
}
