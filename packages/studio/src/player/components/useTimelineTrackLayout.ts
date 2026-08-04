import { useMemo, useRef } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { animationLaneGroups } from "./TimelinePropertyLanes";
import { isAudioTimelineElement } from "../../utils/timelineInspector";
import { elementAutomationLanes } from "./automationLaneData";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import type { DraggedClipState } from "./timelineClipDragTypes";
import { useTimelineTrackDerivations } from "./useTimelineTrackDerivations";
import {
  TRACK_H,
  createTimelineRowGeometry,
  type TimelineRowGeometry,
  trackHeights,
  type TimelineTrackHeightClip,
} from "./timelineLayout";

export { getTrackStyle } from "./timelineIcons";

/**
 * Automation lanes on one clip, or 0 for anything that is not audio.
 *
 * An audio clip can be worth expanding without carrying a single tween, so this
 * counts toward whether a track has anything to disclose. A function rather than
 * a map so every caller reads the same cached parse and none can drift.
 */
export function automationLaneCountOf(element: TimelineElement): number {
  return isAudioTimelineElement(element) ? elementAutomationLanes(element).length : 0;
}

/**
 * The single keyframed element whose property lanes a track shows when expanded.
 * A track can hold several elements (same z-index is common), but keyframes are
 * per-element, so we scope to ONE active element — the selected one if it's on
 * this track, otherwise the element with the most lanes. Selecting a clip is how
 * you switch which element you're keyframing. Returns null when no element on the
 * track has keyframes.
 */
export function resolveTrackKeyframeClip(
  elements: readonly TimelineElement[],
  laneCounts: ReadonlyMap<string, number>,
  selectedElementId: string | null,
  selectedElementIds: ReadonlySet<string>,
  automationLaneCount: (element: TimelineElement) => number = automationLaneCountOf,
): TimelineElement | null {
  // Automation counts toward "has something to disclose". Without it an audio
  // clip carrying envelopes but no tweens resolved to null, so its track got no
  // caret, no reserved height and no lanes — the automation was unreachable for
  // exactly the tracks the feature is for.
  const disclosable = (element: TimelineElement): number =>
    (laneCounts.get(element.key ?? element.id) ?? 0) + automationLaneCount(element);
  const keyframed = elements.filter((element) => disclosable(element) >= 1);
  if (keyframed.length === 0) return null;
  const selected = keyframed.find((element) => {
    const key = element.key ?? element.id;
    return key === selectedElementId || selectedElementIds.has(key);
  });
  if (selected) return selected;
  // Most lanes wins, first one on a tie (same as the old stable sort), but as a
  // reduce over the already non-empty list so there's no index to assert on.
  return keyframed.reduce((best, element) =>
    disclosable(element) > disclosable(best) ? element : best,
  );
}

/** Lanes per clip: the count of distinct property groups whose tween contributes
 *  a lane (real keyframes or a synthesizable flat tween). */
function computeLaneCounts(
  tracks: [number, TimelineElement[]][],
  gsapAnimations: Map<string, GsapAnimation[]>,
): Map<string, number> {
  const laneCounts = new Map<string, number>();
  for (const [, elements] of tracks) {
    for (const element of elements) {
      const clipId = element.key ?? element.id;
      const propertyGroups = new Set<string>();
      for (const animation of gsapAnimations.get(clipId) ?? []) {
        // Same helper the rendered lanes count through, so a reserved row and a
        // drawn lane can never disagree.
        for (const group of animationLaneGroups(animation)) propertyGroups.add(group);
      }
      laneCounts.set(clipId, propertyGroups.size);
    }
  }
  return laneCounts;
}

function useTimelineRowHeights(
  tracks: [number, TimelineElement[]][],
  gsapAnimations: Map<string, GsapAnimation[]>,
  selectedElementId: string | null,
  selectedElementIds: ReadonlySet<string>,
) {
  const expandedClipIds = usePlayerStore((s) => s.expandedClipIds);
  const { laneCounts, rowGeometry } = useMemo(() => {
    const laneCounts = computeLaneCounts(tracks, gsapAnimations);
    // Row height follows only the active keyframe clip, so a track with several
    // keyframed elements never reserves empty lanes for the ones not shown.
    const heightTracks: TimelineTrackHeightClip[][] = tracks.map(([, elements]) => {
      const active = resolveTrackKeyframeClip(
        elements,
        laneCounts,
        selectedElementId,
        selectedElementIds,
      );
      if (!active) return [];
      const clipId = active.key ?? active.id;
      return [
        {
          clipId,
          laneCount: laneCounts.get(clipId) ?? 0,
          automationLaneCount: automationLaneCountOf(active),
        },
      ];
    });
    const rowHeights = trackHeights(heightTracks, expandedClipIds);
    return {
      laneCounts,
      rowGeometry: createTimelineRowGeometry(
        tracks.map(([track]) => track),
        rowHeights,
      ),
    };
  }, [expandedClipIds, gsapAnimations, tracks, selectedElementId, selectedElementIds]);
  const rowGeometryRef = useRef<TimelineRowGeometry>(rowGeometry);
  rowGeometryRef.current = rowGeometry;
  return {
    laneCounts,
    rowGeometry,
    rowGeometryRef,
    rowHeights: rowGeometry.rowHeights,
  };
}

export function useTimelineTrackLayout(
  expandedElements: TimelineElement[],
  gsapAnimations: Map<string, GsapAnimation[]>,
  selectedElementId: string | null,
  selectedElementIds: ReadonlySet<string>,
) {
  const { tracks, trackStyles, trackOrder } = useTimelineTrackDerivations(expandedElements);
  const trackOrderRef = useRef(trackOrder);
  trackOrderRef.current = trackOrder;
  const { laneCounts, rowGeometry, rowGeometryRef, rowHeights } = useTimelineRowHeights(
    tracks,
    gsapAnimations,
    selectedElementId,
    selectedElementIds,
  );

  return {
    tracks,
    trackStyles,
    trackOrder,
    trackOrderRef,
    laneCounts,
    rowGeometry,
    rowGeometryRef,
    rowHeights,
  };
}

function useDisplayRowHeights(
  displayTrackOrder: readonly number[],
  rowGeometry: TimelineRowGeometry,
) {
  return useMemo(
    () =>
      displayTrackOrder.map((track) => {
        const row = rowGeometry.getRowIndex(track);
        return row < 0 ? TRACK_H : rowGeometry.getRowHeight(row);
      }),
    [displayTrackOrder, rowGeometry],
  );
}

function useDisplayTrackOrder(draggedClip: DraggedClipState | null, trackOrder: number[]) {
  return useMemo(() => {
    if (!draggedClip?.started || trackOrder.includes(draggedClip.previewTrack)) return trackOrder;
    return [...trackOrder, draggedClip.previewTrack].sort((a, b) => a - b);
  }, [draggedClip, trackOrder]);
}

export function useTimelineDisplayLayout(
  draggedClip: DraggedClipState | null,
  trackOrder: number[],
  rowGeometry: TimelineRowGeometry,
) {
  const displayTrackOrder = useDisplayTrackOrder(draggedClip, trackOrder);
  const displayRowHeights = useDisplayRowHeights(displayTrackOrder, rowGeometry);
  const displayRowGeometry = useMemo(
    () => createTimelineRowGeometry(displayTrackOrder, displayRowHeights),
    [displayTrackOrder, displayRowHeights],
  );
  return {
    displayTrackOrder,
    displayRowHeights: displayRowGeometry.rowHeights,
    rowGeometry: displayRowGeometry,
    totalH: displayRowGeometry.canvasHeight,
  };
}
