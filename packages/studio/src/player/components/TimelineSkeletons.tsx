import { memo } from "react";
import {
  CLIP_Y,
  TRACK_H,
  TRACKS_BOTTOM_PAD,
  getTimelineRowHeight,
  getTimelineRowTop,
} from "./timelineLayout";
import type { PlacedSkeleton, TimelineSkeletonLayout } from "./useTimelineSkeletons";

/**
 * Clips an agent said it is about to add, drawn where it said they will land.
 *
 * A skeleton is a promise, not a thing: the whole layer takes no pointer
 * events, so a click passes through to the clip or lane underneath exactly as
 * it does when nothing is pending.
 */

interface TimelineSkeletonsProps extends TimelineSkeletonLayout {
  contentOrigin: number;
  pps: number;
  rowHeights: readonly number[];
  /** Display lanes in row order, for turning a lane into a row index. */
  displayTrackOrder: number[];
}

/** Enough of a bar to read as a clip; narrower than this and it is a tick. */
const MIN_WIDTH = 6;

export const TimelineSkeletons = memo(function TimelineSkeletons(props: TimelineSkeletonsProps) {
  const { placed, incoming, incomingTracks } = props;
  if (placed.length === 0 && incoming.length === 0) return null;

  // Tracks that do not exist yet have no row to sit on, so they share the pad
  // below the last one. Splitting the pad between them keeps two new tracks
  // legible instead of drawing them on top of each other.
  const bandTop = getTimelineRowTop(props.rowHeights.length, props.rowHeights);
  const bandHeight = Math.max(0, TRACKS_BOTTOM_PAD - CLIP_Y * 2);
  const slotHeight = incomingTracks.length > 0 ? bandHeight / incomingTracks.length : bandHeight;

  return (
    <div className="pointer-events-none absolute inset-0" data-timeline-skeletons="true">
      {placed.map((skeleton) => {
        const row = props.displayTrackOrder.indexOf(skeleton.lane);
        if (row === -1) return null;
        const height = Math.min(getTimelineRowHeight(row, props.rowHeights), TRACK_H) - CLIP_Y * 2;
        return (
          <Skeleton
            key={skeleton.key}
            skeleton={skeleton}
            contentOrigin={props.contentOrigin}
            pps={props.pps}
            top={getTimelineRowTop(row, props.rowHeights) + CLIP_Y}
            height={height}
          />
        );
      })}

      {incoming.map((skeleton) => (
        <Skeleton
          key={skeleton.key}
          skeleton={skeleton}
          contentOrigin={props.contentOrigin}
          pps={props.pps}
          top={bandTop + CLIP_Y + incomingTracks.indexOf(skeleton.lane) * slotHeight}
          height={Math.max(0, slotHeight - CLIP_Y)}
          newTrack
        />
      ))}
    </div>
  );
});

function Skeleton({
  skeleton,
  contentOrigin,
  pps,
  top,
  height,
  newTrack = false,
}: {
  skeleton: PlacedSkeleton;
  contentOrigin: number;
  pps: number;
  top: number;
  height: number;
  newTrack?: boolean;
}) {
  const width = Math.max(MIN_WIDTH, (skeleton.end - skeleton.start) * pps);
  // A track that does not exist yet is drawn as an outline: there is nothing
  // under it to be a lighter shade of.
  const label = skeleton.label ?? (newTrack ? `New track ${skeleton.lane}` : "");

  return (
    <div
      data-timeline-skeleton="true"
      className={`hf-timeline-skeleton absolute overflow-hidden rounded-[3px] ${
        newTrack ? "border border-dashed" : "border"
      }`}
      style={{
        left: contentOrigin + skeleton.start * pps,
        width,
        top,
        height,
        borderColor: "rgba(60,230,172,0.45)",
        backgroundColor: newTrack ? "transparent" : "rgba(60,230,172,0.12)",
      }}
      aria-hidden="true"
      title={label}
    >
      {label && height >= 16 && (
        <span className="block truncate px-1.5 pt-[3px] text-[10px] leading-none text-[#3CE6AC]/80">
          {label}
        </span>
      )}
    </div>
  );
}
