import { isHtmlElement } from "./domRealm";

/** A `data-width`/`data-height` length in CSS px as the stage lays it out, fractions kept. */
export function parseLayoutDimension(value: string | null | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** The size the runtime reports to its host: whole px, read with `parseInt` as the renderer does. */
export function parseCompositionDimension(value: string | null | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function findRootCompositionElement(): HTMLElement | null {
  const explicitRoot = document.querySelector('[data-composition-id][data-root="true"]');
  if (isHtmlElement(explicitRoot)) return explicitRoot;
  // The first composition in document order never sits inside another one.
  return document.querySelector<HTMLElement>("[data-composition-id]");
}
