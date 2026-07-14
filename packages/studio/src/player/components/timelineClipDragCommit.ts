import type { TimelineElement } from "../store/playerStore";
import type { DraggedClipState } from "./useTimelineClipDrag";
import { classifyZone, normalizeToZones } from "./timelineZones";
import { computeStackingPatches, type StackingPatch } from "./timelineStackingSync";
import { getTimelineEditCapabilities } from "./timelineEditing";
import type { TimelineMoveOperation } from "../../hooks/timelineMoveAdapter";
import {
  beginTimelineOptimisticGesture,
  isLatestTimelineOptimisticGesture,
} from "./timelineOptimisticRevision";

type StartTrack = Pick<TimelineElement, "start" | "track">;
export interface TimelineMoveEdit {
  element: TimelineElement;
  updates: StartTrack;
  /**
   * File-space track override for the persist. The store's `updates.track` is a
   * DISPLAY lane; when the source file's numbering is sparse (authored tracks
   * 1,2,... or gaps), the file write must target the lane's AUTHORED track or it
   * silently re-targets the wrong row. Omitted → persist `updates.track` as-is.
   */
  persistTrack?: number;
}

export interface DragCommitDeps {
  elements: TimelineElement[];
  trackOrder: number[];
  updateElement: (key: string, updates: Partial<TimelineElement>) => void;
  /** Single-clip, SDK-cutover-aware persist (pure time-moves keep this path). */
  onMoveElement?: (element: TimelineElement, updates: StartTrack) => Promise<void> | void;
  /** Atomic multi-clip persist (single undo) for lane changes + track inserts.
   *  `coalesceKey`, when supplied, tags the resulting "Move timeline clips"
   *  history entry so it merges with the lane change's z-reorder entry (see the
   *  lane-change branch below). */
  onMoveElements?: (
    edits: TimelineMoveEdit[],
    coalesceKey?: string,
    operation?: TimelineMoveOperation,
  ) => Promise<void> | void;
  /**
   * The current multi-selection (store.selectedElementIds). When the dragged
   * clip is part of a multi-selection (size > 1), the WHOLE selection moves by
   * the dragged clip's time delta — the standard NLE gesture. Track changes
   * apply to the dragged clip only; the others keep their lanes.
   */
  selectedKeys?: ReadonlySet<string> | null;
  /**
   * Lane ↔ stacking unification. When a DELIBERATE vertical lane change happens,
   * the edited clip(s) get z-index patches so their canvas stacking matches lane
   * order (higher lane = on top) relative to time-overlapping clips — see
   * timelineStackingSync. Both deps must be supplied to engage; if either is
   * absent the z-sync is skipped (pure time-moves and horizontal collision bumps
   * never restack). `readZIndex` returns the clip's current z-index (from the
   * live DOM inline style / computed; "auto" ⇒ 0).
   */
  readZIndex?: (element: TimelineElement) => number;
  /**
   * Apply the computed z-index patches. Wiring (in the drag hook, which owns the
   * DOM/persist plumbing) forwards these to the SAME atomic style-patch persist
   * the canvas z-order commit uses (handleDomZIndexReorderCommit). Documented in
   * research/STAGE3-NEEDED-WIRING.md.
   */
  onStackingPatches?: (patches: StackingPatch[], coalesceKey?: string) => void;
}

const keyOf = (e: TimelineElement) => e.key ?? e.id;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

// One coalesce key per lane-change gesture, shared by the move-persist history
// entry ("Move timeline clips") and the follow-up z-reorder entry ("Reorder
// layers") so editHistory (pushEditHistoryEntry) folds the two consecutive
// records into a single undo step. A monotonic counter — NOT Date.now() /
// Math.random(), which the determinism rules forbid — suffices: the key only has
// to be unique per gesture and identical across the gesture's two records.
let laneChangeGestureSeq = 0;

/** Whether Studio may write timing to this clip (false for locked/implicit rows). */
function canMoveElement(element: TimelineElement): boolean {
  return getTimelineEditCapabilities({
    tag: element.tag,
    duration: element.duration,
    domId: element.domId,
    selector: element.selector,
    compositionSrc: element.compositionSrc,
    playbackStart: element.playbackStart,
    playbackStartAttr: element.playbackStartAttr,
    sourceDuration: element.sourceDuration,
    timingSource: element.timingSource,
    timelineLocked: element.timelineLocked,
  }).canMove;
}

/**
 * Optimistically apply + persist a batch of moves with rollback on failure.
 *
 * Returns a promise that resolves `true` once the write lands, or `false` after a
 * rejected write has been rolled back. The caller uses this to SERIALIZE the
 * lane→z stacking patch: the z-sync is a separate server style-patch, and firing
 * it before this full-file write resolves let the move (computed from a pre-z
 * snapshot) land after — and clobber — the z change. A failed move resolves
 * `false` so the caller also skips the z-sync (no orphaned z patch).
 *
 * The DOM is updated synchronously up front; the returned promise never rejects.
 */
function persistMoveEdits(
  edits: TimelineMoveEdit[],
  deps: DragCommitDeps,
  coalesceKey?: string,
  operation: TimelineMoveOperation = "timing",
): Promise<boolean> {
  if (edits.length === 0) return Promise.resolve(true);
  const { updateElement, onMoveElement, onMoveElements } = deps;
  if (!onMoveElements) {
    console.warn(
      onMoveElement
        ? `[Timeline] persistMoveEdits: only single-clip onMoveElement wired — this ${edits.length}-clip move degrades to a per-clip persist race (no atomic single-undo)`
        : `[Timeline] persistMoveEdits: no move persist handler wired — ${edits.length} edit(s) applied to the store only, not saved`,
    );
  }
  const prev = edits.map((e) => ({
    key: keyOf(e.element),
    start: e.element.start,
    track: e.element.track,
    authoredTrack: e.element.authoredTrack,
  }));
  const revision = beginTimelineOptimisticGesture(
    updateElement,
    edits.map((edit) => keyOf(edit.element)),
  );
  // The file write below targets `persistTrack` (authored space) when supplied,
  // or `updates.track` on a genuine lane write (track insert renumber). Mirror
  // that written value into the store's `authoredTrack` so a SECOND drag before
  // any reload resolves authored tracks from what the file now says, not stale
  // pre-edit data. Pure time-moves leave authoredTrack untouched.
  for (const e of edits) {
    const writtenTrack =
      e.persistTrack ?? (e.updates.track !== e.element.track ? e.updates.track : undefined);
    updateElement(
      keyOf(e.element),
      writtenTrack == null ? e.updates : { ...e.updates, authoredTrack: writtenTrack },
    );
  }
  // The store above gets DISPLAY lanes; the file below gets the authored-space
  // track when one was resolved (see TimelineMoveEdit.persistTrack).
  const persistEdits = edits.map((e) =>
    e.persistTrack == null || e.persistTrack === e.updates.track
      ? e
      : { element: e.element, updates: { ...e.updates, track: e.persistTrack } },
  );
  const persisted = onMoveElements
    ? onMoveElements(persistEdits, coalesceKey, operation)
    : Promise.all(persistEdits.map((e) => Promise.resolve(onMoveElement?.(e.element, e.updates))));
  return Promise.resolve(persisted).then(
    () => true,
    (error) => {
      for (const p of prev) {
        if (isLatestTimelineOptimisticGesture(updateElement, revision, p.key)) {
          updateElement(p.key, { start: p.start, track: p.track, authoredTrack: p.authoredTrack });
        }
      }
      console.error("[Timeline] Failed to persist clip edits", error);
      return false;
    },
  );
}

/**
 * A fractional track value for a NEW lane inserted at boundary `insertRow` in
 * `trackOrder` (0 = above the top, `length` = below the bottom). normalizeToZones
 * then compacts it to a distinct integer lane between its neighbours, and the
 * clips at/below the insert shift down by one — the sanctioned index-renumber.
 */
/** Same-source-file predicate: authored track numbers only compare within ONE
 *  file's coordinate space (an expanded sub-comp child's authoredTrack is in ITS
 *  file, not the host timeline's). `undefined` means the active composition. */
const sameSourceFile = (a: TimelineElement, b: TimelineElement): boolean =>
  (a.sourceFile ?? null) === (b.sourceFile ?? null);

/**
 * Translate a DISPLAY lane into the AUTHORED (source-file) track to persist for
 * `dragged`. Occupants are consulted ONLY from the dragged clip's own source
 * file — an occupant from a different file (e.g. an expanded sub-comp child, or
 * a host clip next to expanded rows) carries authored values in a different
 * coordinate space, and borrowing them would write a foreign file's numbering.
 *
 * Lane semantics after normalizeToZones: each distinct authored track owns one
 * base lane, and time-overlapping same-track clips spill onto adjacent display
 * sub-lanes (packTrackLanes). A spill sub-lane IS a legal drop target (Timeline's
 * trackOrder lists it): its occupants share the base lane's authored track by
 * construction, so the same-file occupant lookup returns that authored track and
 * the drop persists as a same-track join. The clip may then DISPLAY on a
 * different sub-lane than it was dropped on — the spill re-packs
 * deterministically by stable id, first-fit — but the persisted track is
 * correct.
 *
 * Fallbacks when the lane has no same-file occupant (e.g. an expanded child
 * dropped on a lane holding only other files' clips — the display-lane integer
 * must NOT be persisted into a sparse file):
 * 1. Offset from the NEAREST same-file lane: authored(nearest) + lane distance,
 *    preserving "one lane up = one authored track up" in the clip's own file.
 * 2. No same-file peers at all → the lane value itself (single-clip files:
 *    display and authored spaces coincide for want of any other anchor).
 * Edge-created lanes (min-1 / max+1 inserts) route through the insert path,
 * never here.
 */
function authoredTrackForLane(
  lane: number,
  elements: TimelineElement[],
  dragged: TimelineElement,
): number {
  const dragKey = keyOf(dragged);
  const peers = elements.filter((e) => keyOf(e) !== dragKey && sameSourceFile(e, dragged));
  const occupant = peers.find((e) => e.track === lane);
  if (occupant) return occupant.authoredTrack ?? occupant.track;
  let nearest: TimelineElement | null = null;
  for (const p of peers) {
    if (!nearest || Math.abs(p.track - lane) < Math.abs(nearest.track - lane)) nearest = p;
  }
  if (!nearest) return lane;
  return (nearest.authoredTrack ?? nearest.track) + (lane - nearest.track);
}

function insertTrackValue(trackOrder: number[], insertRow: number): number {
  if (trackOrder.length === 0) return 0;
  if (insertRow <= 0) return trackOrder[0] - 0.5;
  if (insertRow >= trackOrder.length) return trackOrder[trackOrder.length - 1] + 0.5;
  return (trackOrder[insertRow - 1] + trackOrder[insertRow]) / 2;
}

/**
 * Build the time-shift resolver for a multi-selection drag: every member of the
 * selection moves by the dragged clip's delta (clamped ≥ 0); non-members are
 * untouched. Returns null when this is not a multi-selection drag. A locked /
 * implicit member is dropped from the moving set (a marquee can sweep one in).
 */
function resolveMultiSelection(
  drag: DraggedClipState,
  deps: DragCommitDeps,
): {
  keys: ReadonlySet<string>;
  movedStart: (e: TimelineElement) => number;
} | null {
  const { elements, selectedKeys } = deps;
  const dragKey = keyOf(drag.element);
  if (!selectedKeys || selectedKeys.size <= 1 || !selectedKeys.has(dragKey)) return null;
  const keys = new Set(
    [...selectedKeys].filter((k) => {
      const el = elements.find((e) => keyOf(e) === k);
      return el ? canMoveElement(el) : false;
    }),
  );
  const delta = drag.previewStart - drag.element.start;
  const movedStart = (e: TimelineElement): number =>
    keyOf(e) === dragKey ? drag.previewStart : Math.max(0, round3(e.start + delta));
  return { keys, movedStart };
}

/**
 * Commit a finished clip drag.
 *
 * The lane model is CapCut-stable: a clip's display lane is its track, and editing
 * ONE clip must never re-lane or rewrite OTHER clips. Three outcomes:
 *
 * - **Pure time-move** (dragged clip keeps its lane, no insert): persist just the
 *   dragged clip's start (multi-selection shifts every selected clip in time).
 * - **Lane change / collision relocation** (the dragged clip's OWN lane changes,
 *   no new track): persist ONLY the dragged clip's start + lane. No other clip is
 *   touched. z is synced only when the gesture is a DELIBERATE vertical move
 *   (the pointer aimed at another lane) — a horizontal drag merely bumped to a
 *   free lane never restacks.
 * - **Track insert** (a new lane at a gap boundary): the dragged clip lands on
 *   the new lane and the clips at/below the insert are renumbered by +1 (the ONLY
 *   permitted multi-clip write) via a whole-set re-normalize; persisted atomically.
 */
// fallow-ignore-next-line complexity
export function commitDraggedClipMove(drag: DraggedClipState, deps: DragCommitDeps): void {
  const { elements, updateElement, onMoveElement } = deps;
  const dragKey = keyOf(drag.element);
  const isInsert = drag.insertRow != null;
  const laneChanged = drag.previewTrack !== drag.element.track;
  // Deliberate VERTICAL gesture: the pointer aimed at a different lane, or at a
  // gap boundary (insert). A plain HORIZONTAL drag whose target span is occupied
  // gets the DRAGGED clip bumped to a free lane (previewTrack differs) while the
  // pointer never left its lane (desiredTrack === element.track) — that is NOT a
  // vertical move: it must neither rewrite other clips nor touch z.
  const aimTrack = drag.desiredTrack ?? drag.previewTrack;
  const isVertical = isInsert || aimTrack !== drag.element.track;
  const multi = resolveMultiSelection(drag, deps);

  // ── Pure time-move (dragged clip keeps its lane, no insert) ─────────────────
  if (!isInsert && !laneChanged) {
    const delta = drag.previewStart - drag.element.start;
    if (delta === 0) return;
    if (multi) {
      const edits: TimelineMoveEdit[] = elements
        .filter((e) => multi.keys.has(keyOf(e)))
        .map((e) => ({
          element: e,
          updates: { start: multi.movedStart(e), track: e.track },
        }))
        .filter((e) => e.updates.start !== e.element.start);
      void persistMoveEdits(edits, deps);
      return;
    }
    const updates = { start: drag.previewStart, track: drag.element.track };
    const prev = { start: drag.element.start, track: drag.element.track };
    const revision = beginTimelineOptimisticGesture(updateElement, [dragKey]);
    updateElement(dragKey, updates);
    Promise.resolve(onMoveElement?.(drag.element, updates)).catch((error) => {
      if (isLatestTimelineOptimisticGesture(updateElement, revision, dragKey)) {
        updateElement(dragKey, prev);
      }
      console.error("[Timeline] Failed to persist clip edit", error);
    });
    return;
  }

  // ── Track insert: renumber the at/below clips by +1 (the one multi-clip write) ─
  if (isInsert) {
    commitTrackInsert(drag, deps, multi);
    return;
  }

  // ── Lane change / collision relocation: persist ONLY the dragged clip ────────
  // CapCut invariant — one edit never re-lanes another clip. The dragged clip
  // takes its new lane (previewTrack); the rest of any selection shifts in time
  // only. Nothing else is written.
  const dragEdit: TimelineMoveEdit = {
    element: drag.element,
    updates: { start: drag.previewStart, track: drag.previewTrack },
    persistTrack: authoredTrackForLane(drag.previewTrack, elements, drag.element),
  };
  const coalesceKey = isVertical ? `clip-lane-move:${laneChangeGestureSeq++}` : undefined;

  const edits: TimelineMoveEdit[] = [dragEdit];
  if (multi) {
    for (const e of elements) {
      if (keyOf(e) === dragKey || !multi.keys.has(keyOf(e))) continue;
      const start = multi.movedStart(e);
      if (start !== e.start) edits.push({ element: e, updates: { start, track: e.track } });
    }
  }
  // The drop-intent set for the z-sync: the dragged clip at its new lane, others
  // as-is. Reasoning on this (not a re-normalize) keeps the sync seeing the user's
  // move; computeStackingPatches only compares lanes relatively.
  const candidate = elements.map((e) => {
    if (keyOf(e) === dragKey) return { ...e, start: drag.previewStart, track: drag.previewTrack };
    // Selection members shift in time with the drag — the z-sync must reason on
    // their POST-move overlap sets, same as the insert branch's candidate.
    if (multi?.keys.has(keyOf(e))) return { ...e, start: multi.movedStart(e) };
    return e;
  });
  const multiKeys = multi ? multi.keys : null;
  void persistMoveEdits(edits, deps, coalesceKey, "lane-reorder").then((moved) => {
    if (moved && isVertical) {
      syncStackingForEdit(
        candidate,
        dragKey,
        drag.element.track,
        drag.previewTrack,
        multiKeys,
        deps,
        coalesceKey,
      );
    }
  });
}

/**
 * Insert a new track at the drop's gap boundary. The dragged clip lands on the
 * fractional insert lane; normalizeToZones then compacts every lane to a contiguous
 * integer, which shifts the clips at/below the insert down by one. That +1
 * renumber is the ONLY sanctioned multi-clip write; it is index-only (never z).
 * The whole affected set is persisted atomically (single undo), and the deliberate
 * vertical move syncs the dragged clip's stacking afterwards.
 */
// fallow-ignore-next-line complexity
function commitTrackInsert(
  drag: DraggedClipState,
  deps: DragCommitDeps,
  multi: {
    keys: ReadonlySet<string>;
    movedStart: (e: TimelineElement) => number;
  } | null,
): void {
  const { elements, trackOrder } = deps;
  const dragKey = keyOf(drag.element);
  const targetTrack = insertTrackValue(trackOrder, drag.insertRow!);
  // Drop-intent set: dragged clip at the fractional insert lane (so it sorts
  // between its neighbours), selection members time-shifted, others as-is.
  const candidate = elements.map((e) => {
    if (keyOf(e) === dragKey) return { ...e, start: drag.previewStart, track: targetTrack };
    if (multi?.keys.has(keyOf(e))) return { ...e, start: multi.movedStart(e) };
    return e;
  });
  // normalizeToZones compacts the fractional lane to a contiguous integer, which
  // shifts the at/below clips down by one — the sanctioned +1 index renumber.
  const normalized = normalizeToZones(candidate);
  const bySrc = new Map(elements.map((e) => [keyOf(e), e]));
  // The renumber is only correct as a WHOLE-SET write: skipping an unwritable
  // clip whose lane shifts leaves its track colliding with a renumbered
  // neighbour, and the next normalize merges the two lanes. If any shifted clip
  // can't be written, refuse the insert instead of persisting a broken layout.
  for (const norm of normalized) {
    const src = bySrc.get(keyOf(norm));
    if (src && !canMoveElement(src) && norm.track !== src.track) {
      console.warn(
        `[Timeline] Track insert refused: locked clip ${keyOf(src)} would need renumbering`,
      );
      return;
    }
  }
  const edits: TimelineMoveEdit[] = [];
  for (const norm of normalized) {
    const src = bySrc.get(keyOf(norm));
    if (!src) continue;
    // Capabilities gate (unchanged-lane clips only reach here now): never write
    // a locked/implicit clip.
    if (!canMoveElement(src)) continue;
    const start =
      keyOf(norm) === dragKey || multi?.keys.has(keyOf(norm))
        ? (multi?.movedStart(src) ?? drag.previewStart)
        : src.start;
    edits.push({ element: src, updates: { start, track: norm.track } });
  }

  const coalesceKey = `clip-lane-move:${laneChangeGestureSeq++}`;
  void persistMoveEdits(edits, deps, coalesceKey, "track-insert").then((moved) => {
    // Skip the z-sync when the insert produced NO move edits (e.g. every clip in
    // the set is locked/implicit and gets filtered out). persistMoveEdits resolves
    // `true` for an empty batch so the caller's serialization proceeds, but firing
    // the z-sync here would record an orphaned z-only history entry for a move that
    // never persisted.
    if (moved && edits.length > 0) {
      // Reason the z-sync on the drop-intent `candidate` (dragged clip at its
      // fractional insert lane) — NOT the re-normalized lanes — so the sync sees
      // the user's move. The guard lane is the aimed insert row (a boundary in
      // display-lane space, comparable to the clip's contiguous current lane).
      syncStackingForEdit(
        candidate,
        dragKey,
        drag.element.track,
        drag.insertRow!,
        multi ? multi.keys : null,
        deps,
        coalesceKey,
      );
    }
  });
}

/**
 * Compute + apply z-index patches for the edited clip(s) after a DELIBERATE
 * vertical lane change. Projects the drop-intent element set (`candidate`: the
 * dragged clip at its new / fractional-insert lane, others at their current tracks)
 * onto StackingElement using the caller-supplied live z-index reader, then
 * delegates the minimal-z resolution to computeStackingPatches — a clip on the
 * upper lane paints above every clip it time-overlaps. No-op unless both z-sync
 * deps are present, and never when the gesture aimed at the clip's OWN current
 * lane (`aimedLane === currentLane` — not a relocation).
 */
function syncStackingForEdit(
  candidate: TimelineElement[],
  dragKey: string,
  currentLane: number,
  aimedLane: number,
  multiKeys: ReadonlySet<string> | null,
  deps: DragCommitDeps,
  coalesceKey?: string,
): void {
  const { readZIndex, onStackingPatches } = deps;
  if (!readZIndex || !onStackingPatches) return;

  // Aiming at the clip's OWN current display lane is not a relocation — never
  // touch z (guards the pure-time-move invariant even if a spurious topology call
  // slips through). Every real lane-realization drop aims at a DIFFERENT lane.
  if (aimedLane === currentLane) return;

  // `candidate` is in discovery order, so its array index IS the DOM document
  // position. Equal-z clips paint by DOM order, so the sync needs it to decide
  // "is A above B" (see StackingElement.domIndex).
  const stackingEls = candidate.map((el, domIndex) => ({
    key: keyOf(el),
    start: el.start,
    duration: el.duration,
    track: el.track,
    zIndex: readZIndex(el),
    isAudio: classifyZone(el) === "audio",
    domIndex,
    stackingContextId: el.stackingContextId ?? null,
  }));

  const editedKeys = [dragKey];
  if (multiKeys) for (const k of multiKeys) if (k !== dragKey) editedKeys.push(k);

  const patches = computeStackingPatches(stackingEls, editedKeys);
  if (patches.length > 0) onStackingPatches(patches, coalesceKey);
}
