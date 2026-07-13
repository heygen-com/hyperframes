import { useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { liveTime, type ZoomMode } from "../store/playerStore";
import { useMountEffect } from "../../hooks/useMountEffect";
import { getPinchTimelineZoomPercent } from "./timelineZoom";
import {
  GUTTER,
  getTimelinePlayheadLeft,
  getTimelineScrollLeftForZoomTransition,
  getTimelineScrollLeftForZoomAnchor,
  shouldAutoScrollTimeline,
} from "./timelineLayout";

interface UseTimelinePlayheadInput {
  playheadRef: React.RefObject<HTMLDivElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  ppsRef: React.RefObject<number>;
  durationRef: React.RefObject<number>;
  isDragging: React.RefObject<boolean>;
  currentTime: number;
  zoomMode: ZoomMode;
  manualZoomPercent: number;
  zoomModeRef: React.RefObject<ZoomMode>;
  manualZoomPercentRef: React.RefObject<number>;
  fitPps: number;
  fitPpsRef: React.RefObject<number>;
  effectiveDuration: number;
  pps: number;
  timelineReady: boolean;
  elementsLength: number;
  setZoomMode: (mode: ZoomMode) => void;
  setManualZoomPercent: (percent: number) => void;
  onSeek?: (time: number) => void;
}

export function useTimelinePlayhead({
  playheadRef,
  scrollRef,
  ppsRef,
  durationRef,
  isDragging,
  currentTime,
  zoomMode,
  zoomModeRef,
  manualZoomPercentRef,
  fitPps: _fitPps,
  fitPpsRef,
  effectiveDuration,
  pps,
  timelineReady,
  elementsLength,
  setZoomMode,
  setManualZoomPercent,
  onSeek,
}: UseTimelinePlayheadInput) {
  const dragScrollRaf = useRef(0);
  const previousZoomModeRef = useRef<ZoomMode | null>(zoomMode);
  // Center-anchored magnify: keep the time at the viewport center fixed when
  // the zoom level (pps) changes via the toolbar / slider. The pinch handler
  // anchors at the cursor instead, so it opts out via `skipCenterAnchorRef`.
  const previousAnchorPpsRef = useRef(pps);
  const skipCenterAnchorRef = useRef(false);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const prevPps = previousAnchorPpsRef.current;
    previousAnchorPpsRef.current = pps;
    // Always consume the skip flag, even when pps didn't change — otherwise a
    // pinch that produced no pps change (already at the zoom clamp) would strand
    // it true and the next toolbar zoom would wrongly skip center-anchoring.
    const skip = skipCenterAnchorRef.current;
    skipCenterAnchorRef.current = false;
    if (!scroll || pps === prevPps || skip) return;
    const nextScrollLeft = getTimelineScrollLeftForZoomAnchor({
      pointerX: scroll.clientWidth / 2,
      currentScrollLeft: scroll.scrollLeft,
      gutter: GUTTER,
      currentPixelsPerSecond: prevPps,
      nextPixelsPerSecond: pps,
      duration: durationRef.current,
    });
    const maxScrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    scroll.scrollLeft = Math.max(0, Math.min(maxScrollLeft, nextScrollLeft));
  }, [pps, scrollRef, durationRef]);

  const syncPlayheadPosition = useCallback(
    (time: number) => {
      if (!playheadRef.current || durationRef.current <= 0) return;
      playheadRef.current.style.left = `${getTimelinePlayheadLeft(time, ppsRef.current)}px`;
    },
    [playheadRef, durationRef, ppsRef],
  );

  useEffect(() => {
    syncPlayheadPosition(currentTime);
  }, [currentTime, pps, syncPlayheadPosition]);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || zoomMode !== "fit") return;
    scroll.scrollLeft = 0;
  }, [zoomMode, pps, scrollRef]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) {
      previousZoomModeRef.current = zoomMode;
      return;
    }
    scroll.scrollLeft = getTimelineScrollLeftForZoomTransition(
      previousZoomModeRef.current,
      zoomMode,
      scroll.scrollLeft,
    );
    previousZoomModeRef.current = zoomMode;
  }, [zoomMode, scrollRef]);

  useMountEffect(() => {
    const unsub = liveTime.subscribe((t) => {
      if (!playheadRef.current || durationRef.current <= 0) return;
      // Playback deliberately does NOT scroll the viewport to chase the playhead —
      // the user's scroll position is theirs; the playhead may run off-screen.
      playheadRef.current.style.left = `${getTimelinePlayheadLeft(t, ppsRef.current)}px`;
    });
    return unsub;
  });

  const seekFromX = useCallback(
    (clientX: number) => {
      const el = scrollRef.current;
      if (!el || effectiveDuration <= 0) return;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left + el.scrollLeft - GUTTER;
      if (x < 0) return;
      const time = Math.max(0, Math.min(effectiveDuration, x / pps));
      liveTime.notify(time);
      onSeek?.(time);
    },
    [scrollRef, effectiveDuration, pps, onSeek],
  );

  const autoScrollDuringDrag = useCallback(
    (clientX: number) => {
      cancelAnimationFrame(dragScrollRaf.current);
      const el = scrollRef.current;
      if (
        !el ||
        !isDragging.current ||
        !shouldAutoScrollTimeline(zoomModeRef.current, el.scrollWidth, el.clientWidth)
      )
        return;
      const rect = el.getBoundingClientRect();
      const edgeZone = 40;
      const maxSpeed = 12;
      let scrollDelta = 0;
      if (clientX < rect.left + edgeZone)
        scrollDelta = -maxSpeed * Math.max(0, 1 - (clientX - rect.left) / edgeZone);
      else if (clientX > rect.right - edgeZone)
        scrollDelta = maxSpeed * Math.max(0, 1 - (rect.right - clientX) / edgeZone);
      if (scrollDelta !== 0) {
        el.scrollLeft += scrollDelta;
        seekFromX(clientX);
        dragScrollRaf.current = requestAnimationFrame(() => autoScrollDuringDrag(clientX));
      }
    },
    [scrollRef, isDragging, zoomModeRef, seekFromX],
  );

  const handlePinchWheel = useCallback(
    (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      const scroll = scrollRef.current;
      if (!scroll || durationRef.current <= 0 || fitPpsRef.current <= 0 || ppsRef.current <= 0)
        return;
      e.preventDefault();
      e.stopPropagation();
      const rect = scroll.getBoundingClientRect();
      const nextZoomPercent = getPinchTimelineZoomPercent(
        e.deltaY,
        zoomModeRef.current,
        manualZoomPercentRef.current,
      );
      if (nextZoomPercent === manualZoomPercentRef.current && zoomModeRef.current === "manual")
        return;
      const nextPps = fitPpsRef.current * (nextZoomPercent / 100);
      const nextScrollLeft = getTimelineScrollLeftForZoomAnchor({
        pointerX: e.clientX - rect.left,
        currentScrollLeft: scroll.scrollLeft,
        gutter: GUTTER,
        currentPixelsPerSecond: ppsRef.current,
        nextPixelsPerSecond: nextPps,
        duration: durationRef.current,
      });
      // Pinch anchors at the cursor (below), so skip the center-anchor effect.
      skipCenterAnchorRef.current = true;
      setZoomMode("manual");
      setManualZoomPercent(nextZoomPercent);
      requestAnimationFrame(() => {
        const maxScrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
        scroll.scrollLeft = Math.min(maxScrollLeft, nextScrollLeft);
      });
    },
    [
      scrollRef,
      durationRef,
      fitPpsRef,
      ppsRef,
      zoomModeRef,
      manualZoomPercentRef,
      setManualZoomPercent,
      setZoomMode,
    ],
  );

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    scroll.addEventListener("wheel", handlePinchWheel, { passive: false, capture: true });
    return () => {
      scroll.removeEventListener("wheel", handlePinchWheel, { capture: true });
    };
  }, [handlePinchWheel, scrollRef, timelineReady, elementsLength]);

  return { seekFromX, autoScrollDuringDrag, dragScrollRaf };
}
