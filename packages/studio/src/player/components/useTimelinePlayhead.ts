import { useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { liveTime, usePlayerStore, type ZoomMode } from "../store/playerStore";
import { useMountEffect } from "../../hooks/useMountEffect";
import { getPinchTimelineZoomPercent } from "./timelineZoom";
import {
  getTimelinePlaybackFollowScrollLeft,
  getTimelineScrubTime,
  getTimelineScrollLeftForZoomTransition,
  getTimelineScrollLeftForZoomAnchor,
  shouldAutoScrollTimeline,
} from "./timelineLayout";
import { getTimelinePlayheadTransform } from "./timelinePlayheadTransform";
import { applyTimelineHorizontalAutoScrollStep } from "./timelineEditing";

/** The scroll that brings an off-screen playhead into view; `from` when it is already visible. */
function revealPlayheadScrollLeft(
  scroll: HTMLDivElement,
  playheadX: number,
  contentOrigin: number,
  from = scroll.scrollLeft,
): number {
  if (playheadX >= from + contentOrigin && playheadX <= from + scroll.clientWidth) return from;
  return getTimelinePlaybackFollowScrollLeft({
    playheadX,
    currentScrollLeft: from,
    viewportWidth: scroll.clientWidth,
    contentOrigin,
    maxScrollLeft: scroll.scrollWidth - scroll.clientWidth,
  });
}

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
  contentOrigin: number;
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
  contentOrigin,
}: UseTimelinePlayheadInput) {
  const dragScrollRaf = useRef(0);
  const previousZoomModeRef = useRef<ZoomMode | null>(zoomMode);
  // A toolbar / slider zoom keeps the playhead where it is on screen; a resize keeps the
  // viewport centre, or 00:00 when the view is at the start. The pinch handler anchors at
  // the cursor instead, so it opts out via `skipCenterAnchorRef`.
  const previousAnchorPpsRef = useRef(pps);
  const previousAnchorPercentRef = useRef(manualZoomPercentRef.current);
  const lastLiveTimeRef = useRef(usePlayerStore.getState().currentTime);
  const skipCenterAnchorRef = useRef(false);
  const contentOriginRef = useRef(contentOrigin);
  contentOriginRef.current = contentOrigin;

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const prevPps = previousAnchorPpsRef.current;
    previousAnchorPpsRef.current = pps;
    const prevPercent = previousAnchorPercentRef.current;
    previousAnchorPercentRef.current = manualZoomPercentRef.current;
    // Always consume the skip flag, even when pps didn't change — otherwise a
    // pinch that produced no pps change (already at the zoom clamp) would strand
    // it true and the next toolbar zoom would wrongly skip center-anchoring.
    const skip = skipCenterAnchorRef.current;
    skipCenterAnchorRef.current = false;
    if (!scroll || pps === prevPps || skip) return;
    const zoomed = manualZoomPercentRef.current !== prevPercent;
    if (!zoomed && scroll.scrollLeft < 1) return;
    const time = Math.max(0, lastLiveTimeRef.current);
    const playheadX = contentOrigin + time * prevPps;
    const onScreen = revealPlayheadScrollLeft(scroll, playheadX, contentOrigin) === scroll.scrollLeft;
    const nextScrollLeft = getTimelineScrollLeftForZoomAnchor({
      pointerX: zoomed && onScreen ? playheadX - scroll.scrollLeft : scroll.clientWidth / 2,
      currentScrollLeft: scroll.scrollLeft,
      contentOrigin,
      currentPixelsPerSecond: prevPps,
      nextPixelsPerSecond: pps,
      duration: durationRef.current,
    });
    const maxScrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    const anchored = Math.max(0, Math.min(maxScrollLeft, nextScrollLeft));
    scroll.scrollLeft = zoomed
      ? revealPlayheadScrollLeft(scroll, contentOrigin + time * pps, contentOrigin, anchored)
      : anchored;
  }, [pps, scrollRef, durationRef, contentOrigin, manualZoomPercentRef]);

  const syncPlayheadPosition = useCallback(
    (time: number) => {
      if (!playheadRef.current || durationRef.current <= 0) return;
      playheadRef.current.style.transform = getTimelinePlayheadTransform(
        time,
        ppsRef.current,
        contentOrigin,
        !usePlayerStore.getState().isPlaying,
      );
    },
    [playheadRef, durationRef, ppsRef, contentOrigin],
  );

  useEffect(() => {
    syncPlayheadPosition(currentTime);
  }, [currentTime, pps, syncPlayheadPosition, timelineReady, elementsLength]);

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
    const place = (t: number, atRest: boolean) => {
      if (!playheadRef.current || durationRef.current <= 0) return false;
      playheadRef.current.style.transform = getTimelinePlayheadTransform(
        t,
        ppsRef.current,
        contentOriginRef.current,
        atRest,
      );
      return true;
    };
    const unsubPlaying = usePlayerStore.subscribe((state, prev) => {
      if (prev.isPlaying && !state.isPlaying) place(lastLiveTimeRef.current, true);
    });
    const unsub = liveTime.subscribe((t) => {
      const moved = t !== lastLiveTimeRef.current;
      lastLiveTimeRef.current = t;
      const playing = usePlayerStore.getState().isPlaying;
      if (!place(t, !playing)) return;
      const playheadX = contentOriginRef.current + Math.max(0, t) * ppsRef.current;
      const scroll = scrollRef.current;
      // Paused, only a new playhead time scrolls, so a person's own scroll stays where they put it.
      if (!scroll || isDragging.current || zoomModeRef.current === "fit" || (!playing && !moved)) {
        return;
      }
      const nextScrollLeft = playing
        ? getTimelinePlaybackFollowScrollLeft({
            playheadX,
            currentScrollLeft: scroll.scrollLeft,
            viewportWidth: scroll.clientWidth,
            contentOrigin: contentOriginRef.current,
            maxScrollLeft: scroll.scrollWidth - scroll.clientWidth,
          })
        : revealPlayheadScrollLeft(scroll, playheadX, contentOriginRef.current);
      if (Math.abs(nextScrollLeft - scroll.scrollLeft) >= 0.5) {
        scroll.scrollLeft = nextScrollLeft;
      }
    });
    return () => {
      unsub();
      unsubPlaying();
    };
  });

  const seekFromX = useCallback(
    (clientX: number) => {
      const el = scrollRef.current;
      if (!el || effectiveDuration <= 0) return;
      const rect = el.getBoundingClientRect();
      const time = getTimelineScrubTime({
        clientX,
        viewportLeft: rect.left,
        scrollLeft: el.scrollLeft,
        contentOrigin,
        pixelsPerSecond: pps,
        duration: effectiveDuration,
      });
      liveTime.notify(time);
      onSeek?.(time);
    },
    [scrollRef, effectiveDuration, pps, onSeek, contentOrigin],
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
      if (applyTimelineHorizontalAutoScrollStep(el, clientX)) {
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
        fitPpsRef.current,
      );
      if (nextZoomPercent === manualZoomPercentRef.current && zoomModeRef.current === "manual")
        return;
      const nextPps = fitPpsRef.current * (nextZoomPercent / 100);
      const nextScrollLeft = getTimelineScrollLeftForZoomAnchor({
        pointerX: e.clientX - rect.left,
        currentScrollLeft: scroll.scrollLeft,
        contentOrigin,
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
      contentOrigin,
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
