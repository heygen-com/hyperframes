import { useRef, useMemo, useCallback, useState, useEffect, memo } from "react";
import { useMusicBeatAnalysis } from "../../hooks/useMusicBeatAnalysis";
import { isMusicTrack } from "../../utils/timelineInspector";
import { remapBeatAnalysisToComposition } from "../../utils/beatEditActions";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { useExpandedTimelineElements } from "../hooks/useExpandedTimelineElements";
import { useMountEffect } from "../../hooks/useMountEffect";
import { EditPopover } from "./EditModal";
import { defaultTimelineTheme } from "./timelineTheme";
import { useTimelineRangeSelection } from "./useTimelineRangeSelection";
import { useTimelineMarqueeSelection } from "./useTimelineMarqueeSelection";
import { useTimelinePlayhead } from "./useTimelinePlayhead";
import { useTimelineActiveClips } from "./useTimelineActiveClips";
import { type TrackVisualStyle, getTrackStyle } from "./timelineIcons";
import { getTimelinePixelsPerSecond } from "./timelineZoom";
import { useTimelineZoom } from "./useTimelineZoom";
import { useTimelineAssetDrop } from "./timelineDragDrop";
import { TimelineEmptyState } from "./TimelineEmptyState";
import { TimelineCanvas } from "./TimelineCanvas";
import {
  KeyframeDiamondContextMenu,
  type KeyframeDiamondContextMenuState,
} from "./KeyframeDiamondContextMenu";
import { useTimelineClipDrag } from "./useTimelineClipDrag";
import { useTimelineKeyframeHandlers } from "./useTimelineKeyframeHandlers";
import { ClipContextMenu } from "./ClipContextMenu";
import { TimelineShortcutHint } from "./TimelineShortcutHint";
import { buildStackingTimelineLayers, insertPreviewTrackOrder } from "./timelineTrackOrder";
import { getTimelineLayerGroupHeaderTotalHeight } from "./TimelineLayerGroupHeader";
import {
  GUTTER,
  generateVisibleTicks,
  getTimelineCanvasHeight,
  shouldShowTimelineShortcutHint,
  computeTimelineBasisDuration,
  computeTimelineEffectiveDuration,
} from "./timelineLayout";
import { useResolvedTimelineEditCallbacks } from "./useResolvedTimelineEditCallbacks";
import type { TimelineProps } from "./TimelineTypes";

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
  onResizeElement: onResizeElementOverride,
  onBlockedEditAttempt: onBlockedEditAttemptOverride,
  onSplitElement: onSplitElementOverride,
  onSelectElement,
  theme: themeOverrides,
}: TimelineProps = {}) {
  const {
    onMoveElement,
    onResizeElement,
    onMoveElements,
    onResizeElements,
    onPreviewMoveElements,
    onPreviewResizeElements,
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
    onResizeElement: onResizeElementOverride,
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
  const timelineReady = usePlayerStore((s) => s.timelineReady);
  const selectedElementId = usePlayerStore((s) => s.selectedElementId);
  const setSelectedElementId = usePlayerStore((s) => s.setSelectedElementId);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const { zoomMode, manualZoomPercent, setZoomMode, setManualZoomPercent } = useTimelineZoom();

  const playheadRef = useRef<HTMLDivElement>(null);
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

  const tracks = useMemo(
    () => buildStackingTimelineLayers(expandedElements).rows,
    [expandedElements],
  );

  const trackStyles = useMemo(() => {
    const map = new Map<string, TrackVisualStyle>();
    for (const layer of tracks) {
      map.set(layer.id, getTrackStyle(layer.elements[0]?.tag ?? ""));
    }
    return map;
  }, [tracks]);

  const trackOrder = useMemo(() => tracks.map((layer) => layer.id), [tracks]);
  const trackOrderRef = useRef(trackOrder);
  trackOrderRef.current = trackOrder;
  const timelineLayersRef = useRef(tracks);
  timelineLayersRef.current = tracks;
  const expandedElementsRef = useRef(expandedElements);
  expandedElementsRef.current = expandedElements;

  const ppsRef = useRef(100);
  const durationRef = useRef(Number.isFinite(duration) ? duration : 0);

  const setRangeSelectionRef = useRef<((sel: null) => void) | null>(null);

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
    trackOrderRef,
    timelineLayersRef,
    timelineElementsRef: expandedElementsRef,
    onMoveElement,
    onResizeElement,
    onMoveElements,
    onResizeElements,
    onPreviewMoveElements,
    onPreviewResizeElements,
    onBlockedEditAttempt,
    setShowPopover,
    setRangeSelectionRef,
  });

  const basisDuration = useMemo(
    () =>
      computeTimelineBasisDuration(
        duration,
        rawElements.map((el) => el.start + el.duration),
      ),
    [rawElements, duration],
  );
  const effectiveDuration = useMemo(
    () =>
      computeTimelineEffectiveDuration(basisDuration, [
        draggedClip?.started ? draggedClip.previewStart + draggedClip.element.duration : null,
        resizingClip?.started ? resizingClip.previewStart + resizingClip.previewDuration : null,
      ]),
    [basisDuration, draggedClip, resizingClip],
  );
  durationRef.current = effectiveDuration;

  const displayTrackOrder = useMemo(() => {
    if (
      !draggedClip?.started ||
      trackOrder.length === 0 ||
      trackOrder.includes(draggedClip.previewLayerId)
    )
      return trackOrder;
    return insertPreviewTrackOrder(
      trackOrder,
      draggedClip.previewLayerId,
      draggedClip.previewLayerIndex,
    );
  }, [draggedClip, trackOrder]);

  const totalH =
    getTimelineCanvasHeight(displayTrackOrder.length) +
    getTimelineLayerGroupHeaderTotalHeight(displayTrackOrder, tracks);
  const keyframeCache = usePlayerStore((s) => s.keyframeCache);
  const selectedKeyframes = usePlayerStore((s) => s.selectedKeyframes);
  const toggleSelectedKeyframe = usePlayerStore((s) => s.toggleSelectedKeyframe);
  const keyframeHandlers = useTimelineKeyframeHandlers({
    expandedElements,
    keyframeCache,
    onSelectElement,
    onSeek,
    setSelectedElementId,
    setKfContextMenu,
    toggleSelectedKeyframe,
  });

  const selectedElement = useMemo(
    () =>
      expandedElements.find((element) => (element.key ?? element.id) === selectedElementId) ?? null,
    [expandedElements, selectedElementId],
  );
  const selectedElementRef = useRef<TimelineElement | null>(selectedElement);
  selectedElementRef.current = selectedElement;

  const fitPps =
    viewportWidth > GUTTER && basisDuration > 0
      ? (viewportWidth - GUTTER - 2) / basisDuration
      : 100;
  const pps = getTimelinePixelsPerSecond(fitPps, zoomMode, manualZoomPercent);
  ppsRef.current = pps;
  const trackContentWidth = Math.max(0, effectiveDuration * pps);
  const clipStateVersion = useMemo(
    () =>
      expandedElements
        .map((el) => `${el.key ?? el.id}:${el.start}:${el.duration}:${el.track}`)
        .join("|"),
    [expandedElements],
  );
  const zoomModeRef = useRef(zoomMode);
  zoomModeRef.current = zoomMode;
  const manualZoomPercentRef = useRef(manualZoomPercent);
  manualZoomPercentRef.current = manualZoomPercent;
  const fitPpsRef = useRef(fitPps);
  fitPpsRef.current = fitPps;

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
  });
  const {
    marqueeRect,
    handlePointerDown: handleMarqueePointerDown,
    handlePointerMove: handleMarqueePointerMove,
    handlePointerUp: handleMarqueePointerUp,
  } = useTimelineMarqueeSelection({
    scrollRef,
    ppsRef,
    trackOrderRef,
    timelineLayersRef,
    disabled: activeTool === "razor",
    setShowPopover,
    setRangeSelectionRef,
    seekFromX,
  });
  setRangeSelectionRef.current = setRangeSelection;
  // Pointer-up and lost-capture end a gesture identically (marquee-claims-first).
  const releasePointer = (event: Parameters<typeof handleMarqueePointerUp>[0]) => {
    if (handleMarqueePointerUp(event)) return;
    handlePointerUp();
  };

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

  const { major, minor } = useMemo(
    () => generateVisibleTicks(effectiveDuration, pps, viewportWidth, GUTTER),
    [effectiveDuration, pps, viewportWidth],
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

  const { isDragOver, setIsDragOver, handleAssetDragOver, handleAssetDrop } = useTimelineAssetDrop({
    scrollRef,
    ppsRef,
    durationRef,
    trackOrderRef,
    timelineLayersRef,
    onFileDrop,
    onAssetDrop,
    onBlockDrop,
  });

  if (!timelineReady || expandedElements.length === 0) {
    return (
      <TimelineEmptyState
        isDragOver={isDragOver}
        onFileDrop={!!onFileDrop}
        onDragOver={handleAssetDragOver}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleAssetDrop}
      />
    );
  }

  return (
    <div
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
        onDragOver={handleAssetDragOver}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleAssetDrop}
        onPointerDown={(e) => {
          if (activeTool === "razor" && e.shiftKey && e.button === 0 && scrollRef.current) {
            const rect = scrollRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left + scrollRef.current.scrollLeft - GUTTER;
            const splitTime = Math.max(0, x / pps);
            onRazorSplitAll?.(splitTime);
            return;
          }
          if (handleMarqueePointerDown(e)) return;
          handlePointerDown(e);
        }}
        onPointerMove={(e) => {
          if (handleMarqueePointerMove(e)) return;
          handlePointerMove(e);
        }}
        onPointerUp={releasePointer}
        onLostPointerCapture={releasePointer}
      >
        <TimelineCanvas
          major={major}
          minor={minor}
          pps={pps}
          trackContentWidth={trackContentWidth}
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
          hoveredClip={hoveredClip}
          draggedClip={draggedClip}
          resizingClip={resizingClip}
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
          onClickKeyframe={keyframeHandlers.onClickKeyframe}
          onShiftClickKeyframe={keyframeHandlers.onShiftClickKeyframe}
          onMoveKeyframe={onMoveKeyframe}
          onContextMenuKeyframe={keyframeHandlers.onContextMenuKeyframe}
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

      {showShortcutHint && !showPopover && !rangeSelection && (
        <TimelineShortcutHint theme={theme} />
      )}

      {showPopover && rangeSelection && (
        <EditPopover
          rangeStart={rangeSelection.start}
          rangeEnd={rangeSelection.end}
          anchorX={rangeSelection.anchorX}
          anchorY={rangeSelection.anchorY}
          onClose={() => {
            setShowPopover(false);
            setRangeSelection(null);
          }}
        />
      )}

      {kfContextMenu && (
        <KeyframeDiamondContextMenu
          state={kfContextMenu}
          onClose={() => setKfContextMenu(null)}
          onDelete={(elId, pct) => onDeleteKeyframe?.(elId, pct)}
          onDeleteAll={(elId) => onDeleteAllKeyframes?.(elId)}
          onChangeEase={(elId, pct, ease) => onChangeKeyframeEase?.(elId, pct, ease)}
          onMoveToPlayhead={
            onMoveKeyframeToPlayhead
              ? (elId, pct) => onMoveKeyframeToPlayhead(elId, pct)
              : undefined
          }
          onCopyProperties={(elId, pct) => {
            const kfData = keyframeCache.get(elId);
            const kf = kfData?.keyframes.find((k) => k.percentage === pct);
            if (kf) {
              void navigator.clipboard.writeText(JSON.stringify(kf.properties, null, 2));
            }
          }}
        />
      )}

      {clipContextMenu && (
        <ClipContextMenu
          x={clipContextMenu.x}
          y={clipContextMenu.y}
          element={clipContextMenu.element}
          currentTime={currentTime}
          onClose={() => setClipContextMenu(null)}
          onSplit={(el, time) => onSplitElement?.(el, time)}
          onDelete={(el) => _onDeleteElement?.(el)}
        />
      )}
    </div>
  );
});
