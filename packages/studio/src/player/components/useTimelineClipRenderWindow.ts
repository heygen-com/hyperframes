import { useMemo, type RefObject } from "react";
import { createTimelineClipIndex } from "../lib/timelineClipIndex";
import { getTimelineRenderTimeRange } from "./timelineLayout";
import type { TimelineElement } from "../store/playerStore";
import type { TimelineRowGeometry } from "./timelineLayout";
import type { TimelineScrollViewportSnapshot } from "./useTimelineScrollViewport";
import { getTimelineVisibleTimeRange } from "./timelineViewportGeometry";
import { useTimelineRevealClip } from "./useTimelineRevealClip";

interface UseTimelineClipRenderWindowInput {
  tracks: Parameters<typeof createTimelineClipIndex>[0];
  viewport: TimelineScrollViewportSnapshot;
  pixelsPerSecond: number;
  contentOrigin: number;
  duration: number;
  selectedElementId?: string;
  draggedElementId?: string;
  resizingElementId?: string;
  revealElementId?: string;
  focusedEaseElementId?: string;
  clipContextMenuElementId?: string;
  keyframeContextMenuElementId?: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  elements: TimelineElement[];
  rowGeometry: TimelineRowGeometry;
  allowHorizontalReveal: boolean;
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
  resizingElementId,
  revealElementId,
  focusedEaseElementId,
  clipContextMenuElementId,
  keyframeContextMenuElementId,
  scrollRef,
  elements,
  rowGeometry,
  allowHorizontalReveal,
  sessionEpoch,
}: UseTimelineClipRenderWindowInput) {
  const clipIndex = useMemo(() => createTimelineClipIndex(tracks), [tracks]);
  const renderTimeRange = useMemo(
    () => getTimelineRenderTimeRange(viewport, pixelsPerSecond, contentOrigin, duration),
    [contentOrigin, duration, pixelsPerSecond, viewport],
  );
  const visibleTimeRange = useMemo(
    () => getTimelineVisibleTimeRange(viewport, pixelsPerSecond, contentOrigin, duration),
    [contentOrigin, duration, pixelsPerSecond, viewport],
  );
  const pinnedClipIdentities = useMemo(
    () =>
      new Set(
        [
          selectedElementId,
          draggedElementId,
          resizingElementId,
          revealElementId,
          focusedEaseElementId,
          clipContextMenuElementId,
          keyframeContextMenuElementId,
        ].filter((identity): identity is string => identity !== undefined),
      ),
    [
      clipContextMenuElementId,
      draggedElementId,
      focusedEaseElementId,
      keyframeContextMenuElementId,
      resizingElementId,
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
    viewportVersion: viewport,
    sessionEpoch,
  });
  return { clipIndex, renderTimeRange, visibleTimeRange, pinnedClipIdentities };
}
