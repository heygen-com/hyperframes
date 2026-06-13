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

/**
 * True when `el` can be split AND `splitTime` lies within its boundary epsilon.
 * Shared by the single-clip and split-all razor paths so both honor the same
 * minimum-distance rule (split-all previously used raw `>`/`<`, letting cuts
 * land inside the epsilon margin and produce a degenerate slice).
 */
export function canSplitElementAt(el: TimelineElement, splitTime: number): boolean {
  return canSplitElement(el) && isSplitTimeWithinBounds(splitTime, el.start, el.duration);
}

/** Elements that the split-all razor action can cut at `splitTime`. */
export function selectSplittableElements(
  elements: TimelineElement[],
  splitTime: number,
): TimelineElement[] {
  return elements.filter((el) => canSplitElementAt(el, splitTime));
}
