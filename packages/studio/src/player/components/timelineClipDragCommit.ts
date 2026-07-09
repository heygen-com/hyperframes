import type { TimelineElement } from "../store/playerStore";
import type { DraggedClipState } from "./useTimelineClipDrag";
import { buildTrackInsert } from "./timelineCollision";

type StartTrack = Pick<TimelineElement, "start" | "track">;
export interface TimelineMoveEdit {
  element: TimelineElement;
  updates: StartTrack;
}

export interface DragCommitDeps {
  elements: TimelineElement[];
  trackOrder: number[];
  updateElement: (key: string, updates: Partial<TimelineElement>) => void;
  /** Single-clip, SDK-cutover-aware persist (plain moves keep this path). */
  onMoveElement?: (element: TimelineElement, updates: StartTrack) => Promise<void> | void;
  /** Atomic multi-clip persist (single undo) for ripple + track-insert. */
  onMoveElements?: (edits: TimelineMoveEdit[]) => Promise<void> | void;
}

const keyOf = (e: TimelineElement) => e.key ?? e.id;

/**
 * Commit a finished clip drag. Two cases (free-form model — no main-track magnet):
 *  - **Insert** (`insertRow != null`): create a new track at the boundary; the
 *    dragged clip takes it, other lanes shift (buildTrackInsert). Persisted as ONE
 *    atomic batch via `onMoveElements` (was N racing per-clip persists — the
 *    file-corruption bug, HANDOFF §7.1 / F2).
 *  - **Plain move**: land the clip on the hovered lane at the dropped time, via
 *    the SDK-aware single-clip `onMoveElement`. Overlaps are allowed; no magnet.
 */
// fallow-ignore-next-line complexity
export function commitDraggedClipMove(drag: DraggedClipState, deps: DragCommitDeps): void {
  const { elements, trackOrder, updateElement, onMoveElement, onMoveElements } = deps;
  const dragKey = keyOf(drag.element);

  // Optimistic store update for a batch, then persist atomically; roll back on failure.
  const commitBatch = (edits: TimelineMoveEdit[]) => {
    if (edits.length === 0) return;
    const prev = edits.map((e) => ({
      key: keyOf(e.element),
      start: e.element.start,
      track: e.element.track,
    }));
    for (const e of edits) updateElement(keyOf(e.element), e.updates);
    Promise.resolve(onMoveElements?.(edits)).catch((error) => {
      for (const p of prev) updateElement(p.key, { start: p.start, track: p.track });
      console.error("[Timeline] Failed to persist clip edits", error);
    });
  };

  // Single-clip SDK-aware persist (plain moves).
  const commitSingle = (element: TimelineElement, updates: StartTrack) => {
    const key = keyOf(element);
    const prev = { start: element.start, track: element.track };
    updateElement(key, updates);
    Promise.resolve(onMoveElement?.(element, updates)).catch((error) => {
      updateElement(key, prev);
      console.error("[Timeline] Failed to persist clip edit", error);
    });
  };

  // ── Insert a new track at a lane boundary ──────────────────────────────────
  if (drag.insertRow != null) {
    const plan = buildTrackInsert(elements, trackOrder, drag.insertRow, dragKey);
    const changed =
      plan.draggedTrack !== drag.element.track ||
      drag.previewStart !== drag.element.start ||
      plan.shifts.length > 0;
    if (!changed) return;
    const edits: TimelineMoveEdit[] = [
      { element: drag.element, updates: { start: drag.previewStart, track: plan.draggedTrack } },
    ];
    for (const shift of plan.shifts) {
      const shifted = elements.find((e) => keyOf(e) === shift.key);
      if (shifted)
        edits.push({ element: shifted, updates: { start: shifted.start, track: shift.toTrack } });
    }
    // Batched persist when available; fall back to per-clip so partial wiring still works.
    if (onMoveElements) commitBatch(edits);
    else for (const e of edits) commitSingle(e.element, e.updates);
    return;
  }

  // ── Plain move (free placement — land where dropped, overlaps allowed) ──────
  if (drag.previewStart === drag.element.start && drag.previewTrack === drag.element.track) return;
  commitSingle(drag.element, { start: drag.previewStart, track: drag.previewTrack });
}
