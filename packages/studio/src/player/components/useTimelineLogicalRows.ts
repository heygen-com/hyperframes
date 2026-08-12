import { useMemo } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { TimelineElement } from "../store/playerStore";
import { buildTimelineLogicalRows } from "./timelineKeyboardNavigation";

interface TimelineLogicalRowsInput {
  tracks: readonly (readonly [number, readonly TimelineElement[]])[];
  displayTrackOrder: readonly number[];
  laneCounts: ReadonlyMap<string, number>;
  selectedElementId: string | null;
  selectedElementIds: ReadonlySet<string>;
  expandedClipIds: ReadonlySet<string>;
  gsapAnimations: ReadonlyMap<string, readonly GsapAnimation[]>;
}

/** Shared by rendering and focus coordination; stable input refs preserve memo identity. */
export function useTimelineLogicalRows({
  tracks,
  displayTrackOrder,
  laneCounts,
  selectedElementId,
  selectedElementIds,
  expandedClipIds,
  gsapAnimations,
}: TimelineLogicalRowsInput) {
  return useMemo(
    () =>
      buildTimelineLogicalRows({
        tracks,
        displayTrackOrder,
        laneCounts,
        selectedElementId,
        selectedElementIds,
        expandedClipIds,
        gsapAnimations,
      }),
    [
      displayTrackOrder,
      expandedClipIds,
      gsapAnimations,
      laneCounts,
      selectedElementId,
      selectedElementIds,
      tracks,
    ],
  );
}
