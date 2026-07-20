import { useRef, useState, useCallback, useMemo } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import {
  applyTimelineAutoScrollStep,
  resolveTimelineAutoScrollLoopAction,
  resolveTimelineDragEscape,
} from "./timelineEditing";
import { usePlayerStore } from "../store/playerStore";
import type { TimelineElement } from "../store/playerStore";
import { isMusicTrack, isAudioTimelineElement } from "../../utils/timelineInspector";
import { mergeUserBeats } from "../../utils/beatEditing";
import {
  buildTimelineGroupResizeMembers,
  type TimelineGroupResizeSession,
} from "./timelineGroupEditing";
import { collectTimelineSnapTargets, type TimelineSnapTarget } from "./timelineSnapping";
import { commitDraggedClipMove } from "./timelineClipDragCommit";
import type { StackingPatch } from "./timelineStackingSync";
import type { TimelineEditCallbacks } from "./timelineCallbacks";
import {
  computeDragPreview,
  computeResizePreview,
  previewGroupResize,
  type ResizePreviewResult,
} from "./timelineClipDragPreview";
import type {
  DraggedClipState,
  ResizingClipState,
  BlockedClipState,
} from "./timelineClipDragTypes";
import {
  beginTimelineOptimisticGesture,
  rollbackLatestTimelineOptimisticGesture,
} from "./timelineOptimisticRevision";
import { commitTimelineGroupResize } from "./timelineGroupResizeCommit";

export type {
  DraggedClipState,
  ResizingClipState,
  BlockedClipState,
} from "./timelineClipDragTypes";

const EMPTY_BEAT_TIMES: number[] = [];

/* ── Hook ───────────────────────────────────────────────────────── */
interface UseTimelineClipDragInput {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  ppsRef: React.RefObject<number>;
  durationRef: React.RefObject<number>;
  trackOrderRef: React.RefObject<number[]>;
  onMoveElement?: (
    element: TimelineElement,
    updates: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  onMoveElements?: (
    edits: Array<{
      element: TimelineElement;
      updates: Pick<TimelineElement, "start" | "track">;
    }>,
  ) => Promise<void> | void;
  onResizeElement?: (
    element: TimelineElement,
    updates: Pick<TimelineElement, "start" | "duration" | "playbackStart">,
  ) => Promise<void> | void;
  onResizeElements?: NonNullable<TimelineEditCallbacks["onResizeElements"]>;
  onBlockedEditAttempt?: (element: TimelineElement, intent: BlockedClipState["intent"]) => void;
  setShowPopover: (show: boolean) => void;
  /** Stable ref to the range selection setter — wired after mount to break circular dependency. */
  setRangeSelectionRef: React.RefObject<((sel: null) => void) | null>;
  /**
   * Lane ↔ stacking unification (see research/STAGE3-NEEDED-WIRING.md). When both
   * are supplied and a lane-change drag commits, the edited clip(s) get z-index
   * patches so their stacking matches lane order relative to time-overlapping
   * clips. Provisioned by the timeline layer (Timeline.tsx) from the preview
   * iframe + the canvas z-order persist path; forwarded straight to
   * commitDraggedClipMove. Both optional → absent = no-op (backward compatible).
   */
  readZIndex?: (element: TimelineElement) => number;
  onStackingPatches?: (patches: StackingPatch[]) => Promise<unknown> | void;
  refreshAfterLaneMove?: () => void;
}

export function useTimelineClipDrag({
  scrollRef,
  ppsRef,
  durationRef,
  trackOrderRef,
  onMoveElement,
  onMoveElements,
  onResizeElement,
  onResizeElements,
  onBlockedEditAttempt,
  setShowPopover,
  setRangeSelectionRef,
  readZIndex,
  onStackingPatches,
  refreshAfterLaneMove,
}: UseTimelineClipDragInput) {
  const updateElement = usePlayerStore((s) => s.updateElement);
  const rawBeatTimes = usePlayerStore((s) => s.beatAnalysis?.beatTimes ?? EMPTY_BEAT_TIMES);
  const rawBeatStrengths = usePlayerStore((s) => s.beatAnalysis?.beatStrengths ?? EMPTY_BEAT_TIMES);
  const beatEdits = usePlayerStore((s) => s.beatEdits);
  const musicStart = usePlayerStore((s) => s.elements.find(isMusicTrack)?.start ?? 0);
  const musicPlaybackStart = usePlayerStore(
    (s) => s.elements.find(isMusicTrack)?.playbackStart ?? 0,
  );
  const musicDuration = usePlayerStore((s) => s.elements.find(isMusicTrack)?.duration ?? 0);
  const musicSrc = usePlayerStore((s) => s.elements.find(isMusicTrack)?.src ?? null);

  const adjustedBeatTimes = useMemo(() => {
    if (rawBeatTimes === EMPTY_BEAT_TIMES || musicDuration === 0) return EMPTY_BEAT_TIMES;
    const merged = mergeUserBeats(rawBeatTimes, rawBeatStrengths, beatEdits, musicSrc);
    const clipEnd = musicPlaybackStart + musicDuration;
    const offset = musicStart - musicPlaybackStart;
    return merged.times
      .filter((t) => t >= musicPlaybackStart && t <= clipEnd)
      .map((t) => Math.round((t + offset) * 1000) / 1000);
  }, [
    rawBeatTimes,
    rawBeatStrengths,
    beatEdits,
    musicSrc,
    musicStart,
    musicPlaybackStart,
    musicDuration,
  ]);

  const elements = usePlayerStore((s) => s.elements);
  const timelineSnapEnabled = usePlayerStore((s) => s.timelineSnapEnabled);
  const snapContextRef = useRef<{ beatTimes: number[]; enabled: boolean }>({
    beatTimes: [],
    enabled: true,
  });
  snapContextRef.current = {
    beatTimes: adjustedBeatTimes,
    enabled: timelineSnapEnabled,
  };
  const elementsRef = useRef(elements);
  elementsRef.current = elements;

  // Perf (frozen-per-gesture): the snap-target set and the audio-track set are
  // fixed for the duration of one drag/resize (the store is not re-authored mid
  // gesture), so build each ONCE and reuse it across every pointermove and every
  // auto-scroll frame. Both caches are cleared at gesture teardown
  // (stopClipDragAutoScroll), so the next gesture rebuilds against fresh state.
  const snapTargetsCacheRef = useRef<Map<string, TimelineSnapTarget[]>>(new Map());
  const dragAudioTracksRef = useRef<ReadonlySet<number> | null>(null);

  const buildSnapTargets = useCallback(
    (excludeElementKey: string | null, includeBeats: boolean): TimelineSnapTarget[] => {
      // Magnet off ⇒ no targets and no scan; do NOT cache so a mid-gesture toggle
      // back on starts scanning immediately (preserves the existing skip).
      if (!snapContextRef.current.enabled) return [];
      const cacheKey = `${excludeElementKey ?? ""}|${includeBeats ? 1 : 0}`;
      const cached = snapTargetsCacheRef.current.get(cacheKey);
      if (cached) return cached;
      const targets = collectTimelineSnapTargets({
        elements: elementsRef.current,
        playheadTime: usePlayerStore.getState().currentTime,
        beatTimes: includeBeats ? snapContextRef.current.beatTimes : [],
        excludeElementKey,
      });
      snapTargetsCacheRef.current.set(cacheKey, targets);
      return targets;
    },
    [],
  );

  const [draggedClip, setDraggedClip] = useState<DraggedClipState | null>(null);
  const draggedClipRef = useRef<DraggedClipState | null>(null);
  draggedClipRef.current = draggedClip;

  const [resizingClip, setResizingClip] = useState<ResizingClipState | null>(null);
  const resizingClipRef = useRef<ResizingClipState | null>(null);
  resizingClipRef.current = resizingClip;

  const blockedClipRef = useRef<BlockedClipState | null>(null);
  const suppressClickRef = useRef(false);

  // Active multi-select group-resize session (restored from main 36413da7f): set
  // lazily on the first resize pointermove when the grabbed clip is part of a
  // capability-clean multi-selection (null ⇒ single-clip resize). Holds the
  // pre-gesture snapshot so the non-grabbed members (previewed through the store)
  // roll back on escape / cancel / failed persist.
  const groupResizeRef = useRef<TimelineGroupResizeSession | null>(null);

  // Restore the non-grabbed group members to their pre-gesture timing (the
  // grabbed clip renders from resizingClip state, so it is never written during
  // preview). `all` also restores the grabbed clip after a committed persist fails.
  const restoreGroupResizeMembers = useCallback(
    (session: TimelineGroupResizeSession, all = false) => {
      for (const m of session.members) {
        if (!all && m.key === session.grabbedKey) continue;
        updateElement(m.key, {
          start: m.start,
          duration: m.duration,
          playbackStart: m.playbackStart,
        });
      }
    },
    [updateElement],
  );

  const onMoveElementRef = useRef(onMoveElement);
  onMoveElementRef.current = onMoveElement;
  const onMoveElementsRef = useRef(onMoveElements);
  onMoveElementsRef.current = onMoveElements;
  const onBlockedEditAttemptRef = useRef(onBlockedEditAttempt);
  onBlockedEditAttemptRef.current = onBlockedEditAttempt;
  const onResizeElementRef = useRef(onResizeElement);
  onResizeElementRef.current = onResizeElement;
  const onResizeElementsRef = useRef(onResizeElements);
  onResizeElementsRef.current = onResizeElements;
  const readZIndexRef = useRef(readZIndex);
  readZIndexRef.current = readZIndex;
  const onStackingPatchesRef = useRef(onStackingPatches);
  onStackingPatchesRef.current = onStackingPatches;
  const refreshAfterLaneMoveRef = useRef(refreshAfterLaneMove);
  refreshAfterLaneMoveRef.current = refreshAfterLaneMove;

  const clipDragScrollRaf = useRef(0);
  const clipDragPointerRef = useRef<{
    clientX: number;
    clientY: number;
  } | null>(null);

  // Recompute the dragged-clip preview for a pointer position. The heavy lifting
  // (move + snap + group clamp + drop placement) is a tested pure function so
  // what runs here is what's verified — see timelineClipDragPreview.
  const updateDraggedClipPreview = useCallback(
    (drag: DraggedClipState, clientX: number, clientY: number): DraggedClipState => {
      // Build the audio-track set once per gesture (see snapTargetsCacheRef): it
      // only feeds zone-aware drop placement and is frozen while dragging.
      if (!dragAudioTracksRef.current) {
        dragAudioTracksRef.current = new Set(
          elementsRef.current.filter(isAudioTimelineElement).map((e) => e.track),
        );
      }
      return computeDragPreview(drag, clientX, clientY, {
        scroll: scrollRef.current,
        pps: ppsRef.current,
        duration: durationRef.current,
        trackOrder: trackOrderRef.current,
        elements: elementsRef.current,
        selectedKeys: usePlayerStore.getState().selectedElementIds,
        buildSnapTargets,
        audioTracks: dragAudioTracksRef.current,
      });
    },
    [scrollRef, ppsRef, durationRef, trackOrderRef, buildSnapTargets],
  );

  // Recompute the trim preview for a pointer x. Shared by the pointermove resize
  // branch and the edge auto-scroll stepper (re-runs as content scrolls under a
  // stationary pointer). computeResizePreview is pure; here we only apply state.
  const applyResizePointer = useCallback(
    (resize: ResizingClipState, clientX: number) => {
      const next = computeResizePreview(resize, clientX, {
        scroll: scrollRef.current,
        pps: ppsRef.current,
        buildSnapTargets,
      });
      const setResizeState = (v: ResizePreviewResult) =>
        setResizingClip((prev) => (prev ? { ...prev, started: true, ...v } : prev));

      // Group resize: a capability-clean multi-selection resizes rigidly by one
      // shared, member-clamped delta (legacy main 36413da7f). The grabbed clip
      // drives the raw delta and renders from resizingClip state; non-grabbed
      // members preview through the store (their store value stays pristine).
      const grabbedKey = resize.element.key ?? resize.element.id;
      let session = groupResizeRef.current;
      if (!session || session.grabbedKey !== grabbedKey || session.edge !== resize.edge) {
        const members = buildTimelineGroupResizeMembers(
          elementsRef.current,
          usePlayerStore.getState().selectedElementIds,
          grabbedKey,
          resize.edge,
        );
        session = members
          ? {
              grabbedKey,
              edge: resize.edge,
              members,
              changes: [],
              hasChanged: false,
            }
          : null;
        groupResizeRef.current = session;
      }

      if (!session) {
        setResizeState(next);
        return;
      }
      previewGroupResize(session, next, grabbedKey, updateElement, setResizeState);
    },
    [scrollRef, ppsRef, buildSnapTargets, updateElement],
  );
  const applyResizePointerRef = useRef(applyResizePointer);
  applyResizePointerRef.current = applyResizePointer;

  const stopClipDragAutoScroll = useCallback(() => {
    clipDragPointerRef.current = null;
    if (clipDragScrollRaf.current) {
      cancelAnimationFrame(clipDragScrollRaf.current);
      clipDragScrollRaf.current = 0;
    }
    // Gesture teardown: drop the frozen-per-gesture perf caches so the next drag
    // rebuilds them against fresh store state (see snapTargetsCacheRef). Does NOT
    // touch groupResizeRef — commit reads it after this runs.
    snapTargetsCacheRef.current.clear();
    dragAudioTracksRef.current = null;
  }, []);

  const stepClipDragAutoScroll = useCallback(() => {
    clipDragScrollRaf.current = 0;
    const drag = draggedClipRef.current;
    const resize = resizingClipRef.current;
    const pointer = clipDragPointerRef.current;
    const scroll = scrollRef.current;
    if ((!drag && !resize) || !pointer || !scroll) return;
    if (!applyTimelineAutoScrollStep(scroll, pointer.clientX, pointer.clientY)) return;

    if (drag) {
      setDraggedClip((prev) =>
        prev ? updateDraggedClipPreview(prev, pointer.clientX, pointer.clientY) : prev,
      );
    } else if (resize) {
      // Re-run the trim preview so the edge keeps tracking while the content
      // scrolls under the stationary pointer (scroll-compensated pointer x).
      applyResizePointerRef.current(resize, pointer.clientX);
    }
    clipDragScrollRaf.current = requestAnimationFrame(stepClipDragAutoScroll);
  }, [scrollRef, updateDraggedClipPreview]);

  const syncClipDragAutoScroll = useCallback(
    (clientX: number, clientY: number) => {
      clipDragPointerRef.current = { clientX, clientY };
      const action = resolveTimelineAutoScrollLoopAction(
        scrollRef.current,
        clientX,
        clientY,
        clipDragScrollRaf.current !== 0,
      );
      if (action === "stop") {
        cancelAnimationFrame(clipDragScrollRaf.current);
        clipDragScrollRaf.current = 0;
      } else if (action === "start") {
        clipDragScrollRaf.current = requestAnimationFrame(stepClipDragAutoScroll);
      }
    },
    [scrollRef, stepClipDragAutoScroll],
  );

  const updateDraggedClipPreviewRef = useRef(updateDraggedClipPreview);
  updateDraggedClipPreviewRef.current = updateDraggedClipPreview;
  const syncClipDragAutoScrollRef = useRef(syncClipDragAutoScroll);
  syncClipDragAutoScrollRef.current = syncClipDragAutoScroll;
  const stopClipDragAutoScrollRef = useRef(stopClipDragAutoScroll);
  stopClipDragAutoScrollRef.current = stopClipDragAutoScroll;

  useMountEffect(() => {
    const clearSuppressedClick = () => {
      requestAnimationFrame(() => {
        suppressClickRef.current = false;
      });
    };

    /* ── pointermove branch handlers (dispatched by drag/resize/blocked) ── */
    const handleResizePointerMove = (e: PointerEvent, resize: ResizingClipState) => {
      const distance = Math.abs(e.clientX - resize.originClientX);
      if (!resize.started && distance < 2) return;

      setShowPopover(false);
      setRangeSelectionRef.current?.(null);

      applyResizePointerRef.current(resize, e.clientX);
      // Edge auto-scroll during a trim, exactly like the move branch — lets a
      // right-edge trim keep extending past the current viewport (the stepper
      // re-runs the scroll-compensated preview each frame).
      syncClipDragAutoScrollRef.current(e.clientX, e.clientY);
    };

    const handleBlockedPointerMove = (e: PointerEvent, blocked: BlockedClipState) => {
      const distance = Math.hypot(
        e.clientX - blocked.originClientX,
        e.clientY - blocked.originClientY,
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

    const handleDragPointerMove = (e: PointerEvent, drag: DraggedClipState) => {
      const distance = Math.hypot(e.clientX - drag.originClientX, e.clientY - drag.originClientY);
      if (!drag.started && distance < 4) return;

      setShowPopover(false);
      setRangeSelectionRef.current?.(null);

      setDraggedClip((prev) =>
        prev ? updateDraggedClipPreviewRef.current(prev, e.clientX, e.clientY) : prev,
      );
      syncClipDragAutoScrollRef.current(e.clientX, e.clientY);
    };

    const handleWindowPointerMove = (e: PointerEvent) => {
      const resize = resizingClipRef.current;
      if (resize) return handleResizePointerMove(e, resize);
      const blocked = blockedClipRef.current;
      if (blocked) return handleBlockedPointerMove(e, blocked);
      const drag = draggedClipRef.current;
      if (drag) handleDragPointerMove(e, drag);
    };

    /* ── pointerup commit handlers (dispatched by drag/resize/blocked) ──── */
    const commitResizePointerUp = (resize: ResizingClipState) => {
      resizingClipRef.current = null;
      setResizingClip(null);
      const groupSession = groupResizeRef.current;
      groupResizeRef.current = null;
      if (!resize.started) {
        // No preview ran, so no group store-mutation to undo; guard is defensive.
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
      if (!blocked.started) return;
      clearSuppressedClick();
    };

    const commitDragPointerUp = (drag: DraggedClipState) => {
      draggedClipRef.current = null;
      setDraggedClip(null);
      if (!drag.started) return;

      suppressClickRef.current = true;
      clearSuppressedClick();

      // Commit the drag — insert (new track), main-track ripple (reflow contiguous),
      // a plain single-clip move, or a multi-selection move (every selected clip
      // shifts by the dragged clip's time delta). See timelineClipDragCommit.
      commitDraggedClipMove(drag, {
        elements: elementsRef.current,
        trackOrder: trackOrderRef.current,
        updateElement,
        onMoveElement: onMoveElementRef.current,
        onMoveElements: onMoveElementsRef.current,
        selectedKeys: usePlayerStore.getState().selectedElementIds,
        // Lane ↔ stacking: engages only when the timeline layer provisions both
        // deps (Timeline.tsx). Absent → commitDraggedClipMove skips the z-sync.
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
        // Escape-cancel leaves the click suppressor armed so the click this
        // pointerup generates can't act on the clip; disarm it right after.
        if (suppressClickRef.current) clearSuppressedClick();
        return;
      }
      commitDragPointerUp(drag);
    };

    // Escape cancels the in-progress gesture: no commit, no undo entry. The
    // previews live only in the drag/resize state (the store is untouched
    // until the pointerup commit), so clearing them restores the pre-drag
    // timeline. Clip drags never take pointer capture (all tracking runs on
    // these window listeners), so there is no capture to release; the null
    // refs make the remaining pointermove/pointerup a no-op.
    const handleWindowKeyDown = (e: KeyboardEvent) => {
      const decision = resolveTimelineDragEscape({
        key: e.key,
        drag: draggedClipRef.current,
        resize: resizingClipRef.current,
        blocked: blockedClipRef.current,
      });
      if (!decision.cancel) return;
      e.preventDefault();
      e.stopPropagation();
      stopClipDragAutoScrollRef.current();
      draggedClipRef.current = null;
      setDraggedClip(null);
      resizingClipRef.current = null;
      setResizingClip(null);
      // Undo any group-resize preview store-mutation (non-grabbed members) so the
      // cancelled gesture restores the pre-drag timeline, like the single-clip path.
      const groupSession = groupResizeRef.current;
      groupResizeRef.current = null;
      if (groupSession) restoreGroupResizeMembers(groupSession);
      blockedClipRef.current = null;
      // The pointer is usually still down; keep the suppressor armed until the
      // eventual pointerup (which disarms it) so its click can't reselect.
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
  });

  return {
    draggedClip,
    setDraggedClip,
    resizingClip,
    setResizingClip,
    blockedClipRef,
    suppressClickRef,
    syncClipDragAutoScroll,
    stopClipDragAutoScroll,
  };
}
