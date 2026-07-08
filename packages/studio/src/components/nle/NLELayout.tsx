import { useCallback, memo, type ReactNode } from "react";
import { Timeline } from "../../player";
import type { TimelineElement } from "../../player";
import type { BlockedTimelineEditIntent } from "../../player/components/timelineEditing";
import { PreviewPane } from "./PreviewPane";
import { TimelineResizeDivider } from "./TimelineResizeDivider";
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
    seek,
    handleDrillDown,
    compositionStack,
    updateCompositionStack,
    timelineH,
    setTimelineH,
    persistTimelineH,
    containerRef,
    timelineDisabled,
  } = useNLEContext();

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
    >
      <PreviewPane
        portrait={portrait}
        previewOverlay={previewOverlay}
        onSelectTimelineElement={onSelectTimelineElement}
        onPreviewBlockDrop={onPreviewBlockDrop}
      />

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
    </div>
  );
});
