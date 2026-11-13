/**
 * Element visibility, visual scoring, layer patch targets, element finders,
 * and the `findElementForSelection` / `findElementForTimelineElement` lookups.
 */
import type {
  DomEditSelection,
  DomEditViewport,
  TimelineElementDomTarget,
  TimelineElementDomTargetOptions,
} from "./domEditingTypes";
import {
  getSelectorIndex,
  getSourceFileForElement,
  isHtmlElement,
  isElementVisibleThroughAncestors,
  querySelectorAllSafely,
} from "./domEditingDom";
import { selectionLookups, timelineElementLookup } from "./domEditSelectionRules";
import {
  isDomLayerElement,
  isInspectableLayerElement,
  resolveAllVisualDomEditTargets,
  resolveLayerSelector,
} from "@hyperframes/core/runtime/editing-port";

// One hit-test rule for Studio and the runtime that answers it for a frame Studio cannot script.
export { isDomLayerElement, isInspectableLayerElement };

// ─── Visibility ──────────────────────────────────────────────────────────────

export function isElementComputedVisible(
  el: HTMLElement,
  memo?: Map<HTMLElement, boolean>,
): boolean {
  return isElementVisibleThroughAncestors(el, memo);
}

// ─── Visual scoring ──────────────────────────────────────────────────────────

// ─── Layer patch target ──────────────────────────────────────────────────────

/**
 * How the element is ADDRESSED — its selector, that selector's occurrence index
 * within the source file, and the file itself. Independent of whether the
 * element currently renders, so it survives every style write and moves only
 * when an identity attribute changes or the document's population of elements
 * sharing the selector does.
 */
export function resolveDomLayerIdentity(
  el: HTMLElement,
  activeCompositionPath: string | null,
): Pick<DomEditSelection, "id" | "hfId" | "selector" | "selectorIndex" | "sourceFile"> | null {
  const selector = resolveLayerSelector(el);
  if (!selector) return null;

  const { sourceFile } = getSourceFileForElement(el, activeCompositionPath);
  return {
    id: el.id || undefined,
    hfId: el.getAttribute("data-hf-id") || undefined,
    selector,
    selectorIndex: getSelectorIndex(
      el.ownerDocument,
      el,
      selector,
      sourceFile,
      activeCompositionPath,
    ),
    sourceFile,
  };
}

// ─── Visual target resolution ─────────────────────────────────────────────────

export function resolveVisualDomEditSelectionTarget(
  elementsFromPoint: Iterable<Element | null | undefined>,
): HTMLElement | null {
  return resolveAllVisualDomEditTargets(elementsFromPoint)[0] ?? null;
}

// ─── Raster detection ────────────────────────────────────────────────────────

function hasRasterBackground(selection: Pick<DomEditSelection, "computedStyles">): boolean {
  const backgroundImage = selection.computedStyles["background-image"]?.trim();
  return Boolean(backgroundImage && backgroundImage !== "none");
}

export function isLargeRasterDomEditSelection(
  selection: Pick<DomEditSelection, "boundingBox" | "computedStyles" | "tagName">,
  viewport?: DomEditViewport | null,
): boolean {
  const tagName = selection.tagName.toLowerCase();
  const isRasterLike = tagName === "img" || hasRasterBackground(selection);
  if (!isRasterLike) return false;

  const { width, height } = selection.boundingBox;
  if (width <= 1 || height <= 1) return false;
  if (!viewport || viewport.width <= 1 || viewport.height <= 1) {
    return width >= 960 && height >= 540;
  }

  const areaRatio = (width * height) / (viewport.width * viewport.height);
  const widthRatio = width / viewport.width;
  const heightRatio = height / viewport.height;
  return areaRatio >= 0.4 || (widthRatio >= 0.7 && heightRatio >= 0.5);
}

// ─── Element finders ──────────────────────────────────────────────────────────

type FindElementSelection = Pick<DomEditSelection, "id" | "hfId" | "selector" | "selectorIndex"> & {
  sourceFile?: string;
};

export function findElementForSelection(
  doc: Document,
  selection: FindElementSelection,
  activeCompositionPath: string | null = null,
): HTMLElement | null {
  const sourceMatches = (candidate: Element): candidate is HTMLElement =>
    isHtmlElement(candidate) &&
    (!selection.sourceFile ||
      getSourceFileForElement(candidate, activeCompositionPath).sourceFile ===
        selection.sourceFile);
  for (const { selector, index } of selectionLookups(selection)) {
    const found = querySelectorAllSafely(doc, selector).filter(sourceMatches)[index];
    if (found) return found;
  }
  return null;
}

// The selected node while mounted, else its copy in the selection's own file (ids repeat across files), else any copy.
export function findPreviewNode(
  doc: Document | null | undefined,
  el: DomEditSelection,
): Element | null {
  if (!doc) return null;
  if (el.element?.isConnected && el.element.ownerDocument === doc) return el.element;
  return (
    findElementForSelection(doc, el) ??
    findElementForSelection(doc, { ...el, sourceFile: undefined })
  );
}

export function findElementForTimelineElement(
  doc: Document,
  element: TimelineElementDomTarget,
  options: TimelineElementDomTargetOptions,
): HTMLElement | null {
  const { target, sourceFile, rootFallback } = timelineElementLookup(element, options);
  const found = target && findElementForSelection(doc, target, options.activeCompositionPath);
  if (found) return found;
  if (!rootFallback) return null;

  const root = doc.querySelector("[data-composition-id]");
  if (!isHtmlElement(root)) return null;
  return getSourceFileForElement(root, options.activeCompositionPath).sourceFile === sourceFile
    ? root
    : null;
}

// ─── Layer children ───────────────────────────────────────────────────────────

/** `el`'s direct children that are layers. No longer takes the context options:
 *  layer-ness does not depend on the active composition path. */
export function getDirectLayerChildren(el: HTMLElement): HTMLElement[] {
  return Array.from(el.children).filter(
    (child): child is HTMLElement => isHtmlElement(child) && isDomLayerElement(child),
  );
}
