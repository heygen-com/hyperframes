import type { TimelineElement } from "../player";
import type {
  TimelineGroupCommitOptions,
  TimelineGroupMoveChange,
} from "./useTimelineGroupEditing";

interface MoveEdit {
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

export function persistTimelineMoveEditsAtomically(
  edits: MoveEdit[],
  coalesceKey: string | undefined,
  operation: TimelineMoveOperation,
  deps: AtomicMoveDeps,
): Promise<void> {
  return deps.handleTimelineGroupMove(
    edits.map(({ element, updates }) => ({
      element,
      start: updates.start,
      // A single vertical edit is the z-only reorder path. Multi-edit gestures
      // are track inserts/ripples and must persist every resulting lane index.
      track: operation === "track-insert" ? updates.track : undefined,
    })),
    { coalesceKey },
  );
}
