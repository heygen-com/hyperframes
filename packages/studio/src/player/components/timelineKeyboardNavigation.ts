import type { GsapAnimation, PropertyGroupName } from "@hyperframes/core/gsap-parser";
import type { TimelineElement } from "../store/playerStore";
import { getTimelinePropertyLanes } from "./TimelinePropertyLanes";
import {
  timelineKeyframeSelectionKey,
  type TimelineKeyframeTarget,
} from "./timelineKeyframeIdentity";
import {
  timelineClipFocusId,
  timelineEaseFocusId,
  timelineKeyframeFocusId,
  timelinePropertyRowId,
  timelineTrackRowId,
} from "./timelineNavigationIdentity";
import { resolveTrackKeyframeClip } from "./useTimelineTrackLayout";

export type TimelineNavigationKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown";

const NAVIGATION_KEYS: ReadonlySet<string> = new Set<TimelineNavigationKey>([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

export function isTimelineNavigationKey(key: string): key is TimelineNavigationKey {
  return NAVIGATION_KEYS.has(key);
}

export interface TimelineLogicalItem {
  id: string;
  kind: "clip" | "keyframe" | "ease";
  rowId: string;
  elementId: string;
  /** The item's time anchor. Clips use their midpoint; ease controls use the segment midpoint. */
  time: number;
  keyframeTarget?: TimelineKeyframeTarget;
}

export interface TimelineLogicalRow {
  id: string;
  kind: "row";
  physicalTrackKey: number;
  logicalIndex: number;
  level: 1 | 2;
  parentId: string | null;
  elementId: string | null;
  expandable: boolean;
  expanded: boolean;
  propertyGroup?: PropertyGroupName;
  items: readonly TimelineLogicalItem[];
}

export type TimelineLogicalTarget = TimelineLogicalRow | TimelineLogicalItem;

interface BuildTimelineLogicalRowsInput {
  tracks: readonly (readonly [number, readonly TimelineElement[]])[];
  displayTrackOrder: readonly number[];
  laneCounts: ReadonlyMap<string, number>;
  selectedElementId: string | null;
  selectedElementIds: ReadonlySet<string>;
  expandedClipIds: ReadonlySet<string>;
  gsapAnimations: ReadonlyMap<string, readonly GsapAnimation[]>;
}

export interface TimelineNavigationOptions {
  /** Supplied by the viewport actor; the model never guesses a fixed page size. */
  pageSize?: number;
  /** Ctrl/Meta + Home/End moves to the first/last logical row. */
  timelineBoundary?: boolean;
}

function elementId(element: TimelineElement): string {
  return element.key ?? element.id;
}

function clipItems(rowId: string, elements: readonly TimelineElement[]): TimelineLogicalItem[] {
  return [...elements]
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.start + left.duration - (right.start + right.duration) ||
        elementId(left).localeCompare(elementId(right)),
    )
    .map((element) => {
      const id = elementId(element);
      return {
        id: timelineClipFocusId(id),
        kind: "clip",
        rowId,
        elementId: id,
        time: element.start + element.duration / 2,
      };
    });
}

function keyframeTarget(
  keyframe: ReturnType<typeof getTimelinePropertyLanes>[number]["keyframes"][number],
): TimelineKeyframeTarget {
  return {
    percentage: keyframe.percentage,
    tweenPercentage: keyframe.tweenPercentage,
    propertyGroup: keyframe.propertyGroup,
    animationId: keyframe.animationId,
    collidingAnimationTargets: keyframe.collidingAnimationTargets,
  };
}

function propertyItems(
  rowId: string,
  clip: TimelineElement,
  keyframes: ReturnType<typeof getTimelinePropertyLanes>[number]["keyframes"],
): TimelineLogicalItem[] {
  const id = elementId(clip);
  const unique = new Map<string, { target: TimelineKeyframeTarget; time: number }>();
  for (const keyframe of keyframes) {
    const target = keyframeTarget(keyframe);
    const key = timelineKeyframeSelectionKey(id, target);
    if (!unique.has(key)) {
      unique.set(key, {
        target,
        time: clip.start + (keyframe.percentage / 100) * clip.duration,
      });
    }
  }
  const ordered = [...unique.entries()].sort(
    ([leftKey, left], [rightKey, right]) =>
      left.time - right.time || leftKey.localeCompare(rightKey),
  );
  const items: TimelineLogicalItem[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const [, current] = ordered[index]!;
    const previous = ordered[index - 1]?.[1];
    if (previous && current.time > previous.time && current.target.animationId !== undefined) {
      items.push({
        id: timelineEaseFocusId(id, current.target),
        kind: "ease",
        rowId,
        elementId: id,
        time: previous.time + (current.time - previous.time) / 2,
        keyframeTarget: current.target,
      });
    }
    items.push({
      id: timelineKeyframeFocusId(id, current.target),
      kind: "keyframe",
      rowId,
      elementId: id,
      time: current.time,
      keyframeTarget: current.target,
    });
  }
  return items;
}

/** Canonical model of the treegrid, independent of which virtual rows or clips are mounted. */
export function buildTimelineLogicalRows({
  tracks,
  displayTrackOrder,
  laneCounts,
  selectedElementId,
  selectedElementIds,
  expandedClipIds,
  gsapAnimations,
}: BuildTimelineLogicalRowsInput): TimelineLogicalRow[] {
  const trackMap = new Map(tracks);
  const rows: TimelineLogicalRow[] = [];
  for (const track of displayTrackOrder) {
    const elements = trackMap.get(track) ?? [];
    const trackId = timelineTrackRowId(track);
    const activeClip = resolveTrackKeyframeClip(
      elements,
      laneCounts,
      selectedElementId,
      selectedElementIds,
    );
    const activeId = activeClip ? elementId(activeClip) : null;
    const lanes = activeClip
      ? getTimelinePropertyLanes(
          gsapAnimations.get(elementId(activeClip)) ?? [],
          activeClip.start,
          activeClip.duration,
        )
      : [];
    const expanded = activeId !== null && expandedClipIds.has(activeId) && lanes.length > 0;
    rows.push({
      id: trackId,
      kind: "row",
      physicalTrackKey: track,
      logicalIndex: rows.length,
      level: 1,
      parentId: null,
      elementId: activeId,
      expandable: lanes.length > 0,
      expanded,
      items: clipItems(trackId, elements),
    });
    if (!expanded || !activeClip) continue;
    for (const lane of lanes) {
      const rowId = timelinePropertyRowId(activeId, lane.group);
      rows.push({
        id: rowId,
        kind: "row",
        physicalTrackKey: track,
        logicalIndex: rows.length,
        level: 2,
        parentId: trackId,
        elementId: activeId,
        expandable: false,
        expanded: false,
        propertyGroup: lane.group,
        items: propertyItems(rowId, activeClip, lane.keyframes),
      });
    }
  }
  return rows;
}

export function locateTimelineLogicalTarget(rows: readonly TimelineLogicalRow[], id: string) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]!;
    if (row.id === id) return { row, rowIndex, itemIndex: -1, target: row };
    const itemIndex = row.items.findIndex((item) => item.id === id);
    if (itemIndex >= 0) return { row, rowIndex, itemIndex, target: row.items[itemIndex]! };
  }
  return null;
}

function nearestTarget(row: TimelineLogicalRow, time: number): TimelineLogicalTarget {
  return (
    [...row.items].sort(
      (left, right) =>
        Math.abs(left.time - time) - Math.abs(right.time - time) ||
        left.time - right.time ||
        left.id.localeCompare(right.id),
    )[0] ?? row
  );
}

export function resolveTimelineNavigationTarget(
  rows: readonly TimelineLogicalRow[],
  currentId: string,
  key: TimelineNavigationKey,
  options: TimelineNavigationOptions = {},
): TimelineLogicalTarget | null {
  const current = locateTimelineLogicalTarget(rows, currentId);
  if (!current) return null;
  const { row, rowIndex, itemIndex, target } = current;

  if (key === "Home" || key === "End") {
    const boundaryRow = options.timelineBoundary ? (key === "Home" ? rows[0] : rows.at(-1)) : row;
    if (!boundaryRow) return target;
    return key === "Home" ? boundaryRow : (boundaryRow.items.at(-1) ?? boundaryRow);
  }
  if (key === "ArrowLeft") {
    if (itemIndex < 0) return row;
    return itemIndex === 0 ? row : row.items[itemIndex - 1]!;
  }
  if (key === "ArrowRight") {
    if (itemIndex < 0) return row.items[0] ?? row;
    return row.items[itemIndex + 1] ?? target;
  }

  const direction = key === "ArrowUp" || key === "PageUp" ? -1 : 1;
  const pageKey = key === "PageUp" || key === "PageDown";
  const pageSize = options.pageSize;
  if (pageKey && (pageSize === undefined || !Number.isFinite(pageSize) || pageSize < 1)) {
    return target;
  }
  const distance = pageKey ? Math.floor(pageSize!) : 1;
  const destinationIndex = Math.max(0, Math.min(rows.length - 1, rowIndex + direction * distance));
  const destination = rows[destinationIndex];
  if (!destination || destinationIndex === rowIndex) return target;
  return target.kind === "row" ? destination : nearestTarget(destination, target.time);
}

/** Preserve focus when possible, then choose previous, next, parent, or nearest surviving row. */
export function resolveTimelineFocusFallback(
  previousRows: readonly TimelineLogicalRow[],
  nextRows: readonly TimelineLogicalRow[],
  currentId: string,
): TimelineLogicalTarget | null {
  const unchanged = locateTimelineLogicalTarget(nextRows, currentId);
  if (unchanged) return unchanged.target;
  const previous = locateTimelineLogicalTarget(previousRows, currentId);
  if (!previous) return null;

  if (previous.itemIndex >= 0) {
    for (let index = previous.itemIndex - 1; index >= 0; index -= 1) {
      const candidate = locateTimelineLogicalTarget(nextRows, previous.row.items[index]!.id);
      if (candidate) return candidate.target;
    }
    for (let index = previous.itemIndex + 1; index < previous.row.items.length; index += 1) {
      const candidate = locateTimelineLogicalTarget(nextRows, previous.row.items[index]!.id);
      if (candidate) return candidate.target;
    }
  }

  const survivingRow = locateTimelineLogicalTarget(nextRows, previous.row.id);
  if (survivingRow) return survivingRow.target;
  if (previous.row.parentId) {
    const parent = locateTimelineLogicalTarget(nextRows, previous.row.parentId);
    if (parent) return parent.target;
  }
  return nextRows[previous.rowIndex] ?? nextRows[previous.rowIndex - 1] ?? null;
}
