import { useCallback, useRef, useSyncExternalStore, memo, type ReactNode } from "react";
import { PlayerControls, Timeline } from "../../player";
import type { TimelineElement } from "../../player";
import type { BlockedTimelineEditIntent } from "../../player/components/timelineEditing";
import { NLEPreview } from "./NLEPreview";
import { CompositionBreadcrumb } from "./CompositionBreadcrumb";
import { TimelineResizeDivider } from "./TimelineResizeDivider";
import { usePreviewBlockDrop } from "./usePreviewBlockDrop";
import { useTimelineEditContext } from "../../contexts/TimelineEditContext";
import { trackStudioExpandedClipEdit } from "../../telemetry/events";
import { NLEProvider, useNLEContext, type NLEProviderProps } from "./NLEContext";

interface NLELayoutViewProps {
  portrait?: boolean;
  /** Slot for overlays rendered on top of the preview (cursors, highlights, etc.) */
  previewOverlay?: ReactNode;
  /** Slot rendered above the timeline tracks (toolbar with split, delete, zoom) */
  timelineToolbar?: ReactNode;
  /** Slot rendered below the timeline tracks */
  timelineFooter?: ReactNode;
  /** Custom clip content renderer for timeline (thumbnails, waveforms, etc.) */
  renderClipContent?: (
    element: TimelineElement,
    style: { clip: string; label: string },
  ) => ReactNode;
  onFileDrop?: (
    files: File[],
    placement?: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  onDeleteElement?: (element: TimelineElement) => Promise<void> | void;
  onAssetDrop?: (
    assetPath: string,
    placement: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  onBlockDrop?: (
    blockName: string,
    placement: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  onPreviewBlockDrop?: (
    blockName: string,
    position: { left: number; top: number },
  ) => Promise<void> | void;
  onBlockedEditAttempt?: (element: TimelineElement, intent: BlockedTimelineEditIntent) => void;
  onSelectTimelineElement?: (element: TimelineElement | null) => void;
}

type NLELayoutProps = NLELayoutViewProps &
  Pick<
    NLEProviderProps,
    | "projectId"
    | "refreshKey"
    | "activeCompositionPath"
    | "onIframeRef"
    | "onCompositionChange"
    | "onCompIdToSrcChange"
    | "onCompositionLoadingChange"
  >;

function subscribeFullscreen(cb: () => void) {
  document.addEventListener("fullscreenchange", cb);
  return () => document.removeEventListener("fullscreenchange", cb);
}

function getFullscreenElement() {
  return document.fullscreenElement;
}

export function NLELayout({
  projectId,
  refreshKey,
  activeCompositionPath,
  onIframeRef,
  onCompositionChange,
  onCompIdToSrcChange,
  onCompositionLoadingChange,
  ...viewProps
}: NLELayoutProps) {
  return (
    <NLEProvider
      projectId={projectId}
      refreshKey={refreshKey}
      activeCompositionPath={activeCompositionPath}
      onIframeRef={onIframeRef}
      onCompositionChange={onCompositionChange}
      onCompIdToSrcChange={onCompIdToSrcChange}
      onCompositionLoadingChange={onCompositionLoadingChange}
    >
      <NLELayoutInner {...viewProps} />
    </NLEProvider>
  );
}

// fallow-ignore-next-line complexity
const NLELayoutInner = memo(function NLELayoutInner({
  portrait,
  previewOverlay,
  timelineToolbar,
  timelineFooter,
  renderClipContent,
  onFileDrop,
  onDeleteElement,
  onAssetDrop,
  onBlockDrop,
  onPreviewBlockDrop,
  onBlockedEditAttempt,
  onSelectTimelineElement,
}: NLELayoutViewProps) {
  const {
    projectId,
    iframeRef,
    togglePlay,
    seek,
    onIframeLoad,
    compositionStack,
    updateCompositionStack,
    handleNavigateComposition,
    handleDrillDown,
    timelineH,
    setTimelineH,
    persistTimelineH,
    containerRef,
    setCompositionLoading,
    timelineDisabled,
    hasLoadedOnceRef,
    previewCompositionSize,
    setPreviewCompositionSize,
  } = useNLEContext();

  const stageRefForDrop = useRef<HTMLDivElement | null>(null);
  const handleStageRef = useCallback((ref: React.RefObject<HTMLDivElement | null>) => {
    stageRefForDrop.current = ref.current;
  }, []);

  const {
    isDragOver: previewDragOver,
    handleDragEnter: handlePreviewDragEnter,
    handleDragOver: handlePreviewDragOver,
    handleDragLeave: handlePreviewDragLeave,
    handleDrop: handlePreviewDrop,
  } = usePreviewBlockDrop({
    portrait,
    compositionSize: previewCompositionSize,
    stageRef: stageRefForDrop as React.RefObject<HTMLDivElement | null>,
    onBlockDrop: onPreviewBlockDrop,
  });

  // Move/resize/split come from the timeline edit context, not props — the
  // wrappers below intercept expanded clips and must call the *real* handlers.
  // (Delete is a direct prop; it stays that way.)
  const { onMoveElement, onResizeElement, onSplitElement } = useTimelineEditContext();

  // An expanded sub-comp child reaches the normal edit handlers in its own
  // local coordinates: addressed by its real DOM id, with timeline time rebased
  // onto the sub-comp it lives in. The handlers then save + reloadPreview exactly
  // as they do for top-level clips — no separate live-DOM path.
  const toLocalElement = useCallback(
    (element: TimelineElement, basis: number): TimelineElement => ({
      ...element,
      id: element.domId ?? element.id,
      start: element.start - basis,
    }),
    [],
  );

  const handleMoveElement = useCallback(
    (element: TimelineElement, updates: Pick<TimelineElement, "start" | "track">) => {
      const basis = element.expandedParentStart;
      if (basis === undefined) return onMoveElement?.(element, updates);
      trackStudioExpandedClipEdit({ action: "move" });
      onMoveElement?.(toLocalElement(element, basis), {
        ...updates,
        start: Math.max(0, updates.start - basis),
      });
    },
    [onMoveElement, toLocalElement],
  );

  const handleResizeElement = useCallback(
    (
      element: TimelineElement,
      updates: Pick<TimelineElement, "start" | "duration" | "playbackStart">,
    ) => {
      const basis = element.expandedParentStart;
      if (basis === undefined) return onResizeElement?.(element, updates);
      trackStudioExpandedClipEdit({ action: "resize" });
      onResizeElement?.(toLocalElement(element, basis), {
        ...updates,
        start: Math.max(0, updates.start - basis),
      });
    },
    [onResizeElement, toLocalElement],
  );

  const handleDeleteElement = useCallback(
    (element: TimelineElement) => {
      const basis = element.expandedParentStart;
      if (basis === undefined) return onDeleteElement?.(element);
      trackStudioExpandedClipEdit({ action: "delete" });
      return onDeleteElement?.(toLocalElement(element, basis));
    },
    [onDeleteElement, toLocalElement],
  );

  const handleSplitElement = useCallback(
    (element: TimelineElement, splitTime: number) => {
      const basis = element.expandedParentStart;
      if (basis === undefined) return onSplitElement?.(element, splitTime);
      trackStudioExpandedClipEdit({ action: "split" });
      return onSplitElement?.(toLocalElement(element, basis), Math.max(0, splitTime - basis));
    },
    [onSplitElement, toLocalElement],
  );

  const fullscreenElement = useSyncExternalStore(subscribeFullscreen, getFullscreenElement);
  const isFullscreen = fullscreenElement === containerRef.current && fullscreenElement != null;

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current.requestFullscreen();
    }
  }, [containerRef]);

  const currentLevel = compositionStack[compositionStack.length - 1];
  const directUrl = compositionStack.length > 1 ? currentLevel.previewUrl : undefined;

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
      className="flex flex-col h-full min-h-0 bg-neutral-950"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      data-studio-fullscreen-target=""
    >
      {/* Preview + player controls */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div
          className="flex-1 min-h-0 relative overflow-hidden"
          data-preview-pan-surface="true"
          onPointerDown={(e) => {
            const el = iframeRef.current?.parentElement ?? iframeRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const inside =
              e.clientX >= rect.left &&
              e.clientX <= rect.right &&
              e.clientY >= rect.top &&
              e.clientY <= rect.bottom;
            if (!inside) onSelectTimelineElement?.(null);
          }}
          onDragEnter={handlePreviewDragEnter}
          onDragOver={handlePreviewDragOver}
          onDragLeave={handlePreviewDragLeave}
          onDrop={handlePreviewDrop}
        >
          <div className="absolute inset-0 overflow-hidden">
            <NLEPreview
              projectId={projectId}
              iframeRef={iframeRef}
              onIframeLoad={onIframeLoad}
              onCompositionLoadingChange={setCompositionLoading}
              portrait={portrait}
              directUrl={directUrl}
              suppressLoadingOverlay={hasLoadedOnceRef.current}
              onStageRef={handleStageRef}
              onCompositionSizeChange={setPreviewCompositionSize}
            />
            {previewDragOver && (
              <div className="absolute inset-2 z-40 rounded-lg border-2 border-dashed border-studio-accent/50 bg-studio-accent/[0.04] pointer-events-none" />
            )}
          </div>
          {!isFullscreen && previewOverlay}
        </div>
        <div className="bg-neutral-950 border-t border-neutral-800/50 flex-shrink-0">
          {!isFullscreen && compositionStack.length > 1 && (
            <CompositionBreadcrumb
              stack={compositionStack}
              onNavigate={handleNavigateComposition}
            />
          )}
          <PlayerControls
            onTogglePlay={togglePlay}
            onSeek={seek}
            disabled={timelineDisabled}
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
          />
        </div>
      </div>

      {!isFullscreen && (
        <>
          <TimelineResizeDivider
            timelineH={timelineH}
            setTimelineH={setTimelineH}
            persistTimelineH={persistTimelineH}
            containerRef={containerRef}
            disabled={timelineDisabled}
          />

          {/* Timeline section */}
          <div
            className="relative flex flex-col flex-shrink-0"
            style={{ height: timelineH }}
            aria-disabled={timelineDisabled || undefined}
          >
            <div
              className="flex flex-col flex-1 min-h-0 overflow-hidden bg-neutral-950"
              onDoubleClick={(e) => {
                if ((e.target as HTMLElement).closest("[data-clip]")) return;
                if (timelineDisabled) return;
                if (compositionStack.length > 1) {
                  updateCompositionStack((prev) => prev.slice(0, -1));
                }
              }}
            >
              <div className="flex-shrink-0">{timelineToolbar}</div>
              <Timeline
                onSeek={seek}
                onDrillDown={handleDrillDown}
                renderClipContent={renderClipContent}
                onFileDrop={onFileDrop}
                onDeleteElement={handleDeleteElement}
                onAssetDrop={onAssetDrop}
                onBlockDrop={onBlockDrop}
                onMoveElement={handleMoveElement}
                onResizeElement={handleResizeElement}
                onBlockedEditAttempt={onBlockedEditAttempt}
                onSplitElement={handleSplitElement}
                onSelectElement={onSelectTimelineElement}
              />
            </div>
            {timelineFooter && <div className="flex-shrink-0">{timelineFooter}</div>}
            {timelineDisabled && (
              <div
                className="absolute inset-0 z-30 cursor-not-allowed bg-black/18 flex items-center justify-center"
                data-testid="timeline-loading-disabled-overlay"
                role="status"
                onPointerDown={(event) => event.preventDefault()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => event.preventDefault()}
              >
                <span className="rounded-md bg-neutral-900/90 px-2.5 py-1 text-[11px] text-neutral-400">
                  Loading composition…
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
});
