import { ensureDOMParser } from "./dom.js";

const DEFAULT_VIEWPORT = { width: 1920, height: 1080 } as const;
const MAX_VIEWPORT_DIMENSION = 4096;

function parseViewportDimension(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(parsed, MAX_VIEWPORT_DIMENSION);
}

/**
 * Pull `data-width` + `data-height` from the document's first composition
 * root (the element with `data-composition-id` plus both dimension attrs
 * — the same selector the producer uses to lay out the page). Returns
 * `null` when no such root exists or either attr is invalid, so callers
 * can distinguish "no declared dimensions" from "declared 1920×1080".
 */
export function findCompositionDimensions(html: string): { width: number; height: number } | null {
  ensureDOMParser();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector("[data-composition-id][data-width][data-height]");
  if (!root) return null;
  const width = parseViewportDimension(root.getAttribute("data-width"));
  const height = parseViewportDimension(root.getAttribute("data-height"));
  if (width === null || height === null) return null;
  return { width, height };
}

export function resolveCompositionViewportFromHtml(html: string): {
  width: number;
  height: number;
} {
  return findCompositionDimensions(html) ?? DEFAULT_VIEWPORT;
}
