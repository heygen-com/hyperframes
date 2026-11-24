import { isHtmlElement } from "@hyperframes/core/runtime/dom-realm";
import type { TimelineElement } from "../player/store/playerStore";
import type { TimelineStackingReorderIntent } from "../player/components/timelineEditing";
import { getElementZIndex } from "../player/lib/layerOrdering";
import { getTimelineElementIdentity } from "../player/lib/timelineElementHelpers";
import { previewFrameOpaque } from "../player/lib/previewChannel";
import { readFoundZIndex } from "../player/components/useTimelineStackingSync";
import { findElementForSelection } from "../components/editor/domEditingElement";
import { findPreviewElementForSelection, standInFor } from "../components/editor/previewSelection";
import type { SelectionLookupTarget } from "../components/editor/domEditSelectionRules";
import type { TimelineZIndexReorderCommit } from "./useTimelineEditingTypes";

type Entry = Parameters<TimelineZIndexReorderCommit>[0][number];
type Layer = { element: HTMLElement; zIndex: number } | null;
type Change = {
  entry: Omit<Entry, "element" | "zIndex">;
  zIndex: number;
  lookup: SelectionLookupTarget;
};

/**
 * Resolve a timeline vertical move to a z-index stacking reorder and commit it through the layers-panel
 * reorder path: only z-index is written, never data-track-index. Nothing is written for audio, for a move
 * that is no reorder, or when any sibling cannot be found in the preview.
 */
export function applyTimelineStackingReorder(input: {
  element: TimelineElement;
  stackingReorder: TimelineStackingReorderIntent | null | undefined;
  timelineElements: readonly TimelineElement[];
  iframe: HTMLIFrameElement | null;
  activeCompPath: string | null;
  commit: TimelineZIndexReorderCommit | null | undefined;
  coalesceKey?: string;
}): Promise<void> {
  if (input.element.tag === "audio") return Promise.resolve();
  const intent = input.stackingReorder ?? null;
  if (intent == null || intent.zIndexChanges.length === 0) return Promise.resolve();
  // Sub-comp children aren't in `timelineElements`: each change carries its own locator first.
  const siblingByKey = new Map(
    input.timelineElements.map((el) => [getTimelineElementIdentity(el), el]),
  );
  // fallow-ignore-next-line complexity
  const changes = intent.zIndexChanges.map((change): Change => {
    const sibling = siblingByKey.get(change.key);
    const domId = change.domId ?? sibling?.domId;
    const selector = change.selector ?? sibling?.selector;
    const selectorIndex = change.selectorIndex ?? sibling?.selectorIndex;
    const sourceFile =
      change.sourceFile ?? sibling?.sourceFile ?? input.activeCompPath ?? "index.html";
    return {
      entry: {
        id: domId ?? sibling?.id ?? change.key,
        selector,
        selectorIndex,
        sourceFile,
        key: change.key,
      },
      zIndex: change.zIndex,
      lookup: { id: domId, selector, selectorIndex, sourceFile },
    };
  });
  const commit = (layers: Layer[]): Promise<void> => {
    if (layers.some((layer) => !layer)) return Promise.resolve();
    const entries = changes.flatMap(({ entry, zIndex }, index): Entry[] => {
      const layer = layers[index]!;
      return layer.zIndex === zIndex ? [] : [{ ...entry, element: layer.element, zIndex }];
    });
    if (entries.length === 0) return Promise.resolve();
    // The durability report is for gesture-level callers; this lane-drag path has no follow-up write.
    return Promise.resolve(input.commit?.(entries, input.coalesceKey)).then(() => undefined);
  };
  const { iframe, activeCompPath } = input;
  if (iframe && previewFrameOpaque(iframe)) {
    return Promise.all(
      changes.map(({ lookup }) => sealedLayer(iframe, lookup, activeCompPath)),
    ).then(commit);
  }
  const doc = iframe?.contentDocument ?? null;
  const layers: Layer[] = [];
  for (const { lookup } of changes) {
    const element = doc ? findElementForSelection(doc, lookup, activeCompPath) : null;
    if (!isHtmlElement(element)) return Promise.resolve();
    layers.push({ element, zIndex: getElementZIndex(element) });
  }
  return commit(layers);
}

async function sealedLayer(
  iframe: HTMLIFrameElement,
  lookup: SelectionLookupTarget,
  activeCompPath: string | null,
): Promise<Layer> {
  const found = await findPreviewElementForSelection(iframe, lookup, activeCompPath);
  if (!found) return null;
  return { element: standInFor(iframe, found), zIndex: await readFoundZIndex(iframe, found) };
}
