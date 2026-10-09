// Chromium rasters a `will-change: transform` layer at no less than device scale, so a preview shown
// small rasters each one at full size. While shown below 1x, the hint becomes an identity filter, which
// keeps its stacking context and containing block, so layout and paint order still match the render.
const TRANSFORM_HINTS = new Set(["transform", "translate", "rotate", "scale"]);

type Swap = { willChange: string; filter: string; ourWillChange: string; ourFilter: string | null };
const swaps = new Map<HTMLElement | SVGElement, Swap>();
let observer: MutationObserver | null = null;

function swap(element: Element): void {
  if (!(element instanceof HTMLElement || element instanceof SVGElement) || swaps.has(element))
    return;
  const computed = getComputedStyle(element);
  const hints = computed.willChange.split(",").map((hint) => hint.trim());
  // A filter would flatten a preserve-3d container, so 3D keeps its hint.
  if (!hints.some((hint) => TRANSFORM_HINTS.has(hint)) || computed.transformStyle === "preserve-3d")
    return;
  const kept = hints.filter((hint) => !TRANSFORM_HINTS.has(hint));
  const ourWillChange = kept.length ? kept.join(", ") : "auto";
  const ourFilter = computed.filter === "none" ? "opacity(1)" : null;
  swaps.set(element, {
    willChange: element.style.willChange,
    filter: element.style.filter,
    ourWillChange,
    ourFilter,
  });
  element.style.willChange = ourWillChange;
  if (ourFilter) element.style.filter = ourFilter;
}

function swapTree(root: Element): void {
  swap(root);
  for (const element of root.querySelectorAll("*")) swap(element);
}

function restore(): void {
  observer?.disconnect();
  observer = null;
  for (const [element, before] of swaps) {
    // A value written since the swap (a GSAP filter tween, say) is newer; keep it.
    if (element.style.willChange === before.ourWillChange)
      element.style.willChange = before.willChange;
    if (before.ourFilter && element.style.filter === before.ourFilter)
      element.style.filter = before.filter;
  }
  swaps.clear();
}

/** The host reports how large it shows this document; below 1x, transform hints stop forcing full-size rasters. */
export function setPreviewRasterScale(scale: number): void {
  if (!(scale > 0) || !Number.isFinite(scale)) return;
  if (scale >= 1) return restore();
  if (observer) return;
  swapTree(document.documentElement);
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof Element) swapTree(record.target);
      for (const node of record.addedNodes) if (node instanceof Element) swapTree(node);
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class"],
  });
}
