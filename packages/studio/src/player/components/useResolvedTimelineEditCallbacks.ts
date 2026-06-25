import { useMemo } from "react";
import { useTimelineEditContextOptional } from "../../contexts/TimelineEditContext";
import type { TimelineEditCallbacks } from "./timelineCallbacks";

// Props a parent (e.g. NLELayout) may pass to <Timeline> to intercept edits —
// the rest of the callback bag still comes from TimelineEditContext.
export type TimelineEditOverrides = Pick<
  TimelineEditCallbacks,
  "onMoveElement" | "onResizeElement" | "onBlockedEditAttempt" | "onSplitElement"
>;

// Merge any prop overrides over the context callbacks. Used so NLELayout can
// wrap move/resize/split (to rebase expanded sub-comp clips) while every other
// callback falls through to the context unchanged.
export function useResolvedTimelineEditCallbacks(
  overrides: TimelineEditOverrides,
): TimelineEditCallbacks {
  const ctx = useTimelineEditContextOptional();
  const { onMoveElement, onResizeElement, onBlockedEditAttempt, onSplitElement } = overrides;
  return useMemo(
    () => ({
      ...ctx,
      onMoveElement: onMoveElement ?? ctx.onMoveElement,
      onResizeElement: onResizeElement ?? ctx.onResizeElement,
      onBlockedEditAttempt: onBlockedEditAttempt ?? ctx.onBlockedEditAttempt,
      onSplitElement: onSplitElement ?? ctx.onSplitElement,
    }),
    [ctx, onMoveElement, onResizeElement, onBlockedEditAttempt, onSplitElement],
  );
}
