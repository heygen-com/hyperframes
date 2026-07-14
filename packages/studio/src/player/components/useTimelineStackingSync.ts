import { useCallback, type RefObject } from "react";
import type { TimelineElement } from "../store/playerStore";
import { useDomEditActionsContextOptional } from "../../contexts/DomEditContext";
import { useStudioShellContextOptional } from "../../contexts/StudioContext";
import { findElementForSelection } from "../../components/editor/domEditingElement";
import { readEffectiveZIndex } from "../../components/editor/canvasContextMenuZOrder";
import type { StackingPatch } from "./timelineStackingSync";

interface UseTimelineStackingSyncInput {
  expandedElementsRef: RefObject<TimelineElement[]>;
}

// Lane ↔ stacking unification (research/STAGE3-NEEDED-WIRING.md). Provision the
// two deps commitDraggedClipMove accepts so a lane-change drag also patches the
// edited clip's z-index. Both read the SAME preview iframe + z-order persist path
// the canvas right-click menu / LayersPanel use, so a timeline lane move and a
// menu z-edit produce one shared inline-style commit shape. Optional contexts:
// outside the NLE (standalone <Timeline>) these are null ⇒ deps undefined ⇒ the
// commit's z-sync is a no-op (backward compatible).
export function useTimelineStackingSync({ expandedElementsRef }: UseTimelineStackingSyncInput) {
  const domEditActions = useDomEditActionsContextOptional();
  const shell = useStudioShellContextOptional();
  const zSyncPreviewIframeRef = domEditActions?.previewIframeRef ?? null;
  const handleDomZIndexReorderCommit = domEditActions?.handleDomZIndexReorderCommit;
  const zSyncActiveCompPath = shell?.activeCompPath ?? null;

  // Resolve a TimelineElement to its live iframe HTMLElement via the same
  // hfId ?? id ?? selector[selectorIndex] resolver the timeline's DOM patches use.
  const resolveIframeElement = useCallback(
    (el: TimelineElement): HTMLElement | null => {
      const doc = zSyncPreviewIframeRef?.current?.contentDocument ?? null;
      if (!doc) return null;
      return findElementForSelection(
        doc,
        {
          hfId: el.hfId,
          id: el.domId ?? el.id,
          selector: el.selector,
          selectorIndex: el.selectorIndex,
          sourceFile: el.sourceFile,
        },
        zSyncActiveCompPath,
      );
    },
    [zSyncPreviewIframeRef, zSyncActiveCompPath],
  );

  // NaN (NOT 0) when the element can't be resolved in the preview iframe — a
  // nested / unmounted sub-comp node, or one outside the active file. Fabricating
  // z=0 would enter computeStackingPatches as a real overlapping neighbour at the
  // z-floor and skew the boundary math; a non-finite value tells it to EXCLUDE this
  // clip instead. NaN (rather than null) keeps the return assignable to the
  // `(el) => number` reader contract the drag hook / commit deps declare.
  const readClipZIndex = useCallback(
    (el: TimelineElement): number => {
      const node = resolveIframeElement(el);
      return node ? readEffectiveZIndex(node) : Number.NaN;
    },
    [resolveIframeElement],
  );

  const applyStackingPatches = useCallback(
    (patches: StackingPatch[], coalesceKey?: string) => {
      if (!handleDomZIndexReorderCommit) return;
      const entries = patches.flatMap((p) => {
        const el = expandedElementsRef.current.find((e) => (e.key ?? e.id) === p.key);
        const node = el && resolveIframeElement(el);
        if (!el || !node) return [];
        return [
          {
            element: node,
            zIndex: p.zIndex,
            id: el.domId ?? el.id,
            selector: el.selector,
            selectorIndex: el.selectorIndex,
            sourceFile: el.sourceFile ?? zSyncActiveCompPath ?? "index.html",
            // The store key: lets the commit update the store's zIndex
            // synchronously (and roll it back on failure).
            key: p.key,
          },
        ];
      });
      // Forward the drag-commit's shared coalesce key so the z-reorder history
      // entry merges with the lane change's move entry into one undo step.
      if (entries.length) handleDomZIndexReorderCommit(entries, coalesceKey);
    },
    [handleDomZIndexReorderCommit, resolveIframeElement, zSyncActiveCompPath, expandedElementsRef],
  );

  // Engage the z-sync only when the persist path is present (inside the NLE).
  const zSyncEnabled = Boolean(handleDomZIndexReorderCommit && zSyncPreviewIframeRef);

  return { readClipZIndex, applyStackingPatches, zSyncEnabled };
}
