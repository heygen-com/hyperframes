import { useMemo } from "react";
import type { TimelineLaneBaseProps } from "./timelineLaneProps";
import { buildTimelineLogicalRows, type TimelineLogicalRow } from "./timelineKeyboardNavigation";

interface TimelineLogicalRowsInput extends Pick<
  TimelineLaneBaseProps,
  | "tracks"
  | "displayTrackOrder"
  | "laneCounts"
  | "selectedElementId"
  | "selectedElementIds"
  | "gsapAnimations"
> {
  expandedClipIds: ReadonlySet<string>;
}

/** Owns the logical timeline model and its physical-track lookup; stable input refs preserve it. */
export function useTimelineLogicalRows({
  tracks,
  displayTrackOrder,
  laneCounts,
  selectedElementId,
  selectedElementIds,
  expandedClipIds,
  gsapAnimations,
}: TimelineLogicalRowsInput) {
  return useMemo(() => {
    const logicalRows = buildTimelineLogicalRows({
      tracks,
      displayTrackOrder,
      laneCounts,
      selectedElementId,
      selectedElementIds,
      expandedClipIds,
      gsapAnimations,
    });
    const logicalRowsByTrack = new Map<number, TimelineLogicalRow[]>();
    for (const row of logicalRows) {
      const trackRows = logicalRowsByTrack.get(row.physicalTrackKey) ?? [];
      trackRows.push(row);
      logicalRowsByTrack.set(row.physicalTrackKey, trackRows);
    }
    return { logicalRows, logicalRowsByTrack };
  }, [
    displayTrackOrder,
    expandedClipIds,
    gsapAnimations,
    laneCounts,
    selectedElementId,
    selectedElementIds,
    tracks,
  ]);
}
