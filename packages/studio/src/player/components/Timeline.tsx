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
import { getTrackStyle } from "./timelineIcons";
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
import { useTimelineTrackDerivations } from "./useTimelineTrackDerivations";
import { GUTTER, TRACKS_LEFT_PAD, generateTicks, getTimelineCanvasHeight } from "./timelineLayout";
import { useTimelineScrollViewport } from "./useTimelineScrollViewport";
import { STUDIO_PREVIEW_FPS } from "../lib/time";
import { useResolvedTimelineEditCallbacks } from "./useResolvedTimelineEditCallbacks";
import type { TimelineProps } from "./TimelineTypes";
import { useTrackGapMenu } from "./useTrackGapMenu";
import { useTimelineGapHighlights } from "./useTimelineGapHighlights";
import { useStudioPlaybackContextOptional } from "../../contexts/StudioContext";

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
  onCompositionDrop,
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
  const playbackContext = useStudioPlaybackContextOptional();
  const setRefreshKey = playbackContext?.setRefreshKey;
  const refreshAfterLaneMove = useCallback(() => {
    setRefreshKey?.((key) => key + 1);
  }, [setRefreshKey]);
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
    const key = (e: KeyboardEvent) => e.key === "Shift" && setShiftHeld(e.type === "keydown");
    const blur = () => setShiftHeld(false);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", blur);
    };
  });

  const [showPopover, setShowPopover] = useState(false);
  const [kfContextMenu, setKfContextMenu] = useState<KeyframeDiamondContextMenuState | null>(null);
  const [clipContextMenu, setClipContextMenu] = useState<{
    x: number;
    y: number;
    element: TimelineElement;
  } | null>(null);

  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
  }, []);

  // Last horizontal scroll offset, restored across the post-edit iframe reload (pinned zoom).
  const lastScrollLeftRef = useRef(0);

  const effectiveDuration = useMemo(() => {
    const safeDur = Number.isFinite(duration) ? duration : 0;
    if (rawElements.length === 0) return safeDur;
    const result = Math.max(safeDur, ...rawElements.map((el) => el.start + el.duration));
    return Number.isFinite(result) ? result : safeDur;
  }, [rawElements, duration]);

  const { tracks, trackStyles, trackOrder } = useTimelineTrackDerivations(expandedElements);
  const trackOrderRef = useRef(trackOrder);
  trackOrderRef.current = trackOrder;
  const expandedElementsRef = useRef(expandedElements);
  expandedElementsRef.current = expandedElements;

  const ppsRef = useRef(100);
  const durationRef = useRef(effectiveDuration);
  durationRef.current = effectiveDuration;
  // Declared before the fitPps derivation so the edit-pin wrappers can close over it.
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
    pinnedOnCompositionDrop,
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
    onCompositionDrop,
  });

  const { readClipZIndex, applyStackingPatches, zSyncEnabled } = useTimelineStackingSync({
    expandedElementsRef,
  });

  const {
    gapMenuModel,
    gapHighlight,
    setHoveredGapAction,
    openGapMenu,
    dismissGapMenu,
    closeTrackGap,
    closeAllTrackGaps,
  } = useTrackGapMenu({
    tracks,
    expandedElementsRef,
    trackOrderRef,
    onMoveElement: pinnedOnMoveElement,
    onMoveElements: pinnedOnMoveElements,
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
    refreshAfterLaneMove,
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
      onCompositionDrop: pinnedOnCompositionDrop,
    });

  const displayTrackOrder = useMemo(() => {
    if (!draggedClip?.started || trackOrder.includes(draggedClip.previewTrack)) return trackOrder;
    return [...trackOrder, draggedClip.previewTrack].sort((a, b) => a - b);
  }, [draggedClip, trackOrder]);

  const totalH = getTimelineCanvasHeight(displayTrackOrder.length);
  const { viewportWidth, showShortcutHint, setScrollRef } = useTimelineScrollViewport(scrollRef, [
    timelineReady,
    expandedElements.length,
    totalH,
  ]);
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

  const laneGapStrips = useTimelineGapHighlights({
    gapHighlight,
    tracks,
    selectedElementId,
    selectedElementIds,
    expandedElements,
    dragActive: draggedClip?.started === true || resizingClip != null,
    displayDuration,
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
  setRangeSelectionRef.current = setRangeSelection; // stable ref consumed by useTimelineClipDrag

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
      className={`relative border-t select-none h-full overflow-hidden ${isDragOver ? "ring-1 ring-inset ring-studio-accent/60" : ""} ${activeTool === "razor" ? "cursor-crosshair" : shiftHeld ? "cursor-crosshair" : "cursor-default"}`}
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
          lastScrollLeftRef.current = e.currentTarget.scrollLeft; // restored across post-edit reload
        }}
        onDragOver={handleAssetDragOver}
        onDragLeave={() => clearDropPreview()}
        onDrop={handleAssetDrop}
        onPointerDown={(e) => {
          if (activeTool === "razor" && e.shiftKey && e.button === 0 && scrollRef.current) {
            const rect = scrollRef.current.getBoundingClientRect();
            const x =
              e.clientX - rect.left + scrollRef.current.scrollLeft - GUTTER - TRACKS_LEFT_PAD;
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
          laneGapStrips={laneGapStrips}
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
            dismissGapMenu();
            setClipContextMenu({ x: e.clientX, y: e.clientY, element: el });
          }}
          onContextMenuLane={(e, track, time) => {
            if (draggedClip?.started || resizingClip) return;
            setClipContextMenu(null);
            openGapMenu({ x: e.clientX, y: e.clientY, track, time });
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
        gapContextMenu={gapMenuModel}
        onDismissGapContextMenu={dismissGapMenu}
        onCloseTrackGap={closeTrackGap}
        onCloseAllTrackGaps={closeAllTrackGaps}
        onHoverGapAction={setHoveredGapAction}
      />
    </div>
  );
});
