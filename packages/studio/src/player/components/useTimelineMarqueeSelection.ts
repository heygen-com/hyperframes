import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { usePlayerStore } from "../store/playerStore";
import {
  resolveTimelineAutoScroll,
  selectTimelineElementsInMarquee,
  type TimelineMarqueeSelectionRect,
} from "./timelineEditing";
import { GUTTER, RULER_H, TRACK_H } from "./timelineLayout";
import { TIMELINE_LAYER_GROUP_HEADER_H } from "./TimelineLayerGroupHeader";
import type { StackingTimelineLayer, TimelineLayerId } from "./timelineTrackOrder";

const MARQUEE_THRESHOLD_PX = 4;

export interface TimelineMarqueeOverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ActiveMarqueeGesture {
  pointerId: number;
  anchorClientX: number;
  anchorClientY: number;
  anchorX: number;
  anchorY: number;
  lastClientX: number;
  lastClientY: number;
  started: boolean;
}

interface UseTimelineMarqueeSelectionInput {
  scrollRef: RefObject<HTMLDivElement | null>;
  ppsRef: RefObject<number>;
  trackOrderRef: RefObject<TimelineLayerId[]>;
  timelineLayersRef: RefObject<StackingTimelineLayer[]>;
  disabled?: boolean;
  setShowPopover: (show: boolean) => void;
  setRangeSelectionRef: RefObject<((sel: null) => void) | null>;
  /** Canonical playhead seek, used to keep empty-lane clicks scrubbing the playhead. */
  seekFromX: (clientX: number) => void;
}

function getCanvasPoint(scroll: HTMLDivElement, clientX: number, clientY: number) {
  const rect = scroll.getBoundingClientRect();
  return {
    x: clientX - rect.left + scroll.scrollLeft,
    y: clientY - rect.top + scroll.scrollTop,
  };
}

function getMarqueeStartPoint(
  event: ReactPointerEvent<HTMLDivElement>,
  scroll: HTMLDivElement | null,
  disabled: boolean,
) {
  if (disabled || event.button !== 0 || event.shiftKey || !scroll) return null;
  const target = event.target as HTMLElement;
  if (target.closest("[data-clip]")) return null;
  const point = getCanvasPoint(scroll, event.clientX, event.clientY);
  if (point.x < GUTTER || point.y < RULER_H) return null;
  return point;
}

function capturePointerIfAvailable(event: ReactPointerEvent<HTMLDivElement>) {
  const currentTarget = event.currentTarget as HTMLElement;
  if (typeof currentTarget.setPointerCapture === "function") {
    currentTarget.setPointerCapture(event.pointerId);
  }
}

function buildSelectionRect(
  active: ActiveMarqueeGesture,
  scroll: HTMLDivElement,
  pps: number,
): { overlay: TimelineMarqueeOverlayRect; selection: TimelineMarqueeSelectionRect } {
  const current = getCanvasPoint(scroll, active.lastClientX, active.lastClientY);
  const left = Math.min(active.anchorX, current.x);
  const right = Math.max(active.anchorX, current.x);
  const top = Math.min(active.anchorY, current.y);
  const bottom = Math.max(active.anchorY, current.y);
  const overlayLeft = Math.max(GUTTER, left);
  const overlayTop = Math.max(RULER_H, top);
  const overlayRight = Math.max(overlayLeft, right);
  const overlayBottom = Math.max(overlayTop, bottom);

  // Hit-test must use the SAME pixels-per-second the overlay is drawn at, or the
  // selected time span diverges from the visible box at low zoom (pps < 1). Guard
  // only against a non-finite/zero pps (would yield NaN/Infinity), never floor it.
  const safePps = Number.isFinite(pps) && pps > 0 ? pps : 0;
  const timeFromX = (x: number) => (safePps > 0 ? Math.max(0, (x - GUTTER) / safePps) : 0);

  return {
    overlay: {
      left: overlayLeft,
      top: overlayTop,
      width: overlayRight - overlayLeft,
      height: overlayBottom - overlayTop,
    },
    selection: {
      startTime: timeFromX(left),
      endTime: timeFromX(right),
      top,
      bottom,
    },
  };
}

export function useTimelineMarqueeSelection({
  scrollRef,
  ppsRef,
  trackOrderRef,
  timelineLayersRef,
  disabled = false,
  setShowPopover,
  setRangeSelectionRef,
  seekFromX,
}: UseTimelineMarqueeSelectionInput) {
  const activeRef = useRef<ActiveMarqueeGesture | null>(null);
  const pointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const scrollRafRef = useRef(0);
  const [marqueeRect, setMarqueeRect] = useState<TimelineMarqueeOverlayRect | null>(null);

  const stopAutoScroll = useCallback(() => {
    pointerRef.current = null;
    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = 0;
    }
  }, []);

  const updateMarqueeRect = useCallback(() => {
    const active = activeRef.current;
    const scroll = scrollRef.current;
    if (!active || !scroll) return null;
    const rects = buildSelectionRect(active, scroll, ppsRef.current);
    setMarqueeRect(rects.overlay);
    return rects;
  }, [ppsRef, scrollRef]);

  const stepAutoScroll = useCallback(() => {
    scrollRafRef.current = 0;
    const pointer = pointerRef.current;
    const scroll = scrollRef.current;
    if (!pointer || !scroll || !activeRef.current) return;

    const delta = resolveTimelineAutoScroll(
      scroll.getBoundingClientRect(),
      pointer.clientX,
      pointer.clientY,
    );
    if (delta.x === 0 && delta.y === 0) return;

    const maxScrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    const maxScrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, scroll.scrollLeft + delta.x));
    const nextScrollTop = Math.max(0, Math.min(maxScrollTop, scroll.scrollTop + delta.y));
    if (nextScrollLeft === scroll.scrollLeft && nextScrollTop === scroll.scrollTop) return;

    scroll.scrollLeft = nextScrollLeft;
    scroll.scrollTop = nextScrollTop;
    updateMarqueeRect();
    scrollRafRef.current = requestAnimationFrame(stepAutoScroll);
  }, [scrollRef, updateMarqueeRect]);

  const syncAutoScroll = useCallback(
    (clientX: number, clientY: number) => {
      pointerRef.current = { clientX, clientY };
      const scroll = scrollRef.current;
      if (!scroll) return;
      const delta = resolveTimelineAutoScroll(scroll.getBoundingClientRect(), clientX, clientY);
      if (delta.x === 0 && delta.y === 0) {
        if (scrollRafRef.current) {
          cancelAnimationFrame(scrollRafRef.current);
          scrollRafRef.current = 0;
        }
        return;
      }
      if (!scrollRafRef.current) {
        scrollRafRef.current = requestAnimationFrame(stepAutoScroll);
      }
    },
    [scrollRef, stepAutoScroll],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const point = getMarqueeStartPoint(event, scrollRef.current, disabled);
      if (!point) return false;
      capturePointerIfAvailable(event);
      activeRef.current = {
        pointerId: event.pointerId,
        anchorClientX: event.clientX,
        anchorClientY: event.clientY,
        anchorX: point.x,
        anchorY: point.y,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        started: false,
      };
      setShowPopover(false);
      setRangeSelectionRef.current?.(null);
      return true;
    },
    [disabled, scrollRef, setRangeSelectionRef, setShowPopover],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const active = activeRef.current;
      if (!active || active.pointerId !== event.pointerId) return false;
      active.lastClientX = event.clientX;
      active.lastClientY = event.clientY;
      const distance = Math.hypot(
        event.clientX - active.anchorClientX,
        event.clientY - active.anchorClientY,
      );
      if (!active.started && distance < MARQUEE_THRESHOLD_PX) return true;
      active.started = true;
      updateMarqueeRect();
      syncAutoScroll(event.clientX, event.clientY);
      return true;
    },
    [syncAutoScroll, updateMarqueeRect],
  );

  const handlePointerUp = useCallback(
    (event?: ReactPointerEvent<HTMLDivElement>) => {
      const active = activeRef.current;
      if (!active || (event && active.pointerId !== event.pointerId)) return false;
      activeRef.current = null;
      stopAutoScroll();
      setMarqueeRect(null);

      if (!active.started) {
        // A press that never crossed the marquee threshold is a plain empty-lane
        // click: clear the selection AND scrub the playhead, matching the seek that
        // the range/playhead handler would have run had the marquee not claimed it.
        usePlayerStore.getState().clearSelection();
        seekFromX(active.anchorClientX);
        return true;
      }

      const scroll = scrollRef.current;
      if (!scroll) return true;
      const rects = buildSelectionRect(active, scroll, ppsRef.current);
      const selectedIds = selectTimelineElementsInMarquee({
        rect: rects.selection,
        layers: timelineLayersRef.current,
        layerOrder: trackOrderRef.current,
        rulerHeight: RULER_H,
        trackHeight: TRACK_H,
        groupHeaderHeight: TIMELINE_LAYER_GROUP_HEADER_H,
      });
      usePlayerStore.getState().setSelection(selectedIds);
      return true;
    },
    [ppsRef, scrollRef, seekFromX, stopAutoScroll, timelineLayersRef, trackOrderRef],
  );

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  return {
    marqueeRect,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
}
