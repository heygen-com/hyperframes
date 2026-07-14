import { useRef, useMemo, useCallback, useState, useEffect, memo } from "react";
import { useMusicBeatAnalysis } from "../../hooks/useMusicBeatAnalysis";
import { isMusicTrack } from "../../utils/timelineInspector";
import { remapBeatAnalysisToComposition } from "../../utils/beatEditActions";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { useExpandedTimelineElements } from "../hooks/useExpandedTimelineElements";
import { useMountEffect } from "../../hooks/useMountEffect";
import { defaultTimelineTheme } from "./timelineTheme";
import { useTimelineRangeSelection } from "./useTimelineRangeSelection";
import { useTimelinePlayhead } from "./useTimelinePlayhead";
import { useTimelineActiveClips } from "./useTimelineActiveClips";
import { type TrackVisualStyle, getTrackStyle } from "./timelineIcons";
import { useTimelineZoom } from "./useTimelineZoom";
import { useTimelineAssetDrop } from "./timelineDragDrop";
import { TimelineEmptyState } from "./TimelineEmptyState";
import { TimelineCanvas } from "./TimelineCanvas";
import { type KeyframeDiamondContextMenuState } from "./KeyframeDiamondContextMenu";
import { useTimelineClipDrag } from "./useTimelineClipDrag";
import { TimelineOverlays } from "./TimelineOverlays";
import { useTimelineEditPinning } from "./useTimelineEditPinning";
import { useTimelineStackingSync } from "./useTimelineStackingSync";
import { useTimelineGeometry } from "./useTimelineGeometry";
import {
  GUTTER,
  generateTicks,
  getTimelineCanvasHeight,
  shouldShowTimelineShortcutHint,
} from "./timelineLayout";
import { STUDIO_PREVIEW_FPS } from "../lib/time";
import { useResolvedTimelineEditCallbacks } from "./useResolvedTimelineEditCallbacks";
import type { TimelineProps } from "./TimelineTypes";

// Re-export pure utilities so existing imports from "./Timeline" still resolve.
export {
  generateTicks,
  formatTimelineTickLabel,
  shouldAutoScrollTimeline,
  getTimelineScrollLeftForZoomTransition,
  getTimelineScrollLeftForZoomAnchor,
  getTimelinePlayheadLeft,
  getTimelineCanvasHeight,
  shouldShowTimelineShortcutHint,
  resolveTimelineAssetDrop,
  shouldHandleTimelineDeleteKey,
  getDefaultDroppedTrack,
} from "./timelineLayout";

export const Timeline = memo(function Timeline({
  onSeek,
  onDrillDown,
  renderClipContent,
  renderClipOverlay,
  onFileDrop,
  onAssetDrop,
  onBlockDrop,
  onDeleteElement: _onDeleteElement,
  onMoveElement: onMoveElementOverride,
  onMoveElements: onMoveElementsOverride,
  onResizeElement: onResizeElementOverride,
  onResizeElements: onResizeElementsOverride,
  onBlockedEditAttempt: onBlockedEditAttemptOverride,
  onSplitElement: onSplitElementOverride,
  onSelectElement,
  theme: themeOverrides,
}: TimelineProps = {}) {
  const {
    onMoveElement,
    onMoveElements,
    onResizeElement,
    onResizeElements,
    onBlockedEditAttempt,
    onSplitElement,
    onRazorSplitAll,
    onDeleteKeyframe,
    onDeleteAllKeyframes,
    onChangeKeyframeEase,
    onMoveKeyframeToPlayhead,
    onMoveKeyframe,
  } = useResolvedTimelineEditCallbacks({
    onMoveElement: onMoveElementOverride,
    onMoveElements: onMoveElementsOverride,
    onResizeElement: onResizeElementOverride,
    onResizeElements: onResizeElementsOverride,
    onBlockedEditAttempt: onBlockedEditAttemptOverride,
    onSplitElement: onSplitElementOverride,
  });
  const theme = useMemo(() => ({ ...defaultTimelineTheme, ...themeOverrides }), [themeOverrides]);
  useMusicBeatAnalysis();
  const rawElements = usePlayerStore((s) => s.elements);
  const expandedElements = useExpandedTimelineElements();
  const beatAnalysis = usePlayerStore((s) => s.beatAnalysis);
  const musicElement = usePlayerStore((s) => s.elements.find(isMusicTrack) ?? null);
  const beatEdits = usePlayerStore((s) => s.beatEdits);
  const adjustedBeatAnalysis = useMemo(
    () => remapBeatAnalysisToComposition(beatAnalysis, musicElement, beatEdits),
    [beatAnalysis, musicElement, beatEdits],
  );
  const duration = usePlayerStore((s) => s.duration);
  const timeDisplayMode = usePlayerStore((s) => s.timeDisplayMode);
  const timelineReady = usePlayerStore((s) => s.timelineReady);
  const selectedElementId = usePlayerStore((s) => s.selectedElementId);
  const selectedElementIds = usePlayerStore((s) => s.selectedElementIds);
  const setSelectedElementId = usePlayerStore((s) => s.setSelectedElementId);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const { zoomMode, manualZoomPercent, setZoomMode, setManualZoomPercent } = useTimelineZoom();

  const playheadRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeTool = usePlayerStore((s) => s.activeTool);
  const [hoveredClip, setHoveredClip] = useState<string | null>(null);
  const isDragging = useRef(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [razorGuideX, setRazorGuideX] = useState<number | null>(null);

  useMountEffect(() => {
    const down = (e: KeyboardEvent) => e.key === "Shift" && setShiftHeld(true);
    const up = (e: KeyboardEvent) => e.key === "Shift" && setShiftHeld(false);
    const blur = () => setShiftHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  });

  const [showPopover, setShowPopover] = useState(false);
  const [showShortcutHint, setShowShortcutHint] = useState(true);
  const [kfContextMenu, setKfContextMenu] = useState<KeyframeDiamondContextMenuState | null>(null);
  const [clipContextMenu, setClipContextMenu] = useState<{
    x: number;
    y: number;
    element: TimelineElement;
  } | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const shortcutHintRafRef = useRef(0);

  const syncShortcutHintVisibility = useCallback(() => {
    const scroll = scrollRef.current;
    setShowShortcutHint(
      scroll ? shouldShowTimelineShortcutHint(scroll.scrollHeight, scroll.clientHeight) : true,
    );
  }, []);

  const scheduleShortcutHintVisibilitySync = useCallback(() => {
    if (shortcutHintRafRef.current) cancelAnimationFrame(shortcutHintRafRef.current);
    shortcutHintRafRef.current = requestAnimationFrame(() => {
      shortcutHintRafRef.current = 0;
      syncShortcutHintVisibility();
    });
  }, [syncShortcutHintVisibility]);

  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
  }, []);

  // Last horizontal scroll offset, RESTORED across the post-edit iframe reload (which clamps into
  // a scroll jump); with the pinned zoom this keeps the user parked at the same spot after edits.
  const lastScrollLeftRef = useRef(0);
  const setScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (roRef.current) {
        roRef.current.disconnect();
        roRef.current = null;
      }
      scrollRef.current = el;
      if (!el) return;

      const syncScrollViewport = () => {
        setViewportWidth(el.clientWidth);
        scheduleShortcutHintVisibilitySync();
      };

      syncScrollViewport();
      roRef.current = new ResizeObserver(syncScrollViewport);
      roRef.current.observe(el);
    },
    [scheduleShortcutHintVisibilitySync],
  );

  useMountEffect(() => () => {
    roRef.current?.disconnect();
    if (shortcutHintRafRef.current) cancelAnimationFrame(shortcutHintRafRef.current);
  });

  const effectiveDuration = useMemo(() => {
    const safeDur = Number.isFinite(duration) ? duration : 0;
    if (rawElements.length === 0) return safeDur;
    const maxEnd = Math.max(...rawElements.map((el) => el.start + el.duration));
    const result = Math.max(safeDur, maxEnd);
    return Number.isFinite(result) ? result : safeDur;
  }, [rawElements, duration]);

  const tracks = useMemo(() => {
    const map = new Map<number, typeof expandedElements>();
    for (const el of expandedElements) {
      const list = map.get(el.track) ?? [];
      list.push(el);
      map.set(el.track, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [expandedElements]);

  const trackStyles = useMemo(() => {
    const map = new Map<number, TrackVisualStyle>();
    for (const [trackNum, els] of tracks) {
      map.set(trackNum, getTrackStyle(els[0]?.tag ?? ""));
    }
    return map;
  }, [tracks]);

  const trackOrder = useMemo(() => tracks.map(([trackNum]) => trackNum), [tracks]);
  const trackOrderRef = useRef(trackOrder);
  trackOrderRef.current = trackOrder;
  const expandedElementsRef = useRef(expandedElements);
  expandedElementsRef.current = expandedElements;

  const ppsRef = useRef(100);
  const durationRef = useRef(effectiveDuration);
  durationRef.current = effectiveDuration;
  // Declared here (used before the fitPps derivation below) so the edit-pin
  // wrappers can close over it; `fitPpsRef.current` is refreshed each render.
  const fitPpsRef = useRef(100);

  const {
    pinZoomBeforeEdit,
    setRangeSelectionRef,
    pinnedOnMoveElement,
    pinnedOnMoveElements,
    pinnedOnResizeElement,
    pinnedOnResizeElements,
    pinnedOnFileDrop,
    pinnedOnAssetDrop,
    pinnedOnBlockDrop,
  } = useTimelineEditPinning({
    ppsRef,
    fitPpsRef,
    onMoveElement,
    onMoveElements,
    onResizeElement,
    onResizeElements,
    onFileDrop,
    onAssetDrop,
    onBlockDrop,
  });

  const { readClipZIndex, applyStackingPatches, zSyncEnabled } = useTimelineStackingSync({
    expandedElementsRef,
  });

  const {
    draggedClip,
    setDraggedClip,
    resizingClip,
    setResizingClip,
    blockedClipRef,
    suppressClickRef,
    syncClipDragAutoScroll,
  } = useTimelineClipDrag({
    scrollRef,
    ppsRef,
    durationRef,
    trackOrderRef,
    onMoveElement: pinnedOnMoveElement,
    onMoveElements: pinnedOnMoveElements,
    onResizeElement: pinnedOnResizeElement,
    onResizeElements: pinnedOnResizeElements,
    onBlockedEditAttempt,
    setShowPopover,
    setRangeSelectionRef,
    readZIndex: zSyncEnabled ? readClipZIndex : undefined,
    onStackingPatches: zSyncEnabled ? applyStackingPatches : undefined,
  });

  const { isDragOver, handleAssetDragOver, handleAssetDrop, clearDropPreview } =
    useTimelineAssetDrop({
      scrollRef,
      ppsRef,
      durationRef,
      trackOrderRef,
      onFileDrop: pinnedOnFileDrop,
      onAssetDrop: pinnedOnAssetDrop,
      onBlockDrop: pinnedOnBlockDrop,
    });

  const displayTrackOrder = useMemo(() => {
    if (!draggedClip?.started || trackOrder.includes(draggedClip.previewTrack)) return trackOrder;
    return [...trackOrder, draggedClip.previewTrack].sort((a, b) => a - b);
  }, [draggedClip, trackOrder]);

  const totalH = getTimelineCanvasHeight(displayTrackOrder.length);
  const keyframeCache = usePlayerStore((s) => s.keyframeCache);
  const selectedKeyframes = usePlayerStore((s) => s.selectedKeyframes);
  const toggleSelectedKeyframe = usePlayerStore((s) => s.toggleSelectedKeyframe);

  const selectedElement = useMemo(
    () =>
      expandedElements.find((element) => (element.key ?? element.id) === selectedElementId) ?? null,
    [expandedElements, selectedElementId],
  );
  const selectedElementRef = useRef<TimelineElement | null>(selectedElement);
  selectedElementRef.current = selectedElement;

  const {
    pps,
    fitPps,
    displayContentWidth,
    displayDuration,
    clipStateVersion,
    zoomModeRef,
    manualZoomPercentRef,
  } = useTimelineGeometry({
    viewportWidth,
    effectiveDuration,
    zoomMode,
    manualZoomPercent,
    ppsRef,
    fitPpsRef,
    draggedClip,
    resizingClip,
    expandedElements,
    isDragging,
    scrollRef,
    lastScrollLeftRef,
  });

  const { seekFromX, autoScrollDuringDrag, dragScrollRaf } = useTimelinePlayhead({
    playheadRef,
    scrollRef,
    ppsRef,
    durationRef,
    isDragging,
    currentTime,
    zoomMode,
    manualZoomPercent,
    zoomModeRef,
    manualZoomPercentRef,
    fitPps,
    fitPpsRef,
    effectiveDuration,
    pps,
    timelineReady,
    elementsLength: expandedElements.length,
    setZoomMode,
    setManualZoomPercent,
    onSeek,
  });
  useTimelineActiveClips({
    scrollRef,
    currentTime,
    clipStateVersion,
  });

  const {
    rangeSelection,
    setRangeSelection,
    shiftClickClipRef,
    marqueeRect,
    isScrubbing,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  } = useTimelineRangeSelection({
    scrollRef,
    ppsRef,
    effectiveDuration,
    pps,
    onSeek,
    seekFromX,
    autoScrollDuringDrag,
    dragScrollRaf,
    isDragging,
    setShowPopover,
    elementsRef: expandedElementsRef,
    trackOrderRef,
    onSelectElement,
  });
  // Wire setRangeSelection into the stable ref consumed by useTimelineClipDrag
  setRangeSelectionRef.current = setRangeSelection;

  const prevSelectedRef = useRef(selectedElementRef.current);
  // eslint-disable-next-line no-restricted-syntax, react-hooks/exhaustive-deps
  useEffect(() => {
    const prev = prevSelectedRef.current;
    const curr = selectedElementRef.current;
    prevSelectedRef.current = curr;
    if (prev && !curr) {
      setShowPopover(false);
      setRangeSelection(null);
    }
  });

  // Frame display mode labels ruler ticks as frame numbers — pass the fps so ticks snap to frames.
  const tickFps = timeDisplayMode === "frame" ? STUDIO_PREVIEW_FPS : undefined;
  const { major, minor } = useMemo(
    () => generateTicks(displayDuration, pps, tickFps),
    [displayDuration, pps, tickFps],
  );
  const majorTickInterval = major.length >= 2 ? major[1] - major[0] : effectiveDuration;

  useEffect(() => {
    syncShortcutHintVisibility();
  }, [syncShortcutHintVisibility, timelineReady, expandedElements.length, totalH]);

  const getPreviewElement = useCallback(
    (element: TimelineElement): TimelineElement => {
      if (
        resizingClip &&
        (resizingClip.element.key ?? resizingClip.element.id) === (element.key ?? element.id)
      ) {
        return {
          ...element,
          start: resizingClip.previewStart,
          duration: resizingClip.previewDuration,
          playbackStart: resizingClip.previewPlaybackStart,
        };
      }
      return element;
    },
    [resizingClip],
  );

  if (!timelineReady || expandedElements.length === 0) {
    return (
      <TimelineEmptyState
        isDragOver={isDragOver}
        onFileDrop={!!onFileDrop}
        onDragOver={handleAssetDragOver}
        onDragLeave={() => clearDropPreview()}
        onDrop={handleAssetDrop}
      />
    );
  }

  return (
    <div
      ref={setContainerRef}
      aria-label="Timeline"
      className={`relative border-t select-none h-full overflow-hidden ${activeTool === "razor" ? "cursor-crosshair" : shiftHeld ? "cursor-crosshair" : "cursor-default"}`}
      onMouseMove={(e) => {
        if (activeTool === "razor" && scrollRef.current) {
          const rect = scrollRef.current.getBoundingClientRect();
          setRazorGuideX(e.clientX - rect.left + scrollRef.current.scrollLeft);
        }
      }}
      onMouseLeave={() => setRazorGuideX(null)}
      style={{
        touchAction: "pan-x pan-y",
        background: theme.shellBackground,
        borderColor: theme.shellBorder,
      }}
    >
      <div
        ref={setScrollRef}
        tabIndex={-1}
        className={`${zoomMode === "fit" ? "overflow-x-hidden" : "overflow-x-auto"} overflow-y-auto h-full outline-none`}
        onScroll={(e) => {
          // Remember the live offset so it can be restored across a post-edit reload.
          lastScrollLeftRef.current = e.currentTarget.scrollLeft;
        }}
        onDragOver={handleAssetDragOver}
        onDragLeave={() => clearDropPreview()}
        onDrop={handleAssetDrop}
        onPointerDown={(e) => {
          if (activeTool === "razor" && e.shiftKey && e.button === 0 && scrollRef.current) {
            const rect = scrollRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left + scrollRef.current.scrollLeft - GUTTER;
            const splitTime = Math.max(0, x / pps);
            onRazorSplitAll?.(splitTime);
            return;
          }
          handlePointerDown(e);
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onLostPointerCapture={handlePointerUp}
      >
        <TimelineCanvas
          major={major}
          minor={minor}
          pps={pps}
          trackContentWidth={displayContentWidth}
          totalH={totalH}
          effectiveDuration={effectiveDuration}
          majorTickInterval={majorTickInterval}
          rangeSelection={rangeSelection}
          marqueeRect={marqueeRect}
          theme={theme}
          displayTrackOrder={displayTrackOrder}
          trackOrder={trackOrder}
          tracks={tracks}
          trackStyles={trackStyles}
          selectedElementId={selectedElementId}
          selectedElementIds={selectedElementIds}
          hoveredClip={hoveredClip}
          draggedClip={draggedClip}
          resizingClip={resizingClip}
          isScrubbing={isScrubbing}
          blockedClipRef={blockedClipRef}
          suppressClickRef={suppressClickRef}
          scrollRef={scrollRef}
          renderClipContent={renderClipContent}
          renderClipOverlay={renderClipOverlay}
          playheadRef={playheadRef}
          onDrillDown={onDrillDown}
          onSelectElement={onSelectElement}
          setHoveredClip={setHoveredClip}
          setShowPopover={setShowPopover}
          setRangeSelection={setRangeSelection}
          setResizingClip={setResizingClip}
          setDraggedClip={setDraggedClip}
          setSelectedElementId={setSelectedElementId}
          syncClipDragAutoScroll={syncClipDragAutoScroll}
          shiftClickClipRef={shiftClickClipRef}
          getPreviewElement={getPreviewElement}
          getTrackStyle={getTrackStyle}
          keyframeCache={keyframeCache}
          selectedKeyframes={selectedKeyframes}
          currentTime={currentTime}
          beatAnalysis={adjustedBeatAnalysis}
          onClickKeyframe={(el, pct) => {
            usePlayerStore.getState().clearSelectedKeyframes();
            const elKey = el.key ?? el.id;
            setSelectedElementId(elKey);
            onSelectElement?.(el);
            // Select the clicked diamond (matches shift-click); cleared above so this single-selects.
            toggleSelectedKeyframe(`${elKey}:${pct}`);
            const absTime = el.start + (pct / 100) * el.duration;
            onSeek?.(absTime);
            const kfData = keyframeCache?.get(elKey);
            const kf = kfData?.keyframes.find((k) => Math.abs(k.percentage - pct) < 0.5);
            usePlayerStore.getState().setActiveKeyframePct(kf?.tweenPercentage ?? null);
          }}
          onShiftClickKeyframe={(elId, pct) => {
            toggleSelectedKeyframe(`${elId}:${pct}`);
          }}
          onMoveKeyframe={onMoveKeyframe}
          onContextMenuKeyframe={(e, elId, pct) => {
            const el = expandedElements.find((x) => (x.key ?? x.id) === elId);
            if (el) {
              setSelectedElementId(elId);
              onSelectElement?.(el);
            }
            const kfData = keyframeCache.get(elId);
            const kf = kfData?.keyframes.find((k) => Math.abs(k.percentage - pct) < 0.2);
            setKfContextMenu({
              x: e.clientX + 4,
              y: e.clientY + 2,
              elementId: elId,
              percentage: pct,
              tweenPercentage: kf?.tweenPercentage,
              currentEase: kf?.ease ?? kfData?.ease,
            });
          }}
          onContextMenuClip={(e, el) => {
            e.preventDefault();
            setSelectedElementId(el.key ?? el.id);
            onSelectElement?.(el);
            setClipContextMenu({ x: e.clientX, y: e.clientY, element: el });
          }}
        />
        {activeTool === "razor" && razorGuideX !== null && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none z-10"
            style={{
              left: razorGuideX,
              width: 1,
              background: "rgba(239,68,68,0.7)",
            }}
          />
        )}
      </div>
      <TimelineOverlays
        theme={theme}
        showShortcutHint={showShortcutHint}
        showPopover={showPopover}
        rangeSelection={rangeSelection}
        setShowPopover={setShowPopover}
        setRangeSelection={setRangeSelection}
        kfContextMenu={kfContextMenu}
        setKfContextMenu={setKfContextMenu}
        onDeleteKeyframe={onDeleteKeyframe}
        onDeleteAllKeyframes={onDeleteAllKeyframes}
        onChangeKeyframeEase={onChangeKeyframeEase}
        onMoveKeyframeToPlayhead={onMoveKeyframeToPlayhead}
        keyframeCache={keyframeCache}
        clipContextMenu={clipContextMenu}
        setClipContextMenu={setClipContextMenu}
        currentTime={currentTime}
        onSplitElement={onSplitElement}
        pinZoomBeforeEdit={pinZoomBeforeEdit}
        onDeleteElement={_onDeleteElement}
      />
    </div>
  );
});
