import type { TimelineElement } from "../store/playerStore";
import type { DraggedClipState } from "./useTimelineClipDrag";
import { normalizeToZones } from "./timelineZones";

type StartTrack = Pick<TimelineElement, "start" | "track">;
export interface TimelineMoveEdit {
  element: TimelineElement;
  updates: StartTrack;
}

export interface DragCommitDeps {
  elements: TimelineElement[];
  trackOrder: number[];
  updateElement: (key: string, updates: Partial<TimelineElement>) => void;
  /** Single-clip, SDK-cutover-aware persist (pure time-moves keep this path). */
  onMoveElement?: (element: TimelineElement, updates: StartTrack) => Promise<void> | void;
  /** Atomic multi-clip persist (single undo) for lane changes + track inserts. */
  onMoveElements?: (edits: TimelineMoveEdit[]) => Promise<void> | void;
  /**
   * The current multi-selection (store.selectedElementIds). When the dragged
   * clip is part of a multi-selection (size > 1), the WHOLE selection moves by
   * the dragged clip's time delta — the standard NLE gesture. Track changes
   * apply to the dragged clip only; the others keep their lanes.
   */
  selectedKeys?: ReadonlySet<string> | null;
}

const keyOf = (e: TimelineElement) => e.key ?? e.id;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Optimistically apply + persist a batch of moves with rollback on failure. */
function persistMoveEdits(edits: TimelineMoveEdit[], deps: DragCommitDeps): void {
  if (edits.length === 0) return;
  const { updateElement, onMoveElement, onMoveElements } = deps;
  const prev = edits.map((e) => ({
    key: keyOf(e.element),
    start: e.element.start,
    track: e.element.track,
  }));
  for (const e of edits) updateElement(keyOf(e.element), e.updates);
  const persisted = onMoveElements
    ? onMoveElements(edits)
    : Promise.all(edits.map((e) => Promise.resolve(onMoveElement?.(e.element, e.updates))));
  Promise.resolve(persisted).catch((error) => {
    for (const p of prev) updateElement(p.key, { start: p.start, track: p.track });
    console.error("[Timeline] Failed to persist clip edits", error);
  });
}

/**
 * A fractional track value for a NEW lane inserted at boundary `insertRow` in
 * `trackOrder` (0 = above the top, `length` = below the bottom). normalizeToZones
 * then compacts it to a distinct integer lane between its neighbours.
 */
function insertTrackValue(trackOrder: number[], insertRow: number): number {
  if (trackOrder.length === 0) return 0;
  if (insertRow <= 0) return trackOrder[0] - 0.5;
  if (insertRow >= trackOrder.length) return trackOrder[trackOrder.length - 1] + 0.5;
  return (trackOrder[insertRow - 1] + trackOrder[insertRow]) / 2;
}

/**
 * Commit a finished clip drag.
 *
 * - **Pure time-move** (same lane): persist just the dragged clip's start via the
 *   SDK-aware single-clip handler.
 * - **Lane change / new track**: apply the move (a fractional track for an insert),
 *   RE-NORMALIZE the whole element set (normalizeToZones) so display track indices
 *   are contiguous + kind-grouped, and persist EVERY clip atomically (single undo).
 *   This is the fix for the raw-vs-normalized collision: persisting only the dragged
 *   clip left other clips' unchanged source indices to clash on reload → overlap.
 */
// fallow-ignore-next-line complexity
export function commitDraggedClipMove(drag: DraggedClipState, deps: DragCommitDeps): void {
  const { elements, trackOrder, updateElement, onMoveElement, selectedKeys } = deps;
  const dragKey = keyOf(drag.element);
  const isTopologyChange = drag.insertRow != null || drag.previewTrack !== drag.element.track;
  // Multi-selection drag: engaged only when the dragged clip is itself part of
  // a multi-selection. Every selected clip shifts by the same time delta
  // (clamped ≥ 0); only the dragged clip changes track.
  const multiKeys =
    selectedKeys && selectedKeys.size > 1 && selectedKeys.has(dragKey) ? selectedKeys : null;
  const delta = drag.previewStart - drag.element.start;
  const movedStart = (e: TimelineElement): number =>
    keyOf(e) === dragKey ? drag.previewStart : Math.max(0, round3(e.start + delta));

  // ── Pure time-move (same lane) ──────────────────────────────────────────────
  if (!isTopologyChange) {
    if (delta === 0) return;
    if (multiKeys) {
      const edits: TimelineMoveEdit[] = elements
        .filter((e) => multiKeys.has(keyOf(e)))
        .map((e) => ({ element: e, updates: { start: movedStart(e), track: e.track } }))
        .filter((e) => e.updates.start !== e.element.start);
      persistMoveEdits(edits, deps);
      return;
    }
    const updates = { start: drag.previewStart, track: drag.element.track };
    const prev = { start: drag.element.start, track: drag.element.track };
    updateElement(dragKey, updates);
    Promise.resolve(onMoveElement?.(drag.element, updates)).catch((error) => {
      updateElement(dragKey, prev);
      console.error("[Timeline] Failed to persist clip edit", error);
    });
    return;
  }

  // ── Lane change / new track: normalize the whole set, persist all atomically ─
  const targetTrack =
    drag.insertRow != null ? insertTrackValue(trackOrder, drag.insertRow) : drag.previewTrack;
  const candidate = elements.map((e) => {
    if (keyOf(e) === dragKey) return { ...e, start: drag.previewStart, track: targetTrack };
    if (multiKeys?.has(keyOf(e))) return { ...e, start: movedStart(e) };
    return e;
  });
  const normalized = normalizeToZones(candidate);
  const bySrc = new Map(elements.map((e) => [keyOf(e), e]));
  const edits: TimelineMoveEdit[] = [];
  for (const norm of normalized) {
    const src = bySrc.get(keyOf(norm));
    if (!src) continue;
    const start =
      keyOf(norm) === dragKey || multiKeys?.has(keyOf(norm)) ? movedStart(src) : src.start;
    edits.push({ element: src, updates: { start, track: norm.track } });
  }
  persistMoveEdits(edits, deps);
}
