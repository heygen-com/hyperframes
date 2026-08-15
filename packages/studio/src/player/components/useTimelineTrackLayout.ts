import { useMemo, useRef } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { animationLaneGroups } from "./TimelinePropertyLanes";
import { isAudioTimelineElement } from "../../utils/timelineInspector";
import { elementAutomationLanes, groupAutomationLanes } from "./automationLaneData";
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
 * Whether this track draws the beat-dot strip: only where there are beats to
 * draw, and only on the track the user is working in — the selected clip's, or
 * the music track's when nothing is selected.
 */
export function trackShowsBeatStrip(
  els: readonly TimelineElement[],
  beatTimes: readonly number[] | undefined,
  ctx: {
    selectedElementId: string | null;
    isMusicTrack(element: TimelineElement): boolean;
  },
): boolean {
  if ((beatTimes?.length ?? 0) < 2) return false;
  return ctx.selectedElementId
    ? els.some((e) => (e.key ?? e.id) === ctx.selectedElementId)
    : els.some((e) => ctx.isMusicTrack(e));
}

/**
 * Automation lanes on one clip, or 0 for anything that is not audio.
 *
 * An audio clip can be worth expanding without carrying a single tween, so this
 * counts toward whether a track has anything to disclose. A function rather than
 * a map so every caller reads the same cached parse and none can drift.
 */
function automationLaneCountOf(element: TimelineElement): number {
  return isAudioTimelineElement(element) ? elementAutomationLanes(element).length : 0;
}

/**
 * Automation rows a TRACK reserves: the union over the clips sharing it, since
 * clips on one row share a lane row per property. Counting only the active clip's
 * lanes reserved a height that changed with the selection.
 */
function trackAutomationLaneCount(elements: readonly TimelineElement[]): number {
  return groupAutomationLanes(elements).length;
}

/**
 * Is this row disclosed? Expansion is stored per clip, but it reads as a property
 * of the ROW: the active clip changes with the selection, so asking only about it
 * collapsed the row the moment you clicked a sibling. Any expanded clip on the
 * track holds the row open — and the caret expands and collapses all of them
 * together (see TimelineLanes), so the two can only disagree on state predating
 * this rule or written by the keyframe auto-expand.
 */
export function isTrackRowExpanded(
  elements: readonly TimelineElement[],
  expandedClipIds: ReadonlySet<string>,
): boolean {
  return elements.some((element) => expandedClipIds.has(element.key ?? element.id));
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
    // Keyframe lanes follow only the active clip, so a track with several
    // keyframed elements never reserves empty lanes for the ones not shown.
    // Automation lanes follow the whole row: they are shared per property.
    const heightTracks: TimelineTrackHeightClip[][] = tracks.map(([, elements]) => {
      const active = resolveTrackKeyframeClip(
        elements,
        laneCounts,
        selectedElementId,
        selectedElementIds,
      );
      if (!active) return [];
      const clipId = active.key ?? active.id;
      // `trackHeights` gates the reserved lanes on this id being expanded, and the
      // row is expanded when ANY of its clips is — so hand it whichever clip holds
      // the row open, while the lane counts stay the active clip's (keyframes) and
      // the track's (automation, shared across the row).
      const holdingOpen = elements.find((element) =>
        expandedClipIds.has(element.key ?? element.id),
      );
      return [
        {
          clipId: holdingOpen ? (holdingOpen.key ?? holdingOpen.id) : clipId,
          laneCount: laneCounts.get(clipId) ?? 0,
          automationLaneCount: trackAutomationLaneCount(elements),
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
  const { tracks, trackStyles, trackOrder, groups, trackGroupOf } =
    useTimelineTrackDerivations(expandedElements);
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
    groups,
    trackGroupOf,
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
    // A group's members sit out of raw numeric order (pulled under their
    // anchor row), so a plain numeric sort here would undo that grouping the
    // moment a clip drags onto a brand-new track. Insert the new preview
    // track only relative to other REAL (integer) tracks, leaving any
    // fractional group-anchor keys exactly where grouping placed them.
    const preview = draggedClip.previewTrack;
    const result: number[] = [];
    let inserted = false;
    for (const key of trackOrder) {
      if (!inserted && Number.isInteger(key) && key > preview) {
        result.push(preview);
        inserted = true;
      }
      result.push(key);
    }
    if (!inserted) result.push(preview);
    return result;
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
