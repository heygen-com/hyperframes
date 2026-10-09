import { PREVIEW_RASTER_ATTR } from "../studioPreviewMark";
import { isElementNode } from "./domRealm";

// Chromium rasters a `will-change: transform` layer at no less than device scale, so a preview shown
// small rasters each one at full size. Below 1x the hint is dropped wherever nothing depends on the
// stacking context and fixed-position containing block it makes, so the preview paints the same.
const TRANSFORM_HINTS = new Set(["transform", "translate", "rotate", "scale"]);
const MARKED = `[${PREVIEW_RASTER_ATTR}]`;
const DROP_HINTS = `${MARKED} { will-change: auto !important; }`;

let sheet: HTMLStyleElement | null = null;
let observer: MutationObserver | null = null;
const zIndexWhenMarked = new WeakMap<Element, string>();

// Other hints (opacity, filter) make boundaries of their own, so only a pure transform hint goes.
function onlyTransformHints(style: CSSStyleDeclaration): boolean {
  return style.willChange.split(",").every((hint) => TRANSFORM_HINTS.has(hint.trim()));
}

// Fixed boxes always need the hint's containing block; z-indexed and blending boxes need its
// stacking context unless the layer stacks anyway.
function escapes(element: Element, stacks: boolean, self = true): boolean {
  for (const pseudo of self ? [null, "::before", "::after"] : ["::before", "::after"]) {
    const style = getComputedStyle(element, pseudo);
    if (pseudo && style.content === "none") continue;
    if (style.position === "fixed") return true;
    if (!stacks && (style.zIndex !== "auto" || style.mixBlendMode !== "normal")) return true;
  }
  return false;
}

// A positioned element already contains its absolute descendants and paints in the same phase.
function canDropHint(element: Element, style: CSSStyleDeclaration): boolean {
  if (style.position === "static") return false;
  const stacks = style.zIndex !== "auto";
  if (escapes(element, stacks, false)) return false;
  for (const descendant of element.querySelectorAll("*")) {
    if (escapes(descendant, stacks)) return false;
  }
  return true;
}

function check(element: Element): void {
  if (element === sheet) return;
  const style = getComputedStyle(element);
  const marked = element.hasAttribute(PREVIEW_RASTER_ATTR);
  // A marked element reads `auto` through our rule, so only its fit is re-checked.
  const drop = (marked || onlyTransformHints(style)) && canDropHint(element, style);
  if (drop) zIndexWhenMarked.set(element, style.zIndex);
  if (drop !== marked) element.toggleAttribute(PREVIEW_RASTER_ATTR, drop);
}

function unmarkHolders(element: Element): void {
  let holder = element.parentElement?.closest(MARKED);
  while (holder) {
    if (escapes(element, getComputedStyle(holder).zIndex !== "auto")) {
      holder.removeAttribute(PREVIEW_RASTER_ATTR);
    }
    holder = holder.parentElement?.closest(MARKED);
  }
}

function followTree(root: Element): void {
  for (const element of [root, ...root.querySelectorAll("*")]) {
    check(element);
    unmarkHolders(element);
  }
}

// Scripts restyle inline every frame, so only what can break a mark is looked at.
function followStyle(element: Element): void {
  if (element.hasAttribute(PREVIEW_RASTER_ATTR)) {
    const style = getComputedStyle(element);
    if (style.position === "static" || style.zIndex !== zIndexWhenMarked.get(element)) {
      check(element);
    }
  }
  unmarkHolders(element);
}

function markLayers(): void {
  for (const element of document.querySelectorAll("*")) check(element);
}

function followAttribute(record: MutationRecord): void {
  if (!isElementNode(record.target)) return;
  if (record.attributeName === "class") followTree(record.target);
  else followStyle(record.target);
}

// New rules can restyle anything.
function addsRules(record: MutationRecord): boolean {
  return [...record.addedNodes].some(
    (node) => isElementNode(node) && (node.localName === "style" || node.localName === "link"),
  );
}

function follow(records: MutationRecord[]): void {
  if (records.some(addsRules)) return markLayers();
  for (const record of records) {
    if (record.type === "attributes") followAttribute(record);
    else for (const node of record.addedNodes) if (isElementNode(node)) followTree(node);
  }
}

function restore(): void {
  observer?.disconnect();
  observer = null;
  sheet?.remove();
  sheet = null;
  for (const element of document.querySelectorAll(MARKED)) {
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
  observer = new MutationObserver(follow);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "style"],
  });
}
