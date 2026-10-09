import { PREVIEW_RASTER_ATTR } from "../studioPreviewMark";

// Chromium rasters a `will-change: transform` layer at no less than device scale, so a preview shown
// small rasters each one at full size. Below 1x the hint is dropped wherever nothing depends on the
// stacking context and fixed-position containing block it makes, so the preview paints the same.
const TRANSFORM_HINTS = new Set(["transform", "translate", "rotate", "scale"]);
const DROP_HINTS = `[${PREVIEW_RASTER_ATTR}] { will-change: auto !important; }`;

let sheet: HTMLStyleElement | null = null;
let observer: MutationObserver | null = null;

function hinted(style: CSSStyleDeclaration): boolean {
  return style.willChange.split(",").some((hint) => TRANSFORM_HINTS.has(hint.trim()));
}

// A positioned element already contains its absolute descendants; fixed ones, z-indexed ones and
// blending ones would escape it without the hint.
function canDropHint(element: Element, style: CSSStyleDeclaration): boolean {
  if (style.position === "static") return false;
  const stacks = style.zIndex !== "auto";
  for (const descendant of element.querySelectorAll("*")) {
    const inner = getComputedStyle(descendant);
    if (inner.position === "fixed") return false;
    if (!stacks && (inner.zIndex !== "auto" || inner.mixBlendMode !== "normal")) return false;
  }
  return true;
}

function markLayers(): void {
  for (const element of document.querySelectorAll("*")) {
    if (element === sheet) continue;
    const style = getComputedStyle(element);
    const marked = element.hasAttribute(PREVIEW_RASTER_ATTR);
    // A marked element reads `auto` through our rule, so only its fit is re-checked.
    const drop = (marked || hinted(style)) && canDropHint(element, style);
    if (drop !== marked) element.toggleAttribute(PREVIEW_RASTER_ATTR, drop);
  }
}

function restore(): void {
  observer?.disconnect();
  observer = null;
  sheet?.remove();
  sheet = null;
  for (const element of document.querySelectorAll(`[${PREVIEW_RASTER_ATTR}]`)) {
    element.removeAttribute(PREVIEW_RASTER_ATTR);
  }
}

/** The host reports how large it shows this document; below 1x, transform hints stop forcing full-size rasters. */
export function setPreviewRasterScale(scale: number): void {
  if (!(scale > 0) || !Number.isFinite(scale)) return;
  if (scale >= 1) return restore();
  if (observer) return;
  sheet = document.createElement("style");
  sheet.textContent = DROP_HINTS;
  (document.head ?? document.documentElement).append(sheet);
  markLayers();
  // ponytail: a full pass per batch of class or tree changes; per-subtree passes if it shows in profiles.
  observer = new MutationObserver(markLayers);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class"],
  });
}
