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
  let transform = "";
  try {
    transform = element.ownerDocument.defaultView?.getComputedStyle(element).transform ?? "";
  } catch {
    return aabb;
  }
  if (!transform || transform === "none") return aabb;
  const m = /^matrix\(([^)]+)\)$/.exec(transform);
  if (!m) return aabb; // matrix3d or unparseable → axis-aligned fallback
  const [a, b, c, d] = m[1]!.split(",").map((v) => Number.parseFloat(v));
  if (![a, b, c, d].every(Number.isFinite)) return aabb;
  const elScaleX = Math.hypot(a!, b!);
  const det = a! * d! - b! * c!;
  const elScaleY = elScaleX !== 0 ? det / elScaleX : 1;
  if (elScaleX <= 0 || elScaleY <= 0) return aabb;
  const angleDeg = (Math.atan2(b!, a!) * 180) / Math.PI;
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
