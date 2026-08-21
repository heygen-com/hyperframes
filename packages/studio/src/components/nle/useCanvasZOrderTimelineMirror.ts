import { useCallback, useRef } from "react";
import { usePlayerStore } from "../../player";
import { useExpandedTimelineElements } from "../../player/hooks/useExpandedTimelineElements";
import { useTimelineEditContextOptional } from "../../contexts/TimelineEditContext";
import {
  displayTrackOrder,
  resolveRepositionLaneMove,
  resolveZMirrorLaneMove,
  type ZMirrorAction,
  type ZMirrorLaneMove,
} from "../../player/components/timelineZMirror";
import type { TimelineElement } from "../../player/store/playerStore";
import { commitZMirrorLaneMove } from "../../player/components/timelineClipDragCommit";
import { deriveTimelineStoreKey } from "../../player/lib/timelineElementHelpers";
import { buildStableSelector, getSelectorIndex } from "../editor/domEditingDom";
import { useStudioShellContextOptional } from "../../contexts/StudioContext";
import { forwardRebasedTimelineMoveElements } from "./TimelinePane";

export interface MirrorZOrderInput {
  /** Timeline store key of the element the menu acted on (entry.key), if any. */
  selectionKey: string | undefined;
  action: ZMirrorAction;
  /** Sibling a forward/backward step moved past (from resolveCrossedNeighbor). */
  crossed: HTMLElement | null;
  /** Source file of the selection — siblings share it (same document). */
  sourceFile: string;
  /** The z persist's coalesce key (zReorderCoalesceKey) — REQUIRED so the lane
   *  write folds into the same undo entry as the z write. */
  coalesceKey: string;
}

/**
 * Mirror a successful canvas z-order menu action into a timeline LANE move.
 *
 * The caller (PreviewOverlays) invokes the returned callback AFTER the z commit
 * resolved — serializing the two same-file writes, exactly like the lane-drag's
 * move→z ordering (see persistMoveEdits' doc) — and with the SAME coalesce key
 * the z persist recorded, so editHistory folds both records into one undo entry.
 * Because the z round-trip puts a real-network gap between the two records, the
 * lane persist carries an unbounded per-gesture coalesce window (see
 * commitZMirrorLaneMove) — the shared key is unique per gesture
 * (zReorderCoalesceKey's gesture seq), so the fold stays gesture-scoped.
 *
 * Element source: `useExpandedTimelineElements()` — the same expanded display
 * set the Timeline renders and the resolver expects (post-normalizeToZones
 * lanes, expanded sub-comp children on their synthetic rows). No new expansion
 * is built here.
 *
 * The mirror persists through the SAME machinery as a timeline lane drag
 * (commitZMirrorLaneMove → persistMoveEdits → onMoveElements, with expanded
 * children rebased to local coords via forwardRebasedTimelineMoveElements) —
 * optimistic store update + rollback included, so the timeline reflects the
 * lane change without a reload. The deps below deliberately OMIT
 * `readZIndex`/`onStackingPatches`: the lane→z stacking sync
 * (syncStackingForEdit) must not fire and recompute the z values the user just
 * set — commitZMirrorLaneMove never calls it, and without these deps it would
 * no-op even if called.
 *
 * Resolves `true` when a lane move persisted, `false` for z-only actions (no
 * timeline mirror applies) or a rolled-back persist.
 */
export function useCanvasZOrderTimelineMirror(): (input: MirrorZOrderInput) => Promise<boolean> {
  const commitMirrorMove = useMirrorLaneMoveCommit();
  const activeCompPath = useStudioShellContextOptional()?.activeCompPath ?? null;

  return useCallback(
    (input: MirrorZOrderInput) =>
      commitMirrorMove(input.selectionKey, input.coalesceKey, (element, els) => {
        // Map the crossed neighbor to its timeline key the same way z-reorder
        // entries get theirs (siblingZIndexEntry): DOM id, else stable selector
        // WITH its selector index, scoped to the selection's source file. The
        // index matters: class selectors are duplicated across clips (.sub),
        // and a key derived without it resolves to occurrence 0 — a DIFFERENT
        // clip — silently mirroring against the wrong neighbor.
        const crossedSelector = input.crossed ? buildStableSelector(input.crossed) : undefined;
        const crossedKey = input.crossed
          ? deriveTimelineStoreKey({
              domId: input.crossed.id || undefined,
              selector: crossedSelector,
              selectorIndex: getSelectorIndex(
                input.crossed.ownerDocument,
                input.crossed,
                crossedSelector,
                input.sourceFile,
                activeCompPath,
              ),
              sourceFile: input.sourceFile,
            })
          : null;
        return resolveZMirrorLaneMove({ action: input.action, element, elements: els, crossedKey });
      }),
    [commitMirrorMove, activeCompPath],
  );
}

export interface LayerReorderMirrorInput {
  /** Timeline store key of the dragged layer (entry.key), if any. */
  selectionKey: string | undefined;
  /** Reordered sibling keys in DESIRED render order, bottom→top (null = no
   *  timeline presence) — see resolveRepositionLaneMove. */
  desiredOrderKeys: ReadonlyArray<string | null>;
  /** The z persist's coalesce key — REQUIRED so the lane write folds into the
   *  same undo entry as the z write. */
  coalesceKey: string;
}

/**
 * Mirror a Layers-panel drag (arbitrary reposition, possibly jumping several
 * siblings) into a timeline lane move — the "equal jump". Identical plumbing,
 * serialization, and undo-fold contract as {@link useCanvasZOrderTimelineMirror};
 * only the resolver differs (resolveRepositionLaneMove's between-new-neighbors
 * rule instead of the menu's four fixed actions).
 */
export function useLayerReorderTimelineMirror(): (
  input: LayerReorderMirrorInput,
) => Promise<boolean> {
  const commitMirrorMove = useMirrorLaneMoveCommit();

  return useCallback(
    (input: LayerReorderMirrorInput) =>
      commitMirrorMove(input.selectionKey, input.coalesceKey, (element, els) =>
        resolveRepositionLaneMove({
          element,
          elements: els,
          desiredOrderKeys: input.desiredOrderKeys,
        }),
      ),
    [commitMirrorMove],
  );
}

/**
 * Shared commit plumbing for both mirrors: resolve the selection key against
 * the expanded display set, run the caller's resolver, and persist the lane
 * move through commitZMirrorLaneMove with the same deps + undo-fold contract.
 * Resolves `true` when a lane move persisted, `false` for z-only actions (no
 * timeline mirror applies) or a rolled-back persist.
 */
function useMirrorLaneMoveCommit(): (
  selectionKey: string | undefined,
  coalesceKey: string,
  resolveMove: (element: TimelineElement, elements: TimelineElement[]) => ZMirrorLaneMove,
) => Promise<boolean> {
  const elements = useExpandedTimelineElements();
  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  const { onMoveElements } = useTimelineEditContextOptional();

  return useCallback(
    (selectionKey, coalesceKey, resolveMove) => {
      const els = elementsRef.current;
      const element = selectionKey ? els.find((e) => (e.key ?? e.id) === selectionKey) : undefined;
      // Not a timeline clip (canvas-only decoration) → z-only action, unchanged.
      if (!element) return Promise.resolve(false);

      const move = resolveMove(element, els);
      if (!move) return Promise.resolve(false);

      return commitZMirrorLaneMove(
        element,
        move,
        {
          elements: els,
          trackOrder: displayTrackOrder(els),
          updateElement: (key, updates) => usePlayerStore.getState().updateElement(key, updates),
          onMoveElements: onMoveElements
            ? (edits, coalesceKey2, operation, coalesceMs) =>
                forwardRebasedTimelineMoveElements(
                  edits,
                  coalesceKey2,
                  operation,
                  onMoveElements,
                  coalesceMs,
                )
            : undefined,
          // NO readZIndex / onStackingPatches: see the hook doc — the lane→z
          // stacking sync must not re-trigger and fight the just-set z values.
        },
        coalesceKey,
        // Unbounded fold window: this record lands only AFTER the z persist's
        // server round-trip resolved, so the gap between the gesture's two
        // records exceeds editHistory's 300ms default under real latency and
        // the fold would silently split into two undo entries. The shared key
        // is unique per gesture (zReorderCoalesceKey's gesture seq), so the
        // unbounded window can never merge two distinct user actions.
        Number.POSITIVE_INFINITY,
      );
    },
    [onMoveElements],
  );
}
