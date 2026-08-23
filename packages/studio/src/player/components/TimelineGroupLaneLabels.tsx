/**
 * The label column beside a group's own automation lanes.
 *
 * The designs draw a group lane as `▤ Volume   0.42` on an accent rail — and
 * the rail is load-bearing, not decoration: "Scope is carried by colour, not by
 * depth — a lane the group owns has an accent rail and names the group; a
 * clip's lane is neutral." Two lanes both called Volume, doing entirely
 * different things, otherwise sit eight pixels apart with nothing to tell them
 * apart.
 *
 * The number is the value AT THE PLAYHEAD, not the stored seed: a readout that
 * showed the seed would stand still while the curve is audibly working.
 */

import { sampleAutomationLane } from "@hyperframes/core/audio-automation";
import { groupAutomationLanes } from "./automationLaneData";
import { AUTOMATION_LANE_H } from "./automationLaneHeight";
import type { TimelineElement } from "../store/playerStore";
import { useLivePlayheadTime } from "../../hooks/useLivePlayheadTime";

export function TimelineGroupLaneLabels({
  groupElement,
  groupLabel,
  top,
  columnWidth,
  gutterBackground,
  accentColor,
}: {
  /** The group wearing a clip's shape — see `groupAutomationElement`. */
  groupElement: TimelineElement;
  groupLabel: string;
  /** y of the first lane, matching the canvas slot's own offset. */
  top: number;
  columnWidth: number;
  gutterBackground: string;
  accentColor: string;
}) {
  // The LIVE playhead, not the row's `currentTime` prop — that one only moves
  // on seek, so the readout sat frozen while the curve was audibly working,
  // which is precisely the failure this number exists to prevent.
  const currentTime = useLivePlayheadTime();
  // The SAME source the curves and the reserved height use
  // (`TimelineGroupRow`), not raw `elementAutomationLanes`. Raw lanes are
  // neither deduped by property nor filtered for resolvability, and the old
  // `if (!parts) return null` consumed an index without drawing — so one
  // unresolvable target slid every later label one row off the curve it names.
  const laneGroups = groupAutomationLanes([groupElement]);
  return (
    <>
      {laneGroups.map((laneGroup, index) => {
        const lane = laneGroup.entries[0]?.lane;
        if (!lane) return null;
        const parts = { name: laneGroup.name, param: laneGroup.param };
        // A group's clock is composition time (§1.3), so the playhead needs no
        // clip-local rebase here — unlike a clip's lane.
        const value = sampleAutomationLane(lane, currentTime);
        return (
          <div
            key={lane.target}
            data-group-lane-label={lane.target}
            className="absolute left-0 flex items-center gap-1.5 overflow-hidden px-1.5 text-[10px] text-white/65"
            style={{
              top: top + index * AUTOMATION_LANE_H,
              width: columnWidth,
              height: AUTOMATION_LANE_H,
              background: gutterBackground,
              borderLeft: `2px solid ${accentColor}`,
            }}
            title={`${groupLabel} · ${parts.param ? `${parts.name} · ${parts.param}` : parts.name}`}
          >
            <span aria-hidden="true" className="shrink-0 text-[11px] text-white/40">
              ▤
            </span>
            <span className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
              <span className="truncate font-mono text-[9px] text-white/70">{parts.name}</span>
              {parts.param ? (
                <span className="truncate font-mono text-[9px] text-white/40">{parts.param}</span>
              ) : null}
            </span>
            <span className="shrink-0 font-mono text-[9px] tabular-nums text-white/55">
              {value.toFixed(2)}
            </span>
          </div>
        );
      })}
    </>
  );
}
