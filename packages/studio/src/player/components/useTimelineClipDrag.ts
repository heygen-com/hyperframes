import { useRef, useState, useCallback } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import {
  resolveTimelineMove,
  resolveTimelineResize,
  resolveTimelineAutoScroll,
  type BlockedTimelineEditIntent,
} from "./timelineEditing";
import { usePlayerStore } from "../store/playerStore";
import type { TimelineElement } from "../store/playerStore";
import { TRACK_H } from "./timelineLayout";

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
  onResizeElement,
  onBlockedEditAttempt,
  setShowPopover,
  setRangeSelectionRef,
}: UseTimelineClipDragInput) {
  const updateElement = usePlayerStore((s) => s.updateElement);

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
      return {
        ...drag,
        started: true,
        pointerClientX: clientX,
        pointerClientY: clientY,
        previewStart: nextMove.start,
        previewTrack: nextMove.track,
      };
    },
    [scrollRef, ppsRef, durationRef, trackOrderRef],
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
        const nextResize = resolveTimelineResize(
          {
            start: resize.element.start,
            duration: resize.element.duration,
            originClientX: resize.originClientX,
            pixelsPerSecond: ppsRef.current,
            minStart: 0,
            maxEnd: Math.min(durationRef.current, resize.element.start + sourceRemaining),
            playbackStart:
              resize.edge === "start" && canSeedPlaybackStart
                ? (resize.element.playbackStart ?? 0)
                : resize.element.playbackStart,
            playbackRate: resize.element.playbackRate,
          },
          resize.edge,
          e.clientX,
        );

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

      const hasChanged =
        drag.previewStart !== drag.element.start || drag.previewTrack !== drag.element.track;
      if (!hasChanged) return;

      updateElement(drag.element.key ?? drag.element.id, {
        start: drag.previewStart,
        track: drag.previewTrack,
      });

      Promise.resolve(
        onMoveElementRef.current?.(drag.element, {
          start: drag.previewStart,
          track: drag.previewTrack,
        }),
      ).catch((error) => {
        updateElement(drag.element.key ?? drag.element.id, {
          start: drag.element.start,
          track: drag.element.track,
        });
        console.error("[Timeline] Failed to persist clip move", error);
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
