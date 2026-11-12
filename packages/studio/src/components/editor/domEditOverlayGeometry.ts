import { type DomEditSelection, findElementForSelection } from "./domEditing";
import {
  computeOverlayRootScale,
  type OverlayRootScale,
  readPositiveDimension,
} from "./domEditOverlayBasis";
import { isElementVisibleThroughAncestors } from "./domEditingDom";
import { hugRectForElement } from "./domEditOverlayCrop";
import {
  elementCornerPoints,
  readElementTransformSnapshot,
  rotationDegreesFromMatrix,
  ROTATION_GATE_EPSILON_DEG,
  type EditingCorners,
  type ElementTransformSnapshot,
} from "@hyperframes/core/runtime/editing-port";
import { type OverlayMeasurePass, readThroughPass } from "./domEditOverlayMeasurePass";

export const RESIZE_HANDLE_HIT_PX = 16;

export interface OverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
  editScaleX: number;
  editScaleY: number;
  /** Live screen-space rotation; omitted for axis-aligned group bounds. */
  angle?: number;
}

export const shiftedOverlayRect = (rect: OverlayRect, dx: number, dy: number): OverlayRect => ({
  ...rect,
  left: rect.left + dx,
  top: rect.top + dy,
});

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
const isSourceBoundary = (node: HTMLElement): boolean =>
  node.hasAttribute("data-composition-file") || node.hasAttribute("data-composition-src");

/** With a `pass`, every node on the way up is memoized rather than only the
 *  element asked about: an element's boundary IS its parent's unless it is one
 *  itself, so siblings share the walk instead of each repeating it. */
function findSourceBoundary(element: HTMLElement, pass?: OverlayMeasurePass): HTMLElement | null {
  const pending: HTMLElement[] = [];
  let boundary: HTMLElement | null | undefined;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    boundary = pass?.sourceBoundary.get(node);
    if (boundary !== undefined) break;
    if (isSourceBoundary(node)) {
      boundary = node;
      pass?.sourceBoundary.set(node, node);
      break;
    }
    pending.push(node);
  }
  const answer = boundary ?? null;
  if (pass) for (const node of pending) pass.sourceBoundary.set(node, answer);
  return answer;
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
  precomputedScale?: OverlayRootScale | null,
): OverlayRect | null {
  const rect = toOverlayRect(overlayEl, iframe, element, precomputedScale);
  return rect ? { ...rect, ...hugRectForElement(rect, element) } : null;
}

/** Batch transient chrome through one shared iframe-to-overlay coordinate basis. */
export function toVisibleOverlayRects(
  overlayEl: HTMLDivElement,
  iframe: HTMLIFrameElement,
  elements: readonly HTMLElement[],
): Array<OverlayRect | null> {
  const scale = computeOverlayRootScale(overlayEl, iframe, iframe.contentDocument);
  if (!scale) return elements.map(() => null);
  return elements.map((element) => {
    const rect = toOverlayRect(overlayEl, iframe, element, scale);
    return rect ? { ...rect, ...hugRectForElement(rect, element) } : null;
  });
}

function toOverlayRect(
  overlayEl: HTMLDivElement,
  iframe: HTMLIFrameElement,
  element: HTMLElement,
  precomputedScale?: OverlayRootScale | null,
  pass?: OverlayMeasurePass,
): OverlayRect | null {
  const scale =
    precomputedScale ?? computeOverlayRootScale(overlayEl, iframe, iframe.contentDocument);
  if (!scale) return null;

  const elementRect = element.getBoundingClientRect();
  const sourceBoundary = findSourceBoundary(element, pass);
  // Every element inside one sub-composition shares this boundary, so its rect
  // is one layout read per boundary rather than one per element.
  const sourceBoundaryRect =
    sourceBoundary && pass
      ? readThroughPass(pass.sourceBoundaryRect, sourceBoundary, () =>
          sourceBoundary.getBoundingClientRect(),
        )
      : sourceBoundary?.getBoundingClientRect();
  return frameRectToOverlay(scale, elementRect, {
    width: sourceBoundaryRect?.width,
    height: sourceBoundaryRect?.height,
    declaredWidth: readPositiveDimension(sourceBoundary?.getAttribute("data-width") ?? null),
    declaredHeight: readPositiveDimension(sourceBoundary?.getAttribute("data-height") ?? null),
  });
}

type FrameSource = {
  width?: number;
  height?: number;
  declaredWidth: number | null;
  declaredHeight: number | null;
} | null;

/** A client rect measured in the frame, and its source boundary's, in overlay coordinates. */
export function frameRectToOverlay(
  scale: OverlayRootScale,
  elementRect: { left: number; top: number; width: number; height: number },
  source: FrameSource,
): OverlayRect {
  const { iframeRect, overlayRect, rootScaleX, rootScaleY } = scale;
  const editScale = resolveDomEditCoordinateScale({
    rootScaleX,
    rootScaleY,
    sourceRectWidth: source?.width,
    sourceRectHeight: source?.height,
    sourceWidth: source?.declaredWidth,
    sourceHeight: source?.declaredHeight,
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

/** Corners measured in the frame's viewport px, in overlay coordinates. */
export function frameCornersToOverlay(
  { iframeRect, overlayRect, rootScaleX, rootScaleY }: OverlayRootScale,
  corners: EditingCorners,
): Record<FixedCorner, { x: number; y: number }> {
  const toOverlay = (pt: { x: number; y: number }): { x: number; y: number } => ({
    x: iframeRect.left - overlayRect.left + pt.x * rootScaleX,
    y: iframeRect.top - overlayRect.top + pt.y * rootScaleY,
  });
  return {
    nw: toOverlay(corners.nw),
    ne: toOverlay(corners.ne),
    se: toOverlay(corners.se),
    sw: toOverlay(corners.sw),
  };
}

/** Which physical corner of the (possibly rotated) element a resize handle keeps
 *  fixed: NW grabs the top-left, so the bottom-right (se) is the anchor, etc. */
export type FixedCorner = "nw" | "ne" | "sw" | "se";

/** Distance between two overlay-px corner points — the edge-length math
 *  orientedOverlayRect uses to turn corners into a width/height. Exported so a
 *  caller already holding raw corners (e.g. a resize gesture mid-measurement)
 *  can derive the same dimensions without a second orientedOverlayRect call. */
export function cornerEdgeLength(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

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
 * A rotated element's four visual corners are the transformed local box corners.
 * Uses the same iframe→overlay root scale as toOverlayRect so the returned
 * points share that function's coordinate space. Returns null when the
 * geometry is unmeasurable.
 */
export function elementCornerOverlayPoints(
  overlayEl: HTMLDivElement,
  iframe: HTMLIFrameElement,
  element: HTMLElement,
  precomputedScale?: OverlayRootScale | null,
  precomputedTransform?: ElementTransformSnapshot | null,
): Record<FixedCorner, { x: number; y: number }> | null {
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) return null;
  if (!(win as Window & typeof globalThis).DOMPoint) return null;

  const scale = precomputedScale ?? computeOverlayRootScale(overlayEl, iframe, doc);
  if (!scale) return null;

  const transform = precomputedTransform ?? readElementTransformSnapshot(win, element);
  if (!transform) return null;
  const corners = elementCornerPoints(win, element, transform);
  return corners && frameCornersToOverlay(scale, corners);
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
 *
 * Rotation gate: an unrotated element's OBB is numerically identical to its AABB
 * (the comment above), so a cheap rotation read decides up front whether the
 * (much pricier) corner-transform pass runs at all — for the overwhelming
 * majority of selections, which aren't rotated, this call is just `toOverlayRect`
 * plus one getComputedStyle/DOMMatrix read. The root scale and the transform
 * snapshot are each computed once per call and threaded into both the rotation
 * read and the corner math, instead of every helper re-measuring independently.
 */
export function orientedOverlayRect(
  overlayEl: HTMLDivElement,
  iframe: HTMLIFrameElement,
  element: HTMLElement,
  precomputedScale?: OverlayRootScale | null,
  pass?: OverlayMeasurePass,
): OverlayRect | null {
  const scale =
    precomputedScale ?? computeOverlayRootScale(overlayEl, iframe, iframe.contentDocument);
  if (!scale) return null;
  const base = toOverlayRect(overlayEl, iframe, element, scale, pass);
  if (!base) return null;

  const win = iframe.contentWindow;
  const transform = win ? readElementTransformSnapshot(win, element, pass?.transform) : null;
  const angle = transform ? rotationDegreesFromMatrix(transform.matrix) : 0;
  if (Math.abs(angle) < ROTATION_GATE_EPSILON_DEG) return base;

  const corners = elementCornerOverlayPoints(overlayEl, iframe, element, scale, transform);
  return orientOverlayRect(base, angle, corners);
}

/** The oriented box whose corners are `corners`, at `angle`; `base` when they cannot describe one. */
export function orientOverlayRect(
  base: OverlayRect,
  angle: number,
  corners: Record<FixedCorner, { x: number; y: number }> | null,
): OverlayRect {
  if (!corners) return base;
  // Unrotated edge lengths (in overlay px): nw→ne is the width, nw→sw the height.
  const width = cornerEdgeLength(corners.nw, corners.ne);
  const height = cornerEdgeLength(corners.nw, corners.sw);
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

/**
 * `toVisibleOverlayRect`'s oriented twin: the element's crop-hugged box plus its
 * live rotation, for chrome that has to sit on a rotated element rather than
 * around it. Rendering the result with `transform: rotate(angle)` about its
 * centre lands it on the element's real corners.
 *
 * At angle 0 `orientedOverlayRect` returns the plain AABB, so an unrotated
 * element measures exactly as it did before.
 */
export function orientedVisibleOverlayRect(
  overlayEl: HTMLDivElement,
  iframe: HTMLIFrameElement,
  element: HTMLElement,
  precomputedScale?: OverlayRootScale | null,
): OverlayRect | null {
  const rect = orientedOverlayRect(overlayEl, iframe, element, precomputedScale);
  return rect ? { ...rect, ...hugRectForElement(rect, element) } : null;
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
  precomputedScale?: OverlayRootScale | null,
  pass?: OverlayMeasurePass,
): OverlayRect | null {
  const rect = toOverlayRect(overlayEl, iframe, el, precomputedScale, pass);
  if (!rect || !el.hasAttribute("data-hf-group")) return rect;
  // Union the MEMBERS' rendered rects — where the content actually is — not the
  // wrapper's own box. The wrapper is invisible and its box can sit apart from the
  // members once they've been moved/transformed, which would otherwise drag the
  // group's bounds (and its off-canvas marker) off to a stale position.
  const rects: OverlayRect[] = [];
  for (const child of Array.from(el.children)) {
    const childRect = toOverlayRect(
      overlayEl,
      iframe,
      child as HTMLElement,
      precomputedScale,
      pass,
    );
    if (childRect) rects.push(childRect);
  }
  const union = rects.length > 0 ? resolveDomEditGroupOverlayRect(rects) : null;
  if (!union) return rect; // empty group → fall back to the wrapper box
  // resolveDomEditGroupOverlayRect hardcodes editScaleX/Y to 1; keep the wrapper's
  // real edit (display) scale, which the drag uses to convert pointer→offset — a
  // reset-to-1 makes the group move at ~display-scale speed and lag the cursor.
  return { ...union, editScaleX: rect.editScaleX, editScaleY: rect.editScaleY };
}

/**
 * Groups stay axis-aligned unions; ordinary elements keep their oriented box.
 *
 * `precomputedScale` is the iframe→overlay basis from `computeOverlayRootScale`.
 * Without it every call resolves the composition root itself — one
 * `querySelector("[data-composition-id]")` plus three `getBoundingClientRect`
 * reads PER ELEMENT — and a caller measuring a whole preview therefore pays that
 * once per element rather than once per composition. The basis is a property of
 * the composition and the canvas zoom, not of the element, so a caller that
 * measures many elements in one synchronous pass resolves it once and threads it
 * through. See `toVisibleOverlayRects` for the same batching in miniature.
 */
export function orientedGroupAwareOverlayRect(
  overlayEl: HTMLDivElement,
  iframe: HTMLIFrameElement,
  el: HTMLElement,
  precomputedScale?: OverlayRootScale | null,
  pass?: OverlayMeasurePass,
): OverlayRect | null {
  return el.hasAttribute("data-hf-group")
    ? groupAwareOverlayRect(overlayEl, iframe, el, precomputedScale, pass)
    : orientedOverlayRect(overlayEl, iframe, el, precomputedScale, pass);
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
