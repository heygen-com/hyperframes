export function normalizePlaybackRate(raw: number): number {
  return Number.isFinite(raw) && raw > 0 ? Math.max(0.1, Math.min(5, raw)) : 1;
}
