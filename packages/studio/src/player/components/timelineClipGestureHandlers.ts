import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import type { DraggedClipState, ResizingClipState, BlockedClipState } from "./useTimelineClipDrag";
import {
  resolveBlockedTimelineEditIntent,
  type BlockedTimelineEditIntent,
} from "./timelineEditing";
import type { TimelineEditCapabilities } from "./timelineEditCapabilities";
import type { TimelineEditCallbacks } from "./timelineCallbacks";
import { CLIP_HANDLE_W } from "./timelineLayout";
import { SPLIT_BOUNDARY_EPSILON_S } from "../../utils/timelineElementSplit";

export interface ClipGestureDeps {
  pps: number;
  onResizeElement?: TimelineEditCallbacks["onResizeElement"];
  onMoveElement?: TimelineEditCallbacks["onMoveElement"];
  onRazorSplit?: (element: TimelineElement, splitTime: number) => Promise<void> | void;
  onRazorSplitAll?: (splitTime: number) => Promise<void> | void;
  blockedClipRef: React.RefObject<BlockedClipState | null>;
  shiftClickClipRef: React.RefObject<{
    element: TimelineElement;
    anchorX: number;
    anchorY: number;
  } | null>;
  suppressClickRef: React.RefObject<boolean>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  setShowPopover(v: boolean): void;
  setRangeSelection(v: null): void;
  setResizingClip(v: ResizingClipState | null): void;
  setDraggedClip(v: DraggedClipState | null): void;
  setSelectedElementId(id: string | null): void;
  onSelectElement?: (element: TimelineElement | null) => void;
}

/** Whether a resize-handle drag on `edge` is allowed to begin at all. */
function canStartResize(
  edge: "start" | "end",
  e: ReactPointerEvent,
  capabilities: TimelineEditCapabilities,
  onResizeElement: ClipGestureDeps["onResizeElement"],
): boolean {
  if (e.button !== 0 || e.shiftKey || !onResizeElement) return false;
  if (edge === "start") return capabilities.canTrimStart;
  return capabilities.canTrimEnd;
}

type PointerDownAction =
  | { kind: "ignore" }
  | { kind: "arm-shift-click" }
  | { kind: "block"; intent: BlockedTimelineEditIntent; rect: DOMRect }
  | { kind: "move"; rect: DOMRect };

/**
 * A hit-tested intent is "blocked" when the pointer landed on a smaller
 * target than the gesture it implies would need — e.g. a resize handle too
 * narrow to grab reliably — AND that gesture is actually wired up. An intent
 * with nowhere to go (no matching callback) is not blocking anything.
 */
function isIntentBlocked(
  intent: BlockedTimelineEditIntent | null,
  onResizeElement: ClipGestureDeps["onResizeElement"],
  onMoveElement: ClipGestureDeps["onMoveElement"],
): intent is BlockedTimelineEditIntent {
  if (!intent) return false;
  return intent === "move" ? Boolean(onMoveElement) : Boolean(onResizeElement);
}

/**
 * What a pointerdown on a clip bar means, before any state is touched. Kept
 * pure (no refs, no store writes) so the branching that decides move vs.
 * resize-handle vs. blocked-by-a-smaller-hit-target lives in one place,
 * separate from the side effects `onPointerDown` below performs for it.
 */
function resolvePointerDownAction(
  e: ReactPointerEvent,
  capabilities: TimelineEditCapabilities,
  onResizeElement: ClipGestureDeps["onResizeElement"],
  onMoveElement: ClipGestureDeps["onMoveElement"],
): PointerDownAction {
  if (e.button !== 0) return { kind: "ignore" };
  if (usePlayerStore.getState().activeTool === "razor") return { kind: "ignore" };
  if (e.shiftKey) return { kind: "arm-shift-click" };

  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const intent = resolveBlockedTimelineEditIntent({
    width: rect.width,
    offsetX: e.clientX - rect.left,
    handleWidth: CLIP_HANDLE_W,
    capabilities,
  });
  if (isIntentBlocked(intent, onResizeElement, onMoveElement)) {
    return { kind: "block", intent, rect };
  }

  if (!onMoveElement || !capabilities.canMove) return { kind: "ignore" };
  return { kind: "move", rect };
}

/**
 * The three pointer/click gestures a clip bar answers to. Factored out of
 * TimelineLanes' render loop — one call per rendered clip, closing over that
 * clip's own `el`/`elementKey`/`previewElement`/`capabilities` — so the huge
 * per-track map body reads as JSX instead of ~120 lines of gesture logic.
 */
export function createClipGestureHandlers(
  el: TimelineElement,
  elementKey: string,
  previewElement: TimelineElement,
  capabilities: TimelineEditCapabilities,
  deps: ClipGestureDeps,
) {
  const {
    pps,
    onResizeElement,
    onMoveElement,
    onRazorSplit,
    onRazorSplitAll,
    blockedClipRef,
    shiftClickClipRef,
    suppressClickRef,
    scrollRef,
    setShowPopover,
    setRangeSelection,
    setResizingClip,
    setDraggedClip,
    setSelectedElementId,
    onSelectElement,
  } = deps;

  const onResizeStart = (edge: "start" | "end", e: ReactPointerEvent): void => {
    if (!canStartResize(edge, e, capabilities, onResizeElement)) return;
    e.stopPropagation();
    blockedClipRef.current = null;
    setShowPopover(false);
    setRangeSelection(null);
    setResizingClip({
      pointerId: e.pointerId,
      element: el,
      edge,
      originClientX: e.clientX,
      originScrollLeft: scrollRef.current?.scrollLeft ?? 0,
      previewStart: el.start,
      previewDuration: el.duration,
      previewPlaybackStart: el.playbackStart,
      started: false,
    });
  };

  const onPointerDown = (e: ReactPointerEvent): void => {
    const action = resolvePointerDownAction(e, capabilities, onResizeElement, onMoveElement);
    if (action.kind === "ignore") return;

    if (action.kind === "arm-shift-click") {
      shiftClickClipRef.current = { element: el, anchorX: e.clientX, anchorY: e.clientY };
      return;
    }

    if (action.kind === "block") {
      blockedClipRef.current = {
        pointerId: e.pointerId,
        element: el,
        intent: action.intent,
        originClientX: e.clientX,
        originClientY: e.clientY,
        started: false,
      };
      return;
    }

    const { rect } = action;
    blockedClipRef.current = null;
    setShowPopover(false);
    setRangeSelection(null);
    setDraggedClip({
      pointerId: e.pointerId,
      element: el,
      originClientX: e.clientX,
      originClientY: e.clientY,
      originScrollLeft: scrollRef.current?.scrollLeft ?? 0,
      originScrollTop: scrollRef.current?.scrollTop ?? 0,
      pointerClientX: e.clientX,
      pointerClientY: e.clientY,
      pointerOffsetX: e.clientX - rect.left,
      pointerOffsetY: e.clientY - rect.top,
      previewStart: el.start,
      previewTrack: el.track,
      desiredTrack: el.track,
      insertRow: null,
      snapTime: null,
      snapType: null,
      started: false,
    });
  };

  const onClick = (e: ReactMouseEvent): void => {
    e.stopPropagation();
    if (suppressClickRef.current) return;
    const { activeTool } = usePlayerStore.getState();
    if (activeTool === "razor" && onRazorSplit) {
      const clipRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const clickOffsetX = e.clientX - clipRect.left;
      const splitTime = previewElement.start + clickOffsetX / pps;
      const clampedTime = Math.max(
        previewElement.start + SPLIT_BOUNDARY_EPSILON_S,
        Math.min(
          previewElement.start + previewElement.duration - SPLIT_BOUNDARY_EPSILON_S,
          splitTime,
        ),
      );
      if (e.shiftKey && onRazorSplitAll) {
        onRazorSplitAll(clampedTime);
      } else {
        onRazorSplit(el, clampedTime);
      }
      return;
    }
    // Clip selection is idempotent; empty timeline space owns deselection.
    setSelectedElementId(elementKey);
    onSelectElement?.(el);
  };

  return { onResizeStart, onPointerDown, onClick };
}
