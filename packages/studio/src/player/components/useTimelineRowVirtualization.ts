import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import type { TimelineElement } from "../store/playerStore";
import { thumbnailScheduler } from "../lib/thumbnailScheduler";
import { resolveTimelineFocusIdentity } from "./timelineFocusIdentity";
import { getTimelineScrollTopForGeometryChange } from "./timelineViewportGeometry";
import type { TimelineRowGeometry } from "./timelineLayout";
import type { TimelineScrollViewportSnapshot } from "./useTimelineScrollViewport";
import {
  STUDIO_TIMELINE_ROW_VIRTUALIZATION_ENABLED,
  useTimelineVirtualRows,
} from "./useTimelineVirtualRows";

interface UseTimelineRowVirtualizationInput {
  scrollRef: RefObject<HTMLDivElement | null>;
  viewport: TimelineScrollViewportSnapshot;
  rowGeometry: TimelineRowGeometry;
  sessionEpoch: number;
  projectId: string | null;
  elements: TimelineElement[];
  selectedElementId: string | null;
  revealElementId: string | null;
  draggedRowKey?: number;
  resizingRowKey?: number;
  clipContextMenuRowKey?: number;
  keyframeContextMenuRowKey?: number;
  lastScrollLeftRef: RefObject<number>;
  syncScrollViewport: (element: HTMLDivElement, isScrolling?: boolean) => void;
}

export function useTimelineRowVirtualization({
  scrollRef,
  viewport,
  rowGeometry,
  sessionEpoch,
  projectId,
  elements,
  selectedElementId,
  revealElementId,
  draggedRowKey,
  resizingRowKey,
  clipContextMenuRowKey,
  keyframeContextMenuRowKey,
  lastScrollLeftRef,
  syncScrollViewport,
}: UseTimelineRowVirtualizationInput) {
  const enabled =
    STUDIO_TIMELINE_ROW_VIRTUALIZATION_ENABLED &&
    viewport.clientWidth > 0 &&
    viewport.clientHeight > 0;
  const previousThumbnailProjectRef = useRef(projectId);
  useEffect(() => {
    thumbnailScheduler.setScrolling(viewport.isScrolling);
    return () => thumbnailScheduler.setScrolling(false);
  }, [viewport.isScrolling]);
  useEffect(() => {
    const previousProject = previousThumbnailProjectRef.current;
    previousThumbnailProjectRef.current = projectId;
    if (previousProject && previousProject !== projectId) {
      thumbnailScheduler.invalidateProject(previousProject);
    }
  }, [projectId]);

  const focusIdentity = useMemo(
    () => resolveTimelineFocusIdentity(elements, selectedElementId),
    [elements, selectedElementId],
  );
  const revealIdentity = useMemo(
    () => resolveTimelineFocusIdentity(elements, revealElementId),
    [elements, revealElementId],
  );
  const pinnedRowKeys = useMemo(
    () =>
      [
        draggedRowKey,
        resizingRowKey,
        revealIdentity?.rowKey,
        clipContextMenuRowKey,
        keyframeContextMenuRowKey,
      ].filter((rowKey): rowKey is number => rowKey !== undefined),
    [
      clipContextMenuRowKey,
      draggedRowKey,
      keyframeContextMenuRowKey,
      resizingRowKey,
      revealIdentity,
    ],
  );
  const virtualRows = useTimelineVirtualRows({
    enabled,
    scrollRef,
    viewport,
    rowGeometry,
    sessionEpoch,
    pinnedRowKeys,
    focusedRowKey: focusIdentity?.rowKey,
  });

  const previousLayoutRef = useRef(rowGeometry);
  const previousSessionEpochRef = useRef(sessionEpoch);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const previousGeometry = previousLayoutRef.current;
    if (previousSessionEpochRef.current !== sessionEpoch) {
      previousSessionEpochRef.current = sessionEpoch;
      lastScrollLeftRef.current = 0;
      if (scroll) {
        scroll.scrollLeft = 0;
        scroll.scrollTop = 0;
        syncScrollViewport(scroll);
      }
    } else if (scroll && previousGeometry !== rowGeometry) {
      const nextScrollTop = getTimelineScrollTopForGeometryChange(
        previousGeometry,
        rowGeometry,
        scroll.scrollTop,
      );
      if (nextScrollTop !== scroll.scrollTop) {
        scroll.scrollTop = nextScrollTop;
        syncScrollViewport(scroll);
      }
    }
    previousLayoutRef.current = rowGeometry;
  }, [lastScrollLeftRef, rowGeometry, scrollRef, sessionEpoch, syncScrollViewport]);

  return { enabled, virtualRows };
}
