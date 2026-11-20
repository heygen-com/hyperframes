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
  "data",
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

// The URL spec's own clean-up before it reads a scheme: no C0 control or space at either end, no tab or newline at all.
function linkAsBrowsersReadIt(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start++;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end--;
  return value.slice(start, end).replace(/[\t\n\r]/g, "");
}

export function isSafeAttributeValue(name: string, value: string): boolean {
  if (URI_BEARING_ATTRS.has(name.toLowerCase())) {
    const trimmed = linkAsBrowsersReadIt(value);
    if (DANGEROUS_URI_SCHEMES.test(trimmed)) return false;
    if (DANGEROUS_DATA_URI.test(trimmed)) return false;
  }
  return true;
}

const CODE_ELEMENTS = new Set(["script", "object", "embed"]);
const INLINE_DOCUMENT_FRAMES = new Set(["iframe", "frame"]);
const LINK_ANIMATIONS = new Set(["set", "animate"]);
const ANIMATED_LINKS = new Set(["href", "xlink:href"]);
const ANIMATED_VALUES = ["to", "from", "by", "values"];

function kindFindings(element: Element, tag: string): string[] {
  if (CODE_ELEMENTS.has(tag)) return [tag];
  return INLINE_DOCUMENT_FRAMES.has(tag) && element.hasAttribute("srcdoc")
    ? [`${tag}[srcdoc]`]
    : [];
}

const runsCode = (name: string, value: string) =>
  name.toLowerCase().startsWith("on") || !isSafeAttributeValue(name, value);

function attributeFindings(element: Element, tag: string): string[] {
  return Array.from(element.attributes)
    .filter(({ name, value }) => runsCode(name, value))
    .map(({ name }) => `${tag}[${name}]`);
}

const animatesLink = (element: Element, tag: string) =>
  LINK_ANIMATIONS.has(tag) &&
  ANIMATED_LINKS.has(element.getAttribute("attributeName")?.toLowerCase() ?? "");

function animationFindings(element: Element, tag: string): string[] {
  if (!animatesLink(element, tag)) return [];
  return ANIMATED_VALUES.filter((name) =>
    (element.getAttribute(name)?.split(";") ?? []).some((v) => !isSafeAttributeValue("href", v)),
  ).map((name) => `${tag}[${name}]`);
}

function childrenOf(element: Element, tag: string): Element[] {
  const content = tag === "template" ? (element as HTMLTemplateElement).content : null;
  return [...Array.from(element.children), ...Array.from(content?.children ?? [])];
}

function unsafeIn(element: Element, found: string[]): void {
  const tag = element.localName;
  found.push(...kindFindings(element, tag));
  found.push(...attributeFindings(element, tag));
  found.push(...animationFindings(element, tag));
  for (const child of childrenOf(element, tag)) unsafeIn(child, found);
}

export function unsafeMarkup(root: Element): string[] {
  const found: string[] = [];
  unsafeIn(root, found);
  return found;
}
