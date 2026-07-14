import { memo } from "react";
import { TimelineRuler } from "./TimelineRuler";
import { PlayheadIndicator } from "./PlayheadIndicator";
import { getTimelineEditCapabilities, type TimelineRangeSelection } from "./timelineEditing";
import { getRenderedTimelineElement } from "./timelineTheme";
import {
  GUTTER,
  TRACK_H,
  RULER_H,
  CLIP_Y,
  TRACKS_TOP_PAD,
  TRACKS_BOTTOM_PAD,
  PLAYHEAD_HEAD_W,
  getTimelinePlayheadLeft,
  getTimelineRowTop,
} from "./timelineLayout";
import { usePlayerStore } from "../store/playerStore";
import type { ResizingClipState } from "./useTimelineClipDrag";
import { type MultiDragPreviewInput } from "./timelineMultiDragPreview";
import { useTimelineEditContextOptional } from "../../contexts/TimelineEditContext";
import type { Rect } from "../../utils/marqueeGeometry";
import { TimelineClip } from "./TimelineClip";
import { TimelineLanes, type TimelineLaneBaseProps } from "./TimelineLanes";
import { renderClipChildren } from "./timelineClipChildren";
import { useTimelineRevealClip } from "./useTimelineRevealClip";

interface TimelineCanvasProps extends TimelineLaneBaseProps {
  major: number[];
  minor: number[];
  totalH: number;
  effectiveDuration: number;
  majorTickInterval: number;
  rangeSelection: TimelineRangeSelection | null;
  /** Live rubber-band multi-select rectangle (canvas coordinates), or null. */
  marqueeRect: Rect | null;
  resizingClip: ResizingClipState | null;
  /** Playhead is being actively scrubbed — fills the grab-handle head. */
  isScrubbing: boolean;
  playheadRef: React.RefObject<HTMLDivElement | null>;
}

export const TimelineCanvas = memo(function TimelineCanvas(props: TimelineCanvasProps) {
  const { draggedClip, scrollRef, selectedElementIds, displayTrackOrder } = props;
  const { onResizeElement, onMoveElement, onToggleTrackHidden, onRazorSplit, onRazorSplitAll } =
    useTimelineEditContextOptional();
  const beatDragging = usePlayerStore((s) => s.beatDragging);
  // Scroll a clip into view when the sidebar (asset card) requests a reveal.
  useTimelineRevealClip(scrollRef);
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
  // The drag ghost follows the cursor freely (both axes) — CapCut-style. The
  // "magnetic" affordance is a highlight on the destination lane (draggedRowIndex),
  // which flips at the MAGNETIC_TRACK_THRESHOLD point; the clip drops into it.
  const draggedRowIndex =
    draggedClip?.started === true ? displayTrackOrder.indexOf(draggedClip.previewTrack) : -1;
  // Live multi-selection drag: while a selected clip is dragged, ALL selected
  // clips move together as one rigid formation. The GRABBED clip is the free
  // ghost below; its co-selected "passengers" slide by the SAME group-clamped
  // delta (cheap translateX, no re-layout) — the delta is derived from the
  // grabbed clip's ALREADY-clamped previewStart, so the whole formation stops at
  // the wall together and never deforms. Matches what the commit will do — see
  // timelineMultiDragPreview + commit.
  const multiDragPreview: MultiDragPreviewInput | null =
    draggedClip?.started === true && draggedElement
      ? {
          dragStarted: true,
          draggedKey: draggedElement.key ?? draggedElement.id,
          draggedOriginStart: draggedElement.start,
          draggedPreviewStart: draggedClip.previewStart,
          selectedKeys: selectedElementIds,
        }
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

  return (
    <div
      className="relative"
      style={{ height: props.totalH, width: GUTTER + props.trackContentWidth }}
    >
      <TimelineRuler
        major={props.major}
        minor={props.minor}
        pps={props.pps}
        trackContentWidth={props.trackContentWidth}
        totalH={props.totalH}
        effectiveDuration={props.effectiveDuration}
        majorTickInterval={props.majorTickInterval}
        theme={props.theme}
        beatAnalysis={props.beatAnalysis}
      />

      {/* Breathing room between the sticky ruler and the first track lane — the
          top half of the CapCut-style padding (see TRACKS_TOP_PAD). */}
      <div aria-hidden="true" style={{ height: TRACKS_TOP_PAD }} />

      <TimelineLanes
        {...props}
        draggedElement={draggedElement}
        multiDragPreview={multiDragPreview}
        onToggleTrackHidden={onToggleTrackHidden}
        onResizeElement={onResizeElement}
        onMoveElement={onMoveElement}
        onRazorSplit={onRazorSplit}
        onRazorSplitAll={onRazorSplitAll}
      />

      {/* Breathing room below the last track lane (~1.5 track heights) — a real
          scrollable surface, so a clip can be dragged into the void to create a
          new bottom track comfortably (see TRACKS_BOTTOM_PAD / getTimelineCanvasHeight). */}
      <div aria-hidden="true" style={{ height: TRACKS_BOTTOM_PAD }} />

      {/* Drop placeholder — a clip-sized slot at the exact landing spot (target
          lane + snapped start), parallel to the ghost. Hidden in insert mode. */}
      {draggedClip?.started && draggedClip.insertRow == null && draggedRowIndex >= 0 && (
        <div
          className="absolute pointer-events-none"
          style={{
            top: getTimelineRowTop(draggedRowIndex) + CLIP_Y,
            left: GUTTER + draggedClip.previewStart * props.pps,
            width: Math.max(draggedClip.element.duration * props.pps, 4),
            height: TRACK_H - CLIP_Y * 2,
            border: "1px solid rgba(60,230,172,0.55)",
            background: "rgba(60,230,172,0.12)",
            borderRadius: 4,
            zIndex: 30,
          }}
        />
      )}

      {/* Insertion line — a new track will be inserted at this boundary on drop.
          Shown while the pointer is near a lane boundary (insert mode). */}
      {draggedClip?.started && draggedClip.insertRow != null && (
        <div
          className="absolute pointer-events-none"
          style={{
            top: getTimelineRowTop(draggedClip.insertRow) - 0.5,
            left: GUTTER,
            width: props.trackContentWidth,
            height: 1,
            background: "#3CE6AC",
            boxShadow: "0 0 3px rgba(60,230,172,0.5)",
            zIndex: 55,
          }}
        />
      )}

      {/* Snap guide for non-beat targets during clip drag */}
      {draggedClip?.started && draggedClip.snapTime != null && draggedClip.snapType !== "beat" && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: GUTTER + draggedClip.snapTime * props.pps,
            top: RULER_H,
            bottom: 0,
            width: 1,
            background: draggedClip.snapType === "playhead" ? "#3CE6AC" : "rgba(255,255,255,0.6)",
            boxShadow:
              draggedClip.snapType === "playhead"
                ? "0 0 6px rgba(60,230,172,0.5)"
                : "0 0 6px rgba(255,255,255,0.4)",
            zIndex: 60,
          }}
        />
      )}

      {/* Drag ghost */}
      {activeDraggedElement && activeDraggedPosition && (
        <div
          className="absolute pointer-events-none"
          style={{
            top: activeDraggedPosition.top,
            left: activeDraggedPosition.left,
            width: Math.max(activeDraggedElement.duration * props.pps, 4),
            height: TRACK_H - CLIP_Y * 2,
            zIndex: 40,
          }}
        >
          <TimelineClip
            el={{ ...activeDraggedElement, start: 0 }}
            pps={props.pps}
            clipY={0}
            isSelected={
              props.selectedElementId === (activeDraggedElement.key ?? activeDraggedElement.id)
            }
            isHovered={false}
            isDragging={true}
            hasCustomContent={!!props.renderClipContent}
            capabilities={getTimelineEditCapabilities(activeDraggedElement)}
            theme={props.theme}
            isComposition={!!activeDraggedElement.compositionSrc}
            onHoverStart={() => {}}
            onHoverEnd={() => {}}
            onResizeStart={() => {}}
            onClick={() => {}}
            onDoubleClick={() => {}}
          >
            {renderClipChildren(
              activeDraggedElement,
              props.getTrackStyle(activeDraggedElement.tag),
              props.renderClipContent,
              props.renderClipOverlay,
            )}
          </TimelineClip>
        </div>
      )}

      {/* Marquee (rubber-band) multi-select rectangle — mirrors the canvas
          MarqueeOverlay look: semi-transparent accent fill + dashed border. */}
      {props.marqueeRect && (
        <div
          aria-hidden="true"
          className="absolute pointer-events-none"
          style={{
            left: props.marqueeRect.left,
            top: props.marqueeRect.top,
            width: props.marqueeRect.width,
            height: props.marqueeRect.height,
            background: "rgba(60,230,172,0.10)",
            border: "1px dashed rgba(60,230,172,0.7)",
            borderRadius: 2,
            zIndex: 70,
          }}
        />
      )}

      {/* Range highlight */}
      {props.rangeSelection && (
        <div
          className="absolute pointer-events-none"
          style={{
            left:
              GUTTER + Math.min(props.rangeSelection.start, props.rangeSelection.end) * props.pps,
            width: Math.abs(props.rangeSelection.end - props.rangeSelection.start) * props.pps,
            top: RULER_H,
            bottom: 0,
            backgroundColor: "rgba(59, 130, 246, 0.12)",
            borderLeft: "1px solid rgba(59, 130, 246, 0.4)",
            borderRight: "1px solid rgba(59, 130, 246, 0.4)",
            zIndex: 50,
          }}
        />
      )}

      {/* Playhead — hidden while dragging a beat so its guideline doesn't
          track the scrub and clutter the beat being moved. Explicit width +
          the half-head offset baked into getTimelinePlayheadLeft keep the
          inner 1px line's CENTER exactly on GUTTER + t * pps (the ruler
          ticks' center), instead of relying on shrink-wrap sizing. */}
      <div
        ref={props.playheadRef}
        className="absolute top-0 bottom-0 pointer-events-none"
        style={{
          left: `${getTimelinePlayheadLeft(0, 0)}px`,
          width: PLAYHEAD_HEAD_W,
          zIndex: 100,
          display: beatDragging ? "none" : undefined,
        }}
      >
        <PlayheadIndicator scrubbing={props.isScrubbing} />
      </div>
    </div>
  );
});
