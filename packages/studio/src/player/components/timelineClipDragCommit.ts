import type { TimelineElement } from "../store/playerStore";
import type { DraggedClipState } from "./useTimelineClipDrag";
import { buildTrackInsert, reflowMainTrack } from "./timelineCollision";
import { resolveMainOriginTrack } from "./timelineZones";

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
 * Commit a finished clip drag. Three cases:
 *  - **Insert** (`insertRow != null`): create a new track at the boundary; the
 *    dragged clip takes it, other lanes shift (buildTrackInsert). Persisted as ONE
 *    atomic batch via `onMoveElements` (was N racing per-clip persists — the
 *    file-corruption bug, HANDOFF §7.1 / F2).
 *  - **Main-track drop**: the main lane is magnetic — reflow every main clip
 *    end-to-end (gap-close + insert-ripple, `reflowMainTrack`) and persist the
 *    whole lane atomically. Overlay/audio/caption lanes are untouched (free).
 *  - **Plain move** (overlay / audio / other lane): a single clip's start/track
 *    via the SDK-aware `onMoveElement`.
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

  // ── Main-track drop: magnetic reflow of the whole main lane ─────────────────
  const mainTrack = resolveMainOriginTrack(elements);
  if (onMoveElements && mainTrack != null && drag.previewTrack === mainTrack) {
    const draggedOnMain = drag.element.track === mainTrack;
    // Reflow input = existing main clips (minus the dragged) + the dragged clip
    // pinned to the main lane; reflowMainTrack orders it by preview start.
    const reflowInput: TimelineElement[] = [
      ...elements.filter((e) => e.track === mainTrack && keyOf(e) !== dragKey),
      { ...drag.element, track: mainTrack },
    ];
    const changes = reflowMainTrack(reflowInput, dragKey, drag.previewStart);
    const edits: TimelineMoveEdit[] = [];
    for (const c of changes) {
      const el = c.key === dragKey ? drag.element : elements.find((e) => keyOf(e) === c.key);
      if (el) edits.push({ element: el, updates: { start: c.start, track: mainTrack } });
    }
    // Pure lane change (dragged moved onto main with no start change): still persist its track.
    if (!changes.some((c) => c.key === dragKey) && !draggedOnMain) {
      edits.push({
        element: drag.element,
        updates: { start: drag.element.start, track: mainTrack },
      });
    }
    if (edits.length === 0) return;
    commitBatch(edits);
    return;
  }

  // ── Plain move (overlay / audio / other lane) ───────────────────────────────
  if (drag.previewStart === drag.element.start && drag.previewTrack === drag.element.track) return;
  commitSingle(drag.element, { start: drag.previewStart, track: drag.previewTrack });
}
