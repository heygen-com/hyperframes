interface TimelineAttributeReader {
  getAttribute(name: string): string | null;
}

function finiteNumber(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** True only when authored timing explicitly declares an inactive window. */
export function isKnownInactiveTimelineWindow(
  element: TimelineAttributeReader,
  resolvedStart: number,
): boolean {
  const duration = finiteNumber(element.getAttribute("data-duration"));
  if (duration != null && duration <= 0) return true;

  const end = finiteNumber(element.getAttribute("data-end"));
  return end != null && end <= resolvedStart;
}
