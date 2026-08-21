/**
 * Browser-safe parser for the `data-composition-variables` schema attribute.
 * Lives outside htmlParser.ts so browser consumers (SDK, Studio, lint) can
 * import it via `@hyperframes/parsers/composition` without pulling the
 * linkedom/Node HTML-parser machinery from the main entry.
 */

import type { CompositionVariable, CompositionVariableType } from "./types.js";

/**
 * Required typeof for each variable type's `default`. For font the default is
 * the font-family name string; for image it is the fallback URL string —
 * extra metadata fields on both are optional and not validated here.
 */
const DEFAULT_TYPEOF: Record<CompositionVariableType, "string" | "number" | "boolean"> = {
  string: "string",
  number: "number",
  color: "string",
  boolean: "boolean",
  enum: "string",
  font: "string",
  image: "string",
};

/**
 * Scalar variable values (string/number/boolean) are the ones that flow into
 * CSS custom props and text bindings; font/image values are object-shaped.
 * Shared so the SDK's CSS-compat writes, the runtime bindings, and Studio's
 * display logic can never disagree on what "scalar" means.
 */
export function isScalarVariableValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isVariableType(t: unknown): t is CompositionVariableType {
  return typeof t === "string" && t in DEFAULT_TYPEOF;
}

/**
 * True when the value is a structurally valid variable declaration: id, label,
 * a known type, a default matching that type, and options[] for enums. The
 * same predicate parseCompositionVariables filters with — exported so writers
 * (SDK declaration ops, Studio forms) can validate before persisting.
 */
export function isCompositionVariable(v: unknown): v is CompositionVariable {
  if (!isRecord(v)) return false;
  if (typeof v.id !== "string" || typeof v.label !== "string") return false;
  if (!isVariableType(v.type)) return false;
  if (typeof v.default !== DEFAULT_TYPEOF[v.type]) return false;
  if (v.type === "enum" && !Array.isArray(v.options)) return false;
  return true;
}

/**
 * Parse the typed variable declarations from an element's
 * `data-composition-variables` attribute. Malformed entries (wrong shape,
 * unknown type, default not matching the declared type) are dropped; an
 * absent attribute, invalid JSON, or a non-array payload yields `[]`.
 */
export function parseCompositionVariables(htmlEl: Element): CompositionVariable[] {
  const variablesAttr = htmlEl.getAttribute("data-composition-variables");
  if (!variablesAttr) {
    return [];
  }

  try {
    const parsed = JSON.parse(variablesAttr);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isCompositionVariable);
  } catch {
    return [];
  }
}

/**
 * Protocol allowlist for a resolved media URL. Relative URLs (no scheme) resolve
 * against the page origin and are always safe. Absolute URLs are restricted to
 * http(s)/blob and image data: URIs -- defense-in-depth alongside the runtime's
 * VAR_SRC_TAGS element guard, blocking `javascript:`, `data:text/html`, `file:`,
 * etc. even if a future tag slips past it. Control chars are stripped before the
 * scheme test because browsers ignore them when parsing the URL.
 *
 * Lives here rather than in the runtime because the linter has to reach the same
 * verdict on a declared default statically: a value this rejects is dropped at
 * bind time and the element's authored fallback renders instead, so a second copy
 * of the scheme list would let lint and the runtime disagree silently.
 */
export function isSafeMediaUrl(url: string): boolean {
  // Browsers ignore ASCII control chars/whitespace when parsing a URL, so strip
  // them before reading the scheme (defeats `java\tscript:` style bypasses).
  // oxlint-disable-next-line no-control-regex -- control chars are the target here
  const normalized = url.replace(/[\u0000-\u0020]/g, "");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalized);
  if (!scheme) return true;
  const proto = scheme[1]?.toLowerCase();
  if (!proto) return false;
  if (proto === "https" || proto === "http" || proto === "blob") return true;
  if (proto === "data") return /^data:image\//i.test(normalized);
  return false;
}
