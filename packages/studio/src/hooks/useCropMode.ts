import { useEffect, useMemo, useReducer } from "react";
import { usePlayerStore } from "../player";

export interface CropModeProps {
  cropMode: boolean;
  onCropModeChange: (active: boolean) => void;
}

/** Crop mode lives in the player store so the canvas toolbar, the Clip panel,
 *  and the overlay all share one switch without prop threading. */
export function useCropModeProps(): CropModeProps {
  const cropMode = usePlayerStore((s) => s.cropMode);
  const setCropMode = usePlayerStore((s) => s.setCropMode);
  return useMemo(
    () => ({
      cropMode,
      onCropModeChange: setCropMode,
    }),
    [cropMode, setCropMode],
  );
}

import type { OverlayRect } from "../components/editor/domEditOverlayGeometry";
import type { DomEditSelection } from "../components/editor/domEditing";
import { readElementCropInsets } from "../components/editor/domEditOverlayCrop";

/** Overlay-side crop state: Escape-to-exit, toolbar availability publishing,
 *  and the box clip that makes the selection outline hug the cropped region.
 *  The box div itself always sits at the FULL element bounds — gestures write
 *  its position directly during drags, so moving/resizing it in React would
 *  fight them. The hug is purely visual: the element's inset clip-path scaled
 *  into overlay space and applied to the box. */
export function useCropOverlay(params: {
  selection: DomEditSelection | null;
  groupCount: number;
  cropMode: boolean;
  onCropModeChange?: (active: boolean) => void;
  overlayRect: OverlayRect | null;
}) {
  const { selection, groupCount, cropMode, onCropModeChange, overlayRect } = params;

  useEffect(() => {
    if (!cropMode || !onCropModeChange) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCropModeChange(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cropMode, onCropModeChange]);

  // Publish availability so the canvas toolbar shows the Crop button only
  // when the selection can take a clip-path crop.
  const setCropAvailable = usePlayerStore((s) => s.setCropAvailable);
  const cropAvailable = Boolean(selection && groupCount <= 1 && selection.capabilities.canCrop);
  useEffect(() => {
    setCropAvailable(cropAvailable);
    return () => setCropAvailable(false);
  }, [cropAvailable, setCropAvailable]);

  // Crop-mode exit restores the element's clip in an effect cleanup — after
  // this hook already read it. One forced re-render picks up the fresh insets
  // so the selection box hugs the crop immediately.
  const [, bumpAfterExit] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!cropMode) bumpAfterExit();
  }, [cropMode]);

  const cropInsets = selection ? readElementCropInsets(selection.element) : null;
  const hasCropInsets = Boolean(
    cropInsets &&
    (cropInsets.top > 0 || cropInsets.right > 0 || cropInsets.bottom > 0 || cropInsets.left > 0),
  );

  // Scaled insets for the crop outline child + the resize-handle shift. The
  // box div itself stays border-less at full bounds; a child draws the
  // outline ON the crop boundary (a clip on the box would swallow the
  // border everywhere the crop edge doesn't touch the element edge).
  const sx = overlayRect && overlayRect.editScaleX > 0 ? overlayRect.editScaleX : 1;
  const sy = overlayRect && overlayRect.editScaleY > 0 ? overlayRect.editScaleY : 1;
  const cropOutlineInsetPx =
    cropInsets && hasCropInsets && !cropMode
      ? {
          top: cropInsets.top * sy,
          right: cropInsets.right * sx,
          bottom: cropInsets.bottom * sy,
          left: cropInsets.left * sx,
        }
      : undefined;

  return { hasCropInsets, cropOutlineInsetPx };
}
