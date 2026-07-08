import type { TimelineElement } from "../store/playerStore";
import type { DraggedClipState } from "./useTimelineClipDrag";
import { buildTrackInsert } from "./timelineCollision";

type StartTrack = Pick<TimelineElement, "start" | "track">;

export interface DragCommitDeps {
  elements: TimelineElement[];
  trackOrder: number[];
  updateElement: (key: string, updates: Partial<TimelineElement>) => void;
  onMoveElement?: (element: TimelineElement, updates: StartTrack) => Promise<void> | void;
}

/**
 * Commit a finished clip drag. Three cases:
 *  - **Insert** (`insertRow != null`): create a new track at the boundary; dragged
 *    clip takes it, lanes below shift down (buildTrackInsert).
 *  - **Plain move**: a single clip's start/track.
 * Each affected clip persists via the same per-element move handler (one undo
 * entry each — batched single-undo is a known follow-up).
 *
 * NOTE: the main-track ripple (4b/4c — reflowMainTrack) is NOT wired here yet.
 * The per-element persist below races on simultaneous start-time changes (each
 * onMoveElement does its own source-write + GSAP shift + reload; firing several
 * concurrently corrupts the file). The ripple needs a batched single-write /
 * single-reload persist first (see the track-model design doc).
 */
// fallow-ignore-next-line complexity
export function commitDraggedClipMove(drag: DraggedClipState, deps: DragCommitDeps): void {
  const { elements, trackOrder, updateElement, onMoveElement } = deps;
  const dragKey = drag.element.key ?? drag.element.id;

  const persist = (element: TimelineElement, updates: StartTrack) => {
    const key = element.key ?? element.id;
    const prev = { start: element.start, track: element.track };
    updateElement(key, updates);
    Promise.resolve(onMoveElement?.(element, updates)).catch((error) => {
      updateElement(key, prev);
      console.error("[Timeline] Failed to persist clip edit", error);
    });
  };

  if (drag.insertRow != null) {
    const plan = buildTrackInsert(elements, trackOrder, drag.insertRow, dragKey);
    const changed =
      plan.draggedTrack !== drag.element.track ||
      drag.previewStart !== drag.element.start ||
      plan.shifts.length > 0;
    if (!changed) return;
    persist(drag.element, { start: drag.previewStart, track: plan.draggedTrack });
    for (const shift of plan.shifts) {
      const shifted = elements.find((e) => (e.key ?? e.id) === shift.key);
      if (shifted) persist(shifted, { start: shifted.start, track: shift.toTrack });
    }
    return;
  }

  if (drag.previewStart === drag.element.start && drag.previewTrack === drag.element.track) return;
  persist(drag.element, { start: drag.previewStart, track: drag.previewTrack });
}
