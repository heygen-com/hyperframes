import { useRef, useState, useCallback, useMemo } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import {
  resolveTimelineMove,
  resolveTimelineResize,
  resolveTimelineAutoScroll,
  type BlockedTimelineEditIntent,
  type TimelineStackingReorderIntent,
} from "./timelineEditing";
import { usePlayerStore } from "../store/playerStore";
import type { TimelineElement } from "../store/playerStore";
import { TRACK_H } from "./timelineLayout";
import { isMusicTrack } from "../../utils/timelineInspector";
import { mergeUserBeats } from "../../utils/beatEditing";
import type { StackingTimelineLayer, TimelineLayerId } from "./timelineTrackOrder";
import type {
  TimelineGroupMoveChange,
  TimelineGroupResizeChange,
} from "../../hooks/useTimelineGroupEditing";
import {
  buildTimelineSnapTargets,
  snapEdgesToTargets,
  snapResizeEdgeToTargets,
  type TimelineSnapKind,
} from "./timelineSnapTargets";
import { resolveDragPreviewPlacement } from "./timelineClipDragPreview";
import { useTimelineClipGroupDrag } from "./useTimelineClipGroupDrag";

const EMPTY_BEAT_TIMES: number[] = [];

/* ── Shared state types ─────────────────────────────────────────── */
export interface DraggedClipState {
  element: TimelineElement;
  originClientX: number;
  originClientY: number;
  originScrollLeft: number;
  originScrollTop: number;
  pointerClientX: number;
  pointerClientY: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
  previewStart: number;
  previewTrack: number;
  previewLayerId: TimelineLayerId;
  previewLayerIndex: number;
  /** Beat time the clip will snap to on drop, for the grid-line highlight. */
  snapBeatTime: number | null;
  snapGuideTime: number | null;
  snapGuideKind: TimelineSnapKind | null;
  /** Sibling-scoped z-index reorder intent resolved from the vertical drag. */
  previewStackingReorder: TimelineStackingReorderIntent | null;
  started: boolean;
}

export interface ResizingClipState {
  element: TimelineElement;
  edge: "start" | "end";
  originClientX: number;
  previewStart: number;
  previewDuration: number;
  previewPlaybackStart?: number;
  snapGuideTime: number | null;
  snapGuideKind: TimelineSnapKind | null;
  started: boolean;
}

export interface BlockedClipState {
  element: TimelineElement;
  intent: BlockedTimelineEditIntent;
  originClientX: number;
  originClientY: number;
  started: boolean;
}

/* ── Hook ───────────────────────────────────────────────────────── */
interface UseTimelineClipDragInput {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  ppsRef: React.RefObject<number>;
  trackOrderRef: React.RefObject<TimelineLayerId[]>;
  timelineLayersRef: React.RefObject<StackingTimelineLayer[]>;
  timelineElementsRef: React.RefObject<TimelineElement[]>;
  onMoveElement?: (
    element: TimelineElement,
    updates: Pick<TimelineElement, "start" | "track"> & {
      stackingReorder?: TimelineStackingReorderIntent | null;
    },
  ) => Promise<void> | void;
  onResizeElement?: (
    element: TimelineElement,
    updates: Pick<TimelineElement, "start" | "duration" | "playbackStart">,
  ) => Promise<void> | void;
  onMoveElements?: (changes: TimelineGroupMoveChange[]) => Promise<void> | void;
  onResizeElements?: (changes: TimelineGroupResizeChange[]) => Promise<void> | void;
  onPreviewMoveElements?: (changes: TimelineGroupMoveChange[]) => void;
  onPreviewResizeElements?: (changes: TimelineGroupResizeChange[]) => void;
  onBlockedEditAttempt?: (element: TimelineElement, intent: BlockedTimelineEditIntent) => void;
  setShowPopover: (show: boolean) => void;
  /** Stable ref to the range selection setter, wired after mount to break circular dependency. */
  setRangeSelectionRef: React.RefObject<((sel: null) => void) | null>;
}

export function useTimelineClipDrag({
  scrollRef,
  ppsRef,
  trackOrderRef,
  timelineLayersRef,
  timelineElementsRef,
  onMoveElement,
  onResizeElement,
  onMoveElements,
  onResizeElements,
  onPreviewMoveElements,
  onPreviewResizeElements,
  onBlockedEditAttempt,
  setShowPopover,
  setRangeSelectionRef,
}: UseTimelineClipDragInput) {
  const updateElement = usePlayerStore((s) => s.updateElement);
  const rawBeatTimes = usePlayerStore((s) => s.beatAnalysis?.beatTimes ?? EMPTY_BEAT_TIMES);
  const rawBeatStrengths = usePlayerStore((s) => s.beatAnalysis?.beatStrengths ?? EMPTY_BEAT_TIMES);
  const beatEdits = usePlayerStore((s) => s.beatEdits);
  const playhead = usePlayerStore((s) => s.currentTime);
  const compositionDuration = usePlayerStore((s) => s.duration);
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

  const beatTimesRef = useRef<number[]>([]);
  beatTimesRef.current = adjustedBeatTimes;
  const playheadRef = useRef(0);
  playheadRef.current = playhead;
  const compositionDurationRef = useRef(0);
  compositionDurationRef.current = compositionDuration;

  const buildSnapTargets = useCallback(
    (element: TimelineElement) => {
      const draggedKey = element.key ?? element.id;
      const selected = selectedElementIdsRef.current;
      // In a group drag every selected clip moves together, so none of them may act
      // as a snap target for the others; exclude the whole set, not just the grabbed clip.
      const excludedKeys =
        selected.size > 1 && selected.has(draggedKey) ? selected : new Set([draggedKey]);
      return buildTimelineSnapTargets({
        elements: timelineElementsRef.current,
        excludedKeys,
        playhead: playheadRef.current,
        compDuration: compositionDurationRef.current,
        beats: isMusicTrack(element) ? EMPTY_BEAT_TIMES : beatTimesRef.current,
      });
    },
    [timelineElementsRef],
  );

  const [draggedClip, setDraggedClip] = useState<DraggedClipState | null>(null);
  const draggedClipRef = useRef<DraggedClipState | null>(null);
  draggedClipRef.current = draggedClip;

  const [resizingClip, setResizingClip] = useState<ResizingClipState | null>(null);
  const resizingClipRef = useRef<ResizingClipState | null>(null);
  resizingClipRef.current = resizingClip;

  const blockedClipRef = useRef<BlockedClipState | null>(null);
  const suppressClickRef = useRef(false);

  const onMoveElementRef = useRef(onMoveElement);
  onMoveElementRef.current = onMoveElement;
  const onResizeElementRef = useRef(onResizeElement);
  onResizeElementRef.current = onResizeElement;
  const onMoveElementsRef = useRef(onMoveElements);
  onMoveElementsRef.current = onMoveElements;
  const onResizeElementsRef = useRef(onResizeElements);
  onResizeElementsRef.current = onResizeElements;
  const onPreviewMoveElementsRef = useRef(onPreviewMoveElements);
  onPreviewMoveElementsRef.current = onPreviewMoveElements;
  const onPreviewResizeElementsRef = useRef(onPreviewResizeElements);
  onPreviewResizeElementsRef.current = onPreviewResizeElements;
  const selectedElementIdsRef = useRef(usePlayerStore.getState().selectedElementIds);
  selectedElementIdsRef.current = usePlayerStore((s) => s.selectedElementIds);

  const clipDragScrollRaf = useRef(0);
  const clipDragPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const {
    previewGroupMove,
    previewGroupResize,
    commitGroupMove,
    commitGroupResize,
    clearGroupDragSessions,
  } = useTimelineClipGroupDrag({
    timelineElementsRef,
    updateElement,
    onMoveElementsRef,
    onResizeElementsRef,
    onPreviewMoveElementsRef,
    onPreviewResizeElementsRef,
  });

  // fallow-ignore-next-line complexity
  const updateDraggedClipPreview = useCallback(
    (drag: DraggedClipState, clientX: number, clientY: number): DraggedClipState => {
      const scroll = scrollRef.current;
      const nextMove = resolveTimelineMove(
        {
          start: drag.element.start,
          track: drag.element.track,
          duration: drag.element.duration,
          originClientX: drag.originClientX,
          originClientY: drag.originClientY,
          originScrollLeft: drag.originScrollLeft,
          originScrollTop: drag.originScrollTop,
          currentScrollLeft: scroll?.scrollLeft ?? drag.originScrollLeft,
          currentScrollTop: scroll?.scrollTop ?? drag.originScrollTop,
          pixelsPerSecond: ppsRef.current,
          trackHeight: TRACK_H,
          maxStart: Number.POSITIVE_INFINITY,
          trackOrder: timelineLayersRef.current.map((layer) => layer.placementTrack),
          layerOrder: trackOrderRef.current,
          timelineLayers: timelineLayersRef.current,
          stackingElement: drag.element,
          stackingElements: timelineElementsRef.current,
        },
        clientX,
        clientY,
      );
      const snap = snapEdgesToTargets(
        nextMove.start,
        drag.element.duration,
        buildSnapTargets(drag.element),
        ppsRef.current,
        { maxStart: Number.POSITIVE_INFINITY },
      );
      const groupMove = previewGroupMove(drag.element, selectedElementIdsRef.current, snap.start);
      const placement = resolveDragPreviewPlacement(drag, nextMove, groupMove);
      return {
        ...drag,
        started: true,
        pointerClientX: clientX,
        pointerClientY: clientY,
        ...placement,
        snapBeatTime: snap.snapKind === "beat" ? snap.snapTime : null,
        snapGuideTime: snap.snapTime,
        snapGuideKind: snap.snapKind,
      };
    },
    [
      scrollRef,
      ppsRef,
      trackOrderRef,
      timelineLayersRef,
      timelineElementsRef,
      buildSnapTargets,
      previewGroupMove,
    ],
  );

  const stopClipDragAutoScroll = useCallback(() => {
    clipDragPointerRef.current = null;
    if (clipDragScrollRaf.current) {
      cancelAnimationFrame(clipDragScrollRaf.current);
      clipDragScrollRaf.current = 0;
    }
  }, []);

  const stepClipDragAutoScroll = useCallback(() => {
    clipDragScrollRaf.current = 0;
    const drag = draggedClipRef.current;
    const pointer = clipDragPointerRef.current;
    const scroll = scrollRef.current;
    if (!drag || !pointer || !scroll) return;

    const rect = scroll.getBoundingClientRect();
    const delta = resolveTimelineAutoScroll(rect, pointer.clientX, pointer.clientY);
    if (delta.x === 0 && delta.y === 0) return;

    const maxScrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    const maxScrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, scroll.scrollLeft + delta.x));
    const nextScrollTop = Math.max(0, Math.min(maxScrollTop, scroll.scrollTop + delta.y));
    if (nextScrollLeft === scroll.scrollLeft && nextScrollTop === scroll.scrollTop) return;

    scroll.scrollLeft = nextScrollLeft;
    scroll.scrollTop = nextScrollTop;
    setDraggedClip((prev) =>
      prev ? updateDraggedClipPreview(prev, pointer.clientX, pointer.clientY) : prev,
    );
    clipDragScrollRaf.current = requestAnimationFrame(stepClipDragAutoScroll);
  }, [scrollRef, updateDraggedClipPreview]);

  const syncClipDragAutoScroll = useCallback(
    (clientX: number, clientY: number) => {
      clipDragPointerRef.current = { clientX, clientY };
      const scroll = scrollRef.current;
      if (!scroll) return;
      const rect = scroll.getBoundingClientRect();
      const delta = resolveTimelineAutoScroll(rect, clientX, clientY);
      if (delta.x === 0 && delta.y === 0) {
        if (clipDragScrollRaf.current) {
          cancelAnimationFrame(clipDragScrollRaf.current);
          clipDragScrollRaf.current = 0;
        }
        return;
      }
      if (!clipDragScrollRaf.current) {
        clipDragScrollRaf.current = requestAnimationFrame(stepClipDragAutoScroll);
      }
    },
    [scrollRef, stepClipDragAutoScroll],
  );

  const updateDraggedClipPreviewRef = useRef(updateDraggedClipPreview);
  updateDraggedClipPreviewRef.current = updateDraggedClipPreview;
  const commitGroupMoveRef = useRef(commitGroupMove);
  commitGroupMoveRef.current = commitGroupMove;
  const commitGroupResizeRef = useRef(commitGroupResize);
  commitGroupResizeRef.current = commitGroupResize;
  const clearGroupDragSessionsRef = useRef(clearGroupDragSessions);
  clearGroupDragSessionsRef.current = clearGroupDragSessions;
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

    // fallow-ignore-next-line complexity
    const handleWindowPointerMove = (e: PointerEvent) => {
      const drag = draggedClipRef.current;
      const resize = resizingClipRef.current;
      const blocked = blockedClipRef.current;

      if (resize) {
        const distance = Math.abs(e.clientX - resize.originClientX);
        if (!resize.started && distance < 2) return;

        setShowPopover(false);
        setRangeSelectionRef.current?.(null);

        const sourceRemaining =
          resize.element.sourceDuration != null
            ? Math.max(
                0,
                (resize.element.sourceDuration - (resize.element.playbackStart ?? 0)) /
                  Math.max(resize.element.playbackRate ?? 1, 0.1),
              )
            : Number.POSITIVE_INFINITY;
        const normalizedTag = resize.element.tag.toLowerCase();
        const canSeedPlaybackStart = normalizedTag === "audio" || normalizedTag === "video";
        const playbackRate = Math.max(resize.element.playbackRate ?? 1, 0.1);
        const maxEnd = resize.element.start + sourceRemaining;
        let nextResize = resolveTimelineResize(
          {
            start: resize.element.start,
            duration: resize.element.duration,
            originClientX: resize.originClientX,
            pixelsPerSecond: ppsRef.current,
            minStart: 0,
            maxEnd,
            playbackStart:
              resize.edge === "start" && canSeedPlaybackStart
                ? (resize.element.playbackStart ?? 0)
                : resize.element.playbackStart,
            playbackRate: resize.element.playbackRate,
          },
          resize.edge,
          e.clientX,
        );

        const snap = snapResizeEdgeToTargets(
          resize.edge,
          nextResize.start,
          nextResize.duration,
          buildSnapTargets(resize.element),
          ppsRef.current,
          {
            minDuration: 0.05,
            maxEnd,
            maxLeftDelta:
              resize.edge === "start" && nextResize.playbackStart != null
                ? nextResize.playbackStart / playbackRate
                : Number.POSITIVE_INFINITY,
          },
        );
        if (snap.snapTime != null) {
          const unsnappedStart = nextResize.start;
          nextResize = { ...nextResize, start: snap.start, duration: snap.duration };
          if (resize.edge === "start" && nextResize.playbackStart != null) {
            const delta = unsnappedStart - snap.start;
            nextResize = {
              ...nextResize,
              playbackStart:
                Math.round(Math.max(0, nextResize.playbackStart - delta * playbackRate) * 1000) /
                1000,
            };
          }
        }
        const groupResize = previewGroupResize(
          resize.element,
          selectedElementIdsRef.current,
          resize.edge,
          nextResize,
        );
        if (groupResize.active) {
          nextResize = groupResize.updates;
        }
        setResizingClip((prev) =>
          prev
            ? {
                ...prev,
                started: true,
                previewStart: nextResize.start,
                previewDuration: nextResize.duration,
                previewPlaybackStart: nextResize.playbackStart,
                snapGuideTime: snap.snapTime,
                snapGuideKind: snap.snapKind,
              }
            : prev,
        );
        return;
      }

      if (blocked) {
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
          onBlockedEditAttempt?.(blocked.element, blocked.intent);
        }
        return;
      }

      if (!drag) return;
      const distance = Math.hypot(e.clientX - drag.originClientX, e.clientY - drag.originClientY);
      if (!drag.started && distance < 4) return;

      setShowPopover(false);
      setRangeSelectionRef.current?.(null);

      setDraggedClip((prev) =>
        prev ? updateDraggedClipPreviewRef.current(prev, e.clientX, e.clientY) : prev,
      );
      syncClipDragAutoScrollRef.current(e.clientX, e.clientY);
    };

    // fallow-ignore-next-line complexity
    const handleWindowPointerUp = () => {
      stopClipDragAutoScrollRef.current();

      const resize = resizingClipRef.current;
      if (resize) {
        resizingClipRef.current = null;
        setResizingClip(null);
        if (!resize.started) return;

        suppressClickRef.current = true;
        clearSuppressedClick();

        if (commitGroupResizeRef.current(resize.element)) return;

        const hasChanged =
          resize.previewStart !== resize.element.start ||
          resize.previewDuration !== resize.element.duration ||
          resize.previewPlaybackStart !== resize.element.playbackStart;
        if (!hasChanged) return;

        updateElement(resize.element.key ?? resize.element.id, {
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
          updateElement(resize.element.key ?? resize.element.id, {
            start: resize.element.start,
            duration: resize.element.duration,
            playbackStart: resize.element.playbackStart,
          });
          console.error("[Timeline] Failed to persist clip resize", error);
        });
        return;
      }

      const blocked = blockedClipRef.current;
      if (blocked) {
        blockedClipRef.current = null;
        if (!blocked.started) return;
        clearSuppressedClick();
        return;
      }

      const drag = draggedClipRef.current;
      if (!drag) return;
      draggedClipRef.current = null;
      setDraggedClip(null);
      if (!drag.started) return;

      suppressClickRef.current = true;
      clearSuppressedClick();

      if (commitGroupMoveRef.current(drag.element)) return;

      const hasStackingReorder =
        drag.previewStackingReorder != null && drag.previewStackingReorder.zIndexChanges.length > 0;
      const hasChanged = drag.previewStart !== drag.element.start || hasStackingReorder;
      if (!hasChanged) return;

      updateElement(drag.element.key ?? drag.element.id, {
        start: drag.previewStart,
      });

      Promise.resolve(
        onMoveElementRef.current?.(drag.element, {
          start: drag.previewStart,
          track: drag.element.track,
          stackingReorder: drag.previewStackingReorder,
        }),
      ).catch((error) => {
        updateElement(drag.element.key ?? drag.element.id, {
          start: drag.element.start,
        });
        console.error("[Timeline] Failed to persist clip move", error);
      });
    };

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerUp);
    return () => {
      clearGroupDragSessionsRef.current();
      stopClipDragAutoScrollRef.current();
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerUp);
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
