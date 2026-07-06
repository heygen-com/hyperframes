// Pure background-resolution logic for the WCAG contrast audit.
//
// The browser-side audit (contrast-audit.browser.js) samples a pixel ring just
// OUTSIDE an element's bounding box to estimate the background the text sits on.
// That is wrong for any element that paints its OWN opaque background (a caption
// pill, a CTA button, a solid card): the text is composited over that solid
// color, not over whatever surrounds the box. Sampling the ring there measures
// the text against the scene behind the element (often a dark photo) and reports
// a false ~1:1 ratio, flagging perfectly readable CTAs.
//
// This module hosts the pure decision so it can be unit-tested without a browser.
// The same logic is inlined into contrast-audit.browser.js (which is injected as
// a raw string and cannot import) — keep the two in sync, mirroring the existing
// "WCAG math is duplicated" note at the top of that file.

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

/** Parse a CSS `rgb()`/`rgba()` string. Returns null if it is not rgb(a). */
export function parseColorRGBA(color: string | null | undefined): Rgba | null {
  const body = /rgba?\(([^)]+)\)/.exec(color ?? "")?.[1];
  if (body == null) return null;
  const p = body.split(",").map((s) => parseFloat(s.trim()));
  if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
  const [r, g, b, a] = p;
  if (r == null || g == null || b == null) return null;
  return [r, g, b, a ?? 1];
}

/** One entry of an element's computed-style chain (element first, then ancestors). */
export interface BackgroundStyle {
  backgroundColor: string;
  backgroundImage: string;
}

/**
 * Resolve the nearest FULLY-opaque background-color painted behind an element's
 * text, walking from the element up its ancestor chain.
 *
 * Returns null (→ caller falls back to sampling the pixel ring) when:
 *  - a background-image is encountered first (text sits over real image pixels,
 *    for which the ring is the better proxy), or
 *  - no fully-opaque background-color exists in the chain.
 *
 * A semi-transparent background-color is skipped (it blends with whatever is
 * below, which the ring captures better than any single color would).
 */
export function pickOpaqueBackground(chain: readonly BackgroundStyle[]): Rgb | null {
  for (const s of chain) {
    if (s.backgroundImage && s.backgroundImage !== "none") return null;
    const c = parseColorRGBA(s.backgroundColor);
    if (c && c[3] >= 0.999) return [c[0], c[1], c[2]];
  }
  return null;
}
