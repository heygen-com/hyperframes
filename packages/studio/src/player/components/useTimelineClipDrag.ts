import { useRef, useState, useCallback, useMemo } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import {
  resolveTimelineMove,
  resolveTimelineResize,
  resolveTimelineAutoScroll,
  type BlockedTimelineEditIntent,
} from "./timelineEditing";
import { usePlayerStore } from "../store/playerStore";
import type { TimelineElement } from "../store/playerStore";
import { TRACK_H, RULER_H } from "./timelineLayout";
import { isMusicTrack, isAudioTimelineElement } from "../../utils/timelineInspector";
import { mergeUserBeats } from "../../utils/beatEditing";
import {
  TIMELINE_SNAP_PX,
  collectTimelineSnapTargets,
  snapMoveToTargets,
  snapTimelineTime,
  type TimelineSnapTarget,
  type TimelineSnapType,
} from "./timelineSnapping";
import { resolveInsertRow } from "./timelineCollision";
import { commitDraggedClipMove } from "./timelineClipDragCommit";

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
  /**
   * When non-null, the drop inserts a NEW track at this visual row boundary
   * (0 = above the top lane, trackOrder.length = below the bottom) instead of
   * landing on previewTrack. Drives the insertion-line indicator.
   */
  insertRow: number | null;
  /** Snap target the clip will land on, for the guide highlight. */
  snapTime: number | null;
  snapType: TimelineSnapType | null;
  started: boolean;
}

export interface ResizingClipState {
  element: TimelineElement;
  edge: "start" | "end";
  originClientX: number;
  previewStart: number;
  previewDuration: number;
  previewPlaybackStart?: number;
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
  durationRef: React.RefObject<number>;
  trackOrderRef: React.RefObject<number[]>;
  onMoveElement?: (
    element: TimelineElement,
    updates: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  onMoveElements?: (
    edits: Array<{ element: TimelineElement; updates: Pick<TimelineElement, "start" | "track"> }>,
  ) => Promise<void> | void;
  onResizeElement?: (
    element: TimelineElement,
    updates: Pick<TimelineElement, "start" | "duration" | "playbackStart">,
  ) => Promise<void> | void;
  onBlockedEditAttempt?: (element: TimelineElement, intent: BlockedTimelineEditIntent) => void;
  setShowPopover: (show: boolean) => void;
  /** Stable ref to the range selection setter — wired after mount to break circular dependency. */
  setRangeSelectionRef: React.RefObject<((sel: null) => void) | null>;
}

export function useTimelineClipDrag({
  scrollRef,
  ppsRef,
  durationRef,
  trackOrderRef,
  onMoveElement,
  onMoveElements,
  onResizeElement,
  onBlockedEditAttempt,
  setShowPopover,
  setRangeSelectionRef,
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
  snapContextRef.current = { beatTimes: adjustedBeatTimes, enabled: timelineSnapEnabled };
  const elementsRef = useRef(elements);
  elementsRef.current = elements;

  const buildSnapTargets = useCallback(
    (excludeElementKey: string | null, includeBeats: boolean): TimelineSnapTarget[] => {
      if (!snapContextRef.current.enabled) return [];
      return collectTimelineSnapTargets({
        elements: elementsRef.current,
        playheadTime: usePlayerStore.getState().currentTime,
        beatTimes: includeBeats ? snapContextRef.current.beatTimes : [],
        excludeElementKey,
      });
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

  const onMoveElementRef = useRef(onMoveElement);
  onMoveElementRef.current = onMoveElement;
  const onMoveElementsRef = useRef(onMoveElements);
  onMoveElementsRef.current = onMoveElements;
  const onResizeElementRef = useRef(onResizeElement);
  onResizeElementRef.current = onResizeElement;

  const clipDragScrollRaf = useRef(0);
  const clipDragPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);

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
          maxStart: Math.max(0, durationRef.current - drag.element.duration),
          trackOrder: trackOrderRef.current,
        },
        clientX,
        clientY,
      );
      // The music track defines the beats, so it must not snap to them —
      // but it still snaps to the playhead and other clip edges.
      const targets = buildSnapTargets(
        drag.element.key ?? drag.element.id,
        !isMusicTrack(drag.element),
      );
      const snap = snapMoveToTargets(
        nextMove.start,
        drag.element.duration,
        targets,
        ppsRef.current,
        durationRef.current,
      );
      // Insert mode: near a lane boundary (or past an edge) the drop inserts a new
      // track instead of landing on a lane. rowFloat is the pointer's position in
      // track-heights from the top of the first lane.
      const rowFloat = scroll
        ? (clientY - scroll.getBoundingClientRect().top + scroll.scrollTop - RULER_H) / TRACK_H
        : 0;
      const rawInsertRow = resolveInsertRow(rowFloat, trackOrderRef.current.length);
      // Inserting a new track only makes sense in the visual zone. Suppress the
      // insertion affordance at/below the first audio lane so it never appears
      // under the bottom (audio stays pinned to the bottom).
      const audioStart = elementsRef.current.reduce(
        (min, e) => (isAudioTimelineElement(e) ? Math.min(min, e.track) : min),
        Number.POSITIVE_INFINITY,
      );
      const insertRow =
        rawInsertRow !== null && Number.isFinite(audioStart) && rawInsertRow > audioStart
          ? null
          : rawInsertRow;
      // Free placement: land on the hovered lane at the (snapped) time. Overlaps are
      // allowed — layered overlays are real HyperFrames content — so there's no
      // collision-push to a free lane and no main-track magnet. Snapping (when the
      // magnet toggle is on) still aligns edges to the playhead / clips / beats.
      return {
        ...drag,
        started: true,
        pointerClientX: clientX,
        pointerClientY: clientY,
        previewStart: snap.start,
        previewTrack: nextMove.track,
        insertRow,
        snapTime: snap.snapTime,
        snapType: snap.snapType,
      };
    },
    [scrollRef, ppsRef, durationRef, trackOrderRef, buildSnapTargets],
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
        const maxEnd = Math.min(durationRef.current, resize.element.start + sourceRemaining);
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

        // Snap edge to unified targets (beats + clip edges + playhead) when available.
        // The snap must stay inside the same limits resolveTimelineResize enforces,
        // or it would push the edge past the available source media / composition end.
        // The music track defines the beats, so it must not snap to them —
        // but it still snaps to the playhead and other clip edges.
        const trimTargets = buildSnapTargets(
          resize.element.key ?? resize.element.id,
          !isMusicTrack(resize.element),
        );
        if (trimTargets.length > 0) {
          const snapSecs = TIMELINE_SNAP_PX / Math.max(ppsRef.current, 1);
          if (resize.edge === "end") {
            const edgeTime = nextResize.start + nextResize.duration;
            const snapped = snapTimelineTime(edgeTime, trimTargets, snapSecs).time;
            // Stay within [start+minDuration, maxEnd] so the snap can't create a
            // degenerate clip or run past the source/composition limit.
            const snappedDuration = Math.round((snapped - nextResize.start) * 1000) / 1000;
            if (snapped !== edgeTime && snapped <= maxEnd + 1e-6 && snappedDuration >= 0.05) {
              nextResize = { ...nextResize, duration: snappedDuration };
            }
          } else {
            const snapped = snapTimelineTime(nextResize.start, trimTargets, snapSecs).time;
            const delta = nextResize.start - snapped; // >0 when snapping left
            // Leftward snap reveals more source; cap so playbackStart can't go < 0.
            const maxLeftDelta =
              nextResize.playbackStart != null
                ? nextResize.playbackStart / playbackRate
                : Number.POSITIVE_INFINITY;
            // Also require the resulting duration to stay >= minDuration so a
            // rightward snap (delta < 0) can't collapse the clip to zero/negative.
            const snappedDuration = Math.round((nextResize.duration + delta) * 1000) / 1000;
            if (
              snapped !== nextResize.start &&
              snapped >= 0 &&
              delta <= maxLeftDelta + 1e-6 &&
              snappedDuration >= 0.05
            ) {
              nextResize = {
                ...nextResize,
                start: snapped,
                duration: snappedDuration,
                playbackStart:
                  nextResize.playbackStart != null
                    ? Math.round(
                        Math.max(0, nextResize.playbackStart - delta * playbackRate) * 1000,
                      ) / 1000
                    : undefined,
              };
            }
          }
        }

        setResizingClip((prev) =>
          prev
            ? {
                ...prev,
                started: true,
                previewStart: nextResize.start,
                previewDuration: nextResize.duration,
                previewPlaybackStart: nextResize.playbackStart,
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

    const handleWindowPointerUp = () => {
      stopClipDragAutoScrollRef.current();

      const resize = resizingClipRef.current;
      if (resize) {
        resizingClipRef.current = null;
        setResizingClip(null);
        if (!resize.started) return;

        suppressClickRef.current = true;
        clearSuppressedClick();

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

      // Commit the drag — insert (new track), main-track ripple (reflow contiguous),
      // or a plain single-clip move. See timelineClipDragCommit.
      commitDraggedClipMove(drag, {
        elements: elementsRef.current,
        trackOrder: trackOrderRef.current,
        updateElement,
        onMoveElement: onMoveElementRef.current,
        onMoveElements: onMoveElementsRef.current,
      });
    };

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerUp);
    return () => {
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
