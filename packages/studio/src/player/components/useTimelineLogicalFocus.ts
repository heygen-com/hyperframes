import { useMemo, type RefObject } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { TimelineElement } from "../store/playerStore";
import type { TimelineRowGeometry } from "./timelineLayout";
import { buildTimelineLogicalRows } from "./timelineKeyboardNavigation";
import type { TimelineScrollViewportSnapshot } from "./useTimelineScrollViewport";
import { useTimelineFocusCoordinator } from "./useTimelineFocusCoordinator";
import { usePlayerStore } from "../store/playerStore";
import { STUDIO_KEYFRAMES_ENABLED } from "../../components/editor/manualEditingAvailability";
import { useTimelineRowVirtualization } from "./useTimelineRowVirtualization";

interface TimelineLogicalFocusInput {
  scrollRef: RefObject<HTMLDivElement | null>;
  tracks: readonly (readonly [number, readonly TimelineElement[]])[];
  layout: { displayTrackOrder: readonly number[]; rowGeometry: TimelineRowGeometry };
  laneCounts: ReadonlyMap<string, number>;
  selectedElementId: string | null;
  selectedElementIds: ReadonlySet<string>;
  gsapAnimations: ReadonlyMap<string, readonly GsapAnimation[]>;
  elements: readonly TimelineElement[];
  pixelsPerSecond: number;
  contentOrigin: number;
  allowHorizontal: boolean;
  viewport: TimelineScrollViewportSnapshot;
  sessionEpoch: number;
  draggedRowKey?: number;
  resizingRowKey?: number;
  clipContextMenuRowKey?: number;
  keyframeContextMenuRowKey?: number;
  lastScrollLeftRef: RefObject<number>;
  syncScrollViewport: (element: HTMLDivElement) => void;
}

export function useTimelineLogicalFocus(input: TimelineLogicalFocusInput) {
  const expandedClipIds = usePlayerStore((state) => state.expandedClipIds);
  const projectId = usePlayerStore((state) => state.timelineProjectId);
  const logicalRows = useMemo(
    () =>
      buildTimelineLogicalRows({
        tracks: input.tracks,
        displayTrackOrder: input.layout.displayTrackOrder,
        laneCounts: input.laneCounts,
        selectedElementId: input.selectedElementId,
        selectedElementIds: input.selectedElementIds,
        expandedClipIds: STUDIO_KEYFRAMES_ENABLED ? expandedClipIds : new Set(),
        gsapAnimations: input.gsapAnimations,
      }),
    [
      expandedClipIds,
      input.gsapAnimations,
      input.laneCounts,
      input.selectedElementId,
      input.selectedElementIds,
      input.tracks,
      input.layout.displayTrackOrder,
    ],
  );
  const focus = useTimelineFocusCoordinator({
    scrollRef: input.scrollRef,
    logicalRows,
    elements: input.elements,
    rowGeometry: input.layout.rowGeometry,
    pixelsPerSecond: input.pixelsPerSecond,
    contentOrigin: input.contentOrigin,
    allowHorizontal: input.allowHorizontal,
    viewportVersion: input.viewport,
    projectId,
    sessionEpoch: input.sessionEpoch,
    syncScrollViewport: input.syncScrollViewport,
  });
  const rows = useTimelineRowVirtualization({
    scrollRef: input.scrollRef,
    viewport: input.viewport,
    rowGeometry: input.layout.rowGeometry,
    sessionEpoch: input.sessionEpoch,
    elements: input.elements,
    selectedElementId: input.selectedElementId,
    focusedRowKey: focus.focusedRowKey,
    draggedRowKey: input.draggedRowKey,
    resizingRowKey: input.resizingRowKey,
    clipContextMenuRowKey: input.clipContextMenuRowKey,
    keyframeContextMenuRowKey: input.keyframeContextMenuRowKey,
    lastScrollLeftRef: input.lastScrollLeftRef,
    syncScrollViewport: input.syncScrollViewport,
  });
  return {
    logicalRows,
    ...focus,
    rowVirtualizationActive: rows.enabled,
    virtualRows: rows.virtualRows,
  };
}
