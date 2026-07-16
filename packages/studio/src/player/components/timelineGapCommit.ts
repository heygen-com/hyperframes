import type { TimelineElement } from "../store/playerStore";
import { getTimelineEditCapabilities } from "./timelineEditing";
import {
  persistMoveEdits,
  type DragCommitDeps,
  type TimelineMoveEdit,
} from "./timelineClipDragCommit";
import {
  laneGapFloor,
  resolveAllTrackGaps,
  resolveCloseGapShifts,
  resolveTrackGapAt,
  type TrackGapShift,
} from "./timelineGaps";

/**
 * Commit layer for the track-gap context menu ("Close gap" / "Close all gaps").
 *
 * Each action is ONE atomic {@link persistMoveEdits} batch — pure time moves
 * (`updates.track === element.track`, no authored-track rewrite) tagged with a
 * per-gesture-unique coalesce key, so an action is exactly one undo entry and
 * flows through the existing move pipeline (optimistic store apply + rollback,
 * SDK fast path, patchIframeDomTiming preview).
 *
 * Refusal rule: if ANY clip that must shift is unmovable
 * ({@link getTimelineEditCapabilities}.canMove === false), the whole action is
 * refused — never a partial compaction. The menu disables the item via
 * {@link canShiftTrackGapClips}; the commit re-checks as defense in depth.
 */

const keyOf = (e: TimelineElement) => e.key ?? e.id;

// Per-gesture-unique coalesce key. A monotonic counter — NOT Date.now() /
// Math.random() (determinism rules) — mirrors laneChangeGestureSeq in
// timelineClipDragCommit.ts.
let gapCloseGestureSeq = 0;

/** True when every clip named in `shifts` may be time-moved. */
export function canShiftTrackGapClips(
  laneElements: readonly TimelineElement[],
  shifts: readonly TrackGapShift[],
): boolean {
  const byKey = new Map(laneElements.map((e) => [keyOf(e), e]));
  return shifts.every((s) => {
    const element = byKey.get(s.key);
    return element != null && getTimelineEditCapabilities(element).canMove;
  });
}

function buildShiftEdits(
  laneElements: readonly TimelineElement[],
  shifts: readonly TrackGapShift[],
): TimelineMoveEdit[] | null {
  if (shifts.length === 0 || !canShiftTrackGapClips(laneElements, shifts)) return null;
  const byKey = new Map(laneElements.map((e) => [keyOf(e), e]));
  return shifts.map((s) => {
    const element = byKey.get(s.key)!;
    return { element, updates: { start: s.newStart, track: element.track } };
  });
}

function commitShifts(
  laneElements: readonly TimelineElement[],
  shifts: readonly TrackGapShift[],
  deps: DragCommitDeps,
): boolean {
  const edits = buildShiftEdits(laneElements, shifts);
  if (!edits) return false;
  void persistMoveEdits(edits, deps, `track-gap-close:${gapCloseGestureSeq++}`);
  return true;
}

/**
 * Close the ONE gap under `time` on the lane: the next clip and every clip
 * after it on that lane shift left by the gap's width. Returns false (and
 * writes nothing) when there is no gap at the point or a shifting clip is
 * unmovable.
 */
export function commitCloseTrackGap(
  laneElements: readonly TimelineElement[],
  time: number,
  deps: DragCommitDeps,
): boolean {
  const gap = resolveTrackGapAt(laneElements, time, undefined, laneGapFloor(laneElements));
  if (!gap) return false;
  return commitShifts(laneElements, resolveCloseGapShifts(laneElements, gap), deps);
}

/**
 * Compact the whole lane (leading gap included): clips become contiguous from
 * 0, order and durations preserved. Returns false (and writes nothing) when
 * the lane has no gaps or a shifting clip is unmovable.
 */
export function commitCloseAllTrackGaps(
  laneElements: readonly TimelineElement[],
  deps: DragCommitDeps,
): boolean {
  return commitShifts(
    laneElements,
    resolveAllTrackGaps(laneElements, undefined, laneGapFloor(laneElements)),
    deps,
  );
}
