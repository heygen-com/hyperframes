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
import { useStudioPlaybackContext, useStudioShellContext } from "../contexts/StudioContext";
import { useDomEditActionsContext, useDomEditSelectionContext } from "../contexts/DomEditContext";
import { TimelineEditProvider } from "../contexts/TimelineEditContext";
import { usePlayerStore, type TimelineElement } from "../player";
import type { BlockPreviewInfo } from "./sidebar/BlocksTab";
import type { GestureRecordingState } from "./editor/GestureRecordControl";
import { useTimelineSelectionPreviewSync } from "../hooks/useTimelineSelectionPreviewSync";
import { StudioAgentTools } from "../webmcp/StudioAgentTools";
import type { TimelineDropPlacement } from "../player/components/timelineCallbacks";
import { Dock } from "./dock/Dock";

type RenderClipContent = (
  element: TimelineElement,
  style: { clip: string; label: string },
) => ReactNode;

// The seven move/resize/split/razor handlers come from TimelineEditCallbackDeps
// (shared with useTimelineEditCallbacks); the rest are drop + wiring props.
export interface EditorShellProps extends TimelineEditCallbackDeps {
  /** Dock.Panel elements for every panel except the built-in preview and timeline. */
  panels: ReactNode;
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
  onCopyClip: () => boolean;
  onPasteClip: () => Promise<void>;
  onDuplicateClip: () => Promise<boolean>;
  canPasteClip: () => boolean;
  setCompIdToSrc: (map: Map<string, string>) => void;
  setCompositionLoading: (loading: boolean) => void;
  shouldShowMotionPath: boolean;
  shouldShowSelectedDomBounds: boolean;
  blockPreview?: BlockPreviewInfo | null;
  isGestureRecording?: boolean;
  recordingState?: GestureRecordingState;
  onToggleRecording?: () => void;
  /**
   * Host layer over the preview, positioned with `usePreviewCompositionRect`. Hidden in
   * fullscreen and during a block preview; below the selection overlay past z-index 10.
   */
  gestureOverlay?: ReactNode;
}

// The dockable shell: every panel lives in one Dock, arranged by the user's
// saved layout. Owns the shared player + composition-stack state via
// NLEProvider so every panel shares one player.
export function EditorShell({
  panels,
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
  setAudioGroupAttribute,
  handleGroupClips,
  setElementFxAttribute,
  handleBlockedTimelineEdit,
  handleTimelineElementSplit,
  handleRazorSplit,
  handleRazorSplitAll,
  placementOps,
  onCopyClip,
  onPasteClip,
  onDuplicateClip,
  canPasteClip,
  setCompIdToSrc,
  setCompositionLoading,
  shouldShowMotionPath,
  shouldShowSelectedDomBounds,
  isGestureRecording,
  recordingState,
  onToggleRecording,
  blockPreview,
  gestureOverlay,
}: EditorShellProps) {
  const { projectId, activeCompPath, setActiveCompPath, handlePreviewIframeRef, showToast } =
    useStudioShellContext();
  const { refreshKey, captionEditMode, refreshPreviewDocumentVersion, timelineElements } =
    useStudioPlaybackContext();
  const {
    handleTimelineElementSelect,
    buildDomSelectionForTimelineElement,
    applyDomSelection,
    applyMarqueeSelection,
  } = useDomEditActionsContext();
  const { domEditSelection, domEditGroupSelections } = useDomEditSelectionContext();
  const selectedElementId = usePlayerStore((state) => state.selectedElementId);
  const selectedElementIds = usePlayerStore((state) => state.selectedElementIds);
  const reportTimelineSelectionNotFound = useCallback(() => {
    showToast("The selected clip is not available in the preview yet.", "info");
  }, [showToast]);

  useTimelineSelectionPreviewSync({
    selectedElementId,
    selectedElementIds,
    timelineElements,
    domEditSelection,
    domEditGroupSelections,
    activeCompPath,
    buildDomSelectionForTimelineElement,
    applyDomSelection,
    applyMarqueeSelection,
    onSelectionNotFound: reportTimelineSelectionNotFound,
  });

  const timelineEditCallbacks = useTimelineEditCallbacks({
    handleTimelineElementMove,
    handleTimelineElementsMove,
    handleTimelineElementResize,
    handleTimelineGroupResize,
    handleToggleTrackHidden,
    setAudioGroupAttribute,
    handleGroupClips,
    setElementFxAttribute,
    handleBlockedTimelineEdit,
    handleTimelineElementSplit,
    handleRazorSplit,
    handleRazorSplitAll,
    placementOps,
  });

  return (
    <div className="flex flex-col flex-1 min-h-0">
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
            projectId={projectId}
            panels={panels}
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
            onCopyClip={onCopyClip}
            onPasteClip={onPasteClip}
            onDuplicateClip={onDuplicateClip}
            canPasteClip={canPasteClip}
            previewOverlay={
              <PreviewOverlays
                shouldShowMotionPath={shouldShowMotionPath}
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
    </div>
  );
}

interface EditorShellBodyProps {
  panels: ReactNode;
  projectId: string;
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
  onCopyClip: () => boolean;
  onPasteClip: () => Promise<void>;
  onDuplicateClip: () => Promise<boolean>;
  canPasteClip: () => boolean;
}

function EditorShellBody({
  panels,
  projectId,
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
  onCopyClip,
  onPasteClip,
  onDuplicateClip,
  canPasteClip,
}: EditorShellBodyProps) {
  const { compositionStack, updateCompositionStack } = useNLEContext();

  // The caption track's blocks are seek targets; CaptionTimeline took an onSeek
  // prop that nothing ever passed, so clicking a block did nothing.
  const seekCaptionTime = useCallback((time: number) => {
    usePlayerStore.getState().requestSeek(time);
  }, []);

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
      // Shell canvas is a step LIGHTER than the near-black panel cards so the
      // gaps between panels read as visible seams (CapCut-style).
      className="flex flex-col flex-1 min-h-0 bg-panel-surface"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Renders nothing; exposes Studio's state to an agentic browser. Mounted
          here rather than in App because it needs the DomEdit contexts. */}
      <StudioAgentTools />
      <Dock.Root projectId={projectId}>
        <Dock.Panel id="preview">
          <div className="relative flex h-full w-full min-w-0 flex-col">
            <PreviewPane
              previewOverlay={previewOverlay}
              onSelectTimelineElement={onSelectTimelineElement}
              onPreviewBlockDrop={onPreviewBlockDrop}
            />
          </div>
        </Dock.Panel>
        <Dock.Panel id="timeline">
          <TimelinePane
            timelineToolbar={timelineToolbar}
            renderClipContent={renderClipContent}
            onFileDrop={onFileDrop}
            onAssetDrop={onAssetDrop}
            onBlockDrop={onBlockDrop}
            onCompositionDrop={onCompositionDrop}
            onDeleteElement={onDeleteElement}
            onCopyClip={onCopyClip}
            onPasteClip={onPasteClip}
            onDuplicateClip={onDuplicateClip}
            canPasteClip={canPasteClip}
            onSelectTimelineElement={onSelectTimelineElement}
            timelineFooter={
              captionEditMode ? (
                <div className="border-t border-neutral-800/30 shrink-0" style={{ height: 60 }}>
                  <div className="flex items-center gap-1.5 px-2 py-0.5">
                    <span className="text-[9px] font-medium text-neutral-500 uppercase tracking-wider">
                      Captions
                    </span>
                  </div>
                  <CaptionTimeline pixelsPerSecond={100} onSeek={seekCaptionTime} />
                </div>
              ) : undefined
            }
          />
        </Dock.Panel>
        {panels}
      </Dock.Root>
    </div>
  );
}
