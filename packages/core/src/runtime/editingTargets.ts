/** The canvas hit-test `pointer-targets` answers; Studio runs it on frames it scripts too. */
import { MAX_POINT_STACK, buildStableSelector, type EditingElementHit } from "./editingElement";
import { isElementVisibleThroughAncestors } from "./editingGeometry";
import { elementHit } from "./editingHandles";
import { isElementNode } from "./domRealm";

export interface EditingViewport {
  width: number;
  height: number;
}

/** A point in the frame's CSS pixels, with the composition box it is measured against. */
export interface EditingLocalPointer {
  x: number;
  y: number;
  viewport: EditingViewport;
}

// A box this close to the composition on both axes is a backdrop: a click passes it to the content.
const FULL_BLEED_RATIO = 0.95;

// A full-bleed video or image is itself what the user clicks, so media stays pickable.
const FULL_BLEED_SELECTABLE_MEDIA_TAGS = new Set(["video", "img", "canvas", "svg"]);

export function coversComposition(
  elRect: { width: number; height: number },
  viewport: EditingViewport,
): boolean {
  if (viewport.width <= 1 || viewport.height <= 1) return false;
  return (
    elRect.width / viewport.width >= FULL_BLEED_RATIO &&
    elRect.height / viewport.height >= FULL_BLEED_RATIO
  );
}

function isFullBleedTarget(el: HTMLElement, viewport: EditingViewport): boolean {
  if (FULL_BLEED_SELECTABLE_MEDIA_TAGS.has(el.tagName.toLowerCase())) return false;
  return coversComposition(el.getBoundingClientRect(), viewport);
}

const VISUAL_LEAF_TAGS = new Set(["img", "video", "canvas", "svg", "audio"]);

// fallow-ignore-next-line complexity
function hasVisualPresence(el: HTMLElement): boolean {
  const win = el.ownerDocument.defaultView;
  if (!win) return false;
  const cs = win.getComputedStyle(el);
  if (cs.backgroundImage !== "none") return true;
  if (
    cs.backgroundColor &&
    cs.backgroundColor !== "transparent" &&
    cs.backgroundColor !== "rgba(0, 0, 0, 0)"
  )
    return true;
  if (cs.borderWidth && parseFloat(cs.borderWidth) > 0 && cs.borderStyle !== "none") return true;
  if (cs.boxShadow && cs.boxShadow !== "none") return true;
  return false;
}

function isEmptyVisualContainer(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (VISUAL_LEAF_TAGS.has(tag)) return false;
  if (hasVisualPresence(el)) return false;

  const { children } = el;
  if (children.length === 0) {
    return (el.textContent ?? "").trim().length === 0;
  }

  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (!isElementNode(child)) continue;
    if (VISUAL_LEAF_TAGS.has(child.tagName.toLowerCase())) return false;
    if (isElementVisibleThroughAncestors(child as HTMLElement)) return false;
  }

  return true;
}

function hasRenderedBox(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) return false;
  if (!isElementVisibleThroughAncestors(el)) return false;
  if (isEmptyVisualContainer(el)) return false;
  return true;
}

const DOM_LAYER_IGNORED_TAGS = new Set([
  "base",
  "br",
  "canvas",
  "link",
  "meta",
  "script",
  "source",
  "style",
  "template",
  "track",
  "wbr",
]);

/** Is it rendered at all: the half of being a layer that a style write can flip. */
export function isInspectableLayerElement(el: HTMLElement): boolean {
  const tagName = el.tagName.toLowerCase();
  if (DOM_LAYER_IGNORED_TAGS.has(tagName)) return false;

  const computed = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (computed?.display === "none" || computed?.visibility === "hidden") return false;

  return true;
}

/** The selector a layer is addressed by; undefined for an element that cannot be one. */
export function resolveLayerSelector(el: HTMLElement): string | undefined {
  if (el.hasAttribute("data-composition-id")) return undefined;
  return buildStableSelector(el);
}

/** Is `el` a layer, without resolving its selector's occurrence index (a whole-document query). */
export function isDomLayerElement(el: HTMLElement): boolean {
  return isInspectableLayerElement(el) && resolveLayerSelector(el) !== undefined;
}

/** The selectable layers in a hit stack, topmost first: one per run of nested hits, its deepest. */
export function resolveAllVisualDomEditTargets(
  elementsFromPoint: Iterable<Element | null | undefined>,
): HTMLElement[] {
  const raw: HTMLElement[] = [];

  for (const entry of elementsFromPoint) {
    if (!isElementNode(entry)) continue;
    const el = entry as HTMLElement;
    if (hasRenderedBox(el) && isDomLayerElement(el)) {
      raw.push(el);
    }
  }

  if (raw.length === 0) return [];

  const layers: HTMLElement[] = [];
  let best = raw[0]!;
  for (let i = 1; i < raw.length; i++) {
    const el = raw[i]!;
    if (best.contains(el)) {
      best = el; // go deeper in this subtree
    } else {
      layers.push(best);
      best = el;
    }
  }
  layers.push(best);

  return layers;
}

const pointerEventsInheritanceFallbackByDocument = new WeakMap<Document, boolean>();

function needsPointerEventsInheritanceFallback(doc: Document, win: Window): boolean {
  const cached = pointerEventsInheritanceFallbackByDocument.get(doc);
  if (cached !== undefined) return cached;

  const parent = doc.createElement("div");
  const child = doc.createElement("div");
  parent.style.pointerEvents = "none";
  parent.appendChild(child);
  const host = doc.body ?? doc.documentElement;
  if (!host) return false;

  host.appendChild(parent);
  const needsFallback = win.getComputedStyle(child).pointerEvents !== "none";
  parent.remove();
  pointerEventsInheritanceFallbackByDocument.set(doc, needsFallback);
  return needsFallback;
}

// Computed, not inline, so a class's pointer-events opt-in under a none ancestor counts.
function hasOwnPointerEventsOverride(el: HTMLElement, win: Window): boolean {
  const value = win.getComputedStyle(el).pointerEvents;
  return value !== "" && value !== "inherit" && value !== "unset";
}

function inheritsPointerEventsNoneFromAncestor(el: HTMLElement, win: Window): boolean {
  let current = el.parentElement;
  while (current) {
    if (win.getComputedStyle(current).pointerEvents === "none") {
      let descendant: HTMLElement | null = el;
      while (descendant && descendant !== current) {
        if (hasOwnPointerEventsOverride(descendant, win)) {
          return win.getComputedStyle(descendant).pointerEvents === "none";
        }
        descendant = descendant.parentElement;
      }
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function hasAuthorPointerEventsNone(el: HTMLElement): boolean {
  const win = el.ownerDocument.defaultView;
  if (!win) return false;
  if (win.getComputedStyle(el).pointerEvents === "none") return true;
  if (!needsPointerEventsInheritanceFallback(el.ownerDocument, win)) return false;
  return inheritsPointerEventsNoneFromAncestor(el, win);
}

function collectPointerEventsNoneTargets(
  elements: Iterable<Element | null | undefined>,
): WeakSet<HTMLElement> {
  const disabled = new WeakSet<HTMLElement>();
  for (const entry of elements) {
    if (isElementNode(entry) && hasAuthorPointerEventsNone(entry as HTMLElement)) {
      disabled.add(entry as HTMLElement);
    }
  }
  return disabled;
}

function filterAuthorInteractiveTargets(elements: Element[]): HTMLElement[] {
  const pointerEventsNoneTargets = collectPointerEventsNoneTargets(elements);
  return resolveAllVisualDomEditTargets(elements).filter((el) => !pointerEventsNoneTargets.has(el));
}

function eventTargetElement(target: EventTarget | null): HTMLElement | null {
  if (!target || typeof target !== "object") return null;
  const maybeNode = target as { nodeType?: number; parentElement?: Element | null };
  if (maybeNode.nodeType === 1) return target as HTMLElement;
  if (maybeNode.nodeType === 3 && maybeNode.parentElement) {
    return maybeNode.parentElement as HTMLElement;
  }
  return null;
}

// The smallest group whose members' union holds the point: its gaps hit-test to nothing.
// fallow-ignore-next-line complexity
function findGroupAtPoint(doc: Document, x: number, y: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestArea = Infinity;
  for (const group of Array.from(doc.querySelectorAll<HTMLElement>("[data-hf-group]"))) {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const member of Array.from(group.children)) {
      const r = member.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
    if (right < left || x < left || x > right || y < top || y > bottom) continue;
    const area = (right - left) * (bottom - top);
    if (area < bestArea) {
      bestArea = area;
      best = group;
    }
  }
  return best;
}

/** The element a press at `point` picks, or null for empty canvas. */
export function pointerTarget(doc: Document, point: EditingLocalPointer): HTMLElement | null {
  // Reads only: a style added here, even briefly, restyles the whole film on each hover.
  if (typeof doc.elementsFromPoint === "function") {
    const elements = doc.elementsFromPoint(point.x, point.y);
    const candidates = filterAuthorInteractiveTargets(elements);
    const visualTarget = candidates.find((el) => !isFullBleedTarget(el, point.viewport)) ?? null;
    if (visualTarget) return visualTarget;
  }
  return pointerFallbackTarget(doc, point);
}

function pointerFallbackTarget(doc: Document, point: EditingLocalPointer): HTMLElement | null {
  const groupHit = findGroupAtPoint(doc, point.x, point.y);
  if (groupHit && !hasAuthorPointerEventsNone(groupHit) && isDomLayerElement(groupHit))
    return groupHit;

  const fallback = eventTargetElement(doc.elementFromPoint(point.x, point.y));
  if (!fallback || !isDomLayerElement(fallback)) return null;
  if (hasAuthorPointerEventsNone(fallback)) return null;
  if (!isElementVisibleThroughAncestors(fallback)) return null;
  if (isFullBleedTarget(fallback, point.viewport)) return null;
  return fallback;
}

/** Every independently-selectable element at `point`, topmost first. */
export function pointerTargets(doc: Document, point: EditingLocalPointer): HTMLElement[] {
  if (typeof doc.elementsFromPoint === "function") {
    const elements = doc.elementsFromPoint(point.x, point.y);
    return filterAuthorInteractiveTargets(elements).filter(
      (el) => !isFullBleedTarget(el, point.viewport),
    );
  }
  const fallback = eventTargetElement(doc.elementFromPoint(point.x, point.y));
  if (!fallback || !isDomLayerElement(fallback)) return [];
  if (hasAuthorPointerEventsNone(fallback)) return [];
  if (!isElementVisibleThroughAncestors(fallback)) return [];
  if (isFullBleedTarget(fallback, point.viewport)) return [];
  return [fallback];
}

/** The frame point at fractions `x` and `y` of the composition root's box, else the viewport's. */
export function compositionPoint(doc: Document, x: number, y: number): EditingLocalPointer | null {
  const root =
    doc.querySelector<HTMLElement>("[data-composition-id]") ?? doc.documentElement ?? null;
  const rootRect = root?.getBoundingClientRect();
  const width = rootRect?.width || doc.defaultView?.innerWidth || 0;
  const height = rootRect?.height || doc.defaultView?.innerHeight || 0;
  if (!width || !height) return null;
  return { x: x * width, y: y * height, viewport: { width, height } };
}

/** `pointer-targets`: the pick at a composition point, and the stack a repeated press cycles. */
export function pointerTargetsAt(
  x: number,
  y: number,
): { target: EditingElementHit | null; stack: EditingElementHit[] } {
  const point = compositionPoint(document, x, y);
  if (!point) return { target: null, stack: [] };
  const stack = pointerTargets(document, point);
  const visual = typeof document.elementsFromPoint === "function" ? stack[0] : undefined;
  const target = visual ?? pointerFallbackTarget(document, point);
  return {
    target: target && elementHit(target),
    stack: stack.slice(0, MAX_POINT_STACK).map(elementHit),
  };
}
