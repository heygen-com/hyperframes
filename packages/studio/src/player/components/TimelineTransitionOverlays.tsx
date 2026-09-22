import { CLIP_Y } from "./timelineLayout";
import { getTimelineElementIdentity } from "../lib/timelineElementHelpers";
import type { TimelineTransitionSeam } from "./timelineTransitionSeams";
import { TimelineTransitionBadge } from "./TimelineTransitionBadge";

interface TimelineTransitionOverlaysProps {
  seams: readonly TimelineTransitionSeam[];
  pixelsPerSecond: number;
  rowHeight: number;
  clipBarHeight?: number;
}

export function TimelineTransitionOverlays({
  seams,
  pixelsPerSecond,
  rowHeight,
  clipBarHeight,
}: TimelineTransitionOverlaysProps) {
  const top = CLIP_Y + (clipBarHeight ?? rowHeight - 2 * CLIP_Y) / 2;
  return seams.map((seam) => (
    <TimelineTransitionBadge
      key={`${getTimelineElementIdentity(seam.outgoing)}-${getTimelineElementIdentity(seam.incoming)}`}
      centerPx={seam.centerTime * pixelsPerSecond}
      top={top}
      widthPx={Math.min(Math.max(seam.duration * pixelsPerSecond, 24), 32)}
      outgoingSrc={seam.outgoing.src}
      incomingSrc={seam.incoming.src}
    />
  ));
}
