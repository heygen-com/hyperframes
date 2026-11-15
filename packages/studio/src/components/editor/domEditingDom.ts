/**
 * Low-level DOM primitives: type guards, style getters, CSS escaping,
 * selector utilities, and composition source resolution.
 * No imports from other domEditing* modules — safe to import from anywhere.
 */
import { getLogicalOpacity } from "@hyperframes/core/studio-preview-mark";
import {
  buildStableSelector,
  escapeCssString,
  getPreferredClassSelector,
  isElementVisibleThroughAncestors,
  readElementSource,
  type EditingElementSource,
} from "@hyperframes/core/runtime/editing-port";
import { getSourceScopedSelectorIndex } from "../../utils/sourceScopedSelectorIndex";
import { CURATED_STYLE_PROPERTIES } from "./domEditingTypes";

// ─── Type guard ───────────────────────────────────────────────────────────────

export function isHtmlElement(value: unknown): value is HTMLElement {
  return (
    typeof value === "object" &&
    value !== null &&
    "nodeType" in value &&
    typeof (value as { nodeType?: unknown }).nodeType === "number" &&
    (value as { nodeType: number }).nodeType === 1
  );
}

// ─── Style parsing ────────────────────────────────────────────────────────────

// Single source of truth lives in @hyperframes/core/editing so the studio
// callers and the core resolver can't drift. Re-exported here to keep this
// module's public surface (6 studio callers import parsePx from it).
export { parsePx } from "@hyperframes/core/editing";

export function isTextBearingTag(tagName: string): boolean {
  return ["div", "span", "p", "strong", "h1", "h2", "h3", "h4", "h5", "h6"].includes(tagName);
}

export function isEditableTextLeaf(el: HTMLElement): boolean {
  return isTextBearingTag(el.tagName.toLowerCase()) && el.children.length === 0;
}

export { getLogicalOpacity };
// One addressing rule for Studio and the runtime that describes elements to it.
export { buildStableSelector, escapeCssString };
// One visibility rule for Studio and the runtime that measures overlay geometry for it.
export { isElementVisibleThroughAncestors };

// ─── Style accessors ──────────────────────────────────────────────────────────

export function getCuratedComputedStyles(el: HTMLElement): Record<string, string> {
  const styles: Record<string, string> = {};
  const computed = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!computed) return styles;

  for (const prop of CURATED_STYLE_PROPERTIES) {
    const value =
      prop === "opacity" ? getLogicalOpacity(el, computed) : computed.getPropertyValue(prop);
    if (value) styles[prop] = value;
  }

  return styles;
}

export function getInlineStyles(el: HTMLElement): Record<string, string> {
  const styles: Record<string, string> = {};
  for (const property of CURATED_STYLE_PROPERTIES) {
    const value = el.style.getPropertyValue(property);
    if (value) styles[property] = value;
  }
  return styles;
}

export function getDataAttributes(el: HTMLElement): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const attr of el.attributes) {
    if (attr.name.startsWith("data-")) {
      attrs[attr.name.slice(5)] = attr.value;
    }
  }
  return attrs;
}

// ─── Composition source resolution ───────────────────────────────────────────

// The runtime INLINES subcompositions and strips the source-file linkage from the
// mounted root (it keeps `data-composition-id` but drops `data-composition-src`/
// `-file`), so a subcomp element's DOM ancestors no longer say which file it came
// from. This project-global map (composition-id → source file, built once from
// index.html's clips — see NLEContext/EditorShell) recovers it. The studio loads one project at a
// time, so module scope is the right lifetime; it's empty until set, in which case
// resolution falls back to the historical attribute-only behavior.
let compositionSourceMap: Map<string, string> = new Map();
// Bumped on every replacement so a consumer that memoizes a resolved source file
// can tell that the map it resolved against is gone. The map is module state
// with no DOM footprint, so nothing else can observe the change.
let compositionSourceMapRevision = 0;

export function setCompositionSourceMap(map: Map<string, string>): void {
  compositionSourceMap = map;
  compositionSourceMapRevision += 1;
}

export function getCompositionSourceMapRevision(): number {
  return compositionSourceMapRevision;
}

/** The source file `source` names (see `EditingElementSource`), with this project's composition map. */
export function resolveElementSourceFile(
  source: EditingElementSource,
  activeCompositionPath: string | null,
): string {
  const { file, compositionId, originalCompositionId } = source;
  const mapped = compositionSourceMap.size
    ? ((originalCompositionId ? compositionSourceMap.get(originalCompositionId) : undefined) ??
      (compositionId ? compositionSourceMap.get(compositionId) : undefined))
    : undefined;
  return file ?? mapped ?? activeCompositionPath ?? "index.html";
}

export function getSourceFileForElement(
  el: HTMLElement,
  activeCompositionPath: string | null,
): { sourceFile: string; compositionPath: string } {
  const sourceFile = resolveElementSourceFile(readElementSource(el), activeCompositionPath);
  return {
    sourceFile,
    compositionPath: sourceFile,
  };
}

export function normalizeTimelineCompositionSource(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^([a-z][a-z0-9+.-]*:|\/)/i.test(trimmed)) return trimmed;

  let pathname = trimmed;
  try {
    pathname = new URL(trimmed, "http://studio.local").pathname;
  } catch {
    pathname = trimmed;
  }

  for (const marker of ["/preview/comp/", "/preview/"]) {
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) continue;
    const sourcePath = pathname.slice(markerIndex + marker.length).replace(/^\/+/, "");
    return sourcePath || trimmed;
  }

  return trimmed;
}

// ─── CSS escaping ─────────────────────────────────────────────────────────────

export function querySelectorAllSafely(doc: Document, selector: string): Element[] {
  try {
    return Array.from(doc.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function humanizeIdentifier(value: string): string {
  return (
    value
      .replace(/\.html$/i, "")
      .replace(/^compositions\//i, "")
      .split("/")
      .at(-1)
      ?.replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase()) ?? value
  );
}

// ─── CSS selector building ────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
export function buildElementLabel(el: HTMLElement): string {
  const compositionId =
    el.getAttribute("data-hf-original-composition-id") ?? el.getAttribute("data-composition-id");
  if (compositionId && compositionId !== "main") {
    return humanizeIdentifier(compositionId);
  }

  const compositionSrc =
    el.getAttribute("data-composition-src") ?? el.getAttribute("data-composition-file");
  if (compositionSrc) {
    return humanizeIdentifier(compositionSrc);
  }

  const group = el.getAttribute("data-hf-group");
  if (group) return group;

  if (el.id) return humanizeIdentifier(el.id);

  const preferredClass = getPreferredClassSelector(el);
  if (preferredClass) {
    return humanizeIdentifier(preferredClass.replace(/^\./, ""));
  }

  const text = (el.textContent ?? "").trim().replace(/\s+/g, " ");
  if (text) return text.length > 40 ? `${text.slice(0, 39)}…` : text;
  return el.tagName.toLowerCase();
}

export function getSelectorIndex(
  doc: Document,
  el: HTMLElement,
  selector: string | undefined,
  sourceFile: string,
  activeCompositionPath: string | null,
): number | undefined {
  if (!selector?.startsWith(".")) return undefined;

  return getSourceScopedSelectorIndex(doc, el, selector, sourceFile, (candidate) =>
    isHtmlElement(candidate)
      ? getSourceFileForElement(candidate, activeCompositionPath).sourceFile
      : undefined,
  );
}
