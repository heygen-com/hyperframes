import { useCallback, type RefObject } from "react";
import type { TimelineElement } from "../store/playerStore";
import { useDomEditActionsContextOptional } from "../../contexts/DomEditContext";
import { useStudioShellContextOptional } from "../../contexts/StudioContext";
import { findElementForSelection } from "../../components/editor/domEditingElement";
import {
  findPreviewElementForSelection,
  standInFor,
} from "../../components/editor/previewSelection";
import type { SelectionLookupTarget } from "../../components/editor/domEditSelectionRules";
import { previewComputedStyles, previewFrameOpaque } from "../lib/previewChannel";
import { parseZIndex, readEffectiveZIndex } from "../../components/editor/canvasContextMenuZOrder";
import { readLayerRevealPriorZ } from "../lib/timelineElementHelpers";
import type { StackingPatch } from "./timelineStackingSync";
import type { TimelineZIndexReorderCommit } from "../../hooks/useTimelineEditingTypes";

/** With both set, a lane move restacks the preview's z-index to match the rows; each overrides Studio's own. */
export interface TimelineStackingSyncProps {
  previewIframeRef?: RefObject<HTMLIFrameElement | null>;
  onZIndexReorder?: TimelineZIndexReorderCommit;
}

interface UseTimelineStackingSyncInput extends TimelineStackingSyncProps {
  expandedElementsRef: RefObject<TimelineElement[]>;
}

// Lane ↔ stacking sync: the two deps commitDraggedClipMove takes so a lane-change drag also patches
// z-index, through the same iframe + z persist path the canvas menu and LayersPanel use. Either missing ⇒ no-op.
export function useTimelineStackingSync({
  expandedElementsRef,
  previewIframeRef,
  onZIndexReorder,
}: UseTimelineStackingSyncInput) {
  const domEditActions = useDomEditActionsContextOptional();
  const shell = useStudioShellContextOptional();
  const zSyncPreviewIframeRef = previewIframeRef ?? domEditActions?.previewIframeRef ?? null;
  const handleDomZIndexReorderCommit =
    onZIndexReorder ?? domEditActions?.handleDomZIndexReorderCommit;
  const zSyncActiveCompPath = shell?.activeCompPath ?? null;

  // Resolve a TimelineElement to its live iframe HTMLElement via the same
  // hfId ?? id ?? selector[selectorIndex] resolver the timeline's DOM patches use.
  const lookupOf = useCallback(
    (el: TimelineElement) => ({
      hfId: el.hfId,
      id: el.domId ?? el.id,
      selector: el.selector,
      selectorIndex: el.selectorIndex,
      sourceFile: el.sourceFile ?? zSyncActiveCompPath ?? "index.html",
    }),
    [zSyncActiveCompPath],
  );
  const resolveIframeElement = useCallback(
    (el: TimelineElement): HTMLElement | null => {
      const doc = zSyncPreviewIframeRef?.current?.contentDocument ?? null;
      if (!doc) return null;
      return findElementForSelection(doc, lookupOf(el), zSyncActiveCompPath);
    },
    [zSyncPreviewIframeRef, zSyncActiveCompPath, lookupOf],
  );
  const sealedFrame = useCallback(() => {
    const iframe = zSyncPreviewIframeRef?.current;
    return iframe && previewFrameOpaque(iframe) ? iframe : null;
  }, [zSyncPreviewIframeRef]);

  // NaN (NOT 0) when the element can't be resolved in the preview iframe — a
  // nested / unmounted sub-comp node, or one outside the active file. Fabricating
  // z=0 would enter computeStackingPatches as a real overlapping neighbour at the
  // z-floor; a non-finite value tells it to EXCLUDE this
  // clip instead. NaN (rather than null) keeps the return assignable to the
  // `(el) => number` reader contract the drag hook / commit deps declare.
  const readClipZIndex = useCallback(
    (el: TimelineElement): number | Promise<number> => {
      const iframe = sealedFrame();
      if (iframe) return readSealedZIndex(iframe, lookupOf(el), zSyncActiveCompPath);
      const node = resolveIframeElement(el);
      return node ? readEffectiveZIndex(node) : Number.NaN;
    },
    [resolveIframeElement, sealedFrame, lookupOf, zSyncActiveCompPath],
  );

  const applyStackingPatches = useCallback(
    (patches: StackingPatch[], coalesceKey?: string) => {
      if (!handleDomZIndexReorderCommit) return Promise.resolve();
      const moves = patches.flatMap((p) => {
        const el = expandedElementsRef.current.find((e) => (e.key ?? e.id) === p.key);
        return el ? [{ el, zIndex: p.zIndex, key: p.key }] : [];
      });
      const commit = (nodes: Array<HTMLElement | null>) => {
        const entries = moves.flatMap(({ el, zIndex, key }, index) => {
          const node = nodes[index];
          if (!node) return [];
          return [
            {
              element: node,
              zIndex,
              id: el.domId ?? el.id,
              selector: el.selector,
              selectorIndex: el.selectorIndex,
              sourceFile: el.sourceFile ?? zSyncActiveCompPath ?? "index.html",
              // The store key: lets the commit update the store's zIndex
              // synchronously (and roll it back on failure).
              key,
            },
          ];
        });
        // Forward the drag-commit's shared coalesce key so the z-reorder history
        // entry merges with the lane change's move entry into one undo step.
        return entries.length
          ? handleDomZIndexReorderCommit(entries, coalesceKey).then(() => undefined)
          : Promise.resolve();
      };
      const iframe = sealedFrame();
      if (!iframe) return commit(moves.map(({ el }) => resolveIframeElement(el)));
      const found = moves.map(({ el }) =>
        findPreviewElementForSelection(iframe, lookupOf(el), zSyncActiveCompPath).then((element) =>
          element ? standInFor(iframe, element) : null,
        ),
      );
      return Promise.all(found).then(commit);
    },
    [
      handleDomZIndexReorderCommit,
      resolveIframeElement,
      sealedFrame,
      lookupOf,
      zSyncActiveCompPath,
      expandedElementsRef,
    ],
  );

  // Engage the z-sync only when the persist path is present (inside the NLE).
  const zSyncEnabled = Boolean(handleDomZIndexReorderCommit && zSyncPreviewIframeRef);

  return { readClipZIndex, applyStackingPatches, zSyncEnabled };
}

/** The frame's effective z-index when the gesture runs: a stylesheet's value, or one an earlier gesture saved. */
async function readSealedZIndex(
  iframe: HTMLIFrameElement,
  lookup: SelectionLookupTarget,
  activeCompPath: string | null,
): Promise<number> {
  const found = await findPreviewElementForSelection(iframe, lookup, activeCompPath);
  if (!found) return Number.NaN;
  const prior = readLayerRevealPriorZ(standInFor(iframe, found));
  if (prior != null) return prior;
  const styles = await previewComputedStyles(iframe, found, ["z-index"]);
  return styles ? parseZIndex(styles["z-index"]) : Number.NaN;
}
