import { PREVIEW_ONLY_ATTRS, PREVIEW_RASTER_ATTR } from "../studioPreviewMark";
import { isElementNode } from "./domRealm";
import { CLIP_HIDDEN_ATTR } from "./timedClipHide";

// Chromium rasters a `will-change: transform` layer at no less than device scale, so a preview shown
// small rasters each one at full size. Below 1x the hint is dropped wherever nothing depends on the
// stacking context and fixed-position containing block it makes, so the preview paints the same.
const TRANSFORM_HINTS = new Set(["transform", "translate", "rotate", "scale"]);
const MARKED = `[${PREVIEW_RASTER_ATTR}]`;
const DROP_HINTS = `${MARKED} { will-change: auto !important; }`;
// Toggled by the runtime as clips come and go; its own rules on them only hide, never restack.
const RUNTIME_PLAYBACK_ATTRS = new Set<string>([...PREVIEW_ONLY_ATTRS, CLIP_HIDDEN_ATTR]);

let sheet: HTMLStyleElement | null = null;
let observer: MutationObserver | null = null;
let hintRuleSelector: string | null = null;
let watchingAttributes: boolean | null = null;
const marked = new Set<Element>();
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
function fits(element: Element, readOwnHints: boolean): boolean {
  if (element === sheet) return false;
  const isMarked = marked.has(element);
  if (isMarked && readOwnHints) setMark(element, false);
  const style = getComputedStyle(element);
  const hintsFit = (isMarked && !readOwnHints) || onlyTransformHints(style);
  const drop = hintsFit && canDropHint(element, style);
  if (drop) markedWith.set(element, inlineFit(element, style));
  return drop;
}

function setMark(element: Element, on: boolean): void {
  element.toggleAttribute(PREVIEW_RASTER_ATTR, on);
  if (on) marked.add(element);
  else marked.delete(element);
}

function adoptCopiedMark(element: Element): void {
  if (element.hasAttribute(PREVIEW_RASTER_ATTR)) marked.add(element);
}

function writeMark(element: Element, drop: boolean): void {
  if (drop !== marked.has(element)) setMark(element, drop);
}

function check(element: Element, readOwnHints: boolean): void {
  writeMark(element, fits(element, readOwnHints));
}

function unmarkHolders(element: Element): void {
  let holder = element.parentElement?.closest(MARKED);
  while (holder) {
    if (escapes(element, getComputedStyle(holder).zIndex !== "auto")) {
      setMark(holder, false);
    }
    holder = holder.parentElement?.closest(MARKED);
  }
}

// Only an element hinted inline or by a rule can carry will-change; neither check reads style.
function readHintRules(): string {
  const selectors: string[] = [];
  const collect = (rules: CSSRuleList, relative: boolean): void => {
    for (const rule of rules) {
      const isStyleRule = rule.type === CSSRule.STYLE_RULE;
      if (isStyleRule && (rule as CSSStyleRule).style.getPropertyValue("will-change")) {
        selectors.push(relative ? "*" : (rule as CSSStyleRule).selectorText);
      }
      const imported = (rule as CSSImportRule).styleSheet;
      if (imported) collect(imported.cssRules, relative);
      if ("cssRules" in rule) collect((rule as CSSGroupingRule).cssRules, relative || isStyleRule);
    }
  };
  try {
    for (const rules of [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])]) {
      if (rules !== sheet?.sheet) collect(rules.cssRules, false);
    }
    document.createDocumentFragment().querySelector(selectors.join(",") || "*");
  } catch {
    // Cross-origin rules are unreadable, and a namespaced selector does not parse here.
    return "*";
  }
  return selectors.join(",");
}

// Re-read where the page is re-checked, when a style or link arrives or loads.
function hintRules(): string {
  return (hintRuleSelector ??= readHintRules());
}

function mayHint(element: Element): boolean {
  if (marked.has(element) || (element as HTMLElement).style?.getPropertyValue("will-change")) {
    return true;
  }
  const rules = hintRules();
  return rules !== "" && element.matches(rules);
}

function followTree(root: Element, batch: FollowBatch): void {
  const decidedBeforeAnyWrite: Array<[Element, boolean]> = [];
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (batch.checked.has(element)) continue;
    batch.checked.add(element);
    adoptCopiedMark(element);
    const readOwnHints = element === root || batch.changed.has(element);
    decidedBeforeAnyWrite.push([element, mayHint(element) && fits(element, readOwnHints)]);
  }
  for (const [element, drop] of decidedBeforeAnyWrite) writeMark(element, drop);
  if (!marked.size) return;
  for (const [element] of decidedBeforeAnyWrite) unmarkHolders(element);
}

type FollowBatch = { changed: Set<Element>; checked: Set<Element> };

// Scripts restyle inline every frame, so only what can break a mark is looked at.
function followStyle(element: Element): void {
  if (marked.has(element)) {
    const style = getComputedStyle(element);
    if (style.position === "static" || inlineFit(element, style) !== markedWith.get(element)) {
      check(element, true);
    }
  }
  unmarkHolders(element);
}

function clearMarks(): void {
  for (const element of document.querySelectorAll(MARKED)) setMark(element, false);
  marked.clear();
}

// Every mark is decided before any is written, so the page restyles twice, not once per layer.
function markLayers(): void {
  clearMarks();
  hintRuleSelector = null;
  const layers = [...document.querySelectorAll("*")].filter(
    (element) => mayHint(element) && fits(element, true),
  );
  for (const layer of layers) setMark(layer, true);
  watch();
}

function followAttribute(record: MutationRecord, batch: FollowBatch): void {
  if (!isElementNode(record.target) || RUNTIME_PLAYBACK_ATTRS.has(record.attributeName ?? ""))
    return;
  // Any attribute can match a selector; inline style is the per-frame case, so it is cheaper.
  if (record.attributeName === "style") followStyle(record.target);
  else followTree(record.target, batch);
}

// New rules can restyle anything, and a linked sheet only applies once it loads.
function addedRules(record: MutationRecord): Element[] {
  return [...record.addedNodes].filter(
    (node): node is Element =>
      isElementNode(node) && (node.localName === "style" || node.localName === "link"),
  );
}

function ownAttributeChanges(records: MutationRecord[]): Set<Element> {
  const changed = new Set<Element>();
  for (const record of records) {
    const name = record.attributeName;
    if (name === null || name === "style" || RUNTIME_PLAYBACK_ATTRS.has(name)) continue;
    if (isElementNode(record.target)) changed.add(record.target);
  }
  return changed;
}

// With nothing marked and no rule giving a hint, no attribute or inline style change can make or
// break a mark: only added elements are followed, and a hint missed that way stays as authored.
function watch(): void {
  const attributes = marked.size > 0 || hintRules() !== "";
  if (!observer || attributes === watchingAttributes) return;
  watchingAttributes = attributes;
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes });
}

function forgetRemovedMarks(records: MutationRecord[]): void {
  if (!records.some((record) => record.removedNodes.length)) return;
  for (const element of marked) if (!element.isConnected) marked.delete(element);
}

function follow(records: MutationRecord[]): void {
  const rules = records.flatMap(addedRules);
  for (const rule of rules) {
    rule.addEventListener("load", () => observer && markLayers(), { once: true });
  }
  if (rules.length) return markLayers();
  forgetRemovedMarks(records);
  const batch: FollowBatch = { changed: ownAttributeChanges(records), checked: new Set() };
  for (const record of records) {
    if (record.type === "attributes") followAttribute(record, batch);
    else for (const node of record.addedNodes) if (isElementNode(node)) followTree(node, batch);
  }
  watch();
}

function restore(): void {
  observer?.disconnect();
  observer = null;
  sheet?.remove();
  sheet = null;
  hintRuleSelector = null;
  watchingAttributes = null;
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
  watch();
}
