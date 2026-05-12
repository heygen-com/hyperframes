import type { ReactNode, RefObject } from "react";
import { NLELayout } from "./nle/NLELayout";
import { CaptionOverlay } from "../captions/components/CaptionOverlay";
import { CaptionTimeline } from "../captions/components/CaptionTimeline";
import { DomEditOverlay, type DomEditGroupPathOffsetCommit } from "./editor/DomEditOverlay";
import type { TimelineElement } from "../player";
import type { BlockedTimelineEditIntent } from "../player/components/timelineEditing";
import type { DomEditSelection } from "./editor/domEditing";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_PREVIEW_MANUAL_EDITING_ENABLED,
  STUDIO_PREVIEW_SELECTION_ENABLED,
} from "./editor/manualEditingAvailability";

export interface StudioPreviewAreaProps {
  projectId: string;
  refreshKey: number;
  activeCompPath: string | null;
  timelineToolbar: ReactNode;
  renderClipContent: (
    element: TimelineElement,
    style: { clip: string; label: string },
  ) => ReactNode;
  timelineVisible: boolean;
  toggleTimelineVisibility: () => void;
  // Timeline editing
  handleTimelineElementDelete: (element: TimelineElement) => Promise<void> | void;
  handleTimelineAssetDrop: (
    assetPath: string,
    placement: Pick<TimelineElement, "start" | "track">,
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
  handleTimelineElementSelect: (element: TimelineElement | null) => void;
  setCompIdToSrc: (map: Map<string, string>) => void;
  setCompositionLoading: (loading: boolean) => void;
  setActiveCompPath: (compPath: string | null) => void;
  refreshPreviewDocumentVersion: () => void;
  handlePreviewIframeRef: (iframe: HTMLIFrameElement | null) => void;
  // Overlay
  captionEditMode: boolean;
  compositionLoading: boolean;
  isPlaying: boolean;
  previewIframeRef: RefObject<HTMLIFrameElement | null>;
  domEditHoverSelection: DomEditSelection | null;
  domEditSelection: DomEditSelection | null;
  domEditGroupSelections: DomEditSelection[];
  shouldShowSelectedDomBounds: boolean;
  handlePreviewCanvasMouseDown: (
    event: React.MouseEvent<HTMLDivElement>,
    options?: { preferClipAncestor?: boolean },
  ) => void;
  handlePreviewCanvasPointerMove: (
    event: React.PointerEvent<HTMLDivElement>,
    options?: { preferClipAncestor?: boolean },
  ) => DomEditSelection | null;
  handlePreviewCanvasPointerLeave: () => void;
  applyDomSelection: (
    selection: DomEditSelection,
    options?: { revealPanel?: boolean; additive?: boolean },
  ) => void;
  handleBlockedDomMove: (selection: DomEditSelection) => void;
  handleDomManualDragStart: () => void;
  handleDomPathOffsetCommit: (
    selection: DomEditSelection,
    next: { x: number; y: number },
  ) => Promise<void> | void;
  handleDomGroupPathOffsetCommit: (updates: DomEditGroupPathOffsetCommit[]) => Promise<void> | void;
  handleDomBoxSizeCommit: (
    selection: DomEditSelection,
    next: { width: number; height: number },
  ) => Promise<void> | void;
  handleDomRotationCommit: (
    selection: DomEditSelection,
    next: { angle: number },
  ) => Promise<void> | void;
}

export function StudioPreviewArea({
  projectId,
  refreshKey,
  activeCompPath,
  timelineToolbar,
  renderClipContent,
  timelineVisible,
  toggleTimelineVisibility,
  handleTimelineElementDelete,
  handleTimelineAssetDrop,
  handleTimelineFileDrop,
  handleTimelineElementMove,
  handleTimelineElementResize,
  handleBlockedTimelineEdit,
  handleTimelineElementSelect,
  setCompIdToSrc,
  setCompositionLoading,
  setActiveCompPath,
  refreshPreviewDocumentVersion,
  handlePreviewIframeRef,
  captionEditMode,
  compositionLoading,
  isPlaying,
  previewIframeRef,
  domEditHoverSelection,
  domEditSelection,
  domEditGroupSelections,
  shouldShowSelectedDomBounds,
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
}: StudioPreviewAreaProps) {
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
          setActiveCompPath(compPath);
          refreshPreviewDocumentVersion();
        }}
        onIframeRef={handlePreviewIframeRef}
        previewOverlay={
          captionEditMode ? (
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
