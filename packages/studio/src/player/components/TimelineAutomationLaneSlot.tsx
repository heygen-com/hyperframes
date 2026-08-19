/**
 * Track-level automation: the stack of shared rows an audio track draws, and
 * one clip's envelopes within them.
 *
 * Split from TimelineAutomationLane.tsx, which owns the single-lane editor this
 * renders many of. The dependency runs one way, slot -> lane, so the editor
 * stays readable on its own and this file keeps the row-layout concern.
 */

import { useEffect, useMemo } from "react";
import { resolveAutomationRange, type HfAutomationLane } from "@hyperframes/core/audio-automation";
import { TimelineAutomationLane } from "./TimelineAutomationLane";
import { AUTOMATION_LANE_H } from "./automationLaneHeight";
import { getTimelineLaneTop } from "./timelineLayout";
import { groupAutomationLanes } from "./automationLaneData";
import { isAudioTimelineElement } from "../../utils/timelineInspector";
import { getTimelineElementIdentity } from "../lib/timelineElementHelpers";
import type { TimelineElement } from "../store/playerStore";
import type { UseAutomationLanesResult } from "./useAutomationLanes";

/** Which shared rows one clip draws into, and with which of its lanes. */
interface ClipLaneRow {
  lane: HfAutomationLane;
  rowIndex: number;
}

/**
 * One clip's envelopes, each in the shared row its property owns.
 *
 * Its own component because every clip on the row needs its own binding, its own
 * gestures and its own selection box — a shared row is a shared lane track, not a
 * shared envelope, and two clips' curves must never drag as one thing. Hooks
 * cannot run in a loop, so the loop is over components.
 */
function ClipAutomationLanes({
  element,
  rows,
  isSelected,
  lanes,
  pps,
  top,
  accentColor,
  currentTime,
  beatTimes,
}: {
  element: TimelineElement;
  rows: readonly ClipLaneRow[];
  isSelected: boolean;
  lanes: UseAutomationLanesResult;
  pps: number;
  /** y of the first automation row on this track. */
  top: number;
  accentColor: string;
  currentTime: number;
  beatTimes?: readonly number[];
}) {
  // Beats inside this clip, in the clip's own frame — the lane's times are
  // clip-local, and a beat outside the clip can never be snapped to anyway.
  const snapTimes = useMemo(
    () =>
      (beatTimes ?? [])
        .filter((t) => t >= element.start && t <= element.start + element.duration)
        .map((t) => t - element.start),
    [beatTimes, element.start, element.duration],
  );
  const bound = lanes.bind(element, isSelected);
  // Stale-selection guard: the selected lane's target can vanish out from under
  // it (e.g. its effect got deleted from the chain, dropping the lane), leaving
  // a rectangle selecting nothing. Clear it rather than let it point at a
  // target that no longer draws. Above the empty-rows return, because a clip
  // that draws nothing is exactly when a selection goes stale.
  useEffect(() => {
    const target = bound.selection?.target;
    if (target !== undefined && !bound.lanes.some((lane) => lane.target === target)) {
      bound.onRangeClear();
    }
  }, [bound]);
  if (rows.length === 0) return null;
  const inClip = currentTime >= element.start && currentTime <= element.start + element.duration;
  return (
    <>
      {rows.map(({ lane, rowIndex }) => {
        const range = resolveAutomationRange(lane.target, bound.chain ?? undefined);
        // A lane whose target no longer resolves was already dropped upstream;
        // this is belt and braces so a row can never draw on the wrong axis.
        if (!range) return null;
        return (
          <TimelineAutomationLane
            key={lane.target}
            duration={element.duration}
            widthPx={Math.max(element.duration * pps, 4)}
            leftPx={element.start * pps}
            topPx={top + rowIndex * AUTOMATION_LANE_H}
            automation={bound.automation}
            target={lane.target}
            range={range}
            accentColor={accentColor}
            playheadSec={inClip ? currentTime - element.start : null}
            onPreview={bound.onPreview}
            onCommit={bound.onCommit}
            onSelect={bound.onSelect}
            snapTimes={snapTimes}
            readOnly={bound.readOnly}
            rangeSelection={
              bound.selection?.target === lane.target
                ? {
                    t0: bound.selection.t0,
                    t1: bound.selection.t1,
                    v0: bound.selection.v0,
                    v1: bound.selection.v1,
                  }
                : null
            }
            onRangeSelect={(t0, t1, v0, v1) => bound.onRangeSelect(lane.target, t0, t1, v0, v1)}
            onRangeClear={bound.onRangeClear}
          />
        );
      })}
    </>
  );
}

export interface TimelineAutomationLaneSlotProps {
  /** Every clip on the track, in row order — not just the selected one. */
  elements: readonly TimelineElement[];
  isSelected: (element: TimelineElement) => boolean;
  lanes: UseAutomationLanesResult;
  pps: number;
  /** Keyframe lanes already stacked above, which automation sits under. */
  laneCount: number;
  accentColor: string;
  /** Composition-time playhead; the slot converts it to clip-local. */
  currentTime: number;
  /** Composition-time beat grid; the slot converts it to clip-local too. */
  beatTimes?: readonly number[];
}

/**
 * Every automated parameter on this TRACK, one lane per row — the way a DAW
 * stacks them, so two envelopes can be read and edited without swapping a
 * control to see either.
 *
 * Rows belong to the track, not to a clip: clips sharing a row share a row per
 * property (see `groupAutomationLanes`), each drawing over its own span, and a
 * clip that does not automate that property leaves its stretch empty. Binding one
 * clip at a time is what made the visible envelopes change with the selection.
 */
export function TimelineAutomationLaneSlot({
  elements,
  isSelected,
  lanes,
  pps,
  laneCount,
  accentColor,
  currentTime,
  beatTimes,
}: TimelineAutomationLaneSlotProps) {
  const clips = elements.filter(isAudioTimelineElement);
  const rowsByClip = new Map<string, ClipLaneRow[]>();
  groupAutomationLanes(clips).forEach((group, rowIndex) => {
    for (const entry of group.entries) {
      const key = getTimelineElementIdentity(entry.element);
      const rows = rowsByClip.get(key);
      if (rows) rows.push({ lane: entry.lane, rowIndex });
      else rowsByClip.set(key, [{ lane: entry.lane, rowIndex }]);
    }
  });
  const top = getTimelineLaneTop(laneCount);
  return (
    <>
      {clips.map((element) => (
        <ClipAutomationLanes
          key={getTimelineElementIdentity(element)}
          element={element}
          rows={rowsByClip.get(getTimelineElementIdentity(element)) ?? []}
          isSelected={isSelected(element)}
          lanes={lanes}
          pps={pps}
          top={top}
          accentColor={accentColor}
          currentTime={currentTime}
          beatTimes={beatTimes}
        />
      ))}
    </>
  );
}
