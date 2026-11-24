import { useSyncExternalStore } from "react";
import type { OverlayRect } from "../components/editor/domEditOverlayGeometry";
import type { DomEditSelection } from "../components/editor/domEditing";
import {
  cropLiftsVersion,
  hugRectForElement,
  subscribeCropLifts,
} from "../components/editor/domEditOverlayCrop";

/** Selection-box crop hug: the outline that makes the selection box hug the
 *  element's committed inset crop. Crop is always-on (no mode) — the draggable
 *  handles live in {@link DomEditCropHandles}; this only shapes the box border.
 *  The box div itself always sits at the FULL element bounds; the hug is purely
 *  visual — the element's inset clip-path scaled into overlay space. */
export function useCropOverlay(params: {
  selection: DomEditSelection | null;
  overlayRect: OverlayRect | null;
}) {
  const { selection, overlayRect } = params;
  useSyncExternalStore(subscribeCropLifts, cropLiftsVersion);

  // The box div stays border-less at full bounds; a child draws the outline ON the crop boundary (a clip on the box
  // would swallow the border everywhere the crop edge doesn't touch the element edge).
  const hug = selection && overlayRect ? hugRectForElement(overlayRect, selection.element) : null;
  const cropOutlineInsetPx =
    hug && overlayRect && hug !== overlayRect
      ? {
          top: hug.top - overlayRect.top,
          right: overlayRect.left + overlayRect.width - (hug.left + hug.width),
          bottom: overlayRect.top + overlayRect.height - (hug.top + hug.height),
          left: hug.left - overlayRect.left,
        }
      : undefined;

  return { hasCropInsets: Boolean(cropOutlineInsetPx), cropOutlineInsetPx };
}
