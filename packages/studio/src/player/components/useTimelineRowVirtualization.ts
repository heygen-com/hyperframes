import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { TimelineElement } from "../store/playerStore";
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
  elements: readonly TimelineElement[];
  selectedElementId: string | null;
  focusedRowKey?: number;
  draggedRowKey?: number;
  resizingRowKey?: number;
  clipContextMenuRowKey?: number;
  keyframeContextMenuRowKey?: number;
  lastScrollLeftRef: RefObject<number>;
  syncScrollViewport: (element: HTMLDivElement, isScrolling?: boolean) => void;
}

function getFocusedTimelineRowKey(target: EventTarget | null): number | undefined {
  if (!(target instanceof Element)) return undefined;
  const value = target.closest<HTMLElement>("[data-timeline-row-key]")?.dataset.timelineRowKey;
  if (value === undefined) return undefined;
  const rowKey = Number(value);
  return Number.isFinite(rowKey) ? rowKey : undefined;
}

export function useTimelineRowVirtualization({
  scrollRef,
  viewport,
  rowGeometry,
  sessionEpoch,
  elements,
  selectedElementId,
  focusedRowKey,
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
  const [domFocusedRowKey, setDomFocusedRowKey] = useState<number>();
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const handleFocusIn = (event: FocusEvent) => {
      setDomFocusedRowKey(getFocusedTimelineRowKey(event.target));
    };
    const handleFocusOut = (event: FocusEvent) => {
      setDomFocusedRowKey(getFocusedTimelineRowKey(event.relatedTarget));
    };
    scroll.addEventListener("focusin", handleFocusIn);
    scroll.addEventListener("focusout", handleFocusOut);
    return () => {
      scroll.removeEventListener("focusin", handleFocusIn);
      scroll.removeEventListener("focusout", handleFocusOut);
    };
  }, [scrollRef, sessionEpoch]);
  const selectedIdentity = useMemo(
    () => resolveTimelineFocusIdentity(elements, selectedElementId),
    [elements, selectedElementId],
  );
  const pinnedRowKeys = useMemo(
    () =>
      [
        draggedRowKey,
        resizingRowKey,
        selectedIdentity?.rowKey,
        focusedRowKey,
        clipContextMenuRowKey,
        keyframeContextMenuRowKey,
      ].filter((rowKey): rowKey is number => rowKey !== undefined),
    [
      clipContextMenuRowKey,
      draggedRowKey,
      focusedRowKey,
      keyframeContextMenuRowKey,
      resizingRowKey,
      selectedIdentity,
    ],
  );
  const virtualRows = useTimelineVirtualRows({
    enabled,
    scrollRef,
    viewport,
    rowGeometry,
    sessionEpoch,
    pinnedRowKeys,
    focusedRowKey: domFocusedRowKey ?? focusedRowKey,
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
