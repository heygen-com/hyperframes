import type { PreviewCompositionSize } from "../../utils/previewCompositionSize";
import { toDomPrecision } from "./previewZoom";

export const PREVIEW_STAGE_INSET_PX = 8;

export function resolvePreviewStageSize(
  viewportWidth: number,
  viewportHeight: number,
  compositionSize: PreviewCompositionSize | null,
  portrait: boolean | undefined,
  gutterPx = 0,
  insetPx = PREVIEW_STAGE_INSET_PX,
): { width: number; height: number } {
  const availableWidth = Math.max(0, viewportWidth - 2 * (insetPx + gutterPx));
  const availableHeight = Math.max(0, viewportHeight - 2 * (insetPx + gutterPx));
  const aspectRatio =
    compositionSize && compositionSize.width > 0 && compositionSize.height > 0
      ? compositionSize.width / compositionSize.height
      : portrait
        ? 9 / 16
        : 16 / 9;

  if (availableWidth === 0 || availableHeight === 0) {
    return { width: 0, height: 0 };
  }

  let width = availableWidth;
  let height = width / aspectRatio;
  if (height > availableHeight) {
    height = availableHeight;
    width = height * aspectRatio;
  }

  return {
    width: toDomPrecision(width),
    height: toDomPrecision(height),
  };
}
