import { memo, type ReactNode } from "react";
import { TimelineClip } from "./TimelineClip";
import { TimelineRuler } from "./TimelineRuler";
import {
  getTimelineEditCapabilities,
  resolveBlockedTimelineEditIntent,
  type TimelineRangeSelection,
} from "./timelineEditing";
import { getRenderedTimelineElement, type TimelineTheme } from "./timelineTheme";
import { GUTTER, TRACK_H, RULER_H, CLIP_Y, CLIP_HANDLE_W } from "./timelineLayout";
import type { TimelineElement } from "../store/playerStore";
import type { DraggedClipState, ResizingClipState, BlockedClipState } from "./useTimelineClipDrag";
import { formatTime } from "../lib/time";
import type { TrackVisualStyle } from "./timelineIcons";

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
  onResizeElement?: unknown;
  onMoveElement?: unknown;
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
  onResizeElement,
  onMoveElement,
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
}: TimelineCanvasProps) {
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
            : "flex flex-col justify-center overflow-hidden flex-1 min-w-0 px-6"
        }
      >
        {renderClipContent?.(element, clipStyle) ?? (
          <div className="flex h-full min-h-0 flex-col justify-between py-3">
            <span
              className="max-w-full truncate rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] leading-none"
              style={{
                color: clipStyle.label,
                background: `${clipStyle.accent}26`,
                boxShadow: `inset 0 0 0 1px ${clipStyle.accent}33`,
              }}
            >
              {element.tag}
            </span>
            <span
              className="max-w-full truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums leading-none"
              style={{ color: theme.textSecondary, background: "rgba(255,255,255,0.04)" }}
            >
              {formatTime(element.start)} {"→"} {formatTime(element.start + element.duration)}
            </span>
          </div>
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
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    background: `linear-gradient(90deg, ${ts.accent}14, transparent 28%)`,
                    boxShadow: `inset 0 0 0 1px ${ts.accent}24`,
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
        <div
          className="absolute top-0 bottom-0"
          style={{
            left: "50%",
            width: 2,
            marginLeft: -1,
            background: "var(--hf-accent, #3CE6AC)",
            boxShadow: "0 0 8px rgba(60,230,172,0.5)",
          }}
        />
        <div className="absolute" style={{ left: "50%", top: 0, transform: "translateX(-50%)" }}>
          <div
            style={{
              width: 0,
              height: 0,
              borderLeft: "6px solid transparent",
              borderRight: "6px solid transparent",
              borderTop: "8px solid var(--hf-accent, #3CE6AC)",
              filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.6))",
            }}
          />
        </div>
      </div>
    </div>
  );
});
