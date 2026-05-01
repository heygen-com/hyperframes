import { ensureDOMParser } from "./dom.js";

const DEFAULT_VIEWPORT = { width: 1920, height: 1080 } as const;
const MAX_VIEWPORT_DIMENSION = 4096;

function parseViewportDimension(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(parsed, MAX_VIEWPORT_DIMENSION);
}

export function resolveCompositionViewportFromHtml(html: string): {
  width: number;
  height: number;
} {
  ensureDOMParser();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector("[data-composition-id][data-width][data-height]");
  const width = parseViewportDimension(root?.getAttribute("data-width") ?? null);
  const height = parseViewportDimension(root?.getAttribute("data-height") ?? null);
  return {
    width: width ?? DEFAULT_VIEWPORT.width,
    height: height ?? DEFAULT_VIEWPORT.height,
  };
}
