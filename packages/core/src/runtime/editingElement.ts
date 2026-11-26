// How an element is addressed in source: one rule for Studio and the runtime's editing agent.
import { COMPOSITION_ROOT_ATTRS, SOURCE_HOST_ATTRS } from "../compositionSource";
import { isHtmlElement } from "./domRealm";

/** Names an element's source file. The parent resolves it: `file`, else its composition map. */
export interface EditingElementSource {
  /** `data-composition-file`, else `data-composition-src`, of the nearest element with either. */
  file: string | null;
  /** The nearest `data-composition-id`, and that element's `data-hf-original-composition-id`. */
  compositionId: string | null;
  originalCompositionId: string | null;
}

/** `<load>:<n>`, never reused. One from another page load, or of a removed element, reads as null. */
export type EditingElementHandle = string;
export const EDITING_ELEMENT_HANDLE = /^[0-9a-f]{16}:[1-9][0-9]{0,14}$/;

export interface EditingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditingElementHit {
  handle: EditingElementHandle;
  tag: string;
  /** `getBoundingClientRect()`, in the frame's CSS pixels. */
  rect: EditingRect;
}

/**
 * An element as plain data, cut at the MAX_ELEMENT_* limits; a `data:` value over its limit keeps only its header.
 * `truncated` says something was cut, so the description is not safe to write back to source.
 */
export interface EditingElementDescription extends EditingElementHit {
  label?: string;
  parent: EditingElementHandle | null;
  id: string | null;
  selector: string | null;
  /**
   * A class selector's earlier matches, counted per source. The element's index in its file is the
   * sum of the counts whose source resolves to that file. Null for other selectors, or too many.
   */
  matchesBefore: Array<{ source: EditingElementSource; count: number }> | null;
  source: EditingElementSource;
  /** The element or an ancestor carries `data-timeline-locked`. */
  locked: boolean;
  /** Every attribute but `style`. */
  attributes: Array<[name: string, value: string]>;
  inlineStyles: Record<string, string>;
  /** Rendered-tree text: `<script>` and `<style>` contents are left out, as from `children`. */
  text: string;
  children: Array<{ handle: EditingElementHandle } | { text: string }>;
  truncated: boolean;
  textMarkup?: boolean;
}

export interface EditingElementMatch {
  handle: EditingElementHandle;
  source: EditingElementSource;
}

export const MAX_ELEMENT_ENTRIES = 256;
export const MAX_ELEMENT_TEXT = 10_000;
export const MAX_ELEMENT_VALUE = 2_000;
export const MAX_DRAFT_PX = 100_000;
export const MAX_SOURCE_GROUPS = 64;
export const MAX_DESCRIBE_HANDLES = 256;
export const MAX_POINT_STACK = 64;
export const MAX_QUERY_MATCHES = 2_048;
export const MAX_TIMELINE_TEXT = 200;

const TEXT_TAGS = new Set(["div", "span", "p", "strong", "h1", "h2", "h3", "h4", "h5", "h6"]);

function isTextBearingTag(tagName: string): boolean {
  return TEXT_TAGS.has(tagName);
}

export function isEditableTextLeaf(el: HTMLElement): boolean {
  return isTextBearingTag(el.tagName.toLowerCase()) && el.children.length === 0;
}

/** A text layer's words and computed look, as its timeline row draws them. */
export interface TextLayerRead {
  value: string;
  fontFamily: string;
  fontWeight: string;
  color: string;
  backgroundColor: string;
}

/** A layer that paints only text on a flat colour, read; null for anything painted beyond that. */
export function readTextLayer(el: Element): TextLayerRead | null {
  if (!isHtmlElement(el) || !isTextBearingTag(el.localName)) return null;
  if (!Array.from(el.children).every((child) => isHtmlElement(child) && isEditableTextLeaf(child)))
    return null;
  const words = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!words) return null;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!style || (style.backgroundImage || "none") !== "none") return null;
  const { fontFamily, fontWeight, color, backgroundColor } = style;
  return { value: words, fontFamily, fontWeight, color, backgroundColor };
}

/** A text layer as the runtime's clip list sends it: the words and each style value capped. */
export function readSentTextLayer(el: Element): TextLayerRead | null {
  const read = readTextLayer(el);
  if (!read) return null;
  return {
    value: read.value.slice(0, MAX_TIMELINE_TEXT),
    fontFamily: read.fontFamily.slice(0, MAX_ELEMENT_VALUE),
    fontWeight: read.fontWeight.slice(0, MAX_ELEMENT_VALUE),
    color: read.color.slice(0, MAX_ELEMENT_VALUE),
    backgroundColor: read.backgroundColor.slice(0, MAX_ELEMENT_VALUE),
  };
}

// fallow-ignore-next-line complexity
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

export function buildStableSelector(el: Element): string | undefined {
  if (el.id && typeof el.id === "string") return `#${escapeCssIdentifier(el.id)}`;

  const compositionId = el.getAttribute("data-composition-id");
  if (compositionId) return `[data-composition-id="${escapeCssString(compositionId)}"]`;

  // Group wrappers carry no id/class; their data-hf-group value is the unique,
  // stable handle the source mutations write — use it so the wrapper is
  // selectable, patchable (move/scale), and addressable for ungroup.
  const group = el.getAttribute("data-hf-group");
  if (group) return `[data-hf-group="${escapeCssString(group)}"]`;

  return getPreferredClassSelector(el);
}

const ESCAPED_IDENTIFIER = String.raw`(?:[A-Za-z0-9_-]|[^\x00-\x7f]|\\[0-9a-f]{1,6} |\\[^0-9a-f\n\r\f])+`;
const ESCAPED_STRING = String.raw`"(?:[^"\\\n\r\f]|\\\\|\\"|\\a |\\d |\\c )+"`;
const CLASS_SELECTOR = new RegExp(`^\\.(?!-?[0-9]|-$)${ESCAPED_IDENTIFIER}$`);
const ATTRIBUTE_SELECTOR = new RegExp(`^\\[data-(?:composition-id|hf-group)=${ESCAPED_STRING}\\]$`);

/** Is `selector` one `buildStableSelector` makes for an element whose id is `id`. */
export function isStableSelector(selector: string, id: string | null): boolean {
  if (selector.startsWith("#"))
    return Boolean(id) && selector === `#${escapeCssIdentifier(id ?? "")}`;
  return !id && (CLASS_SELECTOR.test(selector) || ATTRIBUTE_SELECTOR.test(selector));
}

export function getPreferredClassSelector(el: Element): string | undefined {
  const classes = Array.from(el.classList)
    .map((value) => value.trim())
    .filter(Boolean);
  if (classes.length === 0) return undefined;
  const preferred =
    classes.find((value) => value !== "clip" && !value.startsWith("__hf-")) ?? classes[0];
  return preferred ? `.${escapeCssIdentifier(preferred)}` : undefined;
}

function closestWithAny(el: Element, names: readonly string[]): Element | null {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const candidate = node;
    if (names.some((name) => candidate.hasAttribute(name))) return candidate;
  }
  return null;
}

export function readElementSource(el: Element): EditingElementSource {
  const [fileAttr] = SOURCE_HOST_ATTRS;
  const [idAttr, originalIdAttr] = COMPOSITION_ROOT_ATTRS;
  const host = closestWithAny(el, [fileAttr]);
  const root = closestWithAny(el, [idAttr]);
  return {
    file: host?.getAttribute(fileAttr) || null,
    compositionId: root?.getAttribute(idAttr) ?? null,
    originalCompositionId: root?.getAttribute(originalIdAttr) ?? null,
  };
}
