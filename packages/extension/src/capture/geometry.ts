import type { SelectionRect } from "../protocol";

export interface CropPlan {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  completeness: "complete" | "cropped";
}

export function planVisibleCrop(
  selection: SelectionRect,
  screenshotWidth: number,
  screenshotHeight: number,
): CropPlan | null {
  if (screenshotWidth <= 0 || screenshotHeight <= 0) return null;
  const right = Math.min(selection.left + selection.width, selection.viewportWidth);
  const bottom = Math.min(selection.top + selection.height, selection.viewportHeight);
  const left = Math.max(0, selection.left);
  const top = Math.max(0, selection.top);
  if (right <= left || bottom <= top) return null;

  const scaleX = screenshotWidth / selection.viewportWidth;
  const scaleY = screenshotHeight / selection.viewportHeight;
  const sourceX = Math.max(0, Math.floor(left * scaleX));
  const sourceY = Math.max(0, Math.floor(top * scaleY));
  const sourceRight = Math.min(screenshotWidth, Math.ceil(right * scaleX));
  const sourceBottom = Math.min(screenshotHeight, Math.ceil(bottom * scaleY));
  const sourceWidth = sourceRight - sourceX;
  const sourceHeight = sourceBottom - sourceY;
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;

  return {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    outputWidth: sourceWidth,
    outputHeight: sourceHeight,
    completeness:
      selection.left >= 0 &&
      selection.top >= 0 &&
      selection.left + selection.width <= selection.viewportWidth &&
      selection.top + selection.height <= selection.viewportHeight
        ? "complete"
        : "cropped",
  };
}
