/** A composition's `data-width`/`data-height` in CSS px, read the way the runtime lays the stage out. */
export function parseCompositionDimension(value: string | null | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
