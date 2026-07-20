import { useCallback, type ReactNode } from "react";
import { PreviewPane } from "./nle/PreviewPane";
import { TimelinePane } from "./nle/TimelinePane";
import { PreviewOverlays } from "./nle/PreviewOverlays";
import {
  useTimelineEditCallbacks,
  type TimelineEditCallbackDeps,
} from "./nle/useTimelineEditCallbacks";
import { NLEProvider, useNLEContext } from "./nle/NLEContext";
import { CaptionTimeline } from "../captions/components/CaptionTimeline";
import { StudioFeedbackBar } from "./StudioFeedbackBar";
import { useStudioPlaybackContext, useStudioShellContext } from "../contexts/StudioContext";
import { useDomEditActionsContext } from "../contexts/DomEditContext";
import { TimelineEditProvider } from "../contexts/TimelineEditContext";
import type { TimelineElement } from "../player";
import type { BlockPreviewInfo } from "./sidebar/BlocksTab";
import type { GestureRecordingState } from "./editor/GestureRecordControl";

type RenderClipContent = (
  element: TimelineElement,
  style: { clip: string; label: string },
) => ReactNode;
type TimelineDropPlacement = Pick<TimelineElement, "start" | "track">;

// The seven move/resize/split/razor handlers come from TimelineEditCallbackDeps
// (shared with useTimelineEditCallbacks); the rest are drop + wiring props.
export interface EditorShellProps extends TimelineEditCallbackDeps {
  /** Left sidebar (media/library), rendered in the top row. */
  left: ReactNode;
  /** Right panel (inspector/design) or null when collapsed, in the top row. */
  right: ReactNode;
  /** Hide the whole shell (e.g. while the storyboard view is active). */
  hidden?: boolean;
  timelineToolbar: ReactNode;
  renderClipContent: RenderClipContent;
  handleTimelineElementDelete: (element: TimelineElement) => Promise<void> | void;
  handleTimelineAssetDrop: (
    assetPath: string,
    placement: TimelineDropPlacement,
  ) => Promise<void> | void;
  handleTimelineBlockDrop?: (
    blockName: string,
    placement: TimelineDropPlacement,
  ) => Promise<void> | void;
  handleTimelineCompositionDrop?: (
    sourcePath: string,
    placement: TimelineDropPlacement,
  ) => Promise<void> | void;
  handlePreviewBlockDrop?: (
    blockName: string,
    position: { left: number; top: number },
  ) => Promise<void> | void;
  handleTimelineFileDrop: (
    files: File[],
    placement?: TimelineDropPlacement,
  ) => Promise<void> | void;
  setCompIdToSrc: (map: Map<string, string>) => void;
  setCompositionLoading: (loading: boolean) => void;
  shouldShowSelectedDomBounds: boolean;
  blockPreview?: BlockPreviewInfo | null;
  isGestureRecording?: boolean;
  recordingState?: GestureRecordingState;
  onToggleRecording?: () => void;
  gestureOverlay?: ReactNode;
}

// The CapCut-style shell: [left | preview | right] in a top row, with a
// full-width timeline spanning the bottom. Owns the shared player +
// composition-stack state via NLEProvider so both rows share one player.
export function EditorShell({
  left,
  right,
  hidden,
  timelineToolbar,
  renderClipContent,
  handleTimelineElementDelete,
  handleTimelineAssetDrop,
  handleTimelineBlockDrop,
  handleTimelineCompositionDrop,
  handlePreviewBlockDrop,
  handleTimelineFileDrop,
  handleTimelineElementMove,
  handleTimelineElementsMove,
  handleTimelineElementResize,
  handleTimelineGroupResize,
  handleToggleTrackHidden,
  handleBlockedTimelineEdit,
  handleTimelineElementSplit,
  handleRazorSplit,
  handleRazorSplitAll,
  setCompIdToSrc,
  setCompositionLoading,
  shouldShowSelectedDomBounds,
  isGestureRecording,
  recordingState,
  onToggleRecording,
  blockPreview,
  gestureOverlay,
}: EditorShellProps) {
  const { projectId, activeCompPath, setActiveCompPath, handlePreviewIframeRef } =
    useStudioShellContext();
  const { refreshKey, captionEditMode, refreshPreviewDocumentVersion } = useStudioPlaybackContext();
  const { handleTimelineElementSelect } = useDomEditActionsContext();

  const timelineEditCallbacks = useTimelineEditCallbacks({
    handleTimelineElementMove,
    handleTimelineElementsMove,
    handleTimelineElementResize,
    handleTimelineGroupResize,
    handleToggleTrackHidden,
    handleBlockedTimelineEdit,
    handleTimelineElementSplit,
    handleRazorSplit,
    handleRazorSplitAll,
  });

  return (
    <div className={`flex flex-col flex-1 min-h-0${hidden ? " hidden" : ""}`}>
      <TimelineEditProvider value={timelineEditCallbacks}>
        <NLEProvider
          projectId={projectId}
          refreshKey={refreshKey}
          activeCompositionPath={activeCompPath}
          onIframeRef={handlePreviewIframeRef}
          onCompIdToSrcChange={setCompIdToSrc}
          onCompositionLoadingChange={setCompositionLoading}
          onCompositionChange={(compPath) => {
            // Sync activeCompPath when the user drills down via the timeline or
            // navigates back — keeps sidebar + thumbnails in sync. Guard no-ops to
            // avoid circular refresh cascades (activeCompPath → stack → onChange).
            if (compPath !== activeCompPath) {
              setActiveCompPath(compPath);
              refreshPreviewDocumentVersion();
            }
          }}
        >
          <EditorShellBody
            left={left}
            right={right}
            captionEditMode={captionEditMode}
            onSelectTimelineElement={handleTimelineElementSelect}
            onPreviewBlockDrop={handlePreviewBlockDrop}
            timelineToolbar={timelineToolbar}
            renderClipContent={renderClipContent}
            onFileDrop={handleTimelineFileDrop}
            onAssetDrop={handleTimelineAssetDrop}
            onBlockDrop={handleTimelineBlockDrop}
            onCompositionDrop={handleTimelineCompositionDrop}
            onDeleteElement={handleTimelineElementDelete}
            previewOverlay={
              <PreviewOverlays
                shouldShowSelectedDomBounds={shouldShowSelectedDomBounds}
                blockPreview={blockPreview}
                isGestureRecording={isGestureRecording}
                recordingState={recordingState}
                onToggleRecording={onToggleRecording}
                gestureOverlay={gestureOverlay}
              />
            }
          />
        </NLEProvider>
      </TimelineEditProvider>
      <StudioFeedbackBar />
    </div>
  );
}

interface EditorShellBodyProps {
  left: ReactNode;
  right: ReactNode;
  captionEditMode: boolean;
  previewOverlay: ReactNode;
  onSelectTimelineElement: (element: TimelineElement | null) => void;
  onPreviewBlockDrop?: (
    blockName: string,
    position: { left: number; top: number },
  ) => Promise<void> | void;
  timelineToolbar: ReactNode;
  renderClipContent: RenderClipContent;
  onFileDrop: (files: File[], placement?: TimelineDropPlacement) => Promise<void> | void;
  onAssetDrop: (assetPath: string, placement: TimelineDropPlacement) => Promise<void> | void;
  onBlockDrop?: (blockName: string, placement: TimelineDropPlacement) => Promise<void> | void;
  onCompositionDrop?: (
    sourcePath: string,
    placement: TimelineDropPlacement,
  ) => Promise<void> | void;
  onDeleteElement: (element: TimelineElement) => Promise<void> | void;
}

function EditorShellBody({
  left,
  right,
  captionEditMode,
  previewOverlay,
  onSelectTimelineElement,
  onPreviewBlockDrop,
  timelineToolbar,
  renderClipContent,
  onFileDrop,
  onAssetDrop,
  onBlockDrop,
  onCompositionDrop,
  onDeleteElement,
}: EditorShellBodyProps) {
  const { compositionStack, updateCompositionStack, containerRef } = useNLEContext();

  // Keyboard: Escape to pop composition level
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && compositionStack.length > 1) {
        updateCompositionStack((prev) => prev.slice(0, -1));
      }
    },
    [compositionStack.length, updateCompositionStack],
  );

  return (
    <div
      ref={containerRef}
      // Shell canvas is a step LIGHTER than the near-black panel cards so the
      // gaps between panels read as visible seams (CapCut-style).
      className="flex flex-col flex-1 min-h-0 bg-[#18181B]"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Top row: [left | preview | right] — outer padding + the 8px resize
          seams give the panels CapCut-style separation on the dark canvas. */}
      <div className="flex flex-row flex-1 min-h-0 px-px pt-px">
        {left}
        <div className="flex-1 min-w-0 flex flex-col relative">
          <PreviewPane
            previewOverlay={previewOverlay}
            onSelectTimelineElement={onSelectTimelineElement}
            onPreviewBlockDrop={onPreviewBlockDrop}
          />
        </div>
        {right}
      </div>

      {/* Full-width timeline row */}
      <TimelinePane
        timelineToolbar={timelineToolbar}
        renderClipContent={renderClipContent}
        onFileDrop={onFileDrop}
        onAssetDrop={onAssetDrop}
        onBlockDrop={onBlockDrop}
        onCompositionDrop={onCompositionDrop}
        onDeleteElement={onDeleteElement}
        onSelectTimelineElement={onSelectTimelineElement}
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
      />
    </div>
  );
}
