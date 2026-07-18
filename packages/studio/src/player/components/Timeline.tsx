import { useRef, useMemo, useCallback, useState, memo } from "react";
import { useMusicBeatAnalysis } from "../../hooks/useMusicBeatAnalysis";
import { remapBeatAnalysisToComposition } from "../../utils/beatEditActions";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { useExpandedTimelineElements } from "../hooks/useExpandedTimelineElements";
import { defaultTimelineTheme } from "./timelineTheme";
import { useTimelineRangeSelection } from "./useTimelineRangeSelection";
import { useTimelinePlayhead } from "./useTimelinePlayhead";
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
import { GUTTER, LABEL_COL_W } from "./timelineLayout";
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
import { useStudioPlaybackContextOptional } from "../../contexts/StudioContext";
import { TimelineRazorGuide, useTimelineRazorInteraction } from "./TimelineRazorInteraction";
import {
  getEffectiveTimelineDuration,
  getTimelinePreviewElement,
  hasKeyframedTimelineClips,
} from "./timelineViewModel";
import { useTimelineSelectionLifecycle } from "./useTimelineSelectionLifecycle";
import { useTimelineShiftModifier } from "./useTimelineShiftModifier";
import { useTimelineTicks } from "./useTimelineTicks";
import { getTimelineElementIndexes } from "../lib/timelineElementIndexes";
import { useTimelineRowVirtualization } from "./useTimelineRowVirtualization";
import { useTimelineClipRenderWindow } from "./useTimelineClipRenderWindow";
import { useTimelineActiveClips } from "./useTimelineActiveClips";

export {
  generateTicks,
  formatTimelineTickLabel,
  shouldAutoScrollTimeline,
  getTimelineScrollLeftForZoomTransition,
  getTimelineScrollLeftForZoomAnchor,
  getTimelinePlaybackFollowScrollLeft,
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
  const playbackContext = useStudioPlaybackContextOptional();
  const setRefreshKey = playbackContext?.setRefreshKey;
  const refreshAfterLaneMove = useCallback(() => {
    setRefreshKey?.((key) => key + 1);
  }, [setRefreshKey]);
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
  const clipRevealRequest = usePlayerStore((s) => s.clipRevealRequest);
  const focusedEaseSegment = usePlayerStore((s) => s.focusedEaseSegment);
  const gsapAnimations = usePlayerStore((s) => s.gsapAnimations);
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
    refreshAfterLaneMove,
    sessionEpoch,
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
      onCompositionDrop: pinnedOnCompositionDrop,
    });

  const displayLayout = useTimelineDisplayLayout(draggedClip, trackOrder, rowGeometry);
  const { viewport, showShortcutHint, setScrollRef, syncScrollViewport } =
    useTimelineScrollViewport(scrollRef, [
      timelineReady,
      expandedElements.length,
      displayLayout.totalH,
    ]);
  const { enabled: rowVirtualizationActive, virtualRows } = useTimelineRowVirtualization({
    scrollRef,
    viewport,
    rowGeometry: displayLayout.rowGeometry,
    sessionEpoch,
    elements: expandedElements,
    selectedElementId,
    revealElementId: clipRevealRequest?.elementId ?? null,
    draggedRowKey: draggedClip?.started ? draggedClip.previewTrack : undefined,
    resizingRowKey: resizingClip?.element.track,
    clipContextMenuRowKey: clipContextMenu?.element.track,
    keyframeContextMenuRowKey: kfContextMenu?.element.track,
    lastScrollLeftRef,
    syncScrollViewport,
  });
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

  const { pps, fitPps, displayContentWidth, displayDuration, zoomModeRef, manualZoomPercentRef } =
    useTimelineGeometry({
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
  const { clipIndex, renderTimeRange, pinnedClipIdentities } = useTimelineClipRenderWindow({
    tracks,
    viewport,
    pixelsPerSecond: pps,
    contentOrigin,
    duration: displayDuration,
    selectedElementId: selectedElementId ?? undefined,
    draggedElementId: draggedClip?.element.key ?? draggedClip?.element.id,
    resizingElementIds:
      resizingClip?.groupPreview?.map((change) => change.key) ??
      (resizingClip ? [resizingClip.element.key ?? resizingClip.element.id] : undefined),
    revealElementId: clipRevealRequest?.elementId,
    focusedEaseElementId: focusedEaseSegment?.elementId,
    clipContextMenuElementId: clipContextMenu?.element.key ?? clipContextMenu?.element.id,
    keyframeContextMenuElementId: kfContextMenu?.element.key ?? kfContextMenu?.element.id,
    scrollRef,
    elements: expandedElements,
    rowGeometry: displayLayout.rowGeometry,
    allowHorizontalReveal: zoomMode === "manual",
    sessionEpoch,
  });
  useTimelineActiveClips({
    scrollRef,
    currentTime,
    clipStateVersion: renderTimeRange,
    elementStateVersion: expandedElements,
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
  const { razorGuideX, updateRazorGuide, clearRazorGuide, splitAllAtPointer } =
    useTimelineRazorInteraction({
      active: activeTool === "razor",
      scrollRef,
      contentOrigin,
      pixelsPerSecond: pps,
      onSplitAll: onRazorSplitAll,
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

  const { major, minor, majorTickInterval } = useTimelineTicks(
    displayDuration,
    pps,
    timeDisplayMode,
    rowVirtualizationActive ? renderTimeRange : undefined,
  );

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
      className={`relative border-t select-none h-full overflow-hidden ${isDragOver ? "ring-1 ring-inset ring-studio-accent/60" : ""} ${activeTool === "razor" ? "cursor-crosshair" : shiftHeld ? "cursor-crosshair" : "cursor-default"}`}
      onMouseMove={updateRazorGuide}
      onMouseLeave={clearRazorGuide}
      style={{
        touchAction: "pan-x pan-y",
        background: theme.shellBackground,
        borderColor: theme.shellBorder,
      }}
    >
      <div
        ref={setScrollRef}
        data-timeline-scroll-viewport
        data-timeline-auto-scroll-left-inset={labelMode ? LABEL_COL_W : 0}
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
          if (splitAllAtPointer(e)) return;
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
          rowGeometry={displayLayout.rowGeometry}
          virtualRows={virtualRows}
          rowsVirtualized={rowVirtualizationActive}
          clipIndex={clipIndex}
          renderTimeRange={renderTimeRange}
          pinnedClipIdentities={pinnedClipIdentities}
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
          renderClipContent={viewport.isScrolling ? undefined : renderClipContent}
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
        {activeTool === "razor" && razorGuideX !== null && <TimelineRazorGuide x={razorGuideX} />}
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
