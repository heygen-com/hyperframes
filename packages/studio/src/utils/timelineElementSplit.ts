import type { TimelineElement } from "../player/store/playerStore";

export { buildPatchTarget, readFileContent } from "../hooks/timelineEditingHelpers";

export function canSplitElement(el: TimelineElement): boolean {
  return (
    !el.timelineLocked &&
    el.timingSource !== "implicit" &&
    !el.compositionSrc &&
    !!el.duration &&
    Number.isFinite(el.duration)
  );
}
