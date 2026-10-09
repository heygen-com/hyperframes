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
const markedWith = new WeakMap<Element, string>();

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

// What a script can change inline on a marked layer that decides whether it stays marked.
function inlineFit(element: Element, style: CSSStyleDeclaration): string {
  return `${style.zIndex}|${(element as HTMLElement).style?.willChange ?? ""}`;
}

// A marked element reads `auto` through our rule. Lifting the mark to read its own hints repaints
// the layer, so that only happens when the element itself changed.
function check(element: Element, readOwnHints: boolean): void {
  if (element === sheet) return;
  const marked = element.hasAttribute(PREVIEW_RASTER_ATTR);
  if (marked && readOwnHints) element.removeAttribute(PREVIEW_RASTER_ATTR);
  const style = getComputedStyle(element);
  const hintsFit = (marked && !readOwnHints) || onlyTransformHints(style);
  const drop = hintsFit && canDropHint(element, style);
  if (drop) markedWith.set(element, inlineFit(element, style));
  if (drop !== element.hasAttribute(PREVIEW_RASTER_ATTR)) {
    element.toggleAttribute(PREVIEW_RASTER_ATTR, drop);
  }
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
    check(element, element === root);
    unmarkHolders(element);
  }
}

// Scripts restyle inline every frame, so only what can break a mark is looked at.
function followStyle(element: Element): void {
  if (element.hasAttribute(PREVIEW_RASTER_ATTR)) {
    const style = getComputedStyle(element);
    if (style.position === "static" || inlineFit(element, style) !== markedWith.get(element)) {
      check(element, true);
    }
  }
  unmarkHolders(element);
}

function clearMarks(): void {
  for (const element of document.querySelectorAll(MARKED)) {
    element.removeAttribute(PREVIEW_RASTER_ATTR);
  }
}

// Marks are cleared together so the page restyles once, not once per layer.
function markLayers(): void {
  clearMarks();
  for (const element of document.querySelectorAll("*")) check(element, true);
}

function followAttribute(record: MutationRecord): void {
  if (!isElementNode(record.target) || record.attributeName === PREVIEW_RASTER_ATTR) return;
  // Any attribute can match a selector; inline style is the per-frame case, so it is cheaper.
  if (record.attributeName === "style") followStyle(record.target);
  else followTree(record.target);
}

// New rules can restyle anything, and a linked sheet only applies once it loads.
function addedRules(record: MutationRecord): Element[] {
  return [...record.addedNodes].filter(
    (node): node is Element =>
      isElementNode(node) && (node.localName === "style" || node.localName === "link"),
  );
}

function follow(records: MutationRecord[]): void {
  const rules = records.flatMap(addedRules);
  for (const rule of rules) {
    rule.addEventListener("load", () => observer && markLayers(), { once: true });
  }
  if (rules.length) return markLayers();
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
  clearMarks();
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
  });
}
