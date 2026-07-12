import type { TimelineRangeSelection } from "./timelineEditing";
import { GUTTER, RULER_H } from "./timelineLayout";
import type { TimelineMarqueeOverlayRect } from "./useTimelineMarqueeSelection";

interface TimelineSelectionOverlaysProps {
  rangeSelection: TimelineRangeSelection | null;
  marqueeRect: TimelineMarqueeOverlayRect | null;
  pps: number;
  /** Primary/accent color (hex) shared with the rest of the timeline chrome. */
  accentColor: string;
}

export function TimelineSelectionOverlays({
  rangeSelection,
  marqueeRect,
  pps,
  accentColor,
}: TimelineSelectionOverlaysProps) {
  return (
    <>
      {rangeSelection && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: GUTTER + Math.min(rangeSelection.start, rangeSelection.end) * pps,
            width: Math.abs(rangeSelection.end - rangeSelection.start) * pps,
            top: RULER_H,
            bottom: 0,
            backgroundColor: `${accentColor}1f`,
            borderLeft: `1px solid ${accentColor}`,
            borderRight: `1px solid ${accentColor}`,
            zIndex: 50,
          }}
        />
      )}
      {marqueeRect && (
        <div
          aria-hidden="true"
          className="absolute pointer-events-none"
          data-timeline-marquee="true"
          style={{
            left: marqueeRect.left,
            top: marqueeRect.top,
            width: marqueeRect.width,
            height: marqueeRect.height,
            backgroundColor: `${accentColor}29`,
            border: `1px solid ${accentColor}`,
            boxShadow: "0 0 0 1px rgba(15, 23, 42, 0.35)",
            zIndex: 60,
          }}
        />
      )}
    </>
  );
}
