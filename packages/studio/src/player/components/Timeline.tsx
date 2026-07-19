import { useRef, useMemo, useCallback, useState, useLayoutEffect, memo } from "react";
import { useMusicBeatAnalysis } from "../../hooks/useMusicBeatAnalysis";
import { remapBeatAnalysisToComposition } from "../../utils/beatEditActions";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { useExpandedTimelineElements } from "../hooks/useExpandedTimelineElements";
import { defaultTimelineTheme } from "./timelineTheme";
import { useTimelineRangeSelection } from "./useTimelineRangeSelection";
import { useTimelinePlayhead } from "./useTimelinePlayhead";
import { useTimelineActiveClips } from "./useTimelineActiveClips";
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
import { useAutoExpandKeyframedClips } from "./useAutoExpandKeyframedClips";
import { GUTTER, LABEL_COL_W, getTimelineContentXFromClient } from "./timelineLayout";
import { useTimelineScrollViewport } from "./useTimelineScrollViewport";
import { useResolvedTimelineEditCallbacks } from "./useResolvedTimelineEditCallbacks";
import type { TimelineProps } from "./TimelineTypes";
import {
  getTrackStyle,
  useTimelineDisplayLayout,
  useTimelineTrackLayout,
} from "./useTimelineTrackLayout";
import { useTimelineKeyframeHandlers } from "./useTimelineKeyframeHandlers";
import { STUDIO_KEYFRAMES_ENABLED } from "../../components/editor/manualEditingAvailability";
import { useTrackGapMenu } from "./useTrackGapMenu";
import { useTimelineGapHighlights } from "./useTimelineGapHighlights";
import {
  getEffectiveTimelineDuration,
  getTimelinePreviewElement,
  hasKeyframedTimelineClips,
} from "./timelineViewModel";
import { useTimelineSelectionLifecycle } from "./useTimelineSelectionLifecycle";
import { useTimelineShiftModifier } from "./useTimelineShiftModifier";
import { useTimelineTicks } from "./useTimelineTicks";
import { getTimelineElementIndexes } from "../lib/timelineElementIndexes";
import { getTimelineScrollTopForGeometryChange } from "./timelineViewportGeometry";

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

export {
  getTimelineScrollTopForGeometryChange,
  getTimelineVisibleTimeRange,
} from "./timelineViewportGeometry";

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
  sessionEpoch = 0,
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
  const musicElement = usePlayerStore((s) => getTimelineElementIndexes(s.elements).musicElement);
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
  const gsapAnimations = usePlayerStore((s) => s.gsapAnimations);
  // Label mode = comp has keyframed clips (not just when expanded): keeps the layer
  // disclosure + property column visible and reserves a GUTTER before 0s (Figma).
  const hasKeyframedClips = useMemo(
    () => hasKeyframedTimelineClips(gsapAnimations),
    [gsapAnimations],
  );
  const labelMode = STUDIO_KEYFRAMES_ENABLED && hasKeyframedClips;
  const contentOrigin = labelMode ? LABEL_COL_W + GUTTER : GUTTER;
  const contentGutter = labelMode ? GUTTER : 0;
  const setSelectedElementId = usePlayerStore((s) => s.setSelectedElementId);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const { zoomMode, manualZoomPercent, setZoomMode, setManualZoomPercent } = useTimelineZoom();

  const playheadRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeTool = usePlayerStore((s) => s.activeTool);
  const [hoveredClip, setHoveredClip] = useState<string | null>(null);
  const isDragging = useRef(false);
  const shiftHeld = useTimelineShiftModifier();
  const [razorGuideX, setRazorGuideX] = useState<number | null>(null);

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

  const effectiveDuration = useMemo(
    () => getEffectiveTimelineDuration(duration, rawElements),
    [duration, rawElements],
  );

  const keyframeCache = usePlayerStore((s) => s.keyframeCache);
  useAutoExpandKeyframedClips(gsapAnimations);
  const {
    tracks,
    trackStyles,
    trackOrder,
    trackOrderRef,
    laneCounts,
    rowGeometry,
    rowGeometryRef,
  } = useTimelineTrackLayout(
    expandedElements,
    gsapAnimations,
    selectedElementId,
    selectedElementIds,
  );
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
    rowGeometryRef,
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
      rowGeometryRef,
      contentOrigin,
      onFileDrop: pinnedOnFileDrop,
      onAssetDrop: pinnedOnAssetDrop,
      onBlockDrop: pinnedOnBlockDrop,
    });

  const displayLayout = useTimelineDisplayLayout(draggedClip, trackOrder, rowGeometry);
  const { viewport, showShortcutHint, setScrollRef, syncScrollViewport } =
    useTimelineScrollViewport(scrollRef, [
      timelineReady,
      expandedElements.length,
      displayLayout.totalH,
    ]);
  const previousLayoutRef = useRef(displayLayout.rowGeometry);
  const previousSessionEpochRef = useRef(sessionEpoch);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const previousGeometry = previousLayoutRef.current;
    if (previousSessionEpochRef.current !== sessionEpoch) {
      previousSessionEpochRef.current = sessionEpoch;
      lastScrollLeftRef.current = 0;
      if (scroll) {
        scroll.scrollLeft = 0;
        scroll.scrollTop = 0;
        syncScrollViewport(scroll);
      }
    } else if (scroll && previousGeometry !== displayLayout.rowGeometry) {
      const nextScrollTop = getTimelineScrollTopForGeometryChange(
        previousGeometry,
        displayLayout.rowGeometry,
        scroll.scrollTop,
      );
      if (nextScrollTop !== scroll.scrollTop) {
        scroll.scrollTop = nextScrollTop;
        syncScrollViewport(scroll);
      }
    }
    previousLayoutRef.current = displayLayout.rowGeometry;
  }, [displayLayout.rowGeometry, sessionEpoch, syncScrollViewport]);
  const selectedKeyframes = usePlayerStore((s) => s.selectedKeyframes);
  const toggleSelectedKeyframe = usePlayerStore((s) => s.toggleSelectedKeyframe);
  const { onClickKeyframe, onSelectSegment, onShiftClickKeyframe, onContextMenuKeyframe } =
    useTimelineKeyframeHandlers({
      expandedElements,
      keyframeCache,
      onSelectElement,
      onSeek,
      setSelectedElementId,
      setKfContextMenu,
      toggleSelectedKeyframe,
    });

  const {
    pps,
    fitPps,
    displayContentWidth,
    displayDuration,
    clipStateVersion,
    zoomModeRef,
    manualZoomPercentRef,
  } = useTimelineGeometry({
    viewportWidth: viewport.clientWidth,
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
    contentOrigin,
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
    contentOrigin,
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
    rowGeometryRef,
    onSelectElement,
    contentOrigin,
  });
  setRangeSelectionRef.current = setRangeSelection; // stable ref consumed by useTimelineClipDrag

  useTimelineSelectionLifecycle(expandedElements, selectedElementId, setShowPopover, () =>
    setRangeSelection(null),
  );

  const { major, minor } = useTimelineTicks(displayDuration, pps, timeDisplayMode);
  const majorTickInterval = major.length >= 2 ? major[1] - major[0] : effectiveDuration;

  const getPreviewElement = useCallback(
    (element: TimelineElement): TimelineElement => getTimelinePreviewElement(element, resizingClip),
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
      data-timeline-element-count={expandedElements.length}
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
        data-timeline-scroll-viewport
        tabIndex={-1}
        className={`${zoomMode === "fit" ? "overflow-x-hidden" : "overflow-x-auto"} overflow-y-auto h-full outline-none`}
        onScroll={(e) => {
          lastScrollLeftRef.current = e.currentTarget.scrollLeft; // restored across post-edit reload
          syncScrollViewport(e.currentTarget, true);
        }}
        onDragOver={handleAssetDragOver}
        onDragLeave={() => clearDropPreview()}
        onDrop={handleAssetDrop}
        onPointerDown={(e) => {
          // Let interactive controls (keyframe nav/toggle, caret, inputs) handle
          // their own clicks — scrubbing here would preventDefault and eat them.
          if (e.target instanceof Element && e.target.closest("button, input, select, a")) return;
          if (activeTool === "razor" && e.shiftKey && e.button === 0 && scrollRef.current) {
            const rect = scrollRef.current.getBoundingClientRect();
            const x = getTimelineContentXFromClient({
              clientX: e.clientX,
              rectLeft: rect.left,
              scrollLeft: scrollRef.current.scrollLeft,
              contentOrigin,
            });
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
          contentOrigin={contentOrigin}
          contentGutter={contentGutter}
          trackContentWidth={displayContentWidth}
          totalH={displayLayout.totalH}
          effectiveDuration={effectiveDuration}
          majorTickInterval={majorTickInterval}
          rangeSelection={rangeSelection}
          marqueeRect={marqueeRect}
          laneGapStrips={laneGapStrips}
          theme={theme}
          displayTrackOrder={displayLayout.displayTrackOrder}
          rowHeights={displayLayout.displayRowHeights}
          trackOrder={trackOrder}
          tracks={tracks}
          trackStyles={trackStyles}
          laneCounts={laneCounts}
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
          gsapAnimations={gsapAnimations}
          selectedKeyframes={selectedKeyframes}
          currentTime={currentTime}
          onSeek={onSeek}
          beatAnalysis={adjustedBeatAnalysis}
          onSelectSegment={onSelectSegment}
          onClickKeyframe={onClickKeyframe}
          onShiftClickKeyframe={onShiftClickKeyframe}
          onMoveKeyframe={onMoveKeyframe}
          onContextMenuKeyframe={onContextMenuKeyframe}
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
