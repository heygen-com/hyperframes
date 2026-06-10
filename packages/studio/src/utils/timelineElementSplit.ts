import type { TimelineElement } from "../player/store/playerStore";

export { buildPatchTarget, readFileContent } from "../hooks/timelineEditingHelpers";

/** Minimum distance (seconds) from clip boundaries to allow a split. */
export const SPLIT_BOUNDARY_EPSILON_S = 0.03;

export function canSplitElement(el: TimelineElement): boolean {
  return (
    !el.timelineLocked &&
    el.timingSource !== "implicit" &&
    !el.compositionSrc &&
    !!el.duration &&
    Number.isFinite(el.duration)
  );
}
