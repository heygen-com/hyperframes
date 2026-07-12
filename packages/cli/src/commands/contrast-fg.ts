// Pure foreground-color resolution logic for the WCAG contrast audit.
//
// The browser-side audit (contrast-audit.browser.js) reads an element's
// foreground paint color from getComputedStyle(el).color. That is correct for
// ordinary HTML text, but SVG text (<text>, <tspan>, <textPath>) is painted
// via the `fill` property — `fill` and `color` are independent CSS properties
// in SVG. A page can set `fill` (inline style, a `fill` attribute, or a CSS
// rule) without ever touching `color`, in which case `color` resolves to the
// inherited/initial value (often black) and does not reflect what's actually
// rendered on screen. That mismatch was reported as a real false pass/fail
// in the contrast audit.
//
// This module hosts the pure decision so it can be unit-tested without a
// browser. The same logic is inlined into contrast-audit.browser.js (which is
// injected as a raw string and cannot import) and into
// skills/hyperframes-creative/scripts/contrast-report.mjs — keep all three in
// sync, mirroring the existing "WCAG math is duplicated" note at the top of
// contrast-audit.browser.js.

import { parseColorRGBA, type Rgba } from "./contrast-bg.js";

/**
 * Resolve the foreground paint color for a text-bearing element.
 *
 * - For ordinary HTML text, this is always the computed `color`.
 * - For SVG text, the rendered glyph color is `fill`, not `color`. `fill` is
 *   only trusted when it resolves to a solid rgb()/rgba() color — SVG paint
 *   keywords ("none", "context-fill") and gradient/pattern references
 *   (`url(#...)`) are not colors, so those fall back to `color` instead of
 *   fabricating black.
 */
export function resolveForegroundColor(opts: {
  isSvgText: boolean;
  fill: string;
  color: string;
}): Rgba {
  if (opts.isSvgText) {
    const solid = parseColorRGBA(opts.fill);
    if (solid) return solid;
  }
  return parseColorRGBA(opts.color) ?? [0, 0, 0, 1];
}
