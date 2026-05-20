import { useCallback } from "react";
import { liveTime, usePlayerStore } from "../player";
import { pauseStudioPreviewPlayback } from "../utils/studioPreviewHelpers";
import { STUDIO_PREVIEW_SELECTION_ENABLED } from "../components/editor/manualEditingAvailability";
import { type DomEditSelection } from "../components/editor/domEditing";

// ── Types ──

export interface UsePreviewInteractionParams {
  captionEditMode: boolean;
  compositionLoading: boolean;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  showToast: (message: string, tone?: "error" | "info") => void;

  // From useDomSelection
  applyDomSelection: (
    selection: DomEditSelection | null,
    options?: { revealPanel?: boolean; additive?: boolean; preserveGroup?: boolean },
  ) => void;
  resolveDomSelectionFromPreviewPoint: (
    clientX: number,
    clientY: number,
    options?: { preferClipAncestor?: boolean },
  ) => DomEditSelection | null;
  updateDomEditHoverSelection: (selection: DomEditSelection | null) => void;

  onClickToSource?: (selection: DomEditSelection) => void;
}

// ── Hook ──

export function usePreviewInteraction({
  captionEditMode,
  compositionLoading,
  previewIframeRef,
  showToast,
  applyDomSelection,
  resolveDomSelectionFromPreviewPoint,
  updateDomEditHoverSelection,
  onClickToSource,
}: UsePreviewInteractionParams) {
  const handlePreviewCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, options?: { preferClipAncestor?: boolean }) => {
      if (!STUDIO_PREVIEW_SELECTION_ENABLED || captionEditMode || compositionLoading) return;
      const nextSelection = resolveDomSelectionFromPreviewPoint(e.clientX, e.clientY, {
        preferClipAncestor: options?.preferClipAncestor ?? false,
      });
      if (!nextSelection) {
        if (!e.shiftKey) applyDomSelection(null, { revealPanel: false });
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      applyDomSelection(nextSelection, { additive: e.shiftKey });
      if (!e.shiftKey && e.altKey && onClickToSource) {
        onClickToSource(nextSelection);
      }
    },
    [
      applyDomSelection,
      captionEditMode,
      compositionLoading,
      onClickToSource,
      resolveDomSelectionFromPreviewPoint,
    ],
  );

  const handlePreviewCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, options?: { preferClipAncestor?: boolean }) => {
      if (!STUDIO_PREVIEW_SELECTION_ENABLED || captionEditMode || compositionLoading) {
        updateDomEditHoverSelection(null);
        return null;
      }

      const nextSelection = resolveDomSelectionFromPreviewPoint(e.clientX, e.clientY, {
        preferClipAncestor: options?.preferClipAncestor ?? false,
      });
      updateDomEditHoverSelection(nextSelection);
      return nextSelection;
    },
    [
      captionEditMode,
      compositionLoading,
      resolveDomSelectionFromPreviewPoint,
      updateDomEditHoverSelection,
    ],
  );

  const handlePreviewCanvasPointerLeave = useCallback(() => {
    updateDomEditHoverSelection(null);
  }, [updateDomEditHoverSelection]);

  const handleBlockedDomMove = useCallback(
    (selection: DomEditSelection) => {
      showToast(
        selection.capabilities.reasonIfDisabled ??
          "This element can't be adjusted directly from the preview.",
        "info",
      );
    },
    [showToast],
  );

  const handleDomManualDragStart = useCallback(() => {
    const pausedTime = pauseStudioPreviewPlayback(previewIframeRef.current);
    const playerStore = usePlayerStore.getState();
    playerStore.setIsPlaying(false);
    if (pausedTime != null) {
      playerStore.setCurrentTime(pausedTime);
      liveTime.notify(pausedTime);
    }
  }, [previewIframeRef]);

  return {
    handlePreviewCanvasMouseDown,
    handlePreviewCanvasPointerMove,
    handlePreviewCanvasPointerLeave,
    handleBlockedDomMove,
    handleDomManualDragStart,
  };
}
