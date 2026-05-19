import { useRef, useState, useCallback } from "react";
import { buildClipRangeSelection, type TimelineRangeSelection } from "./timelineEditing";
import type { TimelineElement } from "../store/playerStore";
import { liveTime } from "../store/playerStore";
import { GUTTER } from "./timelineLayout";

interface UseTimelineRangeSelectionInput {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  ppsRef: React.RefObject<number>;
  effectiveDuration: number;
  pps: number;
  onSeek?: (time: number) => void;
  seekFromX: (clientX: number) => void;
  autoScrollDuringDrag: (clientX: number) => void;
  dragScrollRaf: React.RefObject<number>;
  isDragging: React.RefObject<boolean>;
  setShowPopover: (v: boolean) => void;
}

export function useTimelineRangeSelection({
  scrollRef,
  ppsRef: _ppsRef,
  effectiveDuration: _effectiveDuration,
  pps,
  onSeek: _onSeek,
  seekFromX,
  autoScrollDuringDrag,
  dragScrollRaf,
  isDragging,
  setShowPopover,
}: UseTimelineRangeSelectionInput) {
  const isRangeSelecting = useRef(false);
  const rangeAnchorTime = useRef(0);
  const [rangeSelection, setRangeSelection] = useState<TimelineRangeSelection | null>(null);
  const shiftClickClipRef = useRef<{
    element: TimelineElement;
    anchorX: number;
    anchorY: number;
  } | null>(null);

  const seekRafRef = useRef(0);
  const pendingClientXRef = useRef(0);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if (e.shiftKey) {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        isRangeSelecting.current = true;
        setShowPopover(false);
        const rect = scrollRef.current?.getBoundingClientRect();
        if (rect) {
          const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0) - GUTTER;
          const time = Math.max(0, x / pps);
          rangeAnchorTime.current = time;
          setRangeSelection({ start: time, end: time, anchorX: e.clientX, anchorY: e.clientY });
        }
        return;
      }
      shiftClickClipRef.current = null;
      if ((e.target as HTMLElement).closest("[data-clip]")) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      isDragging.current = true;
      setRangeSelection(null);
      setShowPopover(false);
      seekFromX(e.clientX);
    },
    [seekFromX, pps, scrollRef, isDragging, setShowPopover],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isRangeSelecting.current) {
        const rect = scrollRef.current?.getBoundingClientRect();
        if (rect) {
          const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0) - GUTTER;
          setRangeSelection((prev) =>
            prev
              ? { ...prev, end: Math.max(0, x / pps), anchorX: e.clientX, anchorY: e.clientY }
              : null,
          );
        }
        return;
      }
      if (!isDragging.current) return;
      pendingClientXRef.current = e.clientX;
      // Update the playhead visual immediately via liveTime for smooth feedback,
      // then RAF-throttle the full seek (adapter + React state sync).
      const el = scrollRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left + el.scrollLeft - GUTTER;
        if (x >= 0) {
          const dur = el.scrollWidth / pps;
          liveTime.notify(Math.max(0, Math.min(dur, x / pps)));
        }
      }
      if (!seekRafRef.current) {
        seekRafRef.current = requestAnimationFrame(() => {
          seekRafRef.current = 0;
          if (isDragging.current) {
            seekFromX(pendingClientXRef.current);
            autoScrollDuringDrag(pendingClientXRef.current);
          }
        });
      }
    },
    [seekFromX, autoScrollDuringDrag, pps, scrollRef, isDragging],
  );

  const handlePointerUp = useCallback(() => {
    if (isRangeSelecting.current) {
      isRangeSelecting.current = false;
      const pendingShiftClick = shiftClickClipRef.current;
      shiftClickClipRef.current = null;
      setRangeSelection((prev) => {
        if (prev && pendingShiftClick && Math.abs(prev.end - prev.start) <= 0.2) {
          setShowPopover(true);
          return buildClipRangeSelection(pendingShiftClick.element, pendingShiftClick);
        }
        if (prev && Math.abs(prev.end - prev.start) > 0.2) {
          setShowPopover(true);
          return prev;
        }
        return null;
      });
      return;
    }
    if (seekRafRef.current) {
      cancelAnimationFrame(seekRafRef.current);
      seekRafRef.current = 0;
    }
    seekFromX(pendingClientXRef.current);
    isDragging.current = false;
    cancelAnimationFrame(dragScrollRaf.current);
  }, [isDragging, dragScrollRaf, setShowPopover, seekFromX]);

  return {
    rangeSelection,
    setRangeSelection,
    shiftClickClipRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
}
