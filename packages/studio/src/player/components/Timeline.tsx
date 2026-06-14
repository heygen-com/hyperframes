import { useRef, useMemo, useCallback, useState, useEffect, memo, type ReactNode } from "react";
import { useMusicBeatAnalysis } from "../../hooks/useMusicBeatAnalysis";
import { isMusicTrack } from "../../utils/timelineInspector";
import { remapBeatAnalysisToComposition } from "../../utils/beatEditActions";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { useMountEffect } from "../../hooks/useMountEffect";
import { EditPopover } from "./EditModal";
import { defaultTimelineTheme, type TimelineTheme } from "./timelineTheme";
import { useTimelineRangeSelection } from "./useTimelineRangeSelection";
import { useTimelinePlayhead } from "./useTimelinePlayhead";
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
import { snapKeyframePctToBeat } from "./timelineEditing";
import { ClipContextMenu } from "./ClipContextMenu";
import {
  GUTTER,
  generateTicks,
  getTimelineCanvasHeight,
  shouldShowTimelineShortcutHint,
} from "./timelineLayout";
import type { TimelineDropCallbacks } from "./timelineCallbacks";
import { useTimelineEditContext } from "../../contexts/TimelineEditContext";

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

interface TimelineProps extends TimelineDropCallbacks {
  onSeek?: (time: number) => void;
  onDrillDown?: (element: TimelineElement) => void;
  renderClipContent?: (
    element: TimelineElement,
    style: { clip: string; label: string },
  ) => ReactNode;
  renderClipOverlay?: (element: TimelineElement) => ReactNode;
  onDeleteElement?: (element: TimelineElement) => Promise<void> | void;
  onSelectElement?: (element: TimelineElement | null) => void;
  theme?: Partial<TimelineTheme>;
}

export const Timeline = memo(function Timeline({
  onSeek,
  onDrillDown,
  renderClipContent,
  renderClipOverlay,
  onFileDrop,
  onAssetDrop,
  onBlockDrop,
  onDeleteElement: _onDeleteElement,
  onSelectElement,
  theme: themeOverrides,
}: TimelineProps = {}) {
  const {
    onMoveElement,
    onResizeElement,
    onBlockedEditAttempt,
    onSplitElement,
    onRazorSplitAll,
    onDeleteKeyframe,
    onDeleteAllKeyframes,
    onChangeKeyframeEase,
    onMoveKeyframe,
  } = useTimelineEditContext();
  const theme = useMemo(() => ({ ...defaultTimelineTheme, ...themeOverrides }), [themeOverrides]);
  useMusicBeatAnalysis();
  const elements = usePlayerStore((s) => s.elements);
  const beatAnalysis = usePlayerStore((s) => s.beatAnalysis);
  const musicElement = usePlayerStore((s) => s.elements.find(isMusicTrack) ?? null);

  // Merge user edits + remap beats from audio-file → composition coordinates.
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

  const setContainerRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (roRef.current) {
        roRef.current.disconnect();
        roRef.current = null;
      }
      containerRef.current = el;
      if (!el) return;
      setViewportWidth(el.clientWidth);
      scheduleShortcutHintVisibilitySync();
      roRef.current = new ResizeObserver(([entry]) => {
        setViewportWidth(entry.contentRect.width);
        scheduleShortcutHintVisibilitySync();
      });
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
    if (elements.length === 0) return safeDur;
    const maxEnd = Math.max(...elements.map((el) => el.start + el.duration));
    const result = Math.max(safeDur, maxEnd);
    return Number.isFinite(result) ? result : safeDur;
  }, [elements, duration]);

  const tracks = useMemo(() => {
    const map = new Map<number, typeof elements>();
    for (const el of elements) {
      const list = map.get(el.track) ?? [];
      list.push(el);
      map.set(el.track, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [elements]);

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

  const ppsRef = useRef(100);
  const durationRef = useRef(effectiveDuration);
  durationRef.current = effectiveDuration;

  // Stable ref so useTimelineClipDrag can clear rangeSelection without circular dep
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
    durationRef,
    trackOrderRef,
    onMoveElement,
    onResizeElement,
    onBlockedEditAttempt,
    setShowPopover,
    setRangeSelectionRef,
  });

  const displayTrackOrder = useMemo(() => {
    if (
      !draggedClip?.started ||
      trackOrder.length === 0 ||
      trackOrder.includes(draggedClip.previewTrack)
    )
      return trackOrder;
    return [...trackOrder, draggedClip.previewTrack].sort((a, b) => a - b);
  }, [draggedClip, trackOrder]);

  const totalH = getTimelineCanvasHeight(displayTrackOrder.length);
  const keyframeCache = usePlayerStore((s) => s.keyframeCache);
  const selectedKeyframes = usePlayerStore((s) => s.selectedKeyframes);
  const toggleSelectedKeyframe = usePlayerStore((s) => s.toggleSelectedKeyframe);

  const selectedElement = useMemo(
    () => elements.find((element) => (element.key ?? element.id) === selectedElementId) ?? null,
    [elements, selectedElementId],
  );
  const selectedElementRef = useRef<TimelineElement | null>(selectedElement);
  selectedElementRef.current = selectedElement;

  const fitPps =
    viewportWidth > GUTTER && effectiveDuration > 0
      ? (viewportWidth - GUTTER - 2) / effectiveDuration
      : 100;
  const pps = getTimelinePixelsPerSecond(fitPps, zoomMode, manualZoomPercent);
  ppsRef.current = pps;
  const trackContentWidth = Math.max(0, effectiveDuration * pps);
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
    elementsLength: elements.length,
    setZoomMode,
    setManualZoomPercent,
    onSeek,
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

  const { major, minor } = useMemo(
    () => generateTicks(effectiveDuration, pps),
    [effectiveDuration, pps],
  );
  const majorTickInterval =
    major.length >= 2 ? Math.max(0.25, major[1] - major[0]) : effectiveDuration;

  useEffect(() => {
    syncShortcutHintVisibility();
  }, [syncShortcutHintVisibility, timelineReady, elements.length, totalH]);

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
    onFileDrop,
    onAssetDrop,
    onBlockDrop,
  });

  if (!timelineReady || elements.length === 0) {
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
        ref={scrollRef}
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
          trackContentWidth={trackContentWidth}
          totalH={totalH}
          effectiveDuration={effectiveDuration}
          majorTickInterval={majorTickInterval}
          shiftHeld={shiftHeld}
          rangeSelection={rangeSelection}
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
          onClickKeyframe={(el, pct) => {
            usePlayerStore.getState().clearSelectedKeyframes();
            const elKey = el.key ?? el.id;
            setSelectedElementId(elKey);
            onSelectElement?.(el);
            const absTime = el.start + (pct / 100) * el.duration;
            onSeek?.(absTime);
            const kfData = keyframeCache?.get(elKey);
            const kf = kfData?.keyframes.find((k) => Math.abs(k.percentage - pct) < 0.5);
            usePlayerStore.getState().setActiveKeyframePct(kf?.tweenPercentage ?? null);
          }}
          onShiftClickKeyframe={(elId, pct) => {
            toggleSelectedKeyframe(`${elId}:${pct}`);
          }}
          onDragKeyframe={(el, oldPct, newPct) => {
            onMoveKeyframe?.(el, oldPct, newPct);
          }}
          onSnapKeyframePct={(el, pct) =>
            snapKeyframePctToBeat(el, pct, adjustedBeatAnalysis?.beatTimes, pps)
          }
          onPickKeyframeElement={(el) => {
            const elKey = el.key ?? el.id;
            if (selectedElementId !== elKey) {
              setSelectedElementId(elKey);
              onSelectElement?.(el);
            }
          }}
          onContextMenuKeyframe={(e, elId, pct) => {
            const el = elements.find((x) => (x.key ?? x.id) === elId);
            if (el) {
              setSelectedElementId(elId);
              onSelectElement?.(el);
              const absTime = el.start + (pct / 100) * el.duration;
              onSeek?.(absTime);
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

      {showShortcutHint && !showPopover && !rangeSelection && (
        <div className="absolute bottom-2 right-3 pointer-events-none z-20">
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-md border"
            style={{ background: "rgba(17,23,35,0.84)", borderColor: theme.gutterBorder }}
          >
            <kbd
              className="text-[9px] font-mono px-1 py-0.5 rounded"
              style={{ color: theme.textSecondary, background: "rgba(255,255,255,0.06)" }}
            >
              Shift
            </kbd>
            <span className="text-[9px]" style={{ color: theme.textSecondary }}>
              + drag/click to edit range
            </span>
          </div>
        </div>
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
