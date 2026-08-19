import { parseStrictFiniteTimingNumber } from "@hyperframes/core";

interface TimelineAttributeReader {
  getAttribute(name: string): string | null;
}

/** True only when authored timing explicitly declares an inactive window. */
export function isKnownInactiveTimelineWindow(
  element: TimelineAttributeReader,
  resolvedStart: number,
): boolean {
  const duration = parseStrictFiniteTimingNumber(element.getAttribute("data-duration"));
  if (duration != null && duration <= 0) return true;

  const end = parseStrictFiniteTimingNumber(element.getAttribute("data-end"));
  return end != null && end <= resolvedStart;
}
