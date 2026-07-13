import { usePlayerStore } from "../player/store/playerStore";
import { selectedKeyframePercentagesForElement } from "../utils/keyframeSelection";
import type { CommitMutationOptions } from "./gsapScriptCommitTypes";

let deleteKeyframesCommitCounter = 0;

/**
 * Remove the keyframes currently selected in the player store from the active
 * element's GSAP animation. Reads selection lazily so it stays correct when
 * invoked from a ref callback.
 */
export function deleteSelectedKeyframes(session: {
  selectedGsapAnimations: readonly { id: string; keyframes?: unknown }[];
  handleGsapRemoveKeyframe: (
    animId: string,
    pct: number,
    options?: Partial<CommitMutationOptions>,
  ) => void;
}): void {
  const { selectedKeyframes, selectedElementId } = usePlayerStore.getState();
  const animation = session.selectedGsapAnimations.find((anim) => anim.keyframes);
  if (!animation) return;
  // Only the active element's keyframes; a stale cross-element selection must not delete here.
  const percentages = selectedKeyframePercentagesForElement(selectedKeyframes, selectedElementId);
  const coalesceOptions = {
    coalesceKey: `delete-keyframes:${++deleteKeyframesCommitCounter}`,
    coalesceMs: Number.POSITIVE_INFINITY,
  };
  for (const [index, pct] of percentages.entries()) {
    session.handleGsapRemoveKeyframe(animation.id, pct, {
      ...coalesceOptions,
      ...(index === percentages.length - 1 ? { softReload: true } : { skipReload: true }),
    });
  }
}
