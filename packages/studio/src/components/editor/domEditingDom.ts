/**
 * Low-level DOM primitives: type guards, style getters, CSS escaping,
 * selector utilities, and composition source resolution.
 * No imports from other domEditing* modules — safe to import from anywhere.
 */
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

export function parsePx(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.endsWith("px")) return null;
  const parsed = parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isIdentityTransform(value: string | undefined): boolean {
  const transform = (value ?? "none").trim();
  if (!transform || transform === "none") return true;

  const matrix = transform.match(/^matrix\(([^)]+)\)$/i);
  if (matrix) {
    const values = matrix[1].split(",").map((part) => Number.parseFloat(part.trim()));
    if (values.length !== 6 || values.some((part) => !Number.isFinite(part))) return false;
    return (
      Math.abs(values[0] - 1) < 0.0001 &&
      Math.abs(values[1]) < 0.0001 &&
      Math.abs(values[2]) < 0.0001 &&
      Math.abs(values[3] - 1) < 0.0001 &&
      Math.abs(values[4]) < 0.0001 &&
      Math.abs(values[5]) < 0.0001
    );
  }

  const matrix3d = transform.match(/^matrix3d\(([^)]+)\)$/i);
  if (!matrix3d) return false;
  const values = matrix3d[1].split(",").map((part) => Number.parseFloat(part.trim()));
  if (values.length !== 16 || values.some((part) => !Number.isFinite(part))) return false;
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return values.every((part, index) => Math.abs(part - identity[index]) < 0.0001);
}

export function isTextBearingTag(tagName: string): boolean {
  return ["div", "span", "p", "strong", "h1", "h2", "h3", "h4", "h5", "h6"].includes(tagName);
}

const COLOR_GRADING_SOURCE_HIDDEN_ATTR = "data-hf-color-grading-source-hidden";

export function isElementVisibleThroughAncestors(el: HTMLElement): boolean {
  const win = el.ownerDocument.defaultView;
  if (!win) return true;
  let current: HTMLElement | null = el;
  while (current) {
    const computed = win.getComputedStyle(current);
    if (computed.display === "none" || computed.visibility === "hidden") return false;
    const opacity = Number.parseFloat(computed.opacity);
    if (
      Number.isFinite(opacity) &&
      opacity <= 0.01 &&
      !current.hasAttribute(COLOR_GRADING_SOURCE_HIDDEN_ATTR)
    )
      return false;
    current = current.parentElement;
  }
  return true;
}

// ─── Style accessors ──────────────────────────────────────────────────────────

export function getCuratedComputedStyles(el: HTMLElement): Record<string, string> {
  const styles: Record<string, string> = {};
  const computed = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!computed) return styles;

  for (const prop of CURATED_STYLE_PROPERTIES) {
    const value = computed.getPropertyValue(prop);
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

// ─── DOM traversal ────────────────────────────────────────────────────────────

export function findClosestByAttribute(
  el: HTMLElement,
  attributeNames: string[],
): HTMLElement | null {
  let current: HTMLElement | null = el;
  while (current) {
    const candidate = current;
    if (attributeNames.some((attribute) => candidate.hasAttribute(attribute))) {
      return candidate;
    }
    current = current.parentElement;
  }
  return null;
}

export function getElementDepth(el: HTMLElement): number {
  let depth = 0;
  let current = el.parentElement;
  while (current) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
}

// ─── Composition source resolution ───────────────────────────────────────────

// The runtime INLINES subcompositions and strips the source-file linkage from the
// mounted root (it keeps `data-composition-id` but drops `data-composition-src`/
// `-file`), so a subcomp element's DOM ancestors no longer say which file it came
// from. This project-global map (composition-id → source file, built once from
// index.html's clips — see NLELayout) recovers it. The studio loads one project at a
// time, so module scope is the right lifetime; it's empty until set, in which case
// resolution falls back to the historical attribute-only behavior.
let compositionSourceMap: Map<string, string> = new Map();

export function setCompositionSourceMap(map: Map<string, string>): void {
  compositionSourceMap = map;
}

function sourceFromCompositionId(ownerRoot: HTMLElement | null): string | undefined {
  if (!ownerRoot || compositionSourceMap.size === 0) return undefined;
  // The runtime may rename the mounted id to a runtime-unique one, preserving the
  // authored id on `data-hf-original-composition-id` — prefer that, then the current id.
  const authored = ownerRoot.getAttribute("data-hf-original-composition-id");
  const current = ownerRoot.getAttribute("data-composition-id");
  return (
    (authored ? compositionSourceMap.get(authored) : undefined) ??
    (current ? compositionSourceMap.get(current) : undefined)
  );
}

export function getSourceFileForElement(
  el: HTMLElement,
  activeCompositionPath: string | null,
): { sourceFile: string; compositionPath: string } {
  const sourceHost = findClosestByAttribute(el, ["data-composition-file", "data-composition-src"]);
  const ownerRoot = findClosestByAttribute(el, ["data-composition-id"]);
  const sourceFile =
    sourceHost?.getAttribute("data-composition-file") ??
    sourceHost?.getAttribute("data-composition-src") ??
    ownerRoot?.getAttribute("data-composition-file") ??
    ownerRoot?.getAttribute("data-composition-src") ??
    sourceFromCompositionId(ownerRoot) ??
    activeCompositionPath ??
    "index.html";

  return {
    sourceFile,
    compositionPath: sourceFile,
  };
}

export function normalizeTimelineCompositionSource(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

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

function escapeCssIdentifier(value: string): string {
  const css = globalThis.CSS as { escape?: (input: string) => string } | undefined;
  if (typeof css?.escape === "function") return css.escape(value);

  if (value === "-") return "\\-";

  let escaped = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    const code = char.charCodeAt(0);
    if (code === 0) {
      escaped += "�";
      continue;
    }

    const isDigit = code >= 48 && code <= 57;
    const isUpperAlpha = code >= 65 && code <= 90;
    const isLowerAlpha = code >= 97 && code <= 122;
    const isControl = (code >= 1 && code <= 31) || code === 127;
    const isLeadingDigit = index === 0 && isDigit;
    const isSecondDigitAfterDash = index === 1 && value.startsWith("-") && isDigit;
    if (isControl || isLeadingDigit || isSecondDigitAfterDash) {
      escaped += `\\${code.toString(16)} `;
      continue;
    }
    if (isUpperAlpha || isLowerAlpha || isDigit || char === "-" || char === "_" || code >= 128) {
      escaped += char;
      continue;
    }
    escaped += `\\${char}`;
  }
  return escaped;
}

export function escapeCssString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\a ")
    .replace(/\r/g, "\\d ")
    .replace(/\f/g, "\\c ");
}

export function querySelectorAllSafely(doc: Document, selector: string): Element[] {
  try {
    return Array.from(doc.querySelectorAll(selector));
  } catch {
    return [];
  }
}

export function humanizeIdentifier(value: string): string {
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

export function buildStableSelector(el: HTMLElement): string | undefined {
  if (el.id) return `#${escapeCssIdentifier(el.id)}`;

  const compositionId = el.getAttribute("data-composition-id");
  if (compositionId) return `[data-composition-id="${escapeCssString(compositionId)}"]`;

  return getPreferredClassSelector(el);
}

export function getPreferredClassSelector(el: HTMLElement): string | undefined {
  const classes = Array.from(el.classList)
    .map((value) => value.trim())
    .filter(Boolean);
  if (classes.length === 0) return undefined;
  const preferred =
    classes.find((value) => value !== "clip" && !value.startsWith("__hf-")) ?? classes[0];
  return preferred ? `.${escapeCssIdentifier(preferred)}` : undefined;
}

export function getSelectorIndex(
  doc: Document,
  el: HTMLElement,
  selector: string | undefined,
  sourceFile: string,
  activeCompositionPath: string | null,
): number | undefined {
  if (!selector?.startsWith(".")) return undefined;

  const candidates = querySelectorAllSafely(doc, selector).filter(
    (candidate): candidate is HTMLElement =>
      isHtmlElement(candidate) &&
      getSourceFileForElement(candidate, activeCompositionPath).sourceFile === sourceFile,
  );
  const index = candidates.indexOf(el);
  return index >= 0 ? index : undefined;
}
