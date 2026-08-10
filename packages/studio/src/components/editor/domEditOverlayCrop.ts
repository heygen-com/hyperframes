import { parseInsetClipPathSides, type ClipPathInsetSides } from "./clipPathHelpers";

export type CropEdge = "top" | "right" | "bottom" | "left";

export interface CropScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Element-space insets → the cropped region in overlay (screen) space. */
export function cropRectFromInsets(
  rect: CropScreenRect,
  insets: ClipPathInsetSides,
  scaleX: number,
  scaleY: number,
): CropScreenRect {
  const sx = scaleX > 0 ? scaleX : 1;
  const sy = scaleY > 0 ? scaleY : 1;
  const left = rect.left + insets.left * sx;
  const top = rect.top + insets.top * sy;
  return {
    left,
    top,
    width: Math.max(0, rect.width - (insets.left + insets.right) * sx),
    height: Math.max(0, rect.height - (insets.top + insets.bottom) * sy),
  };
}

/**
 * Current inset crop of an element (inline first, computed fallback).
 * Zeros = no clip (croppable, nothing cropped yet). `null` = the element
 * carries a clip-path this tool cannot represent (circle/polygon/non-px
 * inset) — croppers must not lift, edit, or restore it, or the clip gets
 * silently replaced or destroyed on deselect.
 */
export function readElementCropInsets(
  element: HTMLElement,
): (ClipPathInsetSides & { radius: number }) | null {
  const inline = element.style.getPropertyValue("clip-path").trim();
  const value =
    inline || element.ownerDocument.defaultView?.getComputedStyle(element).clipPath.trim() || "";
  if (!value || value === "none") return { top: 0, right: 0, bottom: 0, left: 0, radius: 0 };
  return parseInsetClipPathSides(value);
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
/**
 * The planar rotation in the CSS `rotate` property, in degrees.
 *
 * Computes to `none`, an angle (`-22deg`), or an axis plus an angle
 * (`0 0 1 -22deg`). Only a rotation about z stays in the overlay's plane; any
 * other axis is 3D and reports 0, which leaves the caller on its axis-aligned
 * fallback rather than drawing a box at a plausible-looking wrong angle.
 */
export function individualRotateDegrees(value: string | undefined): number {
  if (!value || value === "none") return 0;
  const parts = value.trim().split(/\s+/);
  const angle = parts.at(-1);
  if (!angle?.endsWith("deg")) return 0;
  if (parts.length === 4) {
    const [x, y, z] = parts;
    if (Number(x) !== 0 || Number(y) !== 0 || Math.abs(Number(z)) !== 1) return 0;
    const deg = Number.parseFloat(angle);
    return Number.isFinite(deg) ? deg * Math.sign(Number(z)) : 0;
  }
  if (parts.length !== 1) return 0;
  const deg = Number.parseFloat(angle);
  return Number.isFinite(deg) ? deg : 0;
}

export function hugRectForElement(
  rect: CropScreenRect & { editScaleX: number; editScaleY: number },
  element: HTMLElement,
): CropScreenRect {
  const insets = readElementCropInsets(element);
  // Uneditable clip (null) can't be hugged — show the full element rect.
  if (!insets || (insets.top <= 0 && insets.right <= 0 && insets.bottom <= 0 && insets.left <= 0))
    return rect;
  return cropRectFromInsets(rect, insets, rect.editScaleX, rect.editScaleY);
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

/**
 * The element's own 2D transform as matrix components, plus the `rotate`
 * property's angle.
 *
 * `rotate` is a separate CSS property, not part of `transform`, and it is the
 * one Studio's rotate handle writes — reading `transform` alone reported a
 * turned element as upright, so the crop outline drew square across it.
 *
 * Null means there is nothing planar to draw against: no transform and no
 * rotation, or a 3D/unparseable matrix. The caller falls back to the
 * axis-aligned box rather than guessing an angle.
 */
/** Perspective terms this far from zero mean the mapping is not affine. */
const PERSPECTIVE_EPSILON = 1e-6;

/**
 * The 2D components of a computed transform, or null when it cannot be used.
 *
 * Accepts `matrix3d` as well as `matrix`, taking the same 2D projection the
 * rest of the overlay reads through DOMMatrix. GSAP writes a 3D matrix for an
 * ordinary 2D move or spin (force3D), and a composition that flips an element
 * writes one with a negative z scale — treating either as unmeasurable left the
 * crop outline square on an element every other piece of chrome drew rotated.
 *
 * Only a perspective term rules the matrix out, because that is where the
 * mapping stops being affine and a single angle stops describing it.
 */
function parseMatrixComponents(
  transform: string,
): { a: number; b: number; c: number; d: number } | null {
  const flat = /^matrix\(([^)]+)\)$/.exec(transform);
  if (flat) {
    const [a, b, c, d] = flat[1]!.split(",").map((v) => Number.parseFloat(v));
    return [a, b, c, d].every(Number.isFinite) ? { a: a!, b: b!, c: c!, d: d! } : null;
  }
  const spatial = /^matrix3d\(([^)]+)\)$/.exec(transform);
  if (!spatial) return null;
  const m = spatial[1]!.split(",").map((v) => Number.parseFloat(v));
  if (m.length !== 16 || !m.every(Number.isFinite)) return null;
  const affine = [m[3], m[7], m[11]].every((v) => Math.abs(v!) < PERSPECTIVE_EPSILON);
  if (!affine) return null;
  return { a: m[0]!, b: m[1]!, c: m[4]!, d: m[5]! };
}

/** The element's own `transform` and `rotate`, read together in one pass. */
function readTransformAndSpin(element: HTMLElement): { transform: string; spin: number } | null {
  try {
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    return { transform: style?.transform ?? "", spin: individualRotateDegrees(style?.rotate) };
  } catch {
    return null;
  }
}

const IDENTITY = { a: 1, b: 0, c: 0, d: 1 };

/** `outer` applied around `inner`, as an ancestor composes over a child. */
function composeMatrices(
  outer: { a: number; b: number; c: number; d: number },
  inner: { a: number; b: number; c: number; d: number },
): { a: number; b: number; c: number; d: number } {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
  };
}

/** The `rotate` property's angle as a 2D matrix. */
function spinMatrix(degrees: number): { a: number; b: number; c: number; d: number } {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { a: cos, b: sin, c: -sin, d: cos };
}

/**
 * The transform the element actually paints under: its own, composed with every
 * ancestor's up to the composition root.
 *
 * Reading the element alone drew the crop outline at the wrong angle for
 * anything nested — a text layer inside a rotated card carries its own spin,
 * and the box has to be drawn at the sum of the two, which is what the user
 * sees. Within each level, CSS applies the individual `rotate` property before
 * `transform`, and an ancestor applies outside its child.
 */
/** One node's own contribution: its `rotate` property applied before its `transform`. */
function ownPlanarMatrix(node: HTMLElement): { a: number; b: number; c: number; d: number } | null {
  const read = readTransformAndSpin(node);
  if (!read) return null;
  const hasTransform = Boolean(read.transform) && read.transform !== "none";
  const base = hasTransform ? parseMatrixComponents(read.transform) : IDENTITY;
  if (!base) return null;
  return read.spin === 0 ? base : composeMatrices(spinMatrix(read.spin), base);
}

/** Whether the matrix leaves the box exactly as it found it. */
function isIdentity(m: { a: number; b: number; c: number; d: number }): boolean {
  return (
    Math.abs(m.a - 1) < PERSPECTIVE_EPSILON &&
    Math.abs(m.b) < PERSPECTIVE_EPSILON &&
    Math.abs(m.c) < PERSPECTIVE_EPSILON &&
    Math.abs(m.d - 1) < PERSPECTIVE_EPSILON
  );
}

/**
 * The transform the element actually paints under: its own, composed with every
 * ancestor's up to the composition root.
 *
 * Reading the element alone drew the crop outline at the wrong angle for
 * anything nested — a text layer inside a rotated card carries its own spin,
 * and the box has to be drawn at the combination of the two, which is what the
 * user sees. An ancestor applies outside its child.
 *
 * Null when nothing up the chain transforms the element: the caller's
 * axis-aligned rect already describes it, and that comes from real layout
 * rather than the element's untransformed box.
 */
function readPlanarTransform(
  element: HTMLElement,
): { a: number; b: number; c: number; d: number } | null {
  let acc = IDENTITY;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const own = ownPlanarMatrix(node);
    if (!own) return null;
    acc = composeMatrices(own, acc);
    if (node.hasAttribute?.("data-composition-id")) break;
  }
  return isIdentity(acc) ? null : acc;
}

export function readElementCropFrame(
  element: HTMLElement,
  overlayRect: CropScreenRect & { editScaleX: number; editScaleY: number },
): CropFrame {
  const editX = overlayRect.editScaleX > 0 ? overlayRect.editScaleX : 1;
  const editY = overlayRect.editScaleY > 0 ? overlayRect.editScaleY : 1;
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
  const width = element.offsetWidth * scaleX;
  const height = element.offsetHeight * scaleY;
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
