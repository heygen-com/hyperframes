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
