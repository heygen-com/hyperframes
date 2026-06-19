/**
 * Shared HTML attribute safety constants.
 *
 * Single source of truth for attribute allowlists and dangerous-URI patterns
 * used by sourceMutation (core), sdkCutover (studio), and mutate (sdk).
 */

export const ALLOWED_HTML_ATTRS = new Set([
  "id",
  "class",
  "style",
  "title",
  "name",
  "for",
  "type",
  "lang",
  "dir",
  "translate",
  "hidden",
  "tabindex",
  "draggable",
  "contenteditable",
  "role",
  "slot",
  "href",
  "target",
  "rel",
  "src",
  "srcset",
  "sizes",
  "alt",
  "poster",
  "loading",
  "decoding",
  "crossorigin",
  "preload",
  "autoplay",
  "loop",
  "muted",
  "controls",
  "playsinline",
  "width",
  "height",
  "colspan",
  "rowspan",
  "scope",
  "placeholder",
  "value",
  "min",
  "max",
  "step",
  "pattern",
  "required",
  "disabled",
  "readonly",
  "checked",
  "selected",
  "multiple",
  "accept",
  "maxlength",
  "minlength",
  "rows",
  "cols",
  "wrap",
]);

export const URI_BEARING_ATTRS = new Set([
  "src",
  "href",
  "action",
  "formaction",
  "poster",
  "srcset",
  "xlink:href",
]);

export const DANGEROUS_URI_SCHEMES = /^(?:javascript|vbscript):/i;
export const DANGEROUS_DATA_URI = /^data\s*:\s*text\/html/i;

export function isAllowedHtmlAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith("on")) return false;
  if (ALLOWED_HTML_ATTRS.has(lower)) return true;
  if (lower.startsWith("data-")) return true;
  if (lower.startsWith("aria-")) return true;
  return false;
}

export function isSafeAttributeValue(name: string, value: string): boolean {
  if (URI_BEARING_ATTRS.has(name.toLowerCase())) {
    const trimmed = value.trim();
    if (DANGEROUS_URI_SCHEMES.test(trimmed)) return false;
    if (DANGEROUS_DATA_URI.test(trimmed)) return false;
  }
  return true;
}
