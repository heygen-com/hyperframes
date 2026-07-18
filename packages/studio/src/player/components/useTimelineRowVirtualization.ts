import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type RefObject,
} from "react";
import type { TimelineElement } from "../store/playerStore";
import { resolveTimelineFocusIdentity } from "./timelineFocusIdentity";
import { getTimelineScrollTopForGeometryChange } from "./timelineViewportGeometry";
import type { TimelineRowGeometry } from "./timelineLayout";
import type { TimelineScrollViewportSnapshot } from "./useTimelineScrollViewport";
import { STUDIO_TIMELINE_ROW_VIRTUALIZATION_ENABLED } from "./timelineRowVirtualizationFlag";
import { useTimelineVirtualRows } from "./useTimelineVirtualRows";

interface UseTimelineRowVirtualizationInput {
  scrollRef: RefObject<HTMLDivElement | null>;
  viewport: TimelineScrollViewportSnapshot;
  rowGeometry: TimelineRowGeometry;
  sessionEpoch: number;
  elements: TimelineElement[];
  selectedElementId: string | null;
  revealElementId: string | null;
  draggedRowKey?: number;
  resizingElementIds?: readonly string[];
  clipContextMenuRowKey?: number;
  keyframeContextMenuRowKey?: number;
  lastScrollLeftRef: RefObject<number>;
  syncScrollViewport: (element: HTMLDivElement, isScrolling?: boolean) => void;
}

interface TimelineDomFocusPin {
  readonly rowKey?: number;
  readonly elementId?: string;
}

function getTimelineDomFocusPin(target: EventTarget | null): TimelineDomFocusPin | undefined {
  if (!(target instanceof Element)) return undefined;
  const value = target.closest<HTMLElement>("[data-timeline-row-key]")?.dataset.timelineRowKey;
  const parsedRowKey = value === undefined ? undefined : Number(value);
  const rowKey =
    parsedRowKey !== undefined && Number.isFinite(parsedRowKey) ? parsedRowKey : undefined;
  const elementId = target.closest<HTMLElement>("[data-el-id]")?.dataset.elId;
  return rowKey === undefined && elementId === undefined ? undefined : { rowKey, elementId };
}

export function useTimelineRowVirtualization({
  scrollRef,
  viewport,
  rowGeometry,
  sessionEpoch,
  elements,
  selectedElementId,
  revealElementId,
  draggedRowKey,
  resizingElementIds,
  clipContextMenuRowKey,
  keyframeContextMenuRowKey,
  lastScrollLeftRef,
  syncScrollViewport,
}: UseTimelineRowVirtualizationInput) {
  const enabled = STUDIO_TIMELINE_ROW_VIRTUALIZATION_ENABLED;
  const [domFocusPin, setDomFocusPin] = useState<TimelineDomFocusPin>();
  const onTimelineFocus = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    setDomFocusPin(getTimelineDomFocusPin(event.target));
  }, []);
  const onTimelineBlur = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    setDomFocusPin(getTimelineDomFocusPin(event.relatedTarget));
  }, []);
  const focusIdentity = useMemo(
    () => resolveTimelineFocusIdentity(elements, selectedElementId),
    [elements, selectedElementId],
  );
  const revealIdentity = useMemo(
    () => resolveTimelineFocusIdentity(elements, revealElementId),
    [elements, revealElementId],
  );
  const resizingRowKeys = useMemo(
    () =>
      resizingElementIds
        ?.map((elementId) => resolveTimelineFocusIdentity(elements, elementId)?.rowKey)
        .filter((rowKey): rowKey is number => rowKey !== undefined) ?? [],
    [elements, resizingElementIds],
  );
  const pinnedRowKeys = useMemo(
    () =>
      [
        draggedRowKey,
        ...resizingRowKeys,
        revealIdentity?.rowKey,
        clipContextMenuRowKey,
        keyframeContextMenuRowKey,
      ].filter((rowKey): rowKey is number => rowKey !== undefined),
    [
      clipContextMenuRowKey,
      draggedRowKey,
      keyframeContextMenuRowKey,
      resizingRowKeys,
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
    focusedRowKey: domFocusPin?.rowKey ?? focusIdentity?.rowKey,
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

  return {
    enabled,
    virtualRows,
    focusedElementId: domFocusPin?.elementId,
    timelineFocusProps: { onFocus: onTimelineFocus, onBlur: onTimelineBlur },
  };
}
