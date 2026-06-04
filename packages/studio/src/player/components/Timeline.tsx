import { useRef, useMemo, useCallback, useState, useEffect, memo, type ReactNode } from "react";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { useMountEffect } from "../../hooks/useMountEffect";
import { EditPopover } from "./EditModal";
import { type BlockedTimelineEditIntent } from "./timelineEditing";
import { defaultTimelineTheme, type TimelineTheme } from "./timelineTheme";
import { useTimelineRangeSelection } from "./useTimelineRangeSelection";
import { useTimelinePlayhead } from "./useTimelinePlayhead";
import { type TrackVisualStyle, getTrackStyle } from "./timelineIcons";
import { getTimelinePixelsPerSecond } from "./timelineZoom";
import { TIMELINE_ASSET_MIME, TIMELINE_BLOCK_MIME } from "../../utils/timelineAssetDrop";
import { TimelineEmptyState } from "./TimelineEmptyState";
import { TimelineCanvas } from "./TimelineCanvas";
import {
  KeyframeDiamondContextMenu,
  type KeyframeDiamondContextMenuState,
} from "./KeyframeDiamondContextMenu";
import { useTimelineClipDrag } from "./useTimelineClipDrag";
import { ClipContextMenu } from "./ClipContextMenu";
import {
  GUTTER,
  TRACK_H,
  generateTicks,
  getTimelineCanvasHeight,
  shouldShowTimelineShortcutHint,
  resolveTimelineAssetDrop,
} from "./timelineLayout";

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

interface TimelineProps {
  onSeek?: (time: number) => void;
  onDrillDown?: (element: TimelineElement) => void;
  renderClipContent?: (
    element: TimelineElement,
    style: { clip: string; label: string },
  ) => ReactNode;
  renderClipOverlay?: (element: TimelineElement) => ReactNode;
  onFileDrop?: (
    files: File[],
    placement?: { start: number; track: number },
  ) => Promise<void> | void;
  onAssetDrop?: (
    assetPath: string,
    placement: { start: number; track: number },
  ) => Promise<void> | void;
  onBlockDrop?: (
    blockName: string,
    placement: { start: number; track: number },
  ) => Promise<void> | void;
  onDeleteElement?: (element: TimelineElement) => Promise<void> | void;
  onMoveElement?: (
    element: TimelineElement,
    updates: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  onResizeElement?: (
    element: TimelineElement,
    updates: Pick<TimelineElement, "start" | "duration" | "playbackStart">,
  ) => Promise<void> | void;
  onBlockedEditAttempt?: (element: TimelineElement, intent: BlockedTimelineEditIntent) => void;
  onSplitElement?: (element: TimelineElement, splitTime: number) => Promise<void> | void;
  onSelectElement?: (element: TimelineElement | null) => void;
  onDeleteKeyframe?: (elementId: string, percentage: number) => void;
  onDeleteAllKeyframes?: (elementId: string) => void;
  onChangeKeyframeEase?: (elementId: string, percentage: number, ease: string) => void;
  onMoveKeyframe?: (element: TimelineElement, oldPct: number, newPct: number) => void;
  onToggleKeyframeAtPlayhead?: (element: TimelineElement) => void;
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
  onMoveElement,
  onResizeElement,
  onBlockedEditAttempt,
  onSplitElement,
  onSelectElement,
  onDeleteKeyframe,
  onDeleteAllKeyframes,
  onChangeKeyframeEase,
  onMoveKeyframe,
  onToggleKeyframeAtPlayhead,
  theme: themeOverrides,
}: TimelineProps = {}) {
  const theme = useMemo(() => ({ ...defaultTimelineTheme, ...themeOverrides }), [themeOverrides]);
  const elements = usePlayerStore((s) => s.elements);
  const duration = usePlayerStore((s) => s.duration);
  const timelineReady = usePlayerStore((s) => s.timelineReady);
  const selectedElementId = usePlayerStore((s) => s.selectedElementId);
  const setSelectedElementId = usePlayerStore((s) => s.setSelectedElementId);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const zoomMode = usePlayerStore((s) => s.zoomMode);
  const manualZoomPercent = usePlayerStore((s) => s.manualZoomPercent);
  const setZoomMode = usePlayerStore((s) => s.setZoomMode);
  const setManualZoomPercent = usePlayerStore((s) => s.setManualZoomPercent);

  const playheadRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hoveredClip, setHoveredClip] = useState<string | null>(null);
  const isDragging = useRef(false);
  const [shiftHeld, setShiftHeld] = useState(false);

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

  const [isDragOver, setIsDragOver] = useState(false);
  const handleAssetDragOver = useCallback((e: React.DragEvent) => {
    const hasFiles = e.dataTransfer.files.length > 0;
    const types = Array.from(e.dataTransfer.types);
    const hasAsset = types.includes(TIMELINE_ASSET_MIME);
    const hasBlock = types.includes(TIMELINE_BLOCK_MIME);
    if (!hasFiles && !hasAsset && !hasBlock) return;
    e.preventDefault();
    if (hasAsset || hasBlock) e.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  }, []);

  const handleAssetDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const scroll = scrollRef.current;
      const rect = scroll?.getBoundingClientRect();
      const dropInput = {
        rectLeft: rect?.left ?? 0,
        rectTop: rect?.top ?? 0,
        scrollLeft: scroll?.scrollLeft ?? 0,
        scrollTop: scroll?.scrollTop ?? 0,
        pixelsPerSecond: ppsRef.current,
        duration: durationRef.current,
        trackHeight: TRACK_H,
        trackOrder: trackOrderRef.current,
      };
      if (onFileDrop && e.dataTransfer.files.length > 0) {
        void onFileDrop(
          Array.from(e.dataTransfer.files),
          scroll && rect ? resolveTimelineAssetDrop(dropInput, e.clientX, e.clientY) : undefined,
        );
        return;
      }
      const assetPayload = e.dataTransfer.getData(TIMELINE_ASSET_MIME);
      if (assetPayload && onAssetDrop && scroll && rect) {
        try {
          const parsed = JSON.parse(assetPayload) as { path?: string };
          if (parsed.path)
            void onAssetDrop(
              parsed.path,
              resolveTimelineAssetDrop(dropInput, e.clientX, e.clientY),
            );
        } catch {
          /* ignore malformed drag payloads */
        }
        return;
      }
      const blockPayload = e.dataTransfer.getData(TIMELINE_BLOCK_MIME);
      if (blockPayload && onBlockDrop && scroll && rect) {
        try {
          const parsed = JSON.parse(blockPayload) as { name?: string };
          if (parsed.name)
            void onBlockDrop(
              parsed.name,
              resolveTimelineAssetDrop(dropInput, e.clientX, e.clientY),
            );
        } catch {
          /* ignore malformed drag payloads */
        }
      }
    },
    [onAssetDrop, onBlockDrop, onFileDrop],
  );

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
      className={`relative border-t select-none h-full overflow-hidden ${shiftHeld ? "cursor-crosshair" : "cursor-default"}`}
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
        onPointerDown={handlePointerDown}
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
          onResizeElement={onResizeElement}
          onMoveElement={onMoveElement}
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
          onToggleKeyframeAtPlayhead={onToggleKeyframeAtPlayhead}
          onClickKeyframe={(el, pct) => {
            usePlayerStore.getState().clearSelectedKeyframes();
            const elKey = el.key ?? el.id;
            setSelectedElementId(elKey);
            onSelectElement?.(el);
            const absTime = el.start + (pct / 100) * el.duration;
            onSeek?.(absTime);
          }}
          onShiftClickKeyframe={(elId, pct) => {
            toggleSelectedKeyframe(`${elId}:${pct}`);
          }}
          onDragKeyframe={(el, oldPct, newPct) => {
            onMoveKeyframe?.(el, oldPct, newPct);
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
            const kf = kfData?.keyframes.find((k) => k.percentage === pct);
            setKfContextMenu({
              x: e.clientX,
              y: e.clientY,
              elementId: elId,
              percentage: pct,
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
