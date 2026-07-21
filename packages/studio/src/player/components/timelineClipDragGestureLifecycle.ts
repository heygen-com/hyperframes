import type { Dispatch, RefObject, SetStateAction } from "react";
import { resolveTimelineDragEscape } from "./timelineEditing";
import { commitDraggedClipMove } from "./timelineClipDragCommit";
import type {
  BlockedClipState,
  DraggedClipState,
  ResizingClipState,
} from "./timelineClipDragTypes";
import type { TimelineGroupResizeSession } from "./timelineGroupEditing";
import { commitTimelineGroupResize } from "./timelineGroupResizeCommit";
import {
  beginTimelineOptimisticGesture,
  rollbackLatestTimelineOptimisticGesture,
} from "./timelineOptimisticRevision";
import type { TimelineEditCallbacks } from "./timelineCallbacks";
import type { StackingPatch } from "./timelineStackingSync";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";

type UpdateElement = ReturnType<typeof usePlayerStore.getState>["updateElement"];

interface TimelineClipDragGestureLifecycleInput {
  draggedClipRef: RefObject<DraggedClipState | null>;
  resizingClipRef: RefObject<ResizingClipState | null>;
  blockedClipRef: RefObject<BlockedClipState | null>;
  groupResizeRef: RefObject<TimelineGroupResizeSession | null>;
  suppressClickRef: RefObject<boolean>;
  elementsRef: RefObject<TimelineElement[]>;
  trackOrderRef: RefObject<number[]>;
  setDraggedClip: Dispatch<SetStateAction<DraggedClipState | null>>;
  setResizingClip: Dispatch<SetStateAction<ResizingClipState | null>>;
  setShowPopover: (show: boolean) => void;
  setRangeSelectionRef: RefObject<((selection: null) => void) | null>;
  applyResizePointerRef: RefObject<(resize: ResizingClipState, clientX: number) => void>;
  syncClipDragAutoScrollRef: RefObject<(clientX: number, clientY: number) => void>;
  stopClipDragAutoScrollRef: RefObject<() => void>;
  updateDraggedClipPreviewRef: RefObject<
    (drag: DraggedClipState, clientX: number, clientY: number) => DraggedClipState
  >;
  restoreGroupResizeMembers: (session: TimelineGroupResizeSession, all?: boolean) => void;
  updateElement: UpdateElement;
  onMoveElementRef: RefObject<TimelineEditCallbacks["onMoveElement"]>;
  onMoveElementsRef: RefObject<TimelineEditCallbacks["onMoveElements"]>;
  onResizeElementRef: RefObject<TimelineEditCallbacks["onResizeElement"]>;
  onResizeElementsRef: RefObject<TimelineEditCallbacks["onResizeElements"]>;
  onBlockedEditAttemptRef: RefObject<
    ((element: TimelineElement, intent: BlockedClipState["intent"]) => void) | undefined
  >;
  readZIndexRef: RefObject<((element: TimelineElement) => number) | undefined>;
  onStackingPatchesRef: RefObject<
    ((patches: StackingPatch[]) => Promise<unknown> | void) | undefined
  >;
  refreshAfterLaneMoveRef: RefObject<(() => void) | undefined>;
}

export function mountTimelineClipDragGestureLifecycle({
  draggedClipRef,
  resizingClipRef,
  blockedClipRef,
  groupResizeRef,
  suppressClickRef,
  elementsRef,
  trackOrderRef,
  setDraggedClip,
  setResizingClip,
  setShowPopover,
  setRangeSelectionRef,
  applyResizePointerRef,
  syncClipDragAutoScrollRef,
  stopClipDragAutoScrollRef,
  updateDraggedClipPreviewRef,
  restoreGroupResizeMembers,
  updateElement,
  onMoveElementRef,
  onMoveElementsRef,
  onResizeElementRef,
  onResizeElementsRef,
  onBlockedEditAttemptRef,
  readZIndexRef,
  onStackingPatchesRef,
  refreshAfterLaneMoveRef,
}: TimelineClipDragGestureLifecycleInput): () => void {
  const clearSuppressedClick = () => {
    requestAnimationFrame(() => {
      suppressClickRef.current = false;
    });
  };

  const handleResizePointerMove = (event: PointerEvent, resize: ResizingClipState) => {
    const distance = Math.abs(event.clientX - resize.originClientX);
    if (!resize.started && distance < 2) return;
    setShowPopover(false);
    setRangeSelectionRef.current?.(null);
    applyResizePointerRef.current(resize, event.clientX);
    syncClipDragAutoScrollRef.current(event.clientX, event.clientY);
  };

  const handleBlockedPointerMove = (event: PointerEvent, blocked: BlockedClipState) => {
    const distance = Math.hypot(
      event.clientX - blocked.originClientX,
      event.clientY - blocked.originClientY,
    );
    const threshold = blocked.intent === "move" ? 4 : 2;
    if (!blocked.started && distance < threshold) return;
    if (!blocked.started) {
      blocked.started = true;
      blockedClipRef.current = blocked;
      suppressClickRef.current = true;
      setShowPopover(false);
      setRangeSelectionRef.current?.(null);
      onBlockedEditAttemptRef.current?.(blocked.element, blocked.intent);
    }
  };

  const handleDragPointerMove = (event: PointerEvent, drag: DraggedClipState) => {
    const distance = Math.hypot(
      event.clientX - drag.originClientX,
      event.clientY - drag.originClientY,
    );
    if (!drag.started && distance < 4) return;
    setShowPopover(false);
    setRangeSelectionRef.current?.(null);
    setDraggedClip((previous) =>
      previous
        ? updateDraggedClipPreviewRef.current(previous, event.clientX, event.clientY)
        : previous,
    );
    syncClipDragAutoScrollRef.current(event.clientX, event.clientY);
  };

  const handleWindowPointerMove = (event: PointerEvent) => {
    const resize = resizingClipRef.current;
    if (resize) return handleResizePointerMove(event, resize);
    const blocked = blockedClipRef.current;
    if (blocked) return handleBlockedPointerMove(event, blocked);
    const drag = draggedClipRef.current;
    if (drag) handleDragPointerMove(event, drag);
  };

  const commitResizePointerUp = (resize: ResizingClipState) => {
    resizingClipRef.current = null;
    setResizingClip(null);
    const groupSession = groupResizeRef.current;
    groupResizeRef.current = null;
    if (!resize.started) {
      if (groupSession) restoreGroupResizeMembers(groupSession);
      return;
    }
    suppressClickRef.current = true;
    clearSuppressedClick();
    if (groupSession) {
      commitTimelineGroupResize(groupSession, updateElement, onResizeElementsRef.current);
      return;
    }
    const hasChanged =
      resize.previewStart !== resize.element.start ||
      resize.previewDuration !== resize.element.duration ||
      resize.previewPlaybackStart !== resize.element.playbackStart;
    if (!hasChanged) return;

    const resizeKey = resize.element.key ?? resize.element.id;
    const revision = beginTimelineOptimisticGesture(updateElement, [resizeKey]);
    updateElement(resizeKey, {
      start: resize.previewStart,
      duration: resize.previewDuration,
      playbackStart: resize.previewPlaybackStart,
    });
    Promise.resolve(
      onResizeElementRef.current?.(resize.element, {
        start: resize.previewStart,
        duration: resize.previewDuration,
        playbackStart: resize.previewPlaybackStart,
      }),
    ).catch((error) => {
      rollbackLatestTimelineOptimisticGesture(updateElement, revision, [
        {
          key: resizeKey,
          updates: {
            start: resize.element.start,
            duration: resize.element.duration,
            playbackStart: resize.element.playbackStart,
          },
        },
      ]);
      console.error("[Timeline] Failed to persist clip resize", error);
    });
  };

  const finishBlockedPointerUp = (blocked: BlockedClipState) => {
    blockedClipRef.current = null;
    if (blocked.started) clearSuppressedClick();
  };

  const commitDragPointerUp = (drag: DraggedClipState) => {
    draggedClipRef.current = null;
    setDraggedClip(null);
    if (!drag.started) return;
    suppressClickRef.current = true;
    clearSuppressedClick();
    commitDraggedClipMove(drag, {
      elements: elementsRef.current,
      trackOrder: trackOrderRef.current,
      updateElement,
      onMoveElement: onMoveElementRef.current,
      onMoveElements: onMoveElementsRef.current,
      selectedKeys: usePlayerStore.getState().selectedElementIds,
      readZIndex: readZIndexRef.current,
      onStackingPatches: onStackingPatchesRef.current,
      refreshAfterLaneMove: refreshAfterLaneMoveRef.current,
    });
  };

  const handleWindowPointerUp = () => {
    stopClipDragAutoScrollRef.current();
    const resize = resizingClipRef.current;
    if (resize) return commitResizePointerUp(resize);
    const blocked = blockedClipRef.current;
    if (blocked) return finishBlockedPointerUp(blocked);
    const drag = draggedClipRef.current;
    if (!drag) {
      if (suppressClickRef.current) clearSuppressedClick();
      return;
    }
    commitDragPointerUp(drag);
  };

  const handleWindowKeyDown = (event: KeyboardEvent) => {
    const decision = resolveTimelineDragEscape({
      key: event.key,
      drag: draggedClipRef.current,
      resize: resizingClipRef.current,
      blocked: blockedClipRef.current,
    });
    if (!decision.cancel) return;
    event.preventDefault();
    event.stopPropagation();
    stopClipDragAutoScrollRef.current();
    draggedClipRef.current = null;
    setDraggedClip(null);
    resizingClipRef.current = null;
    setResizingClip(null);
    const groupSession = groupResizeRef.current;
    groupResizeRef.current = null;
    if (groupSession) restoreGroupResizeMembers(groupSession);
    blockedClipRef.current = null;
    if (decision.suppressClick) suppressClickRef.current = true;
  };

  window.addEventListener("pointermove", handleWindowPointerMove);
  window.addEventListener("pointerup", handleWindowPointerUp);
  window.addEventListener("pointercancel", handleWindowPointerUp);
  window.addEventListener("keydown", handleWindowKeyDown, true);
  return () => {
    stopClipDragAutoScrollRef.current();
    window.removeEventListener("pointermove", handleWindowPointerMove);
    window.removeEventListener("pointerup", handleWindowPointerUp);
    window.removeEventListener("pointercancel", handleWindowPointerUp);
    window.removeEventListener("keydown", handleWindowKeyDown, true);
  };
}
