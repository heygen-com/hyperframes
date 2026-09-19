import type { TimelineElement } from "../store/playerStore";
import type { DraggedClipState } from "./timelineClipDragTypes";
import type { DragCommitDeps, TimelineMoveEdit } from "./timelineClipDragCommit";
import { canMoveTimelineElement } from "./timelineAuthoredMoveTarget";
import { authoredTrackForLane } from "./timelineAuthoredTrack";
import { round3 } from "./timelineGaps";
import { hasSourcePlaybackOffset } from "./timelineGroupEditing";
import {
  placeClip,
  type PlacementMode,
  type PlacementResult,
  type PlacementShift,
} from "./timelinePlacement";
import { canSplitElementAt } from "../../utils/timelineElementSplit";

/** One shared history key and an unbounded window: every write of a drop is one undo step. */
export interface PlacementFold {
  coalesceKey: string;
  coalesceMs: number;
}

export interface PlacementResizeChange {
  element: TimelineElement;
  start: number;
  duration: number;
  playbackStart?: number;
}

/** The two writes a drop needs beyond move and resize; both must record with the fold key. */
export interface PlacementOps {
  split: (element: TimelineElement, at: number, fold: PlacementFold) => Promise<boolean>;
  remove: (elements: TimelineElement[], fold: PlacementFold) => Promise<boolean>;
  toast: (message: string) => void;
}

export type PlacementStep =
  | { kind: "split"; element: TimelineElement; at: number }
  | { kind: "remove"; elements: TimelineElement[] }
  | { kind: "resize"; changes: PlacementResizeChange[] }
  | { kind: "move"; edits: TimelineMoveEdit[] };

const keyOf = (e: TimelineElement) => e.key ?? e.id;

const moveEdit = (element: TimelineElement, start: number): TimelineMoveEdit => ({
  element,
  updates: { start, track: element.track },
});

/** Where a trimmed-in clip starts reading its source: later by the cut time, at its own rate. */
function trimmedPlaybackStart(el: TimelineElement, sourceShift: number): number | undefined {
  if (!hasSourcePlaybackOffset(el)) return el.playbackStart;
  return round3((el.playbackStart ?? 0) + sourceShift * (el.playbackRate ?? 1));
}

interface PlacementPlanInput {
  result: PlacementResult;
  mode: PlacementMode;
  laneClips: readonly TimelineElement[];
  draggedEdit: TimelineMoveEdit;
}

/**
 * Placement to ordered writes, needing no new clip id: an overwrite splits at the drop end then
 * trims the original; an insert pushes the straddled clip, splits it, then moves the head back.
 */
export function buildPlacementSteps({
  result,
  mode,
  laneClips,
  draggedEdit,
}: PlacementPlanInput): PlacementStep[] {
  const byKey = new Map(laneClips.map((e) => [keyOf(e), e]));
  const clip = (key: string): TimelineElement => {
    const found = byKey.get(key);
    if (!found) throw new Error(`Placement referenced ${key}, which is not on the target lane`);
    return found;
  };
  const shiftEdits = result.shifts.map((s: PlacementShift) =>
    moveEdit(clip(s.key), round3(s.start)),
  );
  const splits: PlacementStep[] = [];
  const removes: TimelineElement[] = [];
  const resizes: PlacementResizeChange[] = [];
  const settle: TimelineMoveEdit[] = [];

  for (const cut of result.cuts) {
    const el = clip(cut.key);
    switch (cut.kind) {
      case "remove":
        removes.push(el);
        break;
      case "trim-tail":
        resizes.push({ element: el, start: el.start, duration: round3(cut.duration) });
        break;
      case "trim-head":
        resizes.push({
          element: el,
          start: round3(cut.start),
          duration: round3(cut.duration),
          playbackStart: trimmedPlaybackStart(el, cut.sourceShift),
        });
        break;
      case "split": {
        const at = round3(cut.tail.start);
        if (mode === "overwrite") {
          splits.push({ kind: "split", element: el, at });
          resizes.push({
            element: { ...el, duration: round3(at - el.start) },
            start: el.start,
            duration: round3(cut.headDuration),
          });
          break;
        }
        const pushed = { ...el, start: round3(el.start + (at - result.start)) };
        shiftEdits.push(moveEdit(el, pushed.start));
        splits.push({ kind: "split", element: pushed, at });
        settle.push(moveEdit({ ...pushed, duration: round3(cut.headDuration) }, el.start));
        break;
      }
    }
  }

  const steps: PlacementStep[] = [];
  if (shiftEdits.length > 0) steps.push({ kind: "move", edits: shiftEdits });
  steps.push(...splits);
  if (removes.length > 0) steps.push({ kind: "remove", elements: removes });
  if (resizes.length > 0) steps.push({ kind: "resize", changes: resizes });
  steps.push({ kind: "move", edits: [...settle, draggedEdit] });
  return steps;
}

/** Reason the whole drop must be refused, or null. Nothing is written when this is set. */
export function placementRefusal(
  result: PlacementResult,
  mode: PlacementMode,
  laneClips: readonly TimelineElement[],
): string | null {
  const byKey = new Map(laneClips.map((e) => [keyOf(e), e]));
  const touched = [...result.cuts, ...result.shifts].map((c) => byKey.get(c.key));
  if (touched.some((el) => !el || !canMoveTimelineElement(el) || el.expandedParentStart != null)) {
    return "Cannot overwrite a locked or expanded clip";
  }
  const unsplittable = result.cuts.some((cut) => {
    if (cut.kind !== "split") return false;
    const at = mode === "overwrite" ? cut.tail.start : result.start;
    const el = byKey.get(cut.key);
    return !el || !canSplitElementAt(el, at);
  });
  return unsplittable ? "Cannot split a clip at the drop point" : null;
}

let placementGestureSeq = 0;

interface PlacementRunner {
  ops: PlacementOps;
  resize: (changes: PlacementResizeChange[], fold: PlacementFold) => Promise<void> | void;
  move: (edits: TimelineMoveEdit[], fold: PlacementFold) => Promise<boolean>;
}

function runStep(step: PlacementStep, fold: PlacementFold, run: PlacementRunner) {
  switch (step.kind) {
    case "split":
      return run.ops.split(step.element, step.at, fold);
    case "remove":
      return run.ops.remove(step.elements, fold);
    case "resize":
      return run.resize(step.changes, fold);
    case "move":
      return run.move(step.edits, fold);
  }
}

/** Each step awaits the previous: the history fold needs every write to start from the last one's output. */
export async function runPlacementSteps(
  steps: readonly PlacementStep[],
  run: PlacementRunner,
): Promise<void> {
  const fold: PlacementFold = {
    coalesceKey: `clip-overwrite:${placementGestureSeq++}`,
    coalesceMs: Number.POSITIVE_INFINITY,
  };
  for (const [index, step] of steps.entries()) {
    let applied = false;
    try {
      applied = (await runStep(step, fold, run)) !== false;
    } catch (error) {
      console.error("[Timeline] Overwrite step failed", error);
    }
    if (applied) continue;
    if (index > 0) run.ops.toast("Overwrite partly applied, Undo restores it");
    return;
  }
}

/** Commit a single-clip drop onto its lane's clips; null when it touches none, so plain moves apply. */
export function commitPlacementDrop(
  drag: DraggedClipState,
  deps: DragCommitDeps,
  mode: PlacementMode,
  move: PlacementRunner["move"],
): Promise<void> | null {
  const { placementOps, onResizeElements, elements } = deps;
  const dragKey = keyOf(drag.element);
  const laneChanged = drag.previewTrack !== drag.element.track;
  if (!placementOps || !onResizeElements) return null;
  if (!laneChanged && drag.previewStart === drag.element.start) return null;

  const laneClips = elements.filter((e) => e.track === drag.previewTrack && keyOf(e) !== dragKey);
  const result = placeClip({
    clips: laneClips.map((e) => ({ key: keyOf(e), start: e.start, duration: e.duration })),
    track: drag.previewTrack,
    start: drag.previewStart,
    duration: drag.element.duration,
    mode,
  });
  if (result.cuts.length === 0 && result.shifts.length === 0) return null;

  const refusal = placementRefusal(result, mode, laneClips);
  if (refusal) {
    placementOps.toast(refusal);
    return Promise.resolve();
  }
  const draggedEdit: TimelineMoveEdit = {
    element: drag.element,
    updates: { start: result.start, track: drag.previewTrack },
    ...(laneChanged
      ? { persistTrack: authoredTrackForLane(drag.previewTrack, elements, drag.element) }
      : {}),
  };
  const steps = buildPlacementSteps({ result, mode, laneClips, draggedEdit });
  return runPlacementSteps(steps, {
    ops: placementOps,
    resize: (changes, fold) => onResizeElements(changes, fold),
    move,
  });
}
