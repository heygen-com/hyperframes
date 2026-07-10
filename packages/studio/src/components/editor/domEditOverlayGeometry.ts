import { type DomEditSelection, findElementForSelection } from "./domEditing";
import { isElementVisibleThroughAncestors } from "./domEditingDom";
import { hugRectForElement } from "./domEditOverlayCrop";

export interface OverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
  editScaleX: number;
  editScaleY: number;
  /**
   * The element's live transform rotation in DEGREES (screen/CSS convention, CW
   * positive), decomposed from its computed transform matrix. Present so the
   * selection chrome can render as an oriented bounding box (OBB) that co-rotates
   * with the element. Omitted (treated as 0) for group/union rects and when the
   * transform is unmeasurable — those render axis-aligned exactly as before.
   */
  angle?: number;
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

// Sample points (as fractions of the element box) for the occlusion hit-test:
// the four inner corners plus the center. This is a coarse approximation of the
// element's painted area — we assume a sampled point that lands inside the box also
// lands on something the element actually paints.
//
// LIMITATION: a donut/ring-shaped element (a hole in the middle, content only around
// the edges) breaks that assumption — the center sample, and even the corner samples,
// can fall in the transparent hole and hit-test through to whatever is behind, so the
// element could read as occluded (or as covering) incorrectly. Today's scene element
// shapes (rectangular cards, text, full-bleed media) don't have interior holes, so this
// doesn't bite. If ring/cutout shapes become editable targets, sample more densely or
// hit-test against the element's actual painted geometry instead of its bounding box.
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

/** toOverlayRect, then shrunk to the element's visible (inset-cropped) region.
 *  For consumers that reason about what's ON SCREEN — snap targets, marquee
 *  hit-tests, display outlines. The selection box must keep the full rect
 *  (it is the gesture coordinate basis). */
export function toVisibleOverlayRect(
  overlayEl: HTMLDivElement,
  iframe: HTMLIFrameElement,
  element: HTMLElement,
): OverlayRect | null {
  const rect = toOverlayRect(overlayEl, iframe, element);
  return rect ? { ...rect, ...hugRectForElement(rect, element) } : null;
}

/**
 * The element's live transform rotation, in DEGREES (screen/CSS convention, CW
 * positive), decomposed from its computed transform matrix (rotation = atan2(b, a)).
 * GSAP folds rotation and scale into the same matrix; this reads rotation only.
 * Returns 0 when the transform is "none" or unmeasurable — callers treat 0 as
 * axis-aligned. Skew is ignored (does not affect atan2(b, a)).
 */
export function readElementRotationDegrees(
  iframe: HTMLIFrameElement,
  element: HTMLElement,
): number {
  const win = iframe.contentWindow;
  if (!win) return 0;
  const DOMMatrixCtor = (win as Window & typeof globalThis).DOMMatrix;
  if (!DOMMatrixCtor) return 0;
  const transform = win.getComputedStyle(element).transform;
  if (!transform || transform === "none") return 0;
  let matrix: DOMMatrix;
  try {
    matrix = new DOMMatrixCtor(transform);
  } catch {
    return 0;
  }
  const a = Number.isFinite(matrix.a) ? matrix.a : 1;
  const b = Number.isFinite(matrix.b) ? matrix.b : 0;
  const deg = (Math.atan2(b, a) * 180) / Math.PI;
  return Number.isFinite(deg) ? deg : 0;
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

/** Which physical corner of the (possibly rotated) element a resize handle keeps
 *  fixed: NW grabs the top-left, so the bottom-right (se) is the anchor, etc. */
export type FixedCorner = "nw" | "ne" | "sw" | "se";

/**
 * The centroid (rendered center) of the four transformed corners from
 * `elementCornerOverlayPoints`, in overlay px. This is the element's true rotation
 * center — the point a center-anchored resize keeps planted.
 */
export function overlayCornersCentroid(corners: Record<FixedCorner, { x: number; y: number }>): {
  x: number;
  y: number;
} {
  return {
    x: (corners.nw.x + corners.ne.x + corners.se.x + corners.sw.x) / 4,
    y: (corners.nw.y + corners.ne.y + corners.se.y + corners.sw.y) / 4,
  };
}

/**
 * The element's border-box corners in OVERLAY coordinates, honoring its live
 * transform (rotation/skew/scale) — NOT the axis-aligned getBoundingClientRect.
 * A rotated element's four visual corners are the transformed local box corners;
 * anchoring a corner-resize off the AABB (BCR) width/height only holds the
 * opposite corner still when the element is unrotated. Uses the same
 * iframe→overlay root scale as toOverlayRect so the returned points share that
 * function's coordinate space. Returns null when the geometry is unmeasurable.
 */
export function elementCornerOverlayPoints(
  overlayEl: HTMLDivElement,
  iframe: HTMLIFrameElement,
  element: HTMLElement,
): Record<FixedCorner, { x: number; y: number }> | null {
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) return null;
  const DOMMatrixCtor = (win as Window & typeof globalThis).DOMMatrix;
  const DOMPointCtor = (win as Window & typeof globalThis).DOMPoint;
  if (!DOMMatrixCtor || !DOMPointCtor) return null;

  const iframeRect = iframe.getBoundingClientRect();
  const overlayRect = overlayEl.getBoundingClientRect();
  const root =
    doc.querySelector<HTMLElement>("[data-composition-id]") ?? doc.documentElement ?? null;
  const rootRect = root?.getBoundingClientRect();
  const declaredWidth = readPositiveDimension(root?.getAttribute("data-width") ?? null);
  const declaredHeight = readPositiveDimension(root?.getAttribute("data-height") ?? null);
  const rootWidth = declaredWidth ?? rootRect?.width;
  const rootHeight = declaredHeight ?? rootRect?.height;
  if (!rootWidth || !rootHeight) return null;
  const rootScaleX = iframeRect.width / rootWidth;
  const rootScaleY = iframeRect.height / rootHeight;

  // The element's local border box maps to viewport coords by the SAME transform
  // matrix the browser used for its BCR. We recover the transform's screen-space
  // action from the BCR: transformPoint(localCorner - origin) gives a corner
  // RELATIVE to the transformed origin. We anchor those relative corners to the
  // BCR by matching the AABB of the transformed corners to the real BCR — the
  // constant offset cancels in the before/after difference the caller takes, but
  // we resolve it fully here so callers can also read absolute overlay positions.
  const cs = win.getComputedStyle(element);
  const w = element.offsetWidth;
  const h = element.offsetHeight;
  const originParts = cs.transformOrigin.split(" ").map((p) => Number.parseFloat(p));
  const ox = Number.isFinite(originParts[0]!) ? originParts[0]! : w / 2;
  const oy = Number.isFinite(originParts[1]!) ? originParts[1]! : h / 2;
  let matrix: DOMMatrix;
  try {
    matrix = new DOMMatrixCtor(cs.transform === "none" ? "" : cs.transform);
  } catch {
    return null;
  }
  const rel = (lx: number, ly: number): { x: number; y: number } => {
    const p = matrix.transformPoint(new DOMPointCtor(lx - ox, ly - oy));
    return { x: p.x, y: p.y };
  };
  const relCorners = {
    nw: rel(0, 0),
    ne: rel(w, 0),
    se: rel(w, h),
    sw: rel(0, h),
  };
  // Recover the absolute viewport position by matching to the element's BCR:
  // the relative corners' AABB min corresponds to the BCR's top-left.
  const xs = [relCorners.nw.x, relCorners.ne.x, relCorners.se.x, relCorners.sw.x];
  const ys = [relCorners.nw.y, relCorners.ne.y, relCorners.se.y, relCorners.sw.y];
  const bcr = element.getBoundingClientRect();
  const dx = bcr.left - Math.min(...xs);
  const dy = bcr.top - Math.min(...ys);
  const toOverlay = (pt: { x: number; y: number }): { x: number; y: number } => ({
    x: iframeRect.left - overlayRect.left + (pt.x + dx) * rootScaleX,
    y: iframeRect.top - overlayRect.top + (pt.y + dy) * rootScaleY,
  });
  return {
    nw: toOverlay(relCorners.nw),
    ne: toOverlay(relCorners.ne),
    se: toOverlay(relCorners.se),
    sw: toOverlay(relCorners.sw),
  };
}

/**
 * The selection chrome's ORIENTED bounding box: the element's UNROTATED border box
 * expressed in overlay coordinates (center-anchored left/top/width/height) plus the
 * live rotation angle. Rendering that rect with `transform: rotate(angle)` about its
 * center reproduces the element's real transformed corners exactly, so the border,
 * corner dots, rotate handle, and crop pills all co-rotate with the object.
 *
 * Built from `elementCornerOverlayPoints` (the real transformed corners): the OBB
 * center is the corner centroid, the unrotated width/height are the edge lengths, and
 * left/top place the unrotated box so that rotating it about its center lands the
 * corners back on the measured points. At angle 0 this equals `toOverlayRect` (the
 * AABB and OBB coincide), so unrotated chrome is pixel-identical to today.
 *
 * Returns the plain AABB rect (angle 0) when the corner geometry can't be measured.
 */
export function orientedOverlayRect(
  overlayEl: HTMLDivElement,
  iframe: HTMLIFrameElement,
  element: HTMLElement,
): OverlayRect | null {
  const base = toOverlayRect(overlayEl, iframe, element);
  if (!base) return null;
  const corners = elementCornerOverlayPoints(overlayEl, iframe, element);
  if (!corners) return base;
  const angle = readElementRotationDegrees(iframe, element);
  // Unrotated edge lengths (in overlay px): nw→ne is the width, nw→sw the height.
  const width = Math.hypot(corners.ne.x - corners.nw.x, corners.ne.y - corners.nw.y);
  const height = Math.hypot(corners.sw.x - corners.nw.x, corners.sw.y - corners.nw.y);
  const centerX = (corners.nw.x + corners.se.x) / 2;
  const centerY = (corners.nw.y + corners.se.y) / 2;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return base;
  }
  return {
    left: centerX - width / 2,
    top: centerY - height / 2,
    width,
    height,
    editScaleX: base.editScaleX,
    editScaleY: base.editScaleY,
    angle,
  };
}

const OVERLAY_RECT_EPSILON_PX = 0.5;
const OVERLAY_RECT_ANGLE_EPSILON_DEG = 0.1;

export function rectsEqual(a: OverlayRect | null, b: OverlayRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.left - b.left) < OVERLAY_RECT_EPSILON_PX &&
    Math.abs(a.top - b.top) < OVERLAY_RECT_EPSILON_PX &&
    Math.abs(a.width - b.width) < OVERLAY_RECT_EPSILON_PX &&
    Math.abs(a.height - b.height) < OVERLAY_RECT_EPSILON_PX &&
    Math.abs(a.editScaleX - b.editScaleX) < 0.001 &&
    Math.abs(a.editScaleY - b.editScaleY) < 0.001 &&
    Math.abs((a.angle ?? 0) - (b.angle ?? 0)) < OVERLAY_RECT_ANGLE_EPSILON_DEG
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

// A group's overlay box encompasses its members' actual rendered bounds, not just
// the wrapper's own box — so members moved or transformed out of the wrapper still
// sit inside the box. Used by the selection, hover, and off-canvas overlays so they
// all agree on where a group is.
export function groupAwareOverlayRect(
  overlayEl: HTMLDivElement,
  iframe: HTMLIFrameElement,
  el: HTMLElement,
): OverlayRect | null {
  const rect = toOverlayRect(overlayEl, iframe, el);
  if (!rect || !el.hasAttribute("data-hf-group")) return rect;
  // Union the MEMBERS' rendered rects — where the content actually is — not the
  // wrapper's own box. The wrapper is invisible and its box can sit apart from the
  // members once they've been moved/transformed, which would otherwise drag the
  // group's bounds (and its off-canvas marker) off to a stale position.
  const rects: OverlayRect[] = [];
  for (const child of Array.from(el.children)) {
    const childRect = toOverlayRect(overlayEl, iframe, child as HTMLElement);
    if (childRect) rects.push(childRect);
  }
  const union = rects.length > 0 ? resolveDomEditGroupOverlayRect(rects) : null;
  if (!union) return rect; // empty group → fall back to the wrapper box
  // resolveDomEditGroupOverlayRect hardcodes editScaleX/Y to 1; keep the wrapper's
  // real edit (display) scale, which the drag uses to convert pointer→offset — a
  // reset-to-1 makes the group move at ~display-scale speed and lag the cursor.
  return { ...union, editScaleX: rect.editScaleX, editScaleY: rect.editScaleY };
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
