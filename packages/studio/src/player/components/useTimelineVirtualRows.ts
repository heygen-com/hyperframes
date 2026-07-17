import { useCallback, useEffect, useMemo, type RefObject } from "react";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import { TIMELINE_VIEWPORT_BUDGETS } from "../lib/timelineViewportBudgets";
import type { TimelineScrollViewportSnapshot } from "./useTimelineScrollViewport";
import { RULER_H, TRACKS_TOP_PAD, type TimelineRowGeometry } from "./timelineLayout";

/** Enabled by default; set the flag to `0` for the release rollback path. */
export const STUDIO_TIMELINE_ROW_VIRTUALIZATION_ENABLED =
  import.meta.env.VITE_STUDIO_TIMELINE_ROW_VIRTUALIZATION_ENABLED !== "0";

export interface TimelineVirtualRow {
  readonly index: number;
  readonly rowKey: number;
}

export function extractTimelineVirtualRowRange(
  range: Range,
  pinnedRowIndexes: readonly number[],
): number[] {
  const indexes = new Set(defaultRangeExtractor(range));
  for (const index of pinnedRowIndexes) {
    if (index >= 0 && index < range.count) indexes.add(index);
  }
  return [...indexes].sort((left, right) => left - right);
}

interface UseTimelineVirtualRowsInput {
  enabled: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  viewport: TimelineScrollViewportSnapshot;
  rowGeometry: TimelineRowGeometry;
  sessionEpoch: number;
  pinnedRowKeys: readonly number[];
  focusedRowKey?: number;
}

export function useTimelineVirtualRows({
  enabled,
  scrollRef,
  viewport,
  rowGeometry,
  sessionEpoch,
  pinnedRowKeys,
  focusedRowKey,
}: UseTimelineVirtualRowsInput): readonly TimelineVirtualRow[] {
  const pinnedRowIndexes = useMemo(
    () => [
      ...new Set(
        [...pinnedRowKeys, ...(focusedRowKey === undefined ? [] : [focusedRowKey])].map((key) =>
          rowGeometry.getRowIndex(key),
        ),
      ),
    ],
    [focusedRowKey, pinnedRowKeys, rowGeometry],
  );
  const estimateSize = useCallback(
    (index: number) => rowGeometry.getRowHeight(index),
    [rowGeometry],
  );
  const getItemKey = useCallback(
    (index: number) => rowGeometry.rowKeys[index] ?? index,
    [rowGeometry],
  );
  const rangeExtractor = useCallback(
    (range: Range) => extractTimelineVirtualRowRange(range, pinnedRowIndexes),
    [pinnedRowIndexes],
  );
  const initialOffset = useCallback(() => viewport.scrollTop, [viewport.scrollTop]);
  const virtualizer = useVirtualizer({
    enabled,
    useFlushSync: false,
    count: rowGeometry.rowKeys.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    getItemKey,
    overscan: TIMELINE_VIEWPORT_BUDGETS.rowOverscanPerSide,
    rangeExtractor,
    scrollMargin: RULER_H + TRACKS_TOP_PAD,
    initialRect: { width: viewport.clientWidth, height: viewport.clientHeight },
    initialOffset,
  });

  useEffect(() => {
    if (!enabled) return;
    virtualizer.measure();
    // Timeline owns the epoch reset. This event only makes the virtualizer
    // observe the authoritative DOM offset after that reset; it never writes
    // scrollTop itself.
    scrollRef.current?.dispatchEvent(new Event("scroll"));
  }, [enabled, scrollRef, sessionEpoch, virtualizer]);

  const focusedRowIndex = focusedRowKey === undefined ? -1 : rowGeometry.getRowIndex(focusedRowKey);
  const focusedRowHeight = focusedRowIndex < 0 ? 0 : rowGeometry.getRowHeight(focusedRowIndex);
  useEffect(() => {
    if (enabled && focusedRowIndex >= 0) {
      virtualizer.resizeItem(focusedRowIndex, focusedRowHeight);
    }
  }, [enabled, focusedRowHeight, focusedRowIndex, sessionEpoch, virtualizer]);

  const allRows = useMemo(
    () => rowGeometry.rowKeys.map((rowKey, index) => ({ index, rowKey })),
    [rowGeometry],
  );
  // TanStack Virtual cannot calculate a range before the scroll viewport has
  // measurable height. Render the complete logical model for that first paint
  // so SSR, tests, and a newly mounted timeline never flash an empty treegrid.
  if (!enabled || viewport.clientHeight <= 0) return allRows;
  return virtualizer.getVirtualItems().map(({ index }) => ({
    index,
    rowKey: rowGeometry.rowKeys[index] ?? index,
  }));
}
