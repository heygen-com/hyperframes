// Pure background-sampling-region logic for the WCAG contrast audit.
//
// The audit used to estimate an element's background by sampling a 4px ring
// just OUTSIDE its bounding box (with an own-opaque-background pre-check —
// see the historical note in contrast-bg.ts). That proximity-based estimate
// breaks down whenever what's immediately outside the box differs from
// what's actually behind the text inside it:
//
//  - cross-component bleed: text sits near the edge of its own panel/layer,
//    and a differently-colored sibling panel/layer starts just outside the
//    text's bbox — the ring samples the neighbor, not the true background.
//  - solid-fill pill/button with rounded corners achieved via a sibling
//    shape (not a CSS background-color on an ancestor of the text) — same
//    failure as above; the ownBg ancestor-walk never sees it.
//  - translucent "glass" text over a backdrop-filter blur panel sized only
//    a couple pixels larger than the text — the ring exits the panel and
//    samples the raw, unblurred, untinted pixels behind it.
//  - a translucent/decorative shape that only partially overlaps the ring,
//    or sits entirely INSIDE the text's own bbox (never touching the ring
//    at all) — the ring is structurally blind to it.
//
// The fix: hide the text's own paint (color/fill → transparent), take ONE
// screenshot with the glyphs invisible, then sample the REAL composited
// pixels directly INSIDE the element's own bbox — no proximity heuristic
// needed, because we're reading the exact pixels that were behind the
// glyphs. This module hosts the pure "which rect do we sample" decision
// (inset to dodge anti-aliased edge pixels, clamp to canvas bounds, and
// reject a rect that's too small to sample) so it's unit-testable without a
// browser. The same logic is inlined into contrast-audit.browser.js (which
// is injected as a raw string and cannot import) and into
// skills/hyperframes-creative/scripts/contrast-report.mjs — keep all three
// in sync.

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
