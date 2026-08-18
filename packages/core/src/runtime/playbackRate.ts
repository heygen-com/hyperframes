export function normalizePlaybackRate(raw: number): number {
  return Number.isFinite(raw) && raw > 0 ? Math.max(0.1, Math.min(5, raw)) : 1;
}

export function readMediaStart(el: Pick<Element, "getAttribute">): number {
  const parse = (raw: string | null): number | null => {
    if (raw == null || raw.trim() === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  return (
    parse(el.getAttribute("data-playback-start")) ?? parse(el.getAttribute("data-media-start")) ?? 0
  );
}
export function resolveNaturalMediaTimelineDuration(
  el: Pick<Element, "getAttribute">,
  sourceDuration: number,
): number | null {
  const remaining = sourceDuration - readMediaStart(el);
  return Number.isFinite(remaining) && remaining > 0
    ? remaining / normalizePlaybackRate(Number(el.getAttribute("data-playback-rate")))
    : null;
}
