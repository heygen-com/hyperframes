/** A composition's `data-width`/`data-height` in whole CSS px, read as the renderer reads it
 *  (`parseInt`: "1080px" and "1080.5" are both 1080). */
export function parseCompositionDimension(value: string | null | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
