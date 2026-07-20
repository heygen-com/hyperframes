import { useCallback, type ReactNode } from "react";
import { Timeline } from "../../player";
import type { TimelineElement } from "../../player";
import type { BlockedTimelineEditIntent } from "../../player/components/timelineEditing";
import { TimelineResizeDivider } from "./TimelineResizeDivider";
import { useTimelineEditContext } from "../../contexts/TimelineEditContext";
import { trackStudioExpandedClipEdit } from "../../telemetry/events";
import { useNLEContext } from "./NLEContext";
import type { TimelineMoveOperation } from "../../hooks/timelineMoveAdapter";

type TimelineMoveEdit = {
  element: TimelineElement;
  updates: Pick<TimelineElement, "start" | "track">;
};

export function forwardRebasedTimelineMoveElements(
  edits: TimelineMoveEdit[],
  coalesceKey: string | undefined,
  operation: TimelineMoveOperation | undefined,
  onMoveElements: (
    edits: TimelineMoveEdit[],
    coalesceKey?: string,
    operation?: TimelineMoveOperation,
    coalesceMs?: number,
  ) => Promise<void> | void,
  coalesceMs?: number,
) {
  return onMoveElements(
    edits.map(({ element, updates }) => {
      const basis = element.expandedParentStart;
      if (basis === undefined) return { element, updates };
      return {
        element: { ...element, id: element.domId ?? element.id, start: element.start - basis },
        updates: { ...updates, start: Math.max(0, updates.start - basis) },
      };
    }),
    coalesceKey,
    operation,
    coalesceMs,
  );
}

type TimelineResizeChange = {
  element: TimelineElement;
  start: number;
  duration: number;
  playbackStart?: number;
};

export function forwardRebasedTimelineResizeElements(
  changes: TimelineResizeChange[],
  options: { coalesceKey?: string } | undefined,
  onResizeElements: (
    changes: TimelineResizeChange[],
    options?: { coalesceKey?: string },
  ) => Promise<void> | void,
) {
  return onResizeElements(
    changes.map((change) => {
      const basis = change.element.expandedParentStart;
      if (basis === undefined) return change;
      return {
        ...change,
        element: {
          ...change.element,
          id: change.element.domId ?? change.element.id,
          start: change.element.start - basis,
        },
        start: Math.max(0, change.start - basis),
      };
    }),
    options,
  );
}

export interface TimelinePaneProps {
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
  onCompositionDrop?: (
    sourcePath: string,
    placement: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  onBlockedEditAttempt?: (element: TimelineElement, intent: BlockedTimelineEditIntent) => void;
  onSelectTimelineElement?: (element: TimelineElement | null) => void;
}

// fallow-ignore-next-line complexity
export function TimelinePane({
  timelineToolbar,
  timelineFooter,
  renderClipContent,
  onFileDrop,
  onDeleteElement,
  onAssetDrop,
  onBlockDrop,
  onCompositionDrop,
  onBlockedEditAttempt,
  onSelectTimelineElement,
}: TimelinePaneProps) {
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
  const { onMoveElement, onMoveElements, onResizeElement, onResizeElements, onSplitElement } =
    useTimelineEditContext();

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

  // Batched move (ripple / insert): rebase each expanded sub-comp child to its
  // local coords, exactly as handleMoveElement does for a single clip.
  const handleMoveElements = useCallback(
    (
      edits: Array<{ element: TimelineElement; updates: Pick<TimelineElement, "start" | "track"> }>,
      coalesceKey?: string,
      operation?: TimelineMoveOperation,
      coalesceMs?: number,
    ) => {
      // Match the sibling handlers: report the telemetry when the batch touches at
      // least one expanded sub-comp child (the clips being rebased to local coords).
      if (edits.some(({ element }) => element.expandedParentStart !== undefined)) {
        trackStudioExpandedClipEdit({ action: "move" });
      }
      if (!onMoveElements) return;
      return forwardRebasedTimelineMoveElements(
        edits,
        coalesceKey,
        operation,
        onMoveElements,
        coalesceMs,
      );
    },
    [onMoveElements],
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

  const handleResizeElements = useCallback(
    (
      changes: Array<{
        element: TimelineElement;
        start: number;
        duration: number;
        playbackStart?: number;
      }>,
      options?: { coalesceKey?: string },
    ) => {
      if (!onResizeElements) return;
      if (changes.some(({ element }) => element.expandedParentStart !== undefined)) {
        trackStudioExpandedClipEdit({ action: "resize" });
      }
      return forwardRebasedTimelineResizeElements(changes, options, onResizeElements);
    },
    [onResizeElements],
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

  return (
    <>
      <TimelineResizeDivider
        timelineH={timelineH}
        setTimelineH={setTimelineH}
        persistTimelineH={persistTimelineH}
        containerRef={containerRef}
        disabled={timelineDisabled}
      />

      {/* Timeline section — inner padding (not margin) keeps the divider's
          height math exact while giving the panel a gap from the shell edges. */}
      <div
        className="relative flex flex-col flex-shrink-0 px-px pb-px"
        style={{ height: timelineH }}
        aria-disabled={timelineDisabled || undefined}
      >
        <div
          className="flex flex-col flex-1 min-h-0 overflow-hidden rounded-lg border border-neutral-800/50 bg-neutral-950"
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
            onCompositionDrop={onCompositionDrop}
            onMoveElement={handleMoveElement}
            onMoveElements={handleMoveElements}
            onResizeElement={handleResizeElement}
            onResizeElements={handleResizeElements}
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
  );
}
