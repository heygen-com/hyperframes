import { useCallback } from "react";
import { usePlayerStore, type TimelineElement } from "../player";
import { batchElementUpdates } from "../player/store/batchElementUpdates";
import { resolveMainTrackTrimRipple } from "../player/components/timelineGapCommit";
import { timingGestureStep } from "./timelineTimingSync";
import { isClosed, refuseWithEarlier, type TimelineEditQueue } from "./timelineEditQueue";
import type {
  TimelineGroupCommitOptions,
  TimelineGroupMoveChange,
  TimelineGroupResizeChange,
} from "./useTimelineGroupEditing";

type ResizeUpdates = Pick<TimelineElement, "start" | "duration" | "playbackStart">;

interface UseTimelineTrimRippleOptions {
  handleTimelineElementResize: (element: TimelineElement, updates: ResizeUpdates) => Promise<void>;
  handleTimelineGroupResize: (
    changes: TimelineGroupResizeChange[],
    options?: TimelineGroupCommitOptions,
  ) => Promise<void>;
  handleTimelineGroupMove: (
    changes: TimelineGroupMoveChange[],
    options?: TimelineGroupCommitOptions,
  ) => Promise<void>;
  showToast: (message: string, tone?: "error" | "info") => void;
  reloadPreview: () => void;
  editQueueRef: TimelineEditQueue;
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
  reloadPreview,
  editQueueRef,
}: UseTimelineTrimRippleOptions) {
  const persistWithRipple = useCallback(
    async (
      trims: TimelineGroupResizeChange[],
      label: string,
      persistTrimAlone: () => Promise<void>,
      given?: TimelineGroupCommitOptions,
    ): Promise<void> => {
      const { elements, rippleEditEnabled } = usePlayerStore.getState();
      const ripple = resolveMainTrackTrimRipple(elements, trims, rippleEditEnabled);
      if (!ripple) return persistTrimAlone();
      const { coalesceKey } = timingGestureStep("timeline-resize", given);
      const undoRipple = () => {
        if (isClosed(editQueueRef)) return;
        const now = new Map(usePlayerStore.getState().elements.map((e) => [e.key ?? e.id, e]));
        setStarts(
          ripple.map(({ element, start }) => ({
            element,
            start: (now.get(element.key ?? element.id)?.start ?? start) + element.start - start,
          })),
        );
        reloadPreview();
      };
      setStarts(ripple);
      // Both join the edit queue in this call, so no later edit can land between the trim and
      // its shift and be overwritten by it.
      const trimmed = handleTimelineGroupResize(trims, { ...given, coalesceKey });
      const shifted = handleTimelineGroupMove(ripple, {
        beforeTiming: trimmed,
        ifEarlierRefused: refuseWithEarlier,
        coalesceKey,
        label,
        suppressFailureToast: true,
      });
      try {
        await trimmed;
      } catch (error) {
        undoRipple();
        void shifted.catch(() => undefined);
        throw error;
      }
      try {
        await shifted;
      } catch (error) {
        undoRipple();
        console.error("[Timeline] ripple-edit failed to persist after trim", error);
        showToast("Clip trimmed, but the gap could not be closed.", "error");
      }
    },
    [handleTimelineGroupResize, handleTimelineGroupMove, showToast, reloadPreview, editQueueRef],
  );

  const handleTrimElement = useCallback(
    (element: TimelineElement, updates: ResizeUpdates) =>
      persistWithRipple([{ element, ...updates }], "Resize timeline clip", () =>
        handleTimelineElementResize(element, updates),
      ),
    [persistWithRipple, handleTimelineElementResize],
  );

  const handleTrimElements = useCallback(
    (changes: TimelineGroupResizeChange[], options?: TimelineGroupCommitOptions) =>
      persistWithRipple(
        changes,
        "Resize timeline clips",
        () => handleTimelineGroupResize(changes, options),
        options,
      ),
    [persistWithRipple, handleTimelineGroupResize],
  );

  return { handleTrimElement, handleTrimElements };
}
