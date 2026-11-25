import {
  elementCornerPoints,
  readElementTransformSnapshot,
} from "@hyperframes/core/runtime/editing-port";
import {
  parseInsetClipPathSides,
  type ClipPathInsetSides,
  type ParsedInsetClipPathSides,
} from "./clipPathHelpers";
import { MAX_DRAFT_PX, MAX_ELEMENT_VALUE } from "@hyperframes/core/runtime/editing-port";
import { previewRequest } from "../../player/lib/previewChannel";
import { previewStandIn } from "./previewDrafts";

export type CropEdge = "top" | "right" | "bottom" | "left";

export interface CropScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Element-space insets → the cropped region's bounds in overlay (screen) space. With `corners` (a transformed
 * layer's own corners) the insets cut along its own edges; insets that cross shrink until they meet, as CSS does.
 */
export function cropRectFromInsets(
  rect: CropScreenRect,
  insets: ClipPathInsetSides,
  scaleX: number,
  scaleY: number,
  corners?: OwnCorners,
): CropScreenRect {
  const sx = scaleX > 0 ? scaleX : 1;
  const sy = scaleY > 0 ? scaleY : 1;
  const { left: x, top: y, width: w, height: h } = rect;
  const { nw, ne, sw } = corners ?? { nw: { x, y }, ne: { x: x + w, y }, sw: { x, y: y + h } };
  const [width, height] = [edge(nw, ne), edge(nw, sw)];
  const [l, r] = meet(insets.left * sx, insets.right * sx, width);
  const [t, b] = meet(insets.top * sy, insets.bottom * sy, height);
  const at = (u: number, v: number) => {
    const [fu, fv] = [width > 0 ? u / width : 0, height > 0 ? v / height : 0];
    return {
      x: nw.x + (ne.x - nw.x) * fu + (sw.x - nw.x) * fv,
      y: nw.y + (ne.y - nw.y) * fu + (sw.y - nw.y) * fv,
    };
  };
  const cut = [at(l, t), at(width - r, t), at(width - r, height - b), at(l, height - b)];
  const xs = cut.map((p) => p.x);
  const ys = cut.map((p) => p.y);
  const [left, top] = [Math.min(...xs), Math.min(...ys)];
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

const edge = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const meet = (a: number, b: number, side: number): [number, number] =>
  a + b > side && a + b > 0 ? [(a * side) / (a + b), (b * side) / (a + b)] : [a, b];

// A selected croppable element shows uncropped so the crop UI can dim what is cut away. A rule keyed on its
// identity does that, so the element's own clip-path stays the one record undo, redo and panel edits rewrite.
// A sealed preview's lift is that rule in the frame (core `editing/cropLift.ts`), and `rule` is null.
// A frame lift is kept until the frame says it is gone, so a lost reply never leaves the crop hidden there.
type CropLift = { rule: HTMLStyleElement | null; sheetClip?: string; dropped?: boolean };
const cropLifts = new WeakMap<HTMLElement, CropLift>();
const liftListeners = new Set<() => void>();
let liftVersion = 0;
function liftsChanged() {
  liftVersion += 1;
  for (const listener of liftListeners) listener();
}
function setLift(element: HTMLElement, lift: CropLift | null) {
  if (lift) cropLifts.set(element, lift);
  else cropLifts.delete(element);
  liftsChanged();
}
/** For `useSyncExternalStore`: the overlay redraws its crop hug when a lift starts, lands, is refused or drops. */
export function subscribeCropLifts(listener: () => void): () => void {
  liftListeners.add(listener);
  return () => liftListeners.delete(listener);
}
export const cropLiftsVersion = () => liftVersion;
const UNLIFT_TRIES = 3;

function liftSelector(element: HTMLElement): string | null {
  const quote = (value: string) => `"${value.replace(/["\\]/g, "\\$&")}"`;
  const hfId = element.getAttribute("data-hf-id");
  if (hfId) return `[data-hf-id=${quote(hfId)}]`;
  return element.id ? `[id=${quote(element.id)}]` : null;
}

function unliftInFrame(element: HTMLElement, record: CropLift, tries = UNLIFT_TRIES): void {
  const target = previewStandIn(element);
  if (!target) return;
  void previewRequest(target.iframe, "crop-lift", { handle: target.handle, lift: false }).then(
    (reply) => {
      if (cropLifts.get(element) !== record) return;
      if (reply?.lifted === false) setLift(element, null);
      else if (tries > 1) unliftInFrame(element, record, tries - 1);
    },
  );
}

function liftInFrame(element: HTMLElement): boolean {
  const target = previewStandIn(element);
  if (!target) return false;
  // Until the frame answers, the clip it last reported is the one under the lift.
  const record: CropLift = { rule: null, sheetClip: frameClipPaths.get(element)?.computed ?? "" };
  setLift(element, record);
  void previewRequest(target.iframe, "crop-lift", { handle: target.handle, lift: true }).then(
    (reply) => {
      if (cropLifts.get(element) !== record || !reply) return;
      if (!reply.lifted) setLift(element, null);
      else if (typeof reply.clipPath === "string" && reply.clipPath.length <= MAX_ELEMENT_VALUE)
        record.sheetClip = reply.clipPath.trim();
    },
  );
  return true;
}

export function liftElementCrop(element: HTMLElement): void {
  const held = cropLifts.get(element);
  if ((held && !held.dropped) || liftInFrame(element)) return;
  const selector = liftSelector(element);
  if (!selector || cropLifts.has(element)) return;
  const doc = element.ownerDocument;
  const rule = doc.createElement("style");
  rule.textContent = `${selector}{clip-path:none!important}`;
  (doc.head ?? doc.documentElement).append(rule);
  setLift(element, { rule });
}

export function dropElementCropLift(element: HTMLElement): void {
  const lift = cropLifts.get(element);
  if (!lift || lift.dropped) return;
  if (lift.rule) {
    lift.rule.remove();
    setLift(element, null);
    return;
  }
  lift.dropped = true;
  liftsChanged();
  unliftInFrame(element, lift);
}

export function isElementCropLifted(element: HTMLElement): boolean {
  const lift = cropLifts.get(element);
  return !!lift && !lift.dropped;
}

// A sealed preview's stand-in has no styles of its own: its clip-path is the one the frame reported.
const frameClipPaths = new WeakMap<Element, { inline: string; computed: string }>();

export function rememberFrameClipPath(element: HTMLElement, inline: string, computed: string) {
  frameClipPaths.set(element, { inline: inline.trim(), computed: computed.trim() });
}

const computedClipPath = (element: HTMLElement) => {
  const view = element.ownerDocument.defaultView;
  if (!view) return frameClipPaths.get(element)?.computed ?? "";
  return view.getComputedStyle(element).clipPath.trim();
};

/** The stylesheet's clip under a lift, read once per lift: only inline writes happen while selected. */
function sheetClipUnder(element: HTMLElement, lift: CropLift): string {
  if (lift.sheetClip === undefined && lift.rule) {
    const { parentNode, nextSibling } = lift.rule;
    lift.rule.remove();
    lift.sheetClip = computedClipPath(element);
    parentNode?.insertBefore(lift.rule, nextSibling);
  }
  return lift.sheetClip ?? "";
}

/** The element's clip-path, inline first, then the stylesheet's as it is without the lift. */
function readElementClipPath(element: HTMLElement): string {
  const inline =
    element.style.getPropertyValue("clip-path").trim() || frameClipPaths.get(element)?.inline;
  if (inline) return inline;
  const lift = cropLifts.get(element);
  return lift && !lift.dropped ? sheetClipUnder(element, lift) : computedClipPath(element);
}

/** Zeros = no clip yet. `null` = a clip this tool cannot represent (circle/polygon/non-px inset):
 *  croppers must not lift, edit, or restore it, or deselect silently replaces or destroys it. */
function parseCropClipPath(value: string): ParsedInsetClipPathSides | null {
  if (!value || value === "none") return { top: 0, right: 0, bottom: 0, left: 0, radius: 0 };
  const sides = parseInsetClipPathSides(value);
  const sane = sides && Object.values(sides).every((side) => Math.abs(side) <= MAX_DRAFT_PX);
  return sane ? sides : null;
}

export function readElementCropInsets(element: HTMLElement): ParsedInsetClipPathSides | null {
  return parseCropClipPath(readElementClipPath(element));
}

export function hasCropInsets(insets: ClipPathInsetSides): boolean {
  return insets.top > 0 || insets.right > 0 || insets.bottom > 0 || insets.left > 0;
}

export interface CropInsetDragInput {
  edge: CropEdge;
  startInsets: ClipPathInsetSides;
  deltaX: number;
  deltaY: number;
  scaleX: number;
  scaleY: number;
  width: number;
  height: number;
}

function clampInset(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, value), Math.max(0, max));
}

export function resolveCropInsetFromEdgeDrag(input: CropInsetDragInput): ClipPathInsetSides {
  const scaleX = input.scaleX > 0 ? input.scaleX : 1;
  const scaleY = input.scaleY > 0 ? input.scaleY : 1;
  const next = { ...input.startInsets };

  if (input.edge === "left") {
    next.left = clampInset(
      input.startInsets.left + input.deltaX / scaleX,
      input.width - next.right,
    );
  } else if (input.edge === "right") {
    next.right = clampInset(
      input.startInsets.right - input.deltaX / scaleX,
      input.width - next.left,
    );
  } else if (input.edge === "top") {
    next.top = clampInset(
      input.startInsets.top + input.deltaY / scaleY,
      input.height - next.bottom,
    );
  } else {
    next.bottom = clampInset(
      input.startInsets.bottom - input.deltaY / scaleY,
      input.height - next.top,
    );
  }

  return next;
}

/** Pan the crop window: opposing insets shift together so the crop size stays
 *  constant, clamped inside the element bounds. Repositions which part of the
 *  element shows through a fixed-size crop (the center "reposition" handle). */
export function resolveCropInsetFromMoveDrag(input: {
  startInsets: ClipPathInsetSides;
  deltaX: number;
  deltaY: number;
  scaleX: number;
  scaleY: number;
}): ClipPathInsetSides {
  const sx = input.scaleX > 0 ? input.scaleX : 1;
  const sy = input.scaleY > 0 ? input.scaleY : 1;
  const totalX = input.startInsets.left + input.startInsets.right;
  const totalY = input.startInsets.top + input.startInsets.bottom;
  const left = Math.min(Math.max(0, input.startInsets.left + input.deltaX / sx), totalX);
  const top = Math.min(Math.max(0, input.startInsets.top + input.deltaY / sy), totalY);
  return { left, right: totalX - left, top, bottom: totalY - top };
}

/** Display-only hug: shrink a projected rect by the element's inset crop.
 *  For rects nothing writes back to (e.g. the hover ring). */
export function hugRectForElement(rect: HugRect, element: HTMLElement): CropScreenRect {
  // A lifted clip shows the full element rect.
  if (isElementCropLifted(element)) return rect;
  return hugRectForClipPath(
    rect,
    readElementClipPath(element),
    () => rect.ownScale ?? (previewStandIn(element) ? undefined : liveOwnScale(rect, element)),
  );
}

type HugRect = CropScreenRect & {
  editScaleX: number;
  editScaleY: number;
  ownScale?: OwnScale;
  angle?: number;
};
type Point = { x: number; y: number };
type OwnCorners = Record<"nw" | "ne" | "se" | "sw", Point>;
/** Overlay px per own CSS px along the layer's edges, and its own corners in overlay px when it is transformed. */
export type OwnScale = { x: number; y: number; corners?: OwnCorners };

/** A live element's own-axis scale: an oriented rect's edges, or its turned corners' edges over its upright box. */
function liveOwnScale(rect: HugRect, element: HTMLElement): HugRect["ownScale"] {
  const { offsetWidth: w, offsetHeight: h } = element;
  if (!(w > 0 && h > 0)) return undefined;
  const upright = { x: rect.width / w, y: rect.height / h };
  if (rect.angle !== undefined) return upright;
  const win = element.ownerDocument.defaultView;
  const transform = win && readElementTransformSnapshot(win, element);
  const corners = transform && elementCornerPoints(win, element, transform);
  const box = element.getBoundingClientRect();
  if (!corners || !(box.width > 0 && box.height > 0)) return upright;
  const toOverlay = ({ x, y }: Point) => ({
    x: rect.left + ((x - box.left) * rect.width) / box.width,
    y: rect.top + ((y - box.top) * rect.height) / box.height,
  });
  const own = {
    nw: toOverlay(corners.nw),
    ne: toOverlay(corners.ne),
    se: toOverlay(corners.se),
    sw: toOverlay(corners.sw),
  };
  return { x: edge(own.nw, own.ne) / w, y: edge(own.nw, own.sw) / h, corners: own };
}

const ownScaleXY = (own: HugRect["ownScale"], rect: HugRect): [number, number] => [
  own?.x ?? rect.editScaleX,
  own?.y ?? rect.editScaleY,
];

/** `hugRectForElement` for a clip-path read elsewhere; null is one that could not be read. */
export function hugRectForClipPath(
  rect: HugRect,
  clipPath: string | null,
  ownScaleOf: () => HugRect["ownScale"] = () => rect.ownScale,
): CropScreenRect {
  const insets = clipPath === null ? null : parseCropClipPath(clipPath);
  // Uneditable clip — show the full element rect.
  if (!insets || (insets.top <= 0 && insets.right <= 0 && insets.bottom <= 0 && insets.left <= 0))
    return rect;
  const own = ownScaleOf();
  const corners = rect.angle === undefined ? own?.corners : undefined;
  return cropRectFromInsets(rect, insets, ...ownScaleXY(own, rect), corners);
}

/**
 * The element's own (unrotated) box in overlay space, plus the rotation to
 * apply when drawing crop UI over it. `clip-path` applies in the element's
 * LOCAL frame — before its transform — so the crop dim/outline/handles must be
 * drawn rotated with the element, not on its axis-aligned bounding box: an
 * AABB-drawn dim visually "straightens" a rotated element by masking its
 * corners (the crop window looks axis-aligned while the pixels are not).
 *
 * scaleX/scaleY are overlay px per element CSS px (element's own scale × the
 * editor zoom), so element-space insets map straight onto the frame. Assumes
 * the default 50%/50% transform-origin (the GSAP/studio convention). 3D or
 * unparseable transforms fall back to the axis-aligned frame (angle 0, AABB
 * box) — the pre-existing presentation.
 */
export interface CropFrame {
  angleDeg: number;
  left: number;
  top: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
}

/** Components this close to the identity's count as the identity. */
const IDENTITY_EPSILON = 1e-6;

type Planar2D = { a: number; b: number; c: number; d: number };

/** Whether the matrix leaves the box exactly as it found it. */
function isIdentity(m: Planar2D): boolean {
  return (
    Math.abs(m.a - 1) < IDENTITY_EPSILON &&
    Math.abs(m.b) < IDENTITY_EPSILON &&
    Math.abs(m.c) < IDENTITY_EPSILON &&
    Math.abs(m.d - 1) < IDENTITY_EPSILON
  );
}

/** The 2D components of the matrix the element paints under; null when upright and unscaled, or 3D. */
function readPlanarTransform(element: HTMLElement): Planar2D | null {
  const win = element.ownerDocument.defaultView;
  const matrix = win && readElementTransformSnapshot(win, element)?.matrix;
  if (!matrix) return null;
  const { a, b, c, d } = matrix;
  return isIdentity({ a, b, c, d }) ? null : { a, b, c, d };
}

/** What the frame measured of a stand-in's element at the press: a stand-in has no box of its own. */
export interface CropFrameStart {
  layout: { width: number; height: number };
}

/** A stand-in's crop frame: the frame's live oriented box of its element, scaled by the layout a press measured. */
function standInCropFrame(
  overlayRect: CropScreenRect & { angle?: number },
  layout: { width: number; height: number } | null,
  edit: { x: number; y: number },
): CropFrame {
  const { left, top, width, height } = overlayRect;
  return {
    angleDeg: overlayRect.angle ?? 0,
    left,
    top,
    width,
    height,
    scaleX: layout && layout.width > 0 ? width / layout.width : edit.x,
    scaleY: layout && layout.height > 0 ? height / layout.height : edit.y,
  };
}

export function readElementCropFrame(
  element: HTMLElement,
  overlayRect: CropScreenRect & { editScaleX: number; editScaleY: number; angle?: number },
  start?: CropFrameStart,
): CropFrame {
  const editX = overlayRect.editScaleX > 0 ? overlayRect.editScaleX : 1;
  const editY = overlayRect.editScaleY > 0 ? overlayRect.editScaleY : 1;
  if (previewStandIn(element)) {
    return standInCropFrame(overlayRect, start?.layout ?? null, { x: editX, y: editY });
  }
  const aabb: CropFrame = {
    angleDeg: 0,
    left: overlayRect.left,
    top: overlayRect.top,
    width: overlayRect.width,
    height: overlayRect.height,
    scaleX: editX,
    scaleY: editY,
  };
  const planar = readPlanarTransform(element);
  if (!planar) return aabb;
  const { a, b, c, d } = planar;
  const elScaleX = Math.hypot(a, b);
  const det = a * d - b * c;
  // |det| : a flipped element (negative determinant) still has a real size.
  const elScaleY = elScaleX !== 0 ? Math.abs(det) / elScaleX : 1;
  if (elScaleX <= 0 || elScaleY <= 0) return aabb;
  const angleDeg = (Math.atan2(b, a) * 180) / Math.PI;
  const scaleX = elScaleX * editX;
  const scaleY = elScaleY * editY;
  const size = { width: element.offsetWidth, height: element.offsetHeight };
  const width = size.width * scaleX;
  const height = size.height * scaleY;
  if (!(width > 0) || !(height > 0)) return aabb;
  // Rotation about the default center keeps the center invariant, so the
  // local box is centered on the AABB center.
  const cx = overlayRect.left + overlayRect.width / 2;
  const cy = overlayRect.top + overlayRect.height / 2;
  return {
    angleDeg,
    left: cx - width / 2,
    top: cy - height / 2,
    width,
    height,
    scaleX,
    scaleY,
  };
}

/** Rotate a screen-space pointer delta into the element's local frame. */
export function rotateDeltaIntoFrame(
  deltaX: number,
  deltaY: number,
  angleDeg: number,
): { deltaX: number; deltaY: number } {
  if (angleDeg === 0) return { deltaX, deltaY };
  const rad = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { deltaX: deltaX * cos - deltaY * sin, deltaY: deltaX * sin + deltaY * cos };
}
