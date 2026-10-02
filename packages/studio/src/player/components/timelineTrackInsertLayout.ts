import type { TimelineTrackGroupInfo } from "./useTimelineTrackDerivations";

export function timelineTrackOrderChanged(
  previous: readonly number[],
  current: readonly number[],
): boolean {
  return current.length !== previous.length || current.some((key, row) => key !== previous[row]);
}

export interface TimelineTrackInsertLayout {
  allowedRows: ReadonlySet<number>;
  trackOrder: number[];
  topologyRows: number[];
  groupTracks: ReadonlyMap<number, readonly number[]>;
}

/** Groups own one contiguous insertion block, including their collapsed members. */
export function buildTimelineTrackInsertLayout(
  order: number[],
  groups: readonly Pick<TimelineTrackGroupInfo, "anchorKey" | "memberTracks">[],
): TimelineTrackInsertLayout {
  const allowedRows = new Set(Array.from({ length: order.length + 1 }, (_, row) => row));
  const anchors = new Map(groups.map((group) => [group.anchorKey, group.memberTracks]));
  const positions = new Map(order.map((key, row) => [key, row]));
  for (const group of groups) {
    const anchor = positions.get(group.anchorKey);
    if (anchor === undefined) continue;
    const end = Math.max(anchor, ...group.memberTracks.map((key) => positions.get(key) ?? anchor));
    for (let row = anchor + 1; row <= end; row++) allowedRows.delete(row);
  }
  const tracks = new Set<number>();
  const topologyRows = [0];
  for (const key of order) {
    for (const track of anchors.get(key) ?? [key]) tracks.add(track);
    topologyRows.push(tracks.size);
  }
  return {
    allowedRows,
    trackOrder: [...tracks],
    topologyRows,
    groupTracks: anchors,
  };
}
