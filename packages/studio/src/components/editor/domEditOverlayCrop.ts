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

/** Current inset crop of an element (inline first, computed fallback), or zeros. */
export function readElementCropInsets(element: HTMLElement): ClipPathInsetSides & {
  radius: number;
} {
  const inline = element.style.getPropertyValue("clip-path").trim();
  const value =
    inline || element.ownerDocument.defaultView?.getComputedStyle(element).clipPath.trim() || "";
  const parsed = parseInsetClipPathSides(value === "none" ? "" : value);
  return parsed ?? { top: 0, right: 0, bottom: 0, left: 0, radius: 0 };
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

/** Drag the whole crop window: both opposing insets shift together, the crop
 *  size stays constant, clamped inside the element bounds. */
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
  if (insets.top <= 0 && insets.right <= 0 && insets.bottom <= 0 && insets.left <= 0) return rect;
  return cropRectFromInsets(rect, insets, rect.editScaleX, rect.editScaleY);
}
