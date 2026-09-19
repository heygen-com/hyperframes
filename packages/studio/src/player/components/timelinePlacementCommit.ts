import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { holdTimelineManifests } from "../lib/timelineManifestHold";
import type { DraggedClipState } from "./timelineClipDragTypes";
import type { DragCommitDeps, TimelineMoveEdit } from "./timelineClipDragCommit";
import { canMoveTimelineElement } from "./timelineAuthoredMoveTarget";
import { authoredTrackForLane } from "./timelineAuthoredTrack";
import { round3 } from "./timelineGaps";
import { hasSourcePlaybackOffset } from "./timelineGroupEditing";
import { placeClip, type PlacementMode, type PlaceClipResult } from "./timelinePlacement";
import { getTimelineElementIdentity as keyOf } from "../lib/timelineElementHelpers";
import type { TimelineGroupResizeChange } from "../../hooks/useTimelineGroupEditing";
import { canSplitElementAt, SPLIT_BOUNDARY_EPSILON_S } from "../../utils/timelineElementSplit";

/** One shared history key and an unbounded window: every write of a drop is one undo step. */
export interface PlacementFold {
  coalesceKey: string;
  coalesceMs: number;
}

/** The two writes a drop needs beyond move and resize; both must record with the fold key. */
export interface PlacementOps {
  split: (element: TimelineElement, at: number, fold: PlacementFold) => Promise<boolean>;
  remove: (elements: TimelineElement[], fold: PlacementFold) => Promise<boolean>;
  toast: (message: string) => void;
  /** The one full-reload point for a drop; split/remove skip their own while folded. */
  reloadPreview: () => void;
}

export type PlacementStep =
  | { kind: "split"; element: TimelineElement; at: number }
  | { kind: "remove"; elements: TimelineElement[] }
  | { kind: "resize"; changes: TimelineGroupResizeChange[] }
  | { kind: "move"; edits: TimelineMoveEdit[] };

const WAIT_FOR_RELOAD = "Wait for the previous edit to finish";

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
  result: PlaceClipResult;
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
  const shiftEdits = result.shifts.map((s) => moveEdit(clip(s.key), round3(s.start)));
  const splits: PlacementStep[] = [];
  const removes: TimelineElement[] = [];
  const resizes: TimelineGroupResizeChange[] = [];
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
  result: PlaceClipResult,
  mode: PlacementMode,
  laneClips: readonly TimelineElement[],
  dragged?: TimelineElement,
): string | null {
  const byKey = new Map(laneClips.map((e) => [keyOf(e), e]));
  if (dragged?.awaitingReload) return WAIT_FOR_RELOAD;
  const touched = [...result.cuts, ...result.shifts].map((c) => byKey.get(c.key));
  if (touched.some((el) => !el || !canMoveTimelineElement(el) || el.expandedParentStart != null)) {
    return "Cannot overwrite a locked or expanded clip";
  }
  if (touched.some((el) => el?.awaitingReload)) {
    return WAIT_FOR_RELOAD;
  }
  const unsplittable = result.cuts.some((cut) => {
    if (cut.kind !== "split") return false;
    const at = mode === "overwrite" ? cut.tail.start : result.start;
    const el = byKey.get(cut.key);
    return !el || !canSplitElementAt(el, at);
  });
  if (unsplittable) return "Cannot split a clip at the drop point";
  // A trim below the split epsilon would leave a sliver too thin to select or re-split.
  const tooThin = result.cuts.some(
    (cut) =>
      (cut.kind === "trim-head" || cut.kind === "trim-tail") &&
      cut.duration < SPLIT_BOUNDARY_EPSILON_S,
  );
  return tooThin ? "Cannot trim a clip that thin" : null;
}

let placementGestureSeq = 0;

interface PlacementRunner {
  ops: PlacementOps;
  resize: (changes: TimelineGroupResizeChange[], fold: PlacementFold) => Promise<void> | void;
  move: (edits: TimelineMoveEdit[], fold: PlacementFold) => Promise<boolean>;
  /** Puts the drop's end state in the store before any write starts. */
  applyToStore: (steps: readonly PlacementStep[]) => void;
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

/** The clip a split will add, under a stand-in id until the reload reports the real one. */
function pendingSplitTail(el: TimelineElement, at: number): TimelineElement {
  const playbackStart = hasSourcePlaybackOffset(el)
    ? round3((el.playbackStart ?? 0) + (at - el.start) * (el.playbackRate ?? 1))
    : el.playbackStart;
  return {
    ...el,
    id: `${el.id}~tail`,
    key: `${keyOf(el)}~tail`,
    awaitingReload: true,
    domId: undefined,
    start: at,
    duration: round3(el.start + el.duration - at),
    playbackStart,
  };
}

function moveUpdate(edit: TimelineMoveEdit): Partial<TimelineElement> {
  const written =
    edit.persistTrack ??
    (edit.updates.track !== edit.element.track ? edit.updates.track : undefined);
  return written == null ? edit.updates : { ...edit.updates, authoredTrack: written };
}

function resizeUpdate(change: TimelineGroupResizeChange): Partial<TimelineElement> {
  return {
    start: change.start,
    duration: change.duration,
    ...(change.playbackStart != null ? { playbackStart: change.playbackStart } : {}),
  };
}

/** What one step changes in the store: keyed updates, removed keys, and clips it adds. */
function stepEffects(step: PlacementStep): {
  updates: Array<[string, Partial<TimelineElement>]>;
  removed: string[];
  added: TimelineElement[];
} {
  switch (step.kind) {
    case "remove":
      return { updates: [], removed: step.elements.map(keyOf), added: [] };
    case "move":
      return {
        updates: step.edits.map((edit) => [keyOf(edit.element), moveUpdate(edit)]),
        removed: [],
        added: [],
      };
    case "resize":
      return {
        updates: step.changes.map((change) => [keyOf(change.element), resizeUpdate(change)]),
        removed: [],
        added: [],
      };
    case "split":
      return {
        updates: [[keyOf(step.element), { duration: round3(step.at - step.element.start) }]],
        removed: [],
        added: [pendingSplitTail(step.element, step.at)],
      };
  }
}

/** The drop's end state, written to the store in one go so no in-between state is ever shown. */
function applyPlacementToStore(steps: readonly PlacementStep[]): void {
  const removed = new Set<string>();
  const updates = new Map<string, Partial<TimelineElement>>();
  const tails: TimelineElement[] = [];
  for (const effects of steps.map(stepEffects)) {
    for (const key of effects.removed) removed.add(key);
    for (const [key, next] of effects.updates) updates.set(key, { ...updates.get(key), ...next });
    tails.push(...effects.added);
  }
  const { elements, setElements } = usePlayerStore.getState();
  setElements([
    ...elements
      .filter((el) => !removed.has(keyOf(el)))
      .map((el) => ({ ...el, ...updates.get(keyOf(el)) })),
    ...tails,
  ]);
}

/** Steps run in order, each from the last write; preview manifests stay held until the final reload. */
export async function runPlacementSteps(
  steps: readonly PlacementStep[],
  run: PlacementRunner,
): Promise<void> {
  const fold: PlacementFold = {
    coalesceKey: `clip-overwrite:${placementGestureSeq++}`,
    coalesceMs: Number.POSITIVE_INFINITY,
  };
  const release = holdTimelineManifests();
  try {
    run.applyToStore(steps);
    for (const [index, step] of steps.entries()) {
      let applied = false;
      try {
        applied = (await runStep(step, fold, run)) !== false;
      } catch (error) {
        console.error("[Timeline] Overwrite step failed", error);
      }
      if (applied) continue;
      run.ops.toast(
        index > 0
          ? "Overwrite partly applied, Undo restores it"
          : "Overwrite failed, nothing changed",
      );
      // The store was told the drop's end state; only a reload puts back what disk holds.
      run.ops.reloadPreview();
      return;
    }
    // remove/split write to disk directly and skip their own reload while folded here.
    if (steps.some((step) => step.kind === "remove" || step.kind === "split")) {
      run.ops.reloadPreview();
    }
  } finally {
    release();
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
    start: drag.previewStart,
    duration: drag.element.duration,
    mode,
  });
  if (result.cuts.length === 0 && result.shifts.length === 0) return null;

  const refusal = placementRefusal(result, mode, laneClips, drag.element);
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
    applyToStore: applyPlacementToStore,
  });
}
