import { memo, type ReactNode } from "react";
import { TimelineClip } from "./TimelineClip";
import { TimelineClipDiamonds } from "./TimelineClipDiamonds";
import { TimelineRuler } from "./TimelineRuler";
import { PlayheadIndicator } from "./PlayheadIndicator";
import {
  getTimelineEditCapabilities,
  resolveBlockedTimelineEditIntent,
  type TimelineRangeSelection,
} from "./timelineEditing";
import { getRenderedTimelineElement, type TimelineTheme } from "./timelineTheme";
import { GUTTER, TRACK_H, RULER_H, CLIP_Y, CLIP_HANDLE_W } from "./timelineLayout";
import {
  usePlayerStore,
  type TimelineElement,
  type KeyframeCacheEntry,
} from "../store/playerStore";
import type { DraggedClipState, ResizingClipState, BlockedClipState } from "./useTimelineClipDrag";
import type { TrackVisualStyle } from "./timelineIcons";
import { STUDIO_KEYFRAMES_ENABLED } from "../../components/editor/manualEditingAvailability";
import { SPLIT_BOUNDARY_EPSILON_S } from "../../utils/timelineElementSplit";
import { useTimelineEditContext } from "../../contexts/TimelineEditContext";

function ClipLabel({ element, color }: { element: TimelineElement; color: string }) {
  const lint = usePlayerStore((s) => s.lintFindingsByElement.get(element.key ?? element.id));
  return (
    <span
      className="flex items-center gap-1 truncate text-[10px] font-medium leading-none"
      style={{ color }}
    >
      {element.label || element.id || element.tag}
      {lint && lint.count > 0 && (
        <span
          className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-amber-400"
          title={lint.messages.join("\n")}
        />
      )}
    </span>
  );
}

interface TimelineCanvasProps {
  major: number[];
  minor: number[];
  pps: number;
  trackContentWidth: number;
  totalH: number;
  effectiveDuration: number;
  majorTickInterval: number;
  shiftHeld: boolean;
  rangeSelection: TimelineRangeSelection | null;
  theme: TimelineTheme;
  displayTrackOrder: number[];
  trackOrder: number[];
  tracks: [number, TimelineElement[]][];
  trackStyles: Map<number, TrackVisualStyle>;
  selectedElementId: string | null;
  hoveredClip: string | null;
  draggedClip: DraggedClipState | null;
  resizingClip: ResizingClipState | null;
  blockedClipRef: React.RefObject<BlockedClipState | null>;
  suppressClickRef: React.RefObject<boolean>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  renderClipContent?: (
    element: TimelineElement,
    style: { clip: string; label: string },
  ) => ReactNode;
  renderClipOverlay?: (element: TimelineElement) => ReactNode;
  playheadRef: React.RefObject<HTMLDivElement | null>;
  onDrillDown?: (element: TimelineElement) => void;
  onSelectElement?: (element: TimelineElement | null) => void;
  setHoveredClip: (key: string | null) => void;
  setShowPopover: (v: boolean) => void;
  setRangeSelection: (v: null) => void;
  setResizingClip: (v: ResizingClipState | null) => void;
  setDraggedClip: (v: DraggedClipState | null) => void;
  setSelectedElementId: (id: string | null) => void;
  syncClipDragAutoScroll: (x: number, y: number) => void;
  shiftClickClipRef: React.RefObject<{
    element: TimelineElement;
    anchorX: number;
    anchorY: number;
  } | null>;
  getPreviewElement: (element: TimelineElement) => TimelineElement;
  getTrackStyle: (tag: string) => TrackVisualStyle;
  keyframeCache?: Map<string, KeyframeCacheEntry>;
  selectedKeyframes: Set<string>;
  currentTime: number;
  onClickKeyframe?: (element: TimelineElement, percentage: number) => void;
  onShiftClickKeyframe?: (elementId: string, percentage: number) => void;
  onDragKeyframe?: (element: TimelineElement, oldPct: number, newPct: number) => void;
  onContextMenuKeyframe?: (e: React.MouseEvent, elementId: string, percentage: number) => void;
  onContextMenuClip?: (e: React.MouseEvent, element: TimelineElement) => void;
}

export const TimelineCanvas = memo(function TimelineCanvas({
  major,
  minor,
  pps,
  trackContentWidth,
  totalH,
  effectiveDuration,
  majorTickInterval,
  shiftHeld,
  rangeSelection,
  theme,
  displayTrackOrder,
  trackOrder,
  tracks,
  trackStyles,
  selectedElementId,
  hoveredClip,
  draggedClip,
  resizingClip: _resizingClip,
  blockedClipRef,
  suppressClickRef,
  scrollRef,
  renderClipContent,
  renderClipOverlay,
  playheadRef,
  onDrillDown,
  onSelectElement,
  setHoveredClip,
  setShowPopover,
  setRangeSelection,
  setResizingClip,
  setDraggedClip,
  setSelectedElementId,
  syncClipDragAutoScroll,
  shiftClickClipRef,
  getPreviewElement,
  getTrackStyle,
  keyframeCache,
  selectedKeyframes,
  currentTime,
  onClickKeyframe,
  onShiftClickKeyframe,
  onDragKeyframe,
  onContextMenuKeyframe,
  onContextMenuClip,
}: TimelineCanvasProps) {
  const { onResizeElement, onMoveElement, onRazorSplit, onRazorSplitAll } =
    useTimelineEditContext();
  const draggedElement = draggedClip?.element ?? null;
  const activeDraggedElement =
    draggedClip?.started === true && draggedElement
      ? getRenderedTimelineElement({
          element: draggedElement,
          draggedElementId: draggedElement.key ?? draggedElement.id,
          previewStart: draggedClip.previewStart,
          previewTrack: draggedClip.previewTrack,
        })
      : null;
  const activeDraggedPosition =
    draggedClip?.started === true && activeDraggedElement && scrollRef.current
      ? {
          left:
            draggedClip.pointerClientX -
            scrollRef.current.getBoundingClientRect().left +
            scrollRef.current.scrollLeft -
            draggedClip.pointerOffsetX,
          top:
            draggedClip.pointerClientY -
            scrollRef.current.getBoundingClientRect().top +
            scrollRef.current.scrollTop -
            draggedClip.pointerOffsetY,
        }
      : null;

  const renderClipChildren = (element: TimelineElement, clipStyle: TrackVisualStyle) => (
    <>
      {renderClipOverlay?.(element)}
      <div
        className={
          renderClipContent
            ? "absolute inset-0 overflow-hidden"
            : "flex items-center overflow-hidden flex-1 min-w-0 px-3 gap-2"
        }
      >
        {renderClipContent?.(element, clipStyle) ?? (
          <ClipLabel element={element} color={clipStyle.label} />
        )}
      </div>
    </>
  );

  return (
    <div className="relative" style={{ height: totalH, width: GUTTER + trackContentWidth }}>
      <TimelineRuler
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
      />

      {displayTrackOrder.map((trackNum) => {
        const els = tracks.find(([t]) => t === trackNum)?.[1] ?? [];
        const ts = trackStyles.get(trackNum) ?? getTrackStyle("");
        const isPendingTrack =
          draggedClip?.started === true && !trackOrder.includes(trackNum) && els.length === 0;
        return (
          <div
            key={trackNum}
            className="relative flex"
            style={{
              height: TRACK_H,
              background: theme.rowBackground,
              borderBottom: `1px solid ${theme.rowBorder}`,
            }}
          >
            <div
              className="flex-shrink-0 flex items-center justify-center"
              style={{
                width: GUTTER,
                background: theme.gutterBackground,
                borderRight: `1px solid ${theme.gutterBorder}`,
              }}
            >
              <div
                className="flex items-center justify-center"
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 6,
                  backgroundColor: ts.iconBackground,
                  border: `1px solid ${theme.gutterBorder}`,
                  color: "#fff",
                }}
              >
                {ts.icon}
              </div>
            </div>
            <div style={{ width: trackContentWidth }} className="relative">
              {isPendingTrack && (
                <div
                  className="absolute inset-0 flex items-center"
                  style={{
                    paddingLeft: 16,
                    color: ts.label,
                    fontSize: 11,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    opacity: 0.5,
                  }}
                >
                  New track
                </div>
              )}
              {els.map((el, i) => {
                const clipStyle = getTrackStyle(el.tag);
                const elementKey = el.key ?? el.id;
                const capabilities = getTimelineEditCapabilities(el);
                const isSelected = selectedElementId === elementKey;
                const isComposition = !!el.compositionSrc;
                const clipKey = `${elementKey}-${i}`;
                const isDraggingClip =
                  draggedClip?.started === true &&
                  (draggedElement?.key ?? draggedElement?.id) === elementKey;
                if (isDraggingClip) return null;
                const previewElement = getPreviewElement(el);
                return (
                  <TimelineClip
                    key={clipKey}
                    onContextMenu={(e: React.MouseEvent) => {
                      e.preventDefault();
                      onContextMenuClip?.(e, el);
                    }}
                    el={previewElement}
                    pps={pps}
                    clipY={CLIP_Y}
                    isSelected={isSelected}
                    isHovered={hoveredClip === clipKey}
                    isDragging={false}
                    hasCustomContent={!!renderClipContent}
                    capabilities={capabilities}
                    theme={theme}
                    trackStyle={clipStyle}
                    isComposition={isComposition}
                    onHoverStart={() => setHoveredClip(clipKey)}
                    onHoverEnd={() => setHoveredClip(null)}
                    onResizeStart={(edge, e) => {
                      if (e.button !== 0 || e.shiftKey || !onResizeElement) return;
                      if (edge === "start" && !capabilities.canTrimStart) return;
                      if (edge === "end" && !capabilities.canTrimEnd) return;
                      e.stopPropagation();
                      blockedClipRef.current = null;
                      setShowPopover(false);
                      setRangeSelection(null);
                      setResizingClip({
                        element: el,
                        edge,
                        originClientX: e.clientX,
                        previewStart: el.start,
                        previewDuration: el.duration,
                        previewPlaybackStart: el.playbackStart,
                        started: false,
                      });
                    }}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      if (usePlayerStore.getState().activeTool === "razor") return;
                      if (e.shiftKey) {
                        shiftClickClipRef.current = {
                          element: el,
                          anchorX: e.clientX,
                          anchorY: e.clientY,
                        };
                        return;
                      }
                      const target = e.currentTarget as HTMLElement;
                      const rect = target.getBoundingClientRect();
                      const blockedIntent = resolveBlockedTimelineEditIntent({
                        width: rect.width,
                        offsetX: e.clientX - rect.left,
                        handleWidth: CLIP_HANDLE_W,
                        capabilities,
                      });
                      if (
                        blockedIntent &&
                        ((blockedIntent === "move" && onMoveElement) ||
                          (blockedIntent !== "move" && onResizeElement))
                      ) {
                        blockedClipRef.current = {
                          element: el,
                          intent: blockedIntent,
                          originClientX: e.clientX,
                          originClientY: e.clientY,
                          started: false,
                        };
                        return;
                      }
                      if (!onMoveElement || !capabilities.canMove) return;
                      blockedClipRef.current = null;
                      setShowPopover(false);
                      setRangeSelection(null);
                      setDraggedClip({
                        element: el,
                        originClientX: e.clientX,
                        originClientY: e.clientY,
                        originScrollLeft: scrollRef.current?.scrollLeft ?? 0,
                        originScrollTop: scrollRef.current?.scrollTop ?? 0,
                        pointerClientX: e.clientX,
                        pointerClientY: e.clientY,
                        pointerOffsetX: e.clientX - rect.left,
                        pointerOffsetY: e.clientY - rect.top,
                        previewStart: el.start,
                        previewTrack: el.track,
                        started: false,
                      });
                      syncClipDragAutoScroll(e.clientX, e.clientY);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (suppressClickRef.current) return;
                      const { activeTool } = usePlayerStore.getState();
                      if (activeTool === "razor" && onRazorSplit) {
                        const clipRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const clickOffsetX = e.clientX - clipRect.left;
                        const splitTime = previewElement.start + clickOffsetX / pps;
                        const clampedTime = Math.max(
                          previewElement.start + SPLIT_BOUNDARY_EPSILON_S,
                          Math.min(
                            previewElement.start +
                              previewElement.duration -
                              SPLIT_BOUNDARY_EPSILON_S,
                            splitTime,
                          ),
                        );
                        if (e.shiftKey && onRazorSplitAll) {
                          onRazorSplitAll(clampedTime);
                        } else {
                          onRazorSplit(el, clampedTime);
                        }
                        return;
                      }
                      const nextElement = isSelected ? null : el;
                      setSelectedElementId(nextElement ? elementKey : null);
                      onSelectElement?.(nextElement);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (suppressClickRef.current) return;
                      if (isComposition && onDrillDown) onDrillDown(el);
                    }}
                  >
                    {renderClipChildren(previewElement, clipStyle)}
                    {STUDIO_KEYFRAMES_ENABLED && keyframeCache?.get(elementKey) && (
                      <TimelineClipDiamonds
                        keyframesData={keyframeCache.get(elementKey)!}
                        clipWidthPx={Math.max(previewElement.duration * pps, 4)}
                        clipHeightPx={TRACK_H - 2 * CLIP_Y}
                        accentColor={clipStyle.accent}
                        isSelected={isSelected}
                        currentPercentage={
                          previewElement.duration > 0
                            ? ((currentTime - previewElement.start) / previewElement.duration) * 100
                            : 0
                        }
                        elementId={elementKey}
                        selectedKeyframes={selectedKeyframes}
                        onClickKeyframe={(pct) => onClickKeyframe?.(previewElement, pct)}
                        onShiftClickKeyframe={onShiftClickKeyframe}
                        onDragKeyframe={(oldPct, newPct) =>
                          onDragKeyframe?.(previewElement, oldPct, newPct)
                        }
                        onContextMenuKeyframe={onContextMenuKeyframe}
                      />
                    )}
                  </TimelineClip>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Drag ghost */}
      {activeDraggedElement && activeDraggedPosition && (
        <div
          className="absolute pointer-events-none"
          style={{
            top: activeDraggedPosition.top,
            left: activeDraggedPosition.left,
            width: Math.max(activeDraggedElement.duration * pps, 4),
            height: TRACK_H - CLIP_Y * 2,
            zIndex: 40,
          }}
        >
          <TimelineClip
            el={{ ...activeDraggedElement, start: 0 }}
            pps={pps}
            clipY={0}
            isSelected={selectedElementId === (activeDraggedElement.key ?? activeDraggedElement.id)}
            isHovered={false}
            isDragging={true}
            hasCustomContent={!!renderClipContent}
            capabilities={getTimelineEditCapabilities(activeDraggedElement)}
            theme={theme}
            trackStyle={getTrackStyle(activeDraggedElement.tag)}
            isComposition={!!activeDraggedElement.compositionSrc}
            onHoverStart={() => {}}
            onHoverEnd={() => {}}
            onResizeStart={() => {}}
            onClick={() => {}}
            onDoubleClick={() => {}}
          >
            {renderClipChildren(activeDraggedElement, getTrackStyle(activeDraggedElement.tag))}
          </TimelineClip>
        </div>
      )}

      {/* Range highlight */}
      {rangeSelection && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: GUTTER + Math.min(rangeSelection.start, rangeSelection.end) * pps,
            width: Math.abs(rangeSelection.end - rangeSelection.start) * pps,
            top: RULER_H,
            bottom: 0,
            backgroundColor: "rgba(59, 130, 246, 0.12)",
            borderLeft: "1px solid rgba(59, 130, 246, 0.4)",
            borderRight: "1px solid rgba(59, 130, 246, 0.4)",
            zIndex: 50,
          }}
        />
      )}

      {/* Playhead */}
      <div
        ref={playheadRef}
        className="absolute top-0 bottom-0 pointer-events-none"
        style={{ left: `${GUTTER}px`, zIndex: 100 }}
      >
        <PlayheadIndicator />
      </div>
    </div>
  );
});
