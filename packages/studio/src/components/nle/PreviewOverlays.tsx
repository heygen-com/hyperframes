import { useState } from "react";
import { CaptionOverlay } from "../../captions/components/CaptionOverlay";
import { DomEditOverlay } from "../editor/DomEditOverlay";
import { MotionPathOverlay } from "../editor/MotionPathOverlay";
import { SnapToolbar } from "../editor/SnapToolbar";
import { useCompositionDimensions } from "../../hooks/useCompositionDimensions";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_KEYFRAMES_ENABLED,
  STUDIO_PREVIEW_MANUAL_EDITING_ENABLED,
  STUDIO_PREVIEW_SELECTION_ENABLED,
} from "../editor/manualEditingAvailability";
import { useStudioPlaybackContext, useStudioShellContext } from "../../contexts/StudioContext";
import {
  useDomEditActionsContext,
  useDomEditSelectionContext,
} from "../../contexts/DomEditContext";
import { readStudioUiPreferences } from "../../utils/studioUiPreferences";
import { readHfId, type DomEditSelection } from "../editor/domEditing";
import { buildStableSelector } from "../editor/domEditingDom";
import type { BlockPreviewInfo } from "../sidebar/BlocksTab";
import type { GestureRecordingState } from "../editor/GestureRecordControl";
import type { ReactNode } from "react";

export interface PreviewOverlaysProps {
  shouldShowSelectedDomBounds: boolean;
  blockPreview?: BlockPreviewInfo | null;
  isGestureRecording?: boolean;
  recordingState?: GestureRecordingState;
  onToggleRecording?: () => void;
  gestureOverlay?: ReactNode;
}

type ZIndexReorderEntry = {
  element: HTMLElement;
  zIndex: number;
  id?: string;
  selector?: string;
  selectorIndex?: number;
  sourceFile: string;
};

/** Can this element be robustly re-targeted for a persisted z change? */
function canTargetZIndexElement(
  element: HTMLElement,
  id: string | undefined,
  selector: string | undefined,
): boolean {
  return Boolean(id || selector || readHfId(element));
}

/** The selected element carries its full selection identity. */
function selectedZIndexEntry(sel: DomEditSelection, zIndex: number): ZIndexReorderEntry {
  return {
    element: sel.element,
    zIndex,
    id: sel.id ?? undefined,
    selector: sel.selector,
    selectorIndex: sel.selectorIndex,
    sourceFile: sel.sourceFile,
  };
}

/**
 * Sibling elements are raw iframe DOM nodes with no selection object: derive a
 * PatchTarget from the node itself (siblings live in the same document, so they
 * share the selection's sourceFile). Null when it cannot be robustly targeted
 * (no id and no selector) — its z stays live-only.
 */
function siblingZIndexEntry(
  element: HTMLElement,
  zIndex: number,
  sourceFile: string,
): ZIndexReorderEntry | null {
  const id = element.id || undefined;
  const selector = buildStableSelector(element);
  if (!canTargetZIndexElement(element, id, selector)) return null;
  return { element, zIndex, id, selector, selectorIndex: undefined, sourceFile };
}

// fallow-ignore-next-line complexity
export function PreviewOverlays({
  shouldShowSelectedDomBounds,
  blockPreview,
  isGestureRecording,
  recordingState,
  onToggleRecording,
  gestureOverlay,
}: PreviewOverlaysProps) {
  const { activeCompPath, previewIframeRef } = useStudioShellContext();
  const { captionEditMode, compositionLoading, isPlaying } = useStudioPlaybackContext();
  const compositionDimensions = useCompositionDimensions();

  const { domEditHoverSelection, domEditSelection, domEditGroupSelections } =
    useDomEditSelectionContext();
  const {
    handlePreviewCanvasMouseDown,
    handlePreviewCanvasPointerMove,
    handlePreviewCanvasPointerLeave,
    applyDomSelection,
    handleBlockedDomMove,
    handleDomManualDragStart,
    handleDomPathOffsetCommit,
    handleDomGroupPathOffsetCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleDomStyleCommit,
    applyMarqueeSelection,
    handleDomEditElementDelete,
    handleDomZIndexReorderCommit,
  } = useDomEditActionsContext();

  // fallow-ignore-next-line complexity
  const [snapPrefs, setSnapPrefs] = useState(() => {
    const p = readStudioUiPreferences();
    return {
      snapEnabled: p.snapEnabled ?? true,
      gridVisible: p.gridVisible ?? false,
      gridSpacing: p.gridSpacing ?? 50,
      snapToGrid: p.snapToGrid ?? false,
    };
  });

  if (blockPreview) {
    return (
      <div className="absolute inset-0 z-30 bg-black pointer-events-none">
        {blockPreview.videoUrl ? (
          <video
            src={blockPreview.videoUrl}
            autoPlay
            muted
            loop
            playsInline
            className="w-full h-full object-contain"
          />
        ) : blockPreview.posterUrl ? (
          <img
            src={blockPreview.posterUrl}
            alt={blockPreview.title}
            className="w-full h-full object-contain"
          />
        ) : null}
      </div>
    );
  }

  if (captionEditMode) {
    return <CaptionOverlay iframeRef={previewIframeRef} />;
  }

  if (!STUDIO_INSPECTOR_PANELS_ENABLED) return null;

  return (
    <>
      <DomEditOverlay
        iframeRef={previewIframeRef}
        activeCompositionPath={activeCompPath}
        hoverSelection={
          STUDIO_PREVIEW_SELECTION_ENABLED && !captionEditMode && !compositionLoading && !isPlaying
            ? domEditHoverSelection
            : null
        }
        selection={shouldShowSelectedDomBounds ? domEditSelection : null}
        groupSelections={shouldShowSelectedDomBounds ? domEditGroupSelections : []}
        allowCanvasMovement={STUDIO_PREVIEW_MANUAL_EDITING_ENABLED && !isGestureRecording}
        onCanvasMouseDown={handlePreviewCanvasMouseDown}
        onCanvasPointerMove={handlePreviewCanvasPointerMove}
        onCanvasPointerLeave={handlePreviewCanvasPointerLeave}
        onSelectionChange={applyDomSelection}
        onBlockedMove={handleBlockedDomMove}
        onManualDragStart={handleDomManualDragStart}
        onPathOffsetCommit={handleDomPathOffsetCommit}
        onGroupPathOffsetCommit={handleDomGroupPathOffsetCommit}
        onBoxSizeCommit={handleDomBoxSizeCommit}
        onRotationCommit={handleDomRotationCommit}
        onStyleCommit={handleDomStyleCommit}
        onDeleteSelection={handleDomEditElementDelete}
        onApplyZIndex={(sel, patches) => {
          const entries = patches
            .map((patch) =>
              patch.element === sel.element
                ? selectedZIndexEntry(sel, patch.zIndex)
                : siblingZIndexEntry(patch.element, patch.zIndex, sel.sourceFile),
            )
            .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
          if (entries.length > 0) handleDomZIndexReorderCommit(entries);
        }}
        gridVisible={snapPrefs.gridVisible}
        gridSpacing={snapPrefs.gridSpacing}
        recordingState={recordingState}
        onToggleRecording={onToggleRecording}
        onMarqueeSelect={applyMarqueeSelection}
      />
      <SnapToolbar onSnapChange={setSnapPrefs} />
      {STUDIO_KEYFRAMES_ENABLED && (
        <MotionPathOverlay
          iframeRef={previewIframeRef}
          selection={shouldShowSelectedDomBounds ? domEditSelection : null}
          compositionSize={compositionDimensions}
          isPlaying={isPlaying}
        />
      )}
      {gestureOverlay}
    </>
  );
}
