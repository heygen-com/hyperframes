import type { DomEditPatchBatchesResult } from "../../hooks/domEditCommitTypes";

/**
 * Run one COMPLETE z→lane gesture — the z-index persist followed by its
 * timeline lane mirror — as a single serialized transaction.
 *
 * Why a queue: the two phases persist through DIFFERENT pipelines (the z patch
 * rides the DOM-edit save queue, the lane move rides the timeline/SDK move
 * path). Each gesture orders its own phases by awaiting the z persist, but
 * without cross-gesture serialization a second rapid gesture's z write can
 * land BETWEEN the first gesture's z and lane phases and the interleaved
 * file writes can clobber each other. All z→lane gestures (canvas z-order
 * menu AND Layers-panel drag) chain through this single module-level tail, so
 * gesture B's z phase cannot start until gesture A's lane phase settled.
 *
 * Why the durability gate: a resolved z commit is not necessarily durable —
 * when the server cannot match a patch target, commitDomEditPatchBatches
 * resolves with `allMatched: false` (after scheduling a reload to
 * reconverge). Mirroring a lane move onto a z state that disk never held
 * would desync track order from what actually paints, so the mirror phase is
 * skipped and the gesture resolves `false`.
 *
 * Failures never wedge the queue: a rejected gesture propagates to ITS caller
 * while the tail continues for the next gesture.
 */
let gestureTail: Promise<unknown> = Promise.resolve();

export function runZLaneGesture(input: {
  /** Phase 1: persist the z patch (handleDomZIndexReorderCommit). */
  commitZ: () => Promise<DomEditPatchBatchesResult | undefined | void>;
  /** Phase 2: mirror into a timeline lane move; only runs on a durable phase 1. */
  mirror: () => Promise<boolean>;
}): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    const result = await input.commitZ();
    if (result && result.allMatched === false) return false;
    return input.mirror();
  };
  const gesture = gestureTail.then(run, run);
  gestureTail = gesture.then(
    () => undefined,
    () => undefined,
  );
  return gesture;
}
