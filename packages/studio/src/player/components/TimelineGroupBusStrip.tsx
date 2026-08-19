/**
 * What a group's `∿` area says about the group itself: which tracks it holds.
 *
 * B7 also put a volume slider and a live level meter here — both removed. The
 * group's `data-volume` is still honoured by the preview bus and by the render;
 * there is simply no control for it on this row, and nothing reads a level back
 * out of the graph any more.
 */
import { STRIP_H, TRACK_H } from "./timelineLayout";

interface TimelineGroupBusStripProps {
  memberLabels: readonly string[];
}

export function TimelineGroupBusStrip({ memberLabels }: TimelineGroupBusStripProps) {
  // "vo-1 and vo-2", the designs' own phrasing — a comma list reads as data,
  // and this line is a sentence about what the group is holding.
  const holds =
    memberLabels.length > 1
      ? `${memberLabels.slice(0, -1).join(", ")} and ${memberLabels[memberLabels.length - 1]}`
      : (memberLabels[0] ?? "nothing yet");

  return (
    <div
      className="absolute left-0 right-0 flex items-center gap-2 px-2 text-[10px] text-white/70"
      style={{ top: TRACK_H, height: STRIP_H }}
    >
      {/* Label and value, as the designs split them: "Holds" is chrome, the
          member list is the answer. */}
      <span className="shrink-0 text-white/45">Holds</span>
      <span className="min-w-0 flex-1 truncate" title={`Holds ${holds}`}>
        {holds}
      </span>
    </div>
  );
}
