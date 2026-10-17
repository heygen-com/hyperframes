/** Portable, untrusted element markup. Receivers must sanitize before insertion. */
export interface ElementClipboard {
  html: string;
  css: string;
  width: number;
  height: number;
  warnings: string[];
}

export const ELEMENT_CLIPBOARD_PREFIX = "hyperframes-element:v1\n";
export const ELEMENT_CLIPBOARD_MAX_BYTES = 8 * 1024 * 1024;
export const ELEMENT_CLIPBOARD_MAX_NODES = 5000;
export const ELEMENT_CLIPBOARD_MAX_DIMENSION = 16384;
export const ELEMENT_CLIPBOARD_MAX_WARNINGS = 32;
export const ELEMENT_CLIPBOARD_MAX_WARNING_LENGTH = 512;

function validDimension(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= ELEMENT_CLIPBOARD_MAX_DIMENSION
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validWarnings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= ELEMENT_CLIPBOARD_MAX_WARNINGS &&
    value.every(
      (warning) =>
        typeof warning === "string" && warning.length <= ELEMENT_CLIPBOARD_MAX_WARNING_LENGTH,
    )
  );
}

function withinNodeBudget(html: string): boolean {
  // Conservative lexical budget, independent of browser DOM globals.
  // The receiving DOM sanitizer enforces the parsed tree budget as well.
  let nodes = 0;
  for (const _match of html.matchAll(/<[a-zA-Z][^\s/>]*/g))
    if (++nodes > ELEMENT_CLIPBOARD_MAX_NODES) return false;
  return true;
}

function publicValue(value: unknown): ElementClipboard | null {
  if (!isRecord(value)) return null;
  const { html, css, width, height, warnings } = value;
  if (typeof html !== "string" || !html.trim() || typeof css !== "string") return null;
  if (
    !validDimension(width) ||
    !validDimension(height) ||
    !validWarnings(warnings) ||
    !withinNodeBudget(html)
  )
    return null;
  return { html, css, width, height, warnings: [...warnings] };
}

export function encodeElementClipboard(value: ElementClipboard): string {
  const clean = publicValue(value);
  if (!clean) throw new TypeError("Invalid element clipboard payload");
  const text = ELEMENT_CLIPBOARD_PREFIX + JSON.stringify(clean);
  if (new TextEncoder().encode(text).length > ELEMENT_CLIPBOARD_MAX_BYTES)
    throw new TypeError("Element clipboard payload is too large");
  return text;
}

export function parseElementClipboard(text: string): ElementClipboard | null {
  if (
    typeof text !== "string" ||
    !text.startsWith(ELEMENT_CLIPBOARD_PREFIX) ||
    text.length > ELEMENT_CLIPBOARD_MAX_BYTES ||
    new TextEncoder().encode(text).length > ELEMENT_CLIPBOARD_MAX_BYTES
  )
    return null;
  try {
    return publicValue(JSON.parse(text.slice(ELEMENT_CLIPBOARD_PREFIX.length)));
  } catch {
    return null;
  }
}
