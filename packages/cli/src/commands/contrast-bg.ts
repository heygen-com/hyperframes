// Pure background-resolution logic for the WCAG contrast audit.
//
// HISTORICAL NOTE: contrast-audit.browser.js used to sample a 4px pixel ring
// just OUTSIDE an element's bounding box to estimate its background, with
// pickOpaqueBackground() below as a pre-check: prefer an element's own opaque
// background-color over the ring for solid CTA/pill/card cases. The audit has
// since moved to sampling the ACTUAL composited pixels directly inside each
// element's own bbox (hiding the glyphs first) — see contrast-sample.ts — which
// gets pill/card backgrounds right AND fixes the ring's blind spots (rounded
// corners, backdrop-filter blur, cross-component bleed, partially-overlapping
// translucent decoration). pickOpaqueBackground()/parseColorRGBA() are no
// longer called by the live audit but are kept here — still correct, still
// unit-tested, and contrast-fg.ts imports parseColorRGBA from this module.
//
// This module hosts pure decisions so they can be unit-tested without a
// browser. Historically the same logic was inlined into
// contrast-audit.browser.js (which is injected as a raw string and cannot
// import) — see contrast-sample.ts for what's actually mirrored today.

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

/** WCAG relative luminance for an sRGB color. Mirrors contrast-audit.browser.js. */
export function relativeLuminance(color: Rgb): number {
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2]);
}

/** WCAG contrast ratio between two opaque sRGB colors. */
export function contrastRatio(first: Rgb, second: Rgb): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA minimum contrast for body or large text. */
export function requiredContrastRatio(large: boolean): number {
  return large ? 3 : 4.5;
}

/**
 * Find the nearest passing foreground on the line toward the higher-contrast
 * pole: white for a dark background, black for a light background.
 */
export function suggestCompliantForegroundColor(
  foreground: Rgb,
  background: Rgb,
  requiredRatio: number,
): Rgb {
  if (contrastRatio(foreground, background) >= requiredRatio) return [...foreground];

  const black: Rgb = [0, 0, 0];
  const white: Rgb = [255, 255, 255];
  const target =
    contrastRatio(white, background) >= contrastRatio(black, background) ? white : black;

  for (let step = 1; step <= 255; step += 1) {
    const amount = step / 255;
    const candidate: Rgb = [
      Math.round(foreground[0] + (target[0] - foreground[0]) * amount),
      Math.round(foreground[1] + (target[1] - foreground[1]) * amount),
      Math.round(foreground[2] + (target[2] - foreground[2]) * amount),
    ];
    if (contrastRatio(candidate, background) >= requiredRatio) return candidate;
  }

  return [...target];
}

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
