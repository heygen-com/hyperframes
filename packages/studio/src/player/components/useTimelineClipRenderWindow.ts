import { useMemo, type RefObject } from "react";
import { createTimelineClipIndex } from "../lib/timelineClipIndex";
import type { TimelineElement } from "../store/playerStore";
import { getTimelineRenderTimeRange } from "./timelineViewportGeometry";
import type { TimelineRowGeometry } from "./timelineLayout";
import type { TimelineScrollViewportSnapshot } from "./useTimelineScrollViewport";
import { useTimelineRevealClip } from "./useTimelineRevealClip";

interface UseTimelineClipRenderWindowInput {
  tracks: Parameters<typeof createTimelineClipIndex>[0];
  viewport: TimelineScrollViewportSnapshot;
  pixelsPerSecond: number;
  contentOrigin: number;
  duration: number;
  selectedElementId?: string;
  draggedElementId?: string;
  resizingElementIds?: readonly string[];
  revealElementId?: string;
  focusedEaseElementId?: string;
  clipContextMenuElementId?: string;
  keyframeContextMenuElementId?: string;
  focusedElementId?: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  elements: readonly TimelineElement[];
  rowGeometry: TimelineRowGeometry;
  allowHorizontalReveal: boolean;
  rowVirtualizationActive: boolean;
  sessionEpoch: number;
}

export function useTimelineClipRenderWindow({
  tracks,
  viewport,
  pixelsPerSecond,
  contentOrigin,
  duration,
  selectedElementId,
  draggedElementId,
  resizingElementIds,
  revealElementId,
  focusedEaseElementId,
  clipContextMenuElementId,
  keyframeContextMenuElementId,
  focusedElementId,
  scrollRef,
  elements,
  rowGeometry,
  allowHorizontalReveal,
  rowVirtualizationActive,
  sessionEpoch,
}: UseTimelineClipRenderWindowInput) {
  const clipIndex = useMemo(() => createTimelineClipIndex(tracks), [tracks]);
  const renderTimeRange = useMemo(
    () => getTimelineRenderTimeRange(viewport, pixelsPerSecond, contentOrigin, duration),
    [contentOrigin, duration, pixelsPerSecond, viewport],
  );
  const pinnedClipIdentities = useMemo(
    () =>
      new Set(
        [
          selectedElementId,
          draggedElementId,
          ...(resizingElementIds ?? []),
          revealElementId,
          focusedEaseElementId,
          clipContextMenuElementId,
          keyframeContextMenuElementId,
          focusedElementId,
        ].filter((identity): identity is string => identity !== undefined),
      ),
    [
      clipContextMenuElementId,
      draggedElementId,
      focusedEaseElementId,
      focusedElementId,
      keyframeContextMenuElementId,
      resizingElementIds,
      revealElementId,
      selectedElementId,
    ],
  );
  useTimelineRevealClip({
    scrollRef,
    elements,
    rowGeometry,
    pixelsPerSecond,
    contentOrigin,
    allowHorizontal: allowHorizontalReveal,
    deferFocusUntilViewportUpdate: rowVirtualizationActive,
    focusedElementId,
    viewportVersion: viewport,
    sessionEpoch,
  });
  return { clipIndex, renderTimeRange, pinnedClipIdentities };
}
