// How an element is addressed in source: one rule for Studio and the runtime's editing agent.

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
 * An element as plain data, cut at the MAX_ELEMENT_* limits; a `data:` value keeps only its header.
 * `truncated` says something was cut, so the description is not safe to write back to source.
 */
export interface EditingElementDescription extends EditingElementHit {
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
}

export const MAX_ELEMENT_ENTRIES = 256;
export const MAX_ELEMENT_TEXT = 10_000;
export const MAX_ELEMENT_VALUE = 2_000;
export const MAX_SOURCE_GROUPS = 64;
export const MAX_DESCRIBE_HANDLES = 256;
export const MAX_POINT_STACK = 64;

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
  if (el.id) return `#${escapeCssIdentifier(el.id)}`;

  const compositionId = el.getAttribute("data-composition-id");
  if (compositionId) return `[data-composition-id="${escapeCssString(compositionId)}"]`;

  // Group wrappers carry no id/class; their data-hf-group value is the unique,
  // stable handle the source mutations write — use it so the wrapper is
  // selectable, patchable (move/scale), and addressable for ungroup.
  const group = el.getAttribute("data-hf-group");
  if (group) return `[data-hf-group="${escapeCssString(group)}"]`;

  return getPreferredClassSelector(el);
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
  const host = closestWithAny(el, ["data-composition-file", "data-composition-src"]);
  const root = closestWithAny(el, ["data-composition-id"]);
  return {
    file:
      host?.getAttribute("data-composition-file") ??
      host?.getAttribute("data-composition-src") ??
      null,
    compositionId: root?.getAttribute("data-composition-id") ?? null,
    originalCompositionId: root?.getAttribute("data-hf-original-composition-id") ?? null,
  };
}
