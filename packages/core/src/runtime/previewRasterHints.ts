import { isElementNode, isStylableElement } from "./domRealm";

// Chromium rasters a `will-change: transform` layer at no less than device scale, so a preview shown
// small rasters each one at full size. While shown below 1x, the hint becomes a perspective too far
// away to see, which keeps its stacking context and containing block without making a layer.
const TRANSFORM_HINTS = new Set(["transform", "translate", "rotate", "scale"]);
// A point 1000px deep moves by a millionth of its offset; flat content does not move at all.
const FAR_PERSPECTIVE = "1000000000px";

type Swap = {
  willChange: string;
  perspective: string;
  ourWillChange: string;
  ourPerspective: string | null;
};
const swaps = new Map<HTMLElement | SVGElement, Swap>();
let observer: MutationObserver | null = null;

function swap(element: Element): void {
  if (!isStylableElement(element) || swaps.has(element)) return;
  const computed = getComputedStyle(element);
  const hints = computed.willChange.split(",").map((hint) => hint.trim());
  if (!hints.some((hint) => TRANSFORM_HINTS.has(hint))) return;
  const flat = computed.perspective === "none";
  const before = { willChange: element.style.willChange, perspective: element.style.perspective };
  const kept = hints.filter((hint) => !TRANSFORM_HINTS.has(hint));
  element.style.willChange = kept.length ? kept.join(", ") : "auto";
  if (flat) element.style.perspective = FAR_PERSPECTIVE;
  swaps.set(element, {
    ...before,
    ourWillChange: element.style.willChange,
    ourPerspective: flat ? element.style.perspective : null,
  });
}

function swapTree(root: Element): void {
  swap(root);
  for (const element of root.querySelectorAll("*")) swap(element);
}

function unswap(element: HTMLElement | SVGElement, before: Swap): void {
  swaps.delete(element);
  // A value written since the swap is newer; keep it.
  if (element.style.willChange === before.ourWillChange) {
    element.style.willChange = before.willChange;
  }
  if (before.ourPerspective && element.style.perspective === before.ourPerspective) {
    element.style.perspective = before.perspective;
  }
}

function restore(): void {
  observer?.disconnect();
  observer = null;
  for (const [element, before] of swaps) unswap(element, before);
}

function reswap(element: Element): void {
  if (isStylableElement(element)) {
    const before = swaps.get(element);
    if (before) unswap(element, before);
  }
  swapTree(element);
}

/** The host reports how large it shows this document; below 1x, transform hints stop forcing full-size rasters. */
export function setPreviewRasterScale(scale: number): void {
  if (!(scale > 0) || !Number.isFinite(scale)) return;
  if (scale >= 1) return restore();
  if (observer) return;
  swapTree(document.documentElement);
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes" && isElementNode(record.target)) reswap(record.target);
      for (const node of record.addedNodes) if (isElementNode(node)) swapTree(node);
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class"],
  });
}
