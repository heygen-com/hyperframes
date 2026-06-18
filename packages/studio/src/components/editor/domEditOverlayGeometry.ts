import { type DomEditSelection, findElementForSelection } from "./domEditing";
import { isElementVisibleThroughAncestors } from "./domEditingDom";

export interface OverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
  editScaleX: number;
  editScaleY: number;
}

export interface GroupOverlayItem {
  key: string;
  selection: DomEditSelection;
  element: HTMLElement;
  rect: OverlayRect;
}

export type ResolvedElementRef = {
  current: { key: string; element: HTMLElement } | null;
};

export function isElementVisibleForOverlay(el: HTMLElement): boolean {
  return isElementVisibleThroughAncestors(el);
}

// Sample points (as fractions of the element box) for the occlusion hit-test.
const OCCLUSION_SAMPLE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.5],
  [0.2, 0.2],
  [0.8, 0.2],
  [0.2, 0.8],
  [0.8, 0.8],
];

/** Cumulative opacity of an element through its ancestors (0 if any link is ~0). */
function effectiveOpacity(el: Element | null, win: Window): number {
  let opacity = 1;
  let current: Element | null = el;
  while (current) {
    const op = Number.parseFloat(win.getComputedStyle(current).opacity);
    if (Number.isFinite(op)) opacity *= op;
    if (opacity <= 0.01) return 0;
    current = current.parentElement;
  }
  return opacity;
}

/**
 * True when the element is actually painted on screen — what the viewer sees in
 * the preview. Extends `isElementVisibleForOverlay` (display/visibility/opacity)
 * with an OCCLUSION test: this composition stacks scenes by z-index and fades them
 * IN (never out), so an earlier scene's element stays opacity-1 yet is covered by a
 * later opaque scene.
 *
 * Walks the painted stack (`elementsFromPoint`, top→bottom) at several sample points.
 * A point "sees" the element if the element (or its subtree/ancestor) is reached
 * before any unrelated element that's effectively opaque. Transparent covers (a
 * faded-in scene still at opacity ~0) are skipped — they hit-test but don't paint.
 * If every sampled point is blocked by an opaque cover, the element is hidden.
 */
export function isElementVisibleInPreview(el: HTMLElement): boolean {
  if (!isElementVisibleForOverlay(el)) return false;
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  if (!win || typeof doc.elementsFromPoint !== "function") return true;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  let sampledInViewport = false;
  for (const [fx, fy] of OCCLUSION_SAMPLE_POINTS) {
    const x = rect.left + rect.width * fx;
    const y = rect.top + rect.height * fy;
    if (x < 0 || y < 0 || x > win.innerWidth || y > win.innerHeight) continue;
    sampledInViewport = true;
    for (const hit of doc.elementsFromPoint(x, y)) {
      if (hit === el || el.contains(hit) || hit.contains(el)) return true; // reached, uncovered
      if (effectiveOpacity(hit, win) > 0.01) break; // opaque cover above → this point blocked
      // transparent cover (e.g. a scene at opacity ~0) → ignore, keep descending
    }
  }
  // Every in-viewport sample was blocked by an opaque cover → occluded. If nothing
  // was testable (off-viewport), don't hide on this basis.
  return !sampledInViewport;
}

function readPositiveDimension(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function findSourceBoundary(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current) {
    if (
      current.hasAttribute("data-composition-file") ||
      current.hasAttribute("data-composition-src")
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

export function resolveDomEditCoordinateScale(input: {
  rootScaleX: number;
  rootScaleY: number;
  sourceRectWidth?: number;
  sourceRectHeight?: number;
  sourceWidth?: number | null;
  sourceHeight?: number | null;
}): { scaleX: number; scaleY: number } {
  const rootScaleX = input.rootScaleX > 0 ? input.rootScaleX : 1;
  const rootScaleY = input.rootScaleY > 0 ? input.rootScaleY : 1;
  const sourceScaleX =
    input.sourceRectWidth && input.sourceRectWidth > 0 && input.sourceWidth && input.sourceWidth > 0
      ? (input.sourceRectWidth * rootScaleX) / input.sourceWidth
      : rootScaleX;
  const sourceScaleY =
    input.sourceRectHeight &&
    input.sourceRectHeight > 0 &&
    input.sourceHeight &&
    input.sourceHeight > 0
      ? (input.sourceRectHeight * rootScaleY) / input.sourceHeight
      : rootScaleY;
  return {
    scaleX: sourceScaleX > 0 ? sourceScaleX : rootScaleX,
    scaleY: sourceScaleY > 0 ? sourceScaleY : rootScaleY,
  };
}

export function toOverlayRect(
  overlayEl: HTMLDivElement,
  iframe: HTMLIFrameElement,
  element: HTMLElement,
): OverlayRect | null {
  const iframeRect = iframe.getBoundingClientRect();
  const overlayRect = overlayEl.getBoundingClientRect();
  const doc = iframe.contentDocument;
  const root =
    doc?.querySelector<HTMLElement>("[data-composition-id]") ?? doc?.documentElement ?? null;
  const rootRect = root?.getBoundingClientRect();
  // Use the composition's declared dimensions (data-width/data-height) for scale
  // calculation instead of rootRect.width/height. When GSAP applies transforms
  // (scale, translate) to the root element, rootRect dimensions change but the
  // composition's canonical size stays the same. Using rootRect causes overlay
  // misalignment during animated playback.
  const declaredWidth = readPositiveDimension(root?.getAttribute("data-width") ?? null);
  const declaredHeight = readPositiveDimension(root?.getAttribute("data-height") ?? null);
  const rootWidth = declaredWidth ?? rootRect?.width;
  const rootHeight = declaredHeight ?? rootRect?.height;
  if (!rootWidth || !rootHeight || !rootRect) return null;

  const elementRect = element.getBoundingClientRect();
  const rootScaleX = iframeRect.width / rootWidth;
  const rootScaleY = iframeRect.height / rootHeight;
  const sourceBoundary = findSourceBoundary(element);
  const sourceBoundaryRect = sourceBoundary?.getBoundingClientRect();
  const editScale = resolveDomEditCoordinateScale({
    rootScaleX,
    rootScaleY,
    sourceRectWidth: sourceBoundaryRect?.width,
    sourceRectHeight: sourceBoundaryRect?.height,
    sourceWidth: readPositiveDimension(sourceBoundary?.getAttribute("data-width") ?? null),
    sourceHeight: readPositiveDimension(sourceBoundary?.getAttribute("data-height") ?? null),
  });

  return {
    left: iframeRect.left - overlayRect.left + elementRect.left * rootScaleX,
    top: iframeRect.top - overlayRect.top + elementRect.top * rootScaleY,
    width: elementRect.width * rootScaleX,
    height: elementRect.height * rootScaleY,
    editScaleX: editScale.scaleX,
    editScaleY: editScale.scaleY,
  };
}

const OVERLAY_RECT_EPSILON_PX = 0.5;

export function rectsEqual(a: OverlayRect | null, b: OverlayRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.left - b.left) < OVERLAY_RECT_EPSILON_PX &&
    Math.abs(a.top - b.top) < OVERLAY_RECT_EPSILON_PX &&
    Math.abs(a.width - b.width) < OVERLAY_RECT_EPSILON_PX &&
    Math.abs(a.height - b.height) < OVERLAY_RECT_EPSILON_PX &&
    Math.abs(a.editScaleX - b.editScaleX) < 0.001 &&
    Math.abs(a.editScaleY - b.editScaleY) < 0.001
  );
}

export function groupOverlayItemsEqual(a: GroupOverlayItem[], b: GroupOverlayItem[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return Boolean(
      other &&
      item.key === other.key &&
      item.element === other.element &&
      item.selection === other.selection &&
      rectsEqual(item.rect, other.rect),
    );
  });
}

export function resolveDomEditGroupOverlayRect(rects: OverlayRect[]): OverlayRect | null {
  const first = rects[0];
  if (!first) return null;

  let left = first.left;
  let top = first.top;
  let right = first.left + first.width;
  let bottom = first.top + first.height;

  for (const rect of rects.slice(1)) {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.left + rect.width);
    bottom = Math.max(bottom, rect.top + rect.height);
  }

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    editScaleX: 1,
    editScaleY: 1,
  };
}

export function filterNestedDomEditGroupItems<T extends { element: HTMLElement }>(items: T[]): T[] {
  return items.filter(
    (item) => !items.some((other) => other !== item && other.element.contains(item.element)),
  );
}

export function selectionCacheKey(
  selection: Pick<DomEditSelection, "id" | "hfId" | "selector" | "selectorIndex" | "sourceFile">,
): string {
  return [
    selection.sourceFile ?? "",
    selection.hfId ?? "",
    selection.id ?? "",
    selection.selector ?? "",
    selection.selectorIndex ?? "",
  ].join("|");
}

export function resolveElementForOverlay(
  doc: Document,
  sel: DomEditSelection,
  activeCompositionPath: string | null,
  cacheRef: ResolvedElementRef,
): HTMLElement | null {
  const key = selectionCacheKey(sel);
  const cached = cacheRef.current;
  if (cached?.key === key && cached.element.isConnected && cached.element.ownerDocument === doc) {
    return cached.element;
  }

  const next = findElementForSelection(doc, sel, activeCompositionPath);
  cacheRef.current = next ? { key, element: next } : null;
  return next;
}
