import { useCallback } from "react";
import { usePlayerStore, type TimelineElement } from "../player";
import { batchElementUpdates } from "../player/store/batchElementUpdates";
import { resolveMainTrackTrimRipple } from "../player/components/timelineGapCommit";
import { timingGestureStep } from "./timelineTimingSync";
import type {
  TimelineGroupCommitOptions,
  TimelineGroupMoveChange,
  TimelineGroupResizeChange,
} from "./useTimelineGroupEditing";

type ResizeUpdates = Pick<TimelineElement, "start" | "duration" | "playbackStart">;

interface UseTimelineTrimRippleOptions {
  handleTimelineElementResize: (
    element: TimelineElement,
    updates: ResizeUpdates,
    options?: { coalesceKey?: string },
  ) => Promise<void>;
  handleTimelineGroupResize: (
    changes: TimelineGroupResizeChange[],
    options?: TimelineGroupCommitOptions,
  ) => Promise<void>;
  handleTimelineGroupMove: (
    changes: TimelineGroupMoveChange[],
    options?: TimelineGroupCommitOptions,
  ) => Promise<void>;
  showToast: (message: string, tone?: "error" | "info") => void;
}

function setStarts(changes: ReadonlyArray<{ element: TimelineElement; start: number }>) {
  const { updateElement } = usePlayerStore.getState();
  batchElementUpdates(() => {
    for (const { element, start } of changes) updateElement(element.key ?? element.id, { start });
  });
}

/** Resize handlers that, with Ripple on, close the main-track gap a trim
 *  leaves, folded into the trim's own undo step like the delete ripple. */
export function useTimelineTrimRipple({
  handleTimelineElementResize,
  handleTimelineGroupResize,
  handleTimelineGroupMove,
  showToast,
}: UseTimelineTrimRippleOptions) {
  const persistWithRipple = useCallback(
    async (
      trims: TimelineGroupResizeChange[],
      label: string,
      persistTrim: (coalesceKey: string) => Promise<void>,
      given?: { coalesceKey?: string },
    ): Promise<void> => {
      const step = timingGestureStep("timeline-resize", given);
      const { elements, rippleEditEnabled } = usePlayerStore.getState();
      const ripple = resolveMainTrackTrimRipple(elements, trims, rippleEditEnabled);
      if (!ripple) return persistTrim(step.coalesceKey);
      const undoRipple = () =>
        setStarts(ripple.map(({ element }) => ({ element, start: element.start })));
      setStarts(ripple);
      try {
        await persistTrim(step.coalesceKey);
      } catch (error) {
        undoRipple();
        throw error;
      }
      try {
        await handleTimelineGroupMove(ripple, {
          coalesceKey: step.coalesceKey,
          label,
          suppressFailureToast: true,
        });
      } catch (error) {
        undoRipple();
        console.error("[Timeline] ripple-edit failed to persist after trim", error);
        showToast("Clip trimmed, but the gap could not be closed.", "error");
      }
    },
    [handleTimelineGroupMove, showToast],
  );

  const handleTrimElement = useCallback(
    (element: TimelineElement, updates: ResizeUpdates) =>
      persistWithRipple([{ element, ...updates }], "Resize timeline clip", (coalesceKey) =>
        handleTimelineElementResize(element, updates, { coalesceKey }),
      ),
    [persistWithRipple, handleTimelineElementResize],
  );

  const handleTrimElements = useCallback(
    (changes: TimelineGroupResizeChange[], options?: TimelineGroupCommitOptions) =>
      persistWithRipple(
        changes,
        "Resize timeline clips",
        (coalesceKey) => handleTimelineGroupResize(changes, { ...options, coalesceKey }),
        options,
      ),
    [persistWithRipple, handleTimelineGroupResize],
  );

  return { handleTrimElement, handleTrimElements };
}
