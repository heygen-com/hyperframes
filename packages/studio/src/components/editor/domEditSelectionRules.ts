/** Selection rules over an ancestor chain: one answer for live elements and for descriptions. */
import type { TimelineElementDomTarget, TimelineElementDomTargetOptions } from "./domEditingTypes";
import { escapeCssString, normalizeTimelineCompositionSource } from "./domEditingDom";

/** Reads one element of a chain: the target first, then each parent up to the document element. */
export interface SelectionChainReader<N> {
  attr(node: N, name: string): string | null;
  selector(node: N): string | undefined;
  /** The document's `body` or root element, where the walk to an addressable element stops. */
  isDocumentRoot(node: N): boolean;
}

const OUT_OF_SCOPE = -1;
const hasClass = (value: string | null, name: string) =>
  (value ?? "").split(/[\t\n\f\r ]+/).includes(name);

/**
 * A `data-hf-group` wrapper is one unit until the user drills into it; inside the drilled-into
 * group, clicks reach its children, or the next group nested in it. Returns the unit's index, null
 * to resolve the target itself, or OUT_OF_SCOPE when the target is outside the drilled-into group.
 */
function groupUnitIndex<N>(
  chain: readonly N[],
  read: SelectionChainReader<N>,
  activeGroupIndex: number | null,
): number | null {
  const groups = chain.flatMap((node, index) =>
    read.attr(node, "data-hf-group") === null ? [] : [index],
  );
  if (activeGroupIndex === null) return groups.at(-1) ?? null;
  const at = groups.indexOf(activeGroupIndex);
  if (at === -1) return OUT_OF_SCOPE;
  return at > 0 ? groups[at - 1]! : null;
}

/** The nearest `.clip`; a composition host counts only as the target itself. */
function clipAncestorIndex<N>(chain: readonly N[], read: SelectionChainReader<N>): number | null {
  for (let index = 0; index < chain.length; index += 1) {
    const node = chain[index]!;
    if (!hasClass(read.attr(node, "class"), "clip")) continue;
    const isHost =
      read.attr(node, "data-composition-src") !== null ||
      read.attr(node, "data-composition-file") !== null;
    if (!isHost || index === 0) return index;
  }
  return null;
}

/** Where a selection of `chain[0]` lands; `activeGroupIndex` is -1 for a drilled group not in `chain`. */
export function selectionTargetIndex<N>(
  chain: readonly N[],
  read: SelectionChainReader<N>,
  options: { exactTarget?: boolean; preferClipAncestor?: boolean; activeGroupIndex: number | null },
): number | null {
  let start = options.exactTarget ? 0 : groupUnitIndex(chain, read, options.activeGroupIndex);
  if (start === OUT_OF_SCOPE) start = groupUnitIndex(chain, read, null);
  start ??= options.preferClipAncestor ? (clipAncestorIndex(chain, read) ?? 0) : 0;
  for (let index = start; index < chain.length; index += 1) {
    const node = chain[index]!;
    if (read.isDocumentRoot(node)) return null;
    if (read.selector(node) || read.attr(node, "data-hf-id")?.trim()) return index;
  }
  return null;
}

export function chainLocked<N>(
  chain: readonly N[],
  read: SelectionChainReader<N>,
  index: number,
): boolean {
  return chain.slice(index).some((node) => read.attr(node, "data-timeline-locked") !== null);
}

export interface SelectionLookupTarget {
  id?: string | null;
  hfId?: string;
  selector?: string;
  selectorIndex?: number;
  sourceFile?: string;
}

/** The selectors tried in order, each with the index of its match among those from `sourceFile`. */
export function selectionLookups(
  selection: SelectionLookupTarget,
): Array<{ selector: string; index: number }> {
  const lookups: Array<{ selector: string; index: number }> = [];
  if (selection.hfId) {
    lookups.push({ selector: `[data-hf-id="${escapeCssString(selection.hfId)}"]`, index: 0 });
  }
  // Flattened sub-compositions can repeat authored ids, so an id is matched by attribute, per source.
  if (selection.id) lookups.push({ selector: `[id="${escapeCssString(selection.id)}"]`, index: 0 });
  if (selection.selector) {
    lookups.push({ selector: selection.selector, index: selection.selectorIndex ?? 0 });
  }
  return lookups;
}

/**
 * Where a timeline element is in the preview: `target` to look up, else, when `rootFallback`, the
 * first composition root if it comes from `sourceFile`.
 */
export function timelineElementLookup(
  element: TimelineElementDomTarget,
  options: TimelineElementDomTargetOptions,
): { target: SelectionLookupTarget | null; sourceFile: string; rootFallback: boolean } {
  const elementId = typeof element.id === "string" ? element.id : "";
  const compositionSource =
    normalizeTimelineCompositionSource(element.compositionSrc) ??
    options.compIdToSrc?.get(elementId);
  const sourceFile =
    compositionSource ??
    normalizeTimelineCompositionSource(element.sourceFile) ??
    options.activeCompositionPath ??
    "index.html";
  const escapedElementId = escapeCssString(elementId);
  const escapedCompositionSource = compositionSource ? escapeCssString(compositionSource) : null;
  const selector =
    element.selector ??
    (compositionSource
      ? `[data-composition-src="${escapedCompositionSource}"],[data-composition-file="${escapedCompositionSource}"],[data-composition-id="${escapedElementId}"]`
      : escapedElementId
        ? `[data-composition-id="${escapedElementId}"]`
        : undefined);

  const target =
    selector || element.domId
      ? {
          id: element.domId ?? undefined,
          selector,
          selectorIndex: element.selectorIndex,
          sourceFile,
        }
      : null;
  const hasExplicitDomTarget = Boolean(element.domId || element.selector || compositionSource);
  const rootFallback =
    !options.isMasterView && !hasExplicitDomTarget && Boolean(options.activeCompositionPath);
  return { target, sourceFile, rootFallback };
}
