interface MediaTimingAttributeReader {
  getAttribute(name: string): string | null;
}

function finiteAttributeNumber(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Read source offset with the canonical playback-start -> media-start -> 0 fallback. */
export function readMediaStart(element: MediaTimingAttributeReader): number {
  return (
    finiteAttributeNumber(element.getAttribute("data-playback-start")) ??
    finiteAttributeNumber(element.getAttribute("data-media-start")) ??
    0
  );
}
