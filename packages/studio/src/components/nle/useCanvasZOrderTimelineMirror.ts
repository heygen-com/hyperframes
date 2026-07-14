import { useCallback, useRef } from "react";
import { usePlayerStore } from "../../player";
import { useExpandedTimelineElements } from "../../player/hooks/useExpandedTimelineElements";
import { useTimelineEditContextOptional } from "../../contexts/TimelineEditContext";
import {
  displayTrackOrder,
  resolveZMirrorLaneMove,
  type ZMirrorAction,
} from "../../player/components/timelineZMirror";
import { commitZMirrorLaneMove } from "../../player/components/timelineClipDragCommit";
import { deriveTimelineStoreKey } from "../../player/lib/timelineElementHelpers";
import { buildStableSelector } from "../editor/domEditingDom";
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
  const elements = useExpandedTimelineElements();
  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  const { onMoveElements } = useTimelineEditContextOptional();

  return useCallback(
    (input: MirrorZOrderInput) => {
      const els = elementsRef.current;
      const element = input.selectionKey
        ? els.find((e) => (e.key ?? e.id) === input.selectionKey)
        : undefined;
      // Not a timeline clip (canvas-only decoration) → z-only action, unchanged.
      if (!element) return Promise.resolve(false);

      // Map the crossed neighbor to its timeline key the same way z-reorder
      // entries get theirs (siblingZIndexEntry): DOM id, else stable selector,
      // scoped to the selection's source file.
      const crossedKey = input.crossed
        ? deriveTimelineStoreKey({
            domId: input.crossed.id || undefined,
            selector: buildStableSelector(input.crossed),
            sourceFile: input.sourceFile,
          })
        : null;

      const move = resolveZMirrorLaneMove({
        action: input.action,
        element,
        elements: els,
        crossedKey,
      });
      if (!move) return Promise.resolve(false);

      return commitZMirrorLaneMove(
        element,
        move,
        {
          elements: els,
          trackOrder: displayTrackOrder(els),
          updateElement: (key, updates) => usePlayerStore.getState().updateElement(key, updates),
          onMoveElements: onMoveElements
            ? (edits, coalesceKey, operation) =>
                forwardRebasedTimelineMoveElements(edits, coalesceKey, operation, onMoveElements)
            : undefined,
          // NO readZIndex / onStackingPatches: see the hook doc — the lane→z
          // stacking sync must not re-trigger and fight the just-set z values.
        },
        input.coalesceKey,
      );
    },
    [onMoveElements],
  );
}
