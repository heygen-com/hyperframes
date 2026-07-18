import type { TimelineElement } from "../store/playerStore";

export interface TimelineTimeRange {
  readonly start: number;
  readonly end: number;
}

interface TimelineClipInterval {
  readonly element: TimelineElement;
  readonly identity: string;
  readonly ordinal: number;
  readonly start: number;
  readonly end: number;
}

interface TimelineClipRowIndex {
  readonly byStart: readonly TimelineClipInterval[];
  readonly prefixMaxEnd: readonly number[];
  readonly byIdentity: ReadonlyMap<string, readonly TimelineClipInterval[]>;
}

export interface TimelineClipIndex {
  readonly rows: ReadonlyMap<number, TimelineClipRowIndex>;
}

function clipIdentity(element: TimelineElement): string {
  return element.key ?? element.id;
}

function clipInterval(element: TimelineElement, ordinal: number): TimelineClipInterval | null {
  if (!Number.isFinite(element.start) || !Number.isFinite(element.duration)) return null;
  const duration = Math.max(0, element.duration);
  return Object.freeze({
    element,
    identity: clipIdentity(element),
    ordinal,
    start: element.start,
    end: element.start + duration,
  });
}

/** Immutable render index for the exact display-track projection. */
export function createTimelineClipIndex(
  tracks: readonly (readonly [number, readonly TimelineElement[]])[],
): TimelineClipIndex {
  const rows = new Map<number, TimelineClipRowIndex>();
  for (const [rowKey, elements] of tracks) {
    const intervals = elements
      .map(clipInterval)
      .filter((interval): interval is TimelineClipInterval => interval !== null);
    const byStart = Object.freeze(
      [...intervals].sort(
        (left, right) => left.start - right.start || left.ordinal - right.ordinal,
      ),
    );
    let maxEnd = Number.NEGATIVE_INFINITY;
    const prefixMaxEnd = Object.freeze(
      byStart.map((interval) => {
        maxEnd = Math.max(maxEnd, interval.end);
        return maxEnd;
      }),
    );
    const mutableByIdentity = new Map<string, TimelineClipInterval[]>();
    for (const interval of intervals) {
      const matches = mutableByIdentity.get(interval.identity) ?? [];
      matches.push(interval);
      mutableByIdentity.set(interval.identity, matches);
    }
    const byIdentity = new Map(
      [...mutableByIdentity].map(([identity, matches]) => [identity, Object.freeze(matches)]),
    );
    rows.set(rowKey, Object.freeze({ byStart, prefixMaxEnd, byIdentity }));
  }
  return Object.freeze({ rows });
}

function upperBoundStart(intervals: readonly TimelineClipInterval[], end: number): number {
  let low = 0;
  let high = intervals.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((intervals[mid]?.start ?? Number.POSITIVE_INFINITY) < end) low = mid + 1;
    else high = mid;
  }
  return low;
}

function overlaps(interval: TimelineClipInterval, range: TimelineTimeRange): boolean {
  if (interval.end <= interval.start)
    return interval.start >= range.start && interval.start < range.end;
  return interval.start < range.end && interval.end > range.start;
}

/**
 * Query one display row. The overlap set and explicit actor pins are returned
 * in the row's original projection order, so windowing never changes z/DOM order.
 */
export function queryTimelineClipIndex(
  index: TimelineClipIndex,
  rowKey: number,
  range: TimelineTimeRange,
  pinnedIdentities: ReadonlySet<string> = new Set(),
): readonly TimelineElement[] {
  const row = index.rows.get(rowKey);
  if (!row) return Object.freeze([]);
  const selected = new Set<TimelineClipInterval>();
  if (range.end > range.start) {
    let cursor = upperBoundStart(row.byStart, range.end) - 1;
    while (cursor >= 0 && (row.prefixMaxEnd[cursor] ?? Number.NEGATIVE_INFINITY) >= range.start) {
      const interval = row.byStart[cursor];
      if (interval && overlaps(interval, range)) selected.add(interval);
      cursor -= 1;
    }
  }
  for (const identity of pinnedIdentities) {
    for (const interval of row.byIdentity.get(identity) ?? []) selected.add(interval);
  }
  return Object.freeze(
    [...selected]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((interval) => interval.element),
  );
}
