export function normalizePlaybackRate(raw: number): number {
  return Number.isFinite(raw) && raw > 0 ? Math.max(0.1, Math.min(5, raw)) : 1;
}

export function readElementPlaybackRate(el: Pick<Element, "getAttribute">): number {
  const authored = Number.parseFloat(el.getAttribute("data-playback-rate") ?? "");
  const raw =
    Number.isFinite(authored) && authored > 0
      ? authored
      : typeof HTMLMediaElement !== "undefined" && el instanceof HTMLMediaElement
        ? el.defaultPlaybackRate
        : 1;
  return normalizePlaybackRate(raw);
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
  return resolveNaturalMediaTimelineDurationFromValues(
    sourceDuration,
    readMediaStart(el),
    readElementPlaybackRate(el),
  );
}

export function resolveNaturalMediaTimelineDurationFromValues(
  sourceDuration: number,
  mediaStart: number,
  playbackRate: number,
): number | null {
  if (!Number.isFinite(sourceDuration)) return null;
  const remaining = Math.max(0, sourceDuration - mediaStart);
  return remaining / normalizePlaybackRate(playbackRate);
}
