import type { TimelineElement } from "../player/store/playerStore";

export { buildPatchTarget, readFileContent } from "../hooks/timelineEditingHelpers";

/** Minimum distance (seconds) from clip boundaries to allow a split. */
export const SPLIT_BOUNDARY_EPSILON_S = 0.03;

/**
 * True when splitTime leaves at least SPLIT_BOUNDARY_EPSILON_S on both sides
 * of the cut. Inclusive at the epsilon offsets: the timeline canvas clamps
 * edge clicks to exactly start/end ± epsilon, so the clamped value must pass.
 */
export function isSplitTimeWithinBounds(
  splitTime: number,
  clipStart: number,
  clipDuration: number,
): boolean {
  return (
    splitTime >= clipStart + SPLIT_BOUNDARY_EPSILON_S &&
    splitTime <= clipStart + clipDuration - SPLIT_BOUNDARY_EPSILON_S
  );
}

export function canSplitElement(el: TimelineElement): boolean {
  return (
    !el.timelineLocked &&
    el.timingSource !== "implicit" &&
    !el.compositionSrc &&
    !!el.duration &&
    Number.isFinite(el.duration)
  );
}
