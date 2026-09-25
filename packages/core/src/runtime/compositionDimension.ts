/** Whole px from `data-width`/`data-height`, parsed with `parseInt` as the renderer does. */
export function parseCompositionDimension(value: string | null | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
