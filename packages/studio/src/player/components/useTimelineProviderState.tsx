import { useRef, useMemo, useCallback, useState } from "react";
import { useAdjustedBeatAnalysis, useMusicBeatAnalysis } from "../../hooks/useMusicBeatAnalysis";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { defaultTimelineTheme } from "./timelineTheme";
import { useTimelinePlayhead } from "./useTimelinePlayhead";
import { useTimelineZoom } from "./useTimelineZoom";
import { useTimelineAssetDrop } from "./timelineDragDrop";
import { type KeyframeDiamondContextMenuState } from "./KeyframeDiamondContextMenu";
import { useTimelineClipDrag } from "./useTimelineClipDrag";
import type { ClipContextMenuState, TimelineContextValue } from "./TimelineProvider";
import {
  buildTimelineMeta,
  resolveMultiDragPreview,
  resolveResizingElementIds,
  shouldIgnoreTimelinePointerDown,
} from "./timelineProviderStateBuilders";
import { useTimelineOverlaysState } from "./useTimelineOverlaysState";
import { useTimelineEditPinning } from "./useTimelineEditPinning";
import { useTimelineStackingSync } from "./useTimelineStackingSync";
import { useTimelineGeometry } from "./useTimelineGeometry";
import { useAutoExpandKeyframedClips } from "./useAutoExpandKeyframedClips";
import { GUTTER, LABEL_COL_W, TRACKS_LEFT_PAD } from "./timelineLayout";
import { useTimelineScrollViewport } from "./useTimelineScrollViewport";
import { useResolvedTimelineEditCallbacks } from "./useResolvedTimelineEditCallbacks";
import type { TimelineProps } from "./TimelineTypes";
import {
  getTrackStyle,
  useTimelineDisplayLayout,
  useTimelineTrackLayout,
} from "./useTimelineTrackLayout";
import { useTimelineKeyframeHandlers } from "./useTimelineKeyframeHandlers";
import { useTimelineGapHighlights } from "./useTimelineGapHighlights";
import { TimelineRazorGuideOverlay, useTimelineRazorInteraction } from "./TimelineRazorInteraction";
import { useTimelinePerformanceTelemetry } from "./useTimelinePerformanceTelemetry";
import {
  getEffectiveTimelineDuration,
  getTimelinePreviewElement,
  timelineNeedsLabelColumn,
} from "./timelineViewModel";
import { useTimelineShiftModifier } from "./useTimelineShiftModifier";
import { useTimelineTicks } from "./useTimelineTicks";
import { getTimelineElementIdentity } from "../lib/timelineElementHelpers";
import { useTimelineClipRenderWindow } from "./useTimelineClipRenderWindow";
import { useTimelineActiveClips } from "./useTimelineActiveClips";
import { useTimelineLaneMoveRefresh } from "./useTimelineLaneMoveRefresh";
import { useTimelineLogicalFocus } from "./useTimelineLogicalFocus";
import { useTimelineEditContextOptional } from "../../contexts/TimelineEditContext";
import { resolveSnapGuide } from "./timelineSnapping";
export function useTimelineProviderState({
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
  onRangeSelect,
  onCopyClip,
  onPasteClip,
  onDuplicateClip,
  canPasteClip,
  theme: themeOverrides,
  sessionEpoch = 0,
}: TimelineProps = {}): TimelineContextValue {
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
  const editContext = useTimelineEditContextOptional();
  const refreshAfterLaneMove = useTimelineLaneMoveRefresh();
  useMusicBeatAnalysis();
  const timelineElements = usePlayerStore((s) => s.elements);
  const adjustedBeatAnalysis = useAdjustedBeatAnalysis();
  const duration = usePlayerStore((s) => s.duration);
  const timeDisplayMode = usePlayerStore((s) => s.timeDisplayMode);
  const timelineReady = usePlayerStore((s) => s.timelineReady);
  const selectedElementId = usePlayerStore((s) => s.selectedElementId);
  const selectedElementIds = usePlayerStore((s) => s.selectedElementIds);
  const focusedEaseSegment = usePlayerStore((s) => s.focusedEaseSegment);
  const gsapAnimations = usePlayerStore((s) => s.gsapAnimations);
  const labelMode = useMemo(
    () => timelineNeedsLabelColumn(gsapAnimations, timelineElements),
    [gsapAnimations, timelineElements],
  );
  // The label column provides pre-t=0 space; otherwise keep TRACKS_LEFT_PAD after the gutter.
  const contentOrigin = labelMode ? LABEL_COL_W + GUTTER : GUTTER + TRACKS_LEFT_PAD;
  const setSelectedElementId = usePlayerStore((s) => s.setSelectedElementId);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const beatDragging = usePlayerStore((s) => s.beatDragging);
  const timelineSessionEpoch = usePlayerStore((s) => s.timelineSessionEpoch);
  const setFocusedEaseSegment = usePlayerStore((s) => s.setFocusedEaseSegment);
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
  const [clipContextMenu, setClipContextMenu] = useState<ClipContextMenuState | null>(null);
  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
  }, []);
  const lastScrollLeftRef = useRef(0);
  const effectiveDuration = useMemo(
    () => getEffectiveTimelineDuration(duration, timelineElements),
    [duration, timelineElements],
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
    groups,
    trackGroupOf,
  } = useTimelineTrackLayout(
    timelineElements,
    gsapAnimations,
    selectedElementId,
    selectedElementIds,
  );
  const timelineElementsRef = useRef(timelineElements);
  timelineElementsRef.current = timelineElements; // oxlint-disable-line react/refs -- event handlers read the latest elements
  const ppsRef = useRef(100);
  const durationRef = useRef(effectiveDuration);
  durationRef.current = effectiveDuration; // oxlint-disable-line react/refs -- event handlers read the latest duration
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
    expandedElementsRef: timelineElementsRef,
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
    onSeek,
    setShowPopover,
    setRangeSelectionRef,
    readZIndex: zSyncEnabled ? readClipZIndex : undefined,
    onStackingPatches: zSyncEnabled ? applyStackingPatches : undefined,
    refreshAfterLaneMove,
    sessionEpoch,
  });
  const assetDrop = useTimelineAssetDrop({
    scrollRef,
    ppsRef,
    trackOrderRef,
    rowGeometryRef,
    contentOrigin,
    onFileDrop: pinnedOnFileDrop,
    onAssetDrop: pinnedOnAssetDrop,
    onBlockDrop: pinnedOnBlockDrop,
    onCompositionDrop: pinnedOnCompositionDrop,
    sessionEpoch,
  });
  const displayLayout = useTimelineDisplayLayout(draggedClip, trackOrder, rowGeometry);
  const resizingElementIds = resolveResizingElementIds(resizingClip);
  const { recordTimelineScroll } = useTimelinePerformanceTelemetry({
    totalClipCount: timelineElements.length,
    totalRowCount: displayLayout.displayTrackOrder.length,
    zoomMode,
  });
  const { viewport, showShortcutHint, setScrollRef, syncScrollViewport } =
    useTimelineScrollViewport(scrollRef, [
      timelineReady,
      timelineElements.length,
      displayLayout.totalH,
    ]);
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
      expandedElements: timelineElements,
      isDragging,
      scrollRef,
      lastScrollLeftRef,
      contentOrigin,
    });
  const timelineFocus = useTimelineLogicalFocus({
    scrollRef,
    tracks,
    layout: displayLayout,
    laneCounts,
    selectedElementId,
    selectedElementIds,
    groups,
    trackGroupOf,
    gsapAnimations,
    elements: timelineElements,
    pixelsPerSecond: pps,
    contentOrigin,
    allowHorizontal: zoomMode === "manual",
    viewport,
    sessionEpoch,
    draggedRowKey: draggedClip?.started ? draggedClip.previewTrack : undefined,
    resizingElementIds,
    clipContextMenuRowKey: clipContextMenu?.element.track,
    keyframeContextMenuRowKey: kfContextMenu?.element.track,
    lastScrollLeftRef,
    syncScrollViewport,
  });
  const selectedKeyframes = usePlayerStore((s) => s.selectedKeyframes);
  const toggleSelectedKeyframe = usePlayerStore((s) => s.toggleSelectedKeyframe);
  const { onClickKeyframe, onSelectSegment, onShiftClickKeyframe, onContextMenuKeyframe } =
    useTimelineKeyframeHandlers({
      expandedElements: timelineElements,
      keyframeCache,
      onSelectElement,
      onSeek,
      setSelectedElementId,
      setKfContextMenu,
      toggleSelectedKeyframe,
    });
  const { clipIndex, renderTimeRange, visibleTimeRange, pinnedClipIdentities } =
    useTimelineClipRenderWindow({
      tracks,
      viewport,
      pixelsPerSecond: pps,
      contentOrigin,
      duration: displayDuration,
      selectedElementId: selectedElementId ?? undefined,
      draggedElementId: draggedClip ? getTimelineElementIdentity(draggedClip.element) : undefined,
      resizingElementIds,
      focusedElementId: timelineFocus.pinnedElementId,
      focusedEaseElementId: focusedEaseSegment?.elementId,
      clipContextMenuElementId: clipContextMenu
        ? getTimelineElementIdentity(clipContextMenu.element)
        : undefined,
      keyframeContextMenuElementId: kfContextMenu
        ? getTimelineElementIdentity(kfContextMenu.element)
        : undefined,
    });
  useTimelineActiveClips({
    scrollRef,
    currentTime,
    clipStateVersion: renderTimeRange,
    elementStateVersion: timelineElements,
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
    elementsLength: timelineElements.length,
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
  const overlaysProps = useTimelineOverlaysState({
    elements: timelineElements,
    elementsRef: timelineElementsRef,
    theme,
    showShortcutHint,
    showPopover,
    setShowPopover,
    kfContextMenu,
    setKfContextMenu,
    onDeleteKeyframe,
    onDeleteAllKeyframes,
    onMoveKeyframeToPlayhead,
    clipContextMenu,
    setClipContextMenu,
    currentTime,
    onSplitElement,
    pinZoomBeforeEdit,
    onDeleteElement: _onDeleteElement,
    onCopyClip,
    onPasteClip,
    onDuplicateClip,
    canPasteClip,
    onSelectElement,
    selectedElementId,
    setRangeSelectionRef,
    rangeSelection: {
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
      elementsRef: timelineElementsRef,
      clipIndex,
      rowGeometryRef,
      onSelectElement,
      contentOrigin,
      sessionEpoch,
      onRangeSelect,
    },
    gapMenu: {
      tracks,
      expandedElementsRef: timelineElementsRef,
      trackOrderRef,
      onMoveElement: pinnedOnMoveElement,
      onMoveElements: pinnedOnMoveElements,
    },
  });
  const {
    overlays,
    gapHighlight,
    openGapMenu,
    onContextMenuClip,
    shiftClickClipRef,
    marqueeRect,
    isScrubbing,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  } = overlaysProps;
  const { rangeSelection, setRangeSelection } = overlays;
  const laneGapStrips = useTimelineGapHighlights({
    gapHighlight,
    tracks,
    selectedElementId,
    selectedElementIds,
    expandedElements: timelineElements,
    dragActive: draggedClip?.started === true || resizingClip != null,
    displayDuration,
  });
  const { major, minor, majorTickInterval } = useTimelineTicks(
    displayDuration,
    pps,
    timeDisplayMode,
    timelineFocus.rowVirtualizationActive ? renderTimeRange : undefined,
  );
  const getPreviewElement = useCallback(
    (element: TimelineElement): TimelineElement => getTimelinePreviewElement(element, resizingClip),
    [resizingClip],
  );
  const draggedElement = draggedClip?.element ?? null;
  const multiDragPreview = resolveMultiDragPreview(draggedClip, selectedElementIds);
  const canvasProps = {
    major,
    minor,
    pps,
    contentOrigin,
    contentGutter: labelMode ? GUTTER : 0,
    trackContentWidth: displayContentWidth,
    totalH: displayLayout.totalH,
    effectiveDuration,
    majorTickInterval,
    rangeSelection,
    marqueeRect,
    laneGapStrips,
    dropPreview: assetDrop.dropPreview,
    theme,
    displayTrackOrder: displayLayout.displayTrackOrder,
    rowHeights: displayLayout.displayRowHeights,
    rowGeometry: displayLayout.rowGeometry,
    virtualRows: timelineFocus.virtualRows,
    logicalRows: timelineFocus.logicalRows,
    focusedTargetId: timelineFocus.focusedTargetId,
    rowsVirtualized: timelineFocus.rowVirtualizationActive,
    clipIndex,
    renderTimeRange,
    visibleTimeRange,
    pinnedClipIdentities,
    trackOrder,
    tracks,
    trackStyles,
    groups,
    laneCounts,
    selectedElementId,
    selectedElementIds,
    hoveredClip,
    draggedClip,
    resizingClip,
    isScrubbing,
    blockedClipRef,
    suppressClickRef,
    scrollRef,
    playheadRef,
    onDrillDown,
    onSelectElement,
    setHoveredClip,
    setShowPopover,
    setRangeSelection,
    setResizingClip,
    setDraggedClip,
    setSelectedElementId,
    shiftClickClipRef,
    getPreviewElement,
    getTrackStyle,
    keyframeCache,
    gsapAnimations,
    selectedKeyframes,
    currentTime,
    onSeek,
    beatAnalysis: adjustedBeatAnalysis,
    onSelectSegment,
    onClickKeyframe,
    onShiftClickKeyframe,
    onMoveKeyframe,
    onContextMenuKeyframe,
    onContextMenuClip,
    onContextMenuLane: (e: React.MouseEvent, track: number, time: number) => {
      if (draggedClip?.started || resizingClip) return;
      setClipContextMenu(null);
      openGapMenu({ x: e.clientX, y: e.clientY, track, time });
    },
    onResizeElement,
    onMoveElement,
    beatDragging,
    draggedElement,
    snapGuide: resolveSnapGuide(draggedClip, resizingClip),
    multiDragPreview,
    onToggleTrackHidden: editContext.onToggleTrackHidden,
    onTogglePropertyGroupKeyframe: editContext.onTogglePropertyGroupKeyframe,
    onRazorSplit: editContext.onRazorSplit,
    onRazorSplitAll: editContext.onRazorSplitAll,
  };
  const timelineMeta = buildTimelineMeta({
    emptyState: {
      isDragOver: assetDrop.isDragOver,
      onFileDrop: !!onFileDrop,
      onDragOver: assetDrop.handleAssetDragOver,
      onDragLeave: assetDrop.handleAssetDragLeave,
      onDrop: assetDrop.handleAssetDrop,
    },
    container: {
      ref: setContainerRef,
      "aria-label": "Timeline track view",
      "data-timeline-element-count": timelineElements.length,
      isDragOver: assetDrop.isDragOver,
      activeTool,
      shiftHeld,
      accentClass: "ring-1 ring-inset ring-studio-accent/60",
      onMouseMove: updateRazorGuide,
      onMouseLeave: clearRazorGuide,
      style: {
        touchAction: "pan-x pan-y",
        background: theme.shellBackground,
        borderColor: theme.shellBorder,
      },
    },
    viewport: {
      ref: setScrollRef,
      tabIndex: -1,
      labelMode,
      zoomMode,
      onScroll: (e) => {
        lastScrollLeftRef.current = e.currentTarget.scrollLeft;
        recordTimelineScroll(e.currentTarget);
        syncScrollViewport(e.currentTarget, true);
      },
      ...timelineFocus.timelineFocusProps,
      onDragOver: assetDrop.handleAssetDragOver,
      onDragLeave: assetDrop.handleAssetDragLeave,
      onDrop: assetDrop.handleAssetDrop,
      onPointerDown: (e) => {
        if (shouldIgnoreTimelinePointerDown(e.target)) return;
        if (splitAllAtPointer(e)) return;
        handlePointerDown(e);
      },
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
      onLostPointerCapture: handlePointerCancel,
    },
    elementCount: timelineElements.length,
    labelColumnWidth: LABEL_COL_W,
    razorGuide:
      activeTool === "razor" && razorGuideX !== null ? (
        <TimelineRazorGuideOverlay x={razorGuideX} />
      ) : null,
  });
  const contextValue: TimelineContextValue = {
    state: {
      timelineReady,
      elements: timelineElements,
      selectedElementId,
      sessionEpoch: timelineSessionEpoch,
      keyframeCache,
      canvas: canvasProps,
      overlays,
    },
    actions: {
      renderClipContent,
      renderClipOverlay,
      setFocusedEaseSegment,
    },
    meta: timelineMeta,
  };
  return contextValue;
}
