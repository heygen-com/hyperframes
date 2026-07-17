import { memo } from "react";
import { TimelineRuler } from "./TimelineRuler";
import { PlayheadIndicator } from "./PlayheadIndicator";
import { type TimelineRangeSelection } from "./timelineEditing";
import {
  RULER_H,
  CLIP_Y,
  TRACKS_TOP_PAD,
  TRACKS_BOTTOM_PAD,
  TRACK_H,
  PLAYHEAD_HEAD_W,
  getTimelinePlayheadLeft,
  getTimelineRowTop,
  getTimelineRowHeight,
} from "./timelineLayout";
import { usePlayerStore } from "../store/playerStore";
import type { ResizingClipState } from "./useTimelineClipDrag";
import { type MultiDragPreviewInput } from "./timelineMultiDragPreview";
import { useTimelineEditContextOptional } from "../../contexts/TimelineEditContext";
import type { Rect } from "../../utils/marqueeGeometry";
import { TimelineLanes, type TimelineLaneBaseProps } from "./TimelineLanes";
import type { TimelineLaneGapStrips } from "./useTimelineGapHighlights";
import { TimelineGestureOverlay } from "./TimelineGestureOverlay";

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
  /** Gap strips: loud on gap-menu-row hover, quiet on the selected clip's lane. */
  laneGapStrips: TimelineLaneGapStrips[];
}

export const TimelineCanvas = memo(function TimelineCanvas(props: TimelineCanvasProps) {
  const { draggedClip, scrollRef, selectedElementIds, displayTrackOrder } = props;
  const draggedRowIndex =
    draggedClip?.started === true ? displayTrackOrder.indexOf(draggedClip.previewTrack) : -1;
  const draggedRowHeight = getTimelineRowHeight(draggedRowIndex, props.rowHeights);
  const {
    onResizeElement,
    onMoveElement,
    onToggleTrackHidden,
    onTogglePropertyGroupKeyframe,
    onRazorSplit,
    onRazorSplitAll,
  } = useTimelineEditContextOptional();
  const beatDragging = usePlayerStore((s) => s.beatDragging);
  const draggedElement = draggedClip?.element ?? null;
  // The drag ghost follows the cursor freely (both axes) — CapCut-style. The
  // "magnetic" affordance is a highlight on the destination lane (draggedRowIndex),
  // which flips at the MAGNETIC_TRACK_THRESHOLD point; the clip drops into it.
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

  return (
    <div
      className="relative"
      style={{ height: props.totalH, width: props.contentOrigin + props.trackContentWidth }}
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
        contentOrigin={props.contentOrigin}
        renderTimeRange={props.rowsVirtualized ? props.renderTimeRange : undefined}
      />

      {/* Breathing room between the sticky ruler and the first track lane — the
          top half of the CapCut-style padding (see TRACKS_TOP_PAD). */}
      <div aria-hidden="true" style={{ height: props.rowsVirtualized ? 0 : TRACKS_TOP_PAD }} />

      <TimelineLanes
        {...props}
        draggedElement={draggedElement}
        multiDragPreview={multiDragPreview}
        onToggleTrackHidden={onToggleTrackHidden}
        onTogglePropertyGroupKeyframe={onTogglePropertyGroupKeyframe}
        onResizeElement={onResizeElement}
        onMoveElement={onMoveElement}
        onRazorSplit={onRazorSplit}
        onRazorSplitAll={onRazorSplitAll}
      />

      {/* Breathing room below the last track lane (~1.5 track heights) — a real
          scrollable surface, so a clip can be dragged into the void to create a
          new bottom track comfortably (see TRACKS_BOTTOM_PAD / getTimelineCanvasHeight). */}
      <div aria-hidden="true" style={{ height: props.rowsVirtualized ? 0 : TRACKS_BOTTOM_PAD }} />

      {/* Gap strips — loud dashed fill for the gap(s) a hovered "Close gap(s)"
          menu row would collapse; a quiet tint for every gap on the selected
          clip's lane. Geometry mirrors the drop placeholder (row top + clip
          inset) so strips sit exactly where a clip body would. */}
      {props.laneGapStrips.map((strip) => {
        const rowIndex = displayTrackOrder.indexOf(strip.track);
        if (rowIndex < 0) return null;
        const loud = strip.kind === "hover";
        const visibleIntervals = props.rowsVirtualized
          ? strip.intervals.filter(
              (gap) =>
                gap.start < props.renderTimeRange.end && gap.end > props.renderTimeRange.start,
            )
          : strip.intervals;
        return visibleIntervals.map((gap) => (
          <div
            key={`gap-${strip.kind}-${strip.track}-${gap.start}`}
            className="pointer-events-none absolute"
            style={{
              top: getTimelineRowTop(rowIndex, props.rowHeights) + CLIP_Y,
              left: props.contentOrigin + gap.start * props.pps,
              width: Math.max((gap.end - gap.start) * props.pps, 2),
              height: TRACK_H - CLIP_Y * 2,
              background: loud ? "rgba(60,230,172,0.18)" : "rgba(60,230,172,0.055)",
              borderRadius: 4,
              zIndex: 25,
            }}
          />
        ));
      })}

      {/* Drop placeholder — a clip-sized slot at the exact landing spot (target
          lane + snapped start), parallel to the ghost. Hidden in insert mode. */}
      {draggedClip?.started && draggedClip.insertRow == null && draggedRowIndex >= 0 && (
        <div
          className="absolute pointer-events-none"
          style={{
            top: getTimelineRowTop(draggedRowIndex, props.rowHeights) + CLIP_Y,
            left: props.contentOrigin + draggedClip.previewStart * props.pps,
            width: Math.max(draggedClip.element.duration * props.pps, 4),
            height: draggedRowHeight - CLIP_Y * 2,
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
            top: getTimelineRowTop(draggedClip.insertRow, props.rowHeights) - 0.5,
            left: props.contentOrigin,
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
            left: props.contentOrigin + draggedClip.snapTime * props.pps,
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

      <TimelineGestureOverlay
        drag={draggedClip}
        scrollRef={scrollRef}
        pixelsPerSecond={props.pps}
        rowHeight={draggedRowHeight - CLIP_Y * 2}
        selectedElementId={props.selectedElementId}
        currentTime={props.currentTime}
        theme={props.theme}
        getTrackStyle={props.getTrackStyle}
        renderClipContent={props.renderClipContent}
        renderClipOverlay={props.renderClipOverlay}
      />

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
              props.contentOrigin +
              Math.min(props.rangeSelection.start, props.rangeSelection.end) * props.pps,
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
          inner 1px line's CENTER exactly on contentOrigin + t * pps (the ruler
          ticks' center), instead of relying on shrink-wrap sizing. */}
      <div
        ref={props.playheadRef}
        className="absolute top-0 bottom-0 pointer-events-none"
        style={{
          left: `${getTimelinePlayheadLeft(0, 0, props.contentOrigin)}px`,
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
