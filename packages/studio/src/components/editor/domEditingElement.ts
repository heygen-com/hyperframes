/**
 * Element visibility, visual scoring, layer patch targets, element finders,
 * and the `findElementForSelection` / `findElementForTimelineElement` lookups.
 */
import type {
  DomEditContextOptions,
  DomEditSelection,
  DomEditViewport,
  TimelineElementDomTarget,
  TimelineElementDomTargetOptions,
} from "./domEditingTypes";
import {
  buildStableSelector,
  escapeCssString,
  getSelectorIndex,
  getSourceFileForElement,
  isHtmlElement,
  normalizeTimelineCompositionSource,
  querySelectorAllSafely,
} from "./domEditingDom";

// ─── Visibility ──────────────────────────────────────────────────────────────

export function isElementComputedVisible(el: HTMLElement): boolean {
  const win = el.ownerDocument.defaultView;
  if (!win) return true;
  let current: HTMLElement | null = el;
  while (current) {
    const computed = win.getComputedStyle(current);
    if (computed.display === "none" || computed.visibility === "hidden") return false;
    const opacity = Number.parseFloat(computed.opacity);
    if (Number.isFinite(opacity) && opacity <= 0.01) return false;
    current = current.parentElement;
  }
  return true;
}

const VISUAL_LEAF_TAGS = new Set(["img", "video", "canvas", "svg", "audio"]);

function isEmptyVisualContainer(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (VISUAL_LEAF_TAGS.has(tag)) return false;

  const { children } = el;
  if (children.length === 0) {
    return (el.textContent ?? "").trim().length === 0;
  }

  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (!isHtmlElement(child)) continue;
    if (VISUAL_LEAF_TAGS.has(child.tagName.toLowerCase())) return false;
    if (isElementComputedVisible(child)) return false;
  }

  return true;
}

function hasRenderedBox(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) return false;
  if (!isElementComputedVisible(el)) return false;
  if (isEmptyVisualContainer(el)) return false;
  return true;
}

// ─── Visual scoring ──────────────────────────────────────────────────────────

// ─── Layer patch target ──────────────────────────────────────────────────────

const DOM_LAYER_IGNORED_TAGS = new Set([
  "base",
  "br",
  "canvas",
  "link",
  "meta",
  "script",
  "source",
  "style",
  "template",
  "track",
  "wbr",
]);

function isInspectableLayerElement(el: HTMLElement): boolean {
  const tagName = el.tagName.toLowerCase();
  if (DOM_LAYER_IGNORED_TAGS.has(tagName)) return false;

  const computed = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (computed?.display === "none" || computed?.visibility === "hidden") return false;

  return true;
}

export function getDomLayerPatchTarget(
  el: HTMLElement,
  activeCompositionPath: string | null,
): Pick<DomEditSelection, "id" | "selector" | "selectorIndex" | "sourceFile"> | null {
  if (!isInspectableLayerElement(el)) return null;
  if (el.hasAttribute("data-composition-id")) return null;

  const selector = buildStableSelector(el);
  if (!selector) return null;

  const { sourceFile } = getSourceFileForElement(el, activeCompositionPath);
  return {
    id: el.id || undefined,
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

// ─── Clip ancestor / selection candidate ─────────────────────────────────────

function getPreferredClipAncestor(startEl: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = startEl;
  while (current) {
    if (current.classList.contains("clip")) {
      const isCompositionHost =
        current.hasAttribute("data-composition-src") ||
        current.hasAttribute("data-composition-file");
      if (!isCompositionHost || current === startEl) return current;
    }
    current = current.parentElement;
  }
  return null;
}

export function getSelectionCandidate(
  startEl: HTMLElement,
  options: DomEditContextOptions,
): HTMLElement {
  if (options.preferClipAncestor) {
    const clipAncestor = getPreferredClipAncestor(startEl);
    if (clipAncestor) {
      return clipAncestor;
    }
  }

  return startEl;
}

// ─── Visual target resolution ─────────────────────────────────────────────────

export function resolveVisualDomEditSelectionTarget(
  elementsFromPoint: Iterable<Element | null | undefined>,
  options: Pick<DomEditContextOptions, "activeCompositionPath">,
): HTMLElement | null {
  const candidates: HTMLElement[] = [];

  for (const entry of elementsFromPoint) {
    if (!isHtmlElement(entry)) continue;
    if (hasRenderedBox(entry) && getDomLayerPatchTarget(entry, options.activeCompositionPath)) {
      candidates.push(entry);
    }
  }

  if (candidates.length === 0) return null;

  // candidates are in visual stacking order (topmost first, from elementsFromPoint).
  // Start with the topmost and only replace with a descendant that is more
  // specific within the same visual subtree. Never jump to an unrelated
  // element that happens to be painted behind the current pick.
  let best = candidates[0];

  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (best.contains(candidate)) {
      best = candidate;
    }
  }

  return best;
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

export function findElementForSelection(
  doc: Document,
  selection: Pick<DomEditSelection, "id" | "selector" | "selectorIndex" | "sourceFile">,
  activeCompositionPath: string | null = null,
): HTMLElement | null {
  if (selection.id) {
    const byId = doc.getElementById(selection.id);
    if (
      isHtmlElement(byId) &&
      (!selection.sourceFile ||
        getSourceFileForElement(byId, activeCompositionPath).sourceFile === selection.sourceFile)
    ) {
      return byId;
    }
  }

  if (!selection.selector) return null;

  if (selection.selector.startsWith(".") && selection.selectorIndex != null) {
    const matches = querySelectorAllSafely(doc, selection.selector).filter(
      (candidate): candidate is HTMLElement =>
        isHtmlElement(candidate) &&
        (!selection.sourceFile ||
          getSourceFileForElement(candidate, activeCompositionPath).sourceFile ===
            selection.sourceFile),
    );
    return matches[selection.selectorIndex] ?? null;
  }

  const matches = querySelectorAllSafely(doc, selection.selector).filter(
    (candidate): candidate is HTMLElement =>
      isHtmlElement(candidate) &&
      (!selection.sourceFile ||
        getSourceFileForElement(candidate, activeCompositionPath).sourceFile ===
          selection.sourceFile),
  );
  return matches[0] ?? null;
}

export function findElementForTimelineElement(
  doc: Document,
  element: TimelineElementDomTarget,
  options: TimelineElementDomTargetOptions,
): HTMLElement | null {
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

  if (selector || element.domId) {
    const targetElement = findElementForSelection(
      doc,
      {
        id: element.domId ?? undefined,
        selector,
        selectorIndex: element.selectorIndex,
        sourceFile,
      },
      options.activeCompositionPath,
    );
    if (targetElement) return targetElement;
  }

  const hasExplicitDomTarget = Boolean(element.domId || element.selector || compositionSource);
  if (options.isMasterView || hasExplicitDomTarget || !options.activeCompositionPath) {
    return null;
  }

  const root = doc.querySelector("[data-composition-id]");
  if (!isHtmlElement(root)) return null;
  return getSourceFileForElement(root, options.activeCompositionPath).sourceFile === sourceFile
    ? root
    : null;
}

// ─── Layer children ───────────────────────────────────────────────────────────

export function getDirectLayerChildren(
  el: HTMLElement,
  options: DomEditContextOptions,
): HTMLElement[] {
  return Array.from(el.children).filter(
    (child): child is HTMLElement =>
      isHtmlElement(child) && getDomLayerPatchTarget(child, options.activeCompositionPath) !== null,
  );
}
