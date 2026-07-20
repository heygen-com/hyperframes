import type { TimelineElement } from "../player";
import type {
  TimelineGroupCommitOptions,
  TimelineGroupMoveChange,
} from "./useTimelineGroupEditing";

export interface TimelineMoveEdit {
  element: TimelineElement;
  updates: Pick<TimelineElement, "start" | "track">;
}

interface AtomicMoveDeps {
  handleTimelineGroupMove: (
    changes: TimelineGroupMoveChange[],
    options?: TimelineGroupCommitOptions,
  ) => Promise<void>;
}

export type TimelineMoveOperation = "timing" | "lane-reorder" | "track-insert";

export type TimelineMoveEditsHandler = (
  edits: TimelineMoveEdit[],
  coalesceKey?: string,
  operation?: TimelineMoveOperation,
  coalesceMs?: number,
) => Promise<void>;

export function persistTimelineMoveEditsAtomically(
  edits: TimelineMoveEdit[],
  coalesceKey: string | undefined,
  operation: TimelineMoveOperation,
  deps: AtomicMoveDeps,
  coalesceMs?: number,
): Promise<void> {
  return deps.handleTimelineGroupMove(
    edits.map(({ element, updates }) => ({
      element,
      start: updates.start,
      // Stable track lanes: a lane is the authored data-track-index, so every
      // vertical gesture (lane-reorder AND track-insert) must persist the track;
      // z is paint order only and is synced separately. Plain horizontal moves
      // ("timing") omit it so they stay eligible for the SDK fast path.
      track: operation === "timing" ? undefined : updates.track,
    })),
    { coalesceKey, coalesceMs },
  );
}
