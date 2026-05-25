import type { ReactNode } from "react";
import { NLELayout } from "./nle/NLELayout";
import { CaptionOverlay } from "../captions/components/CaptionOverlay";
import { CaptionTimeline } from "../captions/components/CaptionTimeline";
import { DomEditOverlay } from "./editor/DomEditOverlay";
import type { TimelineElement } from "../player";
import type { BlockedTimelineEditIntent } from "../player/components/timelineEditing";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_PREVIEW_MANUAL_EDITING_ENABLED,
  STUDIO_PREVIEW_SELECTION_ENABLED,
} from "./editor/manualEditingAvailability";
import { useStudioContext } from "../contexts/StudioContext";
import { useDomEditContext } from "../contexts/DomEditContext";
import type { BlockPreviewInfo } from "./sidebar/BlocksTab";

export interface StudioPreviewAreaProps {
  timelineToolbar: ReactNode;
  renderClipContent: (
    element: TimelineElement,
    style: { clip: string; label: string },
  ) => ReactNode;
  // Timeline editing
  handleTimelineElementDelete: (element: TimelineElement) => Promise<void> | void;
  handleTimelineAssetDrop: (
    assetPath: string,
    placement: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  handleTimelineBlockDrop?: (
    blockName: string,
    placement: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  handlePreviewBlockDrop?: (
    blockName: string,
    position: { left: number; top: number },
  ) => Promise<void> | void;
  handleTimelineFileDrop: (
    files: File[],
    placement?: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  handleTimelineElementMove: (
    element: TimelineElement,
    updates: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  handleTimelineElementResize: (
    element: TimelineElement,
    updates: Pick<TimelineElement, "start" | "duration" | "playbackStart">,
  ) => Promise<void> | void;
  handleBlockedTimelineEdit: (element: TimelineElement, intent: BlockedTimelineEditIntent) => void;
  setCompIdToSrc: (map: Map<string, string>) => void;
  setCompositionLoading: (loading: boolean) => void;
  shouldShowSelectedDomBounds: boolean;
  blockPreview?: BlockPreviewInfo | null;
}

export function StudioPreviewArea({
  timelineToolbar,
  renderClipContent,
  handleTimelineElementDelete,
  handleTimelineAssetDrop,
  handleTimelineBlockDrop,
  handlePreviewBlockDrop,
  handleTimelineFileDrop,
  handleTimelineElementMove,
  handleTimelineElementResize,
  handleBlockedTimelineEdit,
  setCompIdToSrc,
  setCompositionLoading,
  shouldShowSelectedDomBounds,
  blockPreview,
}: StudioPreviewAreaProps) {
  const {
    projectId,
    refreshKey,
    activeCompPath,
    setActiveCompPath,
    captionEditMode,
    compositionLoading,
    isPlaying,
    previewIframeRef,
    refreshPreviewDocumentVersion,
    handlePreviewIframeRef,
    timelineVisible,
    toggleTimelineVisibility,
  } = useStudioContext();

  const {
    domEditHoverSelection,
    domEditSelection,
    domEditGroupSelections,
    handleTimelineElementSelect,
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
  } = useDomEditContext();

  return (
    <div className="flex-1 relative min-w-0">
      <NLELayout
        projectId={projectId}
        refreshKey={refreshKey}
        activeCompositionPath={activeCompPath}
        timelineToolbar={timelineToolbar}
        renderClipContent={renderClipContent}
        onDeleteElement={handleTimelineElementDelete}
        onAssetDrop={handleTimelineAssetDrop}
        onBlockDrop={handleTimelineBlockDrop}
        onPreviewBlockDrop={handlePreviewBlockDrop}
        onFileDrop={handleTimelineFileDrop}
        onMoveElement={handleTimelineElementMove}
        onResizeElement={handleTimelineElementResize}
        onBlockedEditAttempt={handleBlockedTimelineEdit}
        onSelectTimelineElement={handleTimelineElementSelect}
        onCompIdToSrcChange={setCompIdToSrc}
        onCompositionLoadingChange={setCompositionLoading}
        onCompositionChange={(compPath) => {
          // Sync activeCompPath when user drills down via timeline double-click
          // or navigates back via breadcrumb — keeps sidebar + thumbnails in sync.
          // Guard against no-op updates to prevent circular refresh cascades
          // between activeCompPath → compositionStack → onCompositionChange.
          if (compPath !== activeCompPath) {
            setActiveCompPath(compPath);
            refreshPreviewDocumentVersion();
          }
        }}
        onIframeRef={handlePreviewIframeRef}
        previewOverlay={
          blockPreview ? (
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
          ) : captionEditMode ? (
            <CaptionOverlay iframeRef={previewIframeRef} />
          ) : STUDIO_INSPECTOR_PANELS_ENABLED ? (
            <DomEditOverlay
              iframeRef={previewIframeRef}
              activeCompositionPath={activeCompPath}
              hoverSelection={
                STUDIO_PREVIEW_SELECTION_ENABLED &&
                !captionEditMode &&
                !compositionLoading &&
                !isPlaying
                  ? domEditHoverSelection
                  : null
              }
              selection={shouldShowSelectedDomBounds ? domEditSelection : null}
              groupSelections={shouldShowSelectedDomBounds ? domEditGroupSelections : []}
              allowCanvasMovement={STUDIO_PREVIEW_MANUAL_EDITING_ENABLED}
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
            />
          ) : null
        }
        timelineFooter={
          captionEditMode ? (
            <div className="border-t border-neutral-800/30 flex-shrink-0" style={{ height: 60 }}>
              <div className="flex items-center gap-1.5 px-2 py-0.5">
                <span className="text-[9px] font-medium text-neutral-500 uppercase tracking-wider">
                  Captions
                </span>
              </div>
              <CaptionTimeline pixelsPerSecond={100} />
            </div>
          ) : undefined
        }
        timelineVisible={timelineVisible}
        onToggleTimeline={toggleTimelineVisibility}
      />
    </div>
  );
}
