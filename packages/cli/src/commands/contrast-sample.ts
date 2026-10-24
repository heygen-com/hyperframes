// Pure background-sampling-region logic for the WCAG contrast audit.
//
// A ring sampled just OUTSIDE a text box reads whatever is next to the text,
// not what is behind it: a neighbouring panel, a rounded pill drawn by a
// sibling shape, a glass panel only a few pixels larger than the text, or a
// decoration that sits inside the box. So the audit hides the text's own
// paint (color/fill → transparent), takes ONE screenshot with the glyphs
// invisible, and samples the composited pixels INSIDE the element's own bbox.
// This module hosts the pure "which rect do we sample" decision (inset to
// dodge anti-aliased edge pixels, clamp to canvas bounds, and reject a rect
// that's too small to sample) so it's unit-testable without a browser. The
// same logic is inlined into contrast-audit.browser.js (which is injected as
// a raw string and cannot import) — keep both in sync.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PixelRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Compute the region to sample for an element's true background: its own
 * bbox, inset by 1px on each side (anti-aliased glyph/box edges bleed into
 * the adjacent pixel and shouldn't count as "background"), clamped to the
 * screenshot's pixel bounds.
 *
 * Returns null when nothing usable survives — the bbox is entirely outside
 * the canvas, or is too small once inset to contain any interior pixel.
 */
export function computeSampleRect(
  bbox: Rect,
  canvasWidth: number,
  canvasHeight: number,
): PixelRect | null {
  const x0 = Math.max(0, Math.round(bbox.x) + 1);
  const x1 = Math.min(canvasWidth - 1, Math.round(bbox.x + bbox.w) - 1);
  const y0 = Math.max(0, Math.round(bbox.y) + 1);
  const y1 = Math.min(canvasHeight - 1, Math.round(bbox.y + bbox.h) - 1);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x0, x1, y0, y1 };
}

/**
 * Generate a bounded grid of sample coordinates within a pixel rect — dense
 * enough to catch a partially-overlapping decoration, capped so a large
 * caption bar doesn't turn into a full pixel scan.
 */
export function sampleGridPoints(
  rect: PixelRect,
  maxCols = 12,
  maxRows = 6,
): Array<[number, number]> {
  const stepX = Math.max(1, Math.floor((rect.x1 - rect.x0) / maxCols));
  const stepY = Math.max(1, Math.floor((rect.y1 - rect.y0) / maxRows));
  const points: Array<[number, number]> = [];
  for (let y = rect.y0; y <= rect.y1; y += stepY) {
    for (let x = rect.x0; x <= rect.x1; x += stepX) {
      points.push([x, y]);
    }
  }
  return points;
}
