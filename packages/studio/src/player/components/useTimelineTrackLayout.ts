import { useMemo, useRef } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { animationContributesLane } from "./TimelinePropertyLanes";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { STUDIO_KEYFRAMES_ENABLED } from "../../components/editor/manualEditingAvailability";
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
): TimelineElement | null {
  const keyframed = elements.filter(
    (element) => (laneCounts.get(element.key ?? element.id) ?? 0) >= 1,
  );
  if (keyframed.length === 0) return null;
  const selected = keyframed.find((element) => {
    const key = element.key ?? element.id;
    return key === selectedElementId || selectedElementIds.has(key);
  });
  if (selected) return selected;
  return [...keyframed].sort(
    (a, b) => (laneCounts.get(b.key ?? b.id) ?? 0) - (laneCounts.get(a.key ?? a.id) ?? 0),
  )[0]!;
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
        if (animation.propertyGroup && animationContributesLane(animation)) {
          propertyGroups.add(animation.propertyGroup);
        }
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
      return [{ clipId, laneCount: laneCounts.get(clipId) ?? 0 }];
    });
    const rowHeights = trackHeights(
      heightTracks,
      STUDIO_KEYFRAMES_ENABLED ? expandedClipIds : undefined,
    );
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
