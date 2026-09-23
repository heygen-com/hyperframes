import { CLIP_Y } from "./timelineLayout";
import type { TimelineElement } from "../store/playerStore";

// Frames are at least 1/120 s apart, so anything closer is the same instant.
const JOIN_EPSILON_S = 1e-3;

/** Times where one clip on a row ends exactly where the next begins. */
export function deriveTimelineClipJoins(elements: readonly TimelineElement[]): number[] {
  const sorted = [...elements].sort((left, right) => left.start - right.start);
  const joins: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const end = previous.start + previous.duration;
    if (Math.abs(sorted[index]!.start - end) < JOIN_EPSILON_S) joins.push(end);
  }
  return joins;
}

interface TimelineClipJoinsProps {
  elements: readonly TimelineElement[];
  pixelsPerSecond: number;
  rowHeight: number;
  clipBarHeight?: number;
  color: string;
}

/** A hairline in the row colour over each join, so touching clips read as two without moving either. */
export function TimelineClipJoins({
  elements,
  pixelsPerSecond,
  rowHeight,
  clipBarHeight,
  color,
}: TimelineClipJoinsProps) {
  const height = clipBarHeight ?? rowHeight - 2 * CLIP_Y;
  return deriveTimelineClipJoins(elements).map((time) => (
    <div
      key={time}
      data-timeline-clip-join=""
      aria-hidden="true"
      className="absolute pointer-events-none"
      style={{
        left: time * pixelsPerSecond,
        top: CLIP_Y,
        width: 1,
        height,
        transform: "translateX(-50%)",
        background: color,
        // Over an idle or hovered clip, under the diamonds (6) and a selected clip (10).
        zIndex: 5,
      }}
    />
  ));
}
