/**
 * Source Patcher — Maps visual property edits back to source HTML files.
 * Handles inline style updates, attribute changes, and text content.
 */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeStyleAttributeValue(value: string, quote: string): string {
  return quote === '"' ? value.replace(/"/g, "&quot;") : value.replace(/'/g, "&#39;");
}

/** Escape a string for safe use inside a double-quoted HTML attribute. */
function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Reverse escapeHtmlAttribute so callers get the original value. */
function unescapeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function splitInlineStyleDeclarations(style: string): string[] {
  const declarations: string[] = [];
  let current = "";
  let quote: string | null = null;
  let entity = false;
  let parenDepth = 0;

  for (const char of style) {
    if (entity) {
      current += char;
      if (char === ";") entity = false;
      continue;
    }

    if (char === "&") {
      entity = true;
      current += char;
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      current += char;
      continue;
    }

    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      current += char;
      continue;
    }

    if (char === ";" && parenDepth === 0) {
      declarations.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current) declarations.push(current);
  return declarations;
}

export interface PatchOperation {
  type: "inline-style" | "attribute" | "text-content" | "html-attribute";
  property: string;
  value: string | null;
  childSelector?: string;
  childIndex?: number;
}

// Runtime validation for hfId lives in findTagByTarget → execDataAttrPattern (CSS attr-value
// escape). This type is documentation only; the server's MutationTarget mirrors this shape.
export interface PatchTarget {
  id?: string | null;
  hfId?: string;
  selector?: string;
  selectorIndex?: number;
}

/**
 * Find which source file contains an element by its ID.
 */
export function resolveSourceFile(
  elementId: string | null,
  selector: string,
  files: Record<string, string>,
): string | null {
  if (!elementId && !selector) return null;

  // Strategy 1: Search by id attribute
  if (elementId) {
    for (const [path, content] of Object.entries(files)) {
      if (content.includes(`id="${elementId}"`) || content.includes(`id='${elementId}'`)) {
        return path;
      }
    }
  }

  // Strategy 2: Search by data-composition-id from the selector
  const compIdMatch = selector.match(/data-composition-id="([^"]+)"/);
  if (compIdMatch) {
    const compId = compIdMatch[1];
    for (const [path, content] of Object.entries(files)) {
      if (content.includes(`data-composition-id="${compId}"`)) {
        return path;
      }
    }
  }

  // Strategy 3: Search by class from the selector
  const classMatch = selector.match(/^\.([a-zA-Z0-9_-]+)/);
  if (classMatch) {
    const cls = classMatch[1];
    for (const [path, content] of Object.entries(files)) {
      if (
        content.includes(`class="${cls}"`) ||
        content.includes(`class="${cls} `) ||
        content.includes(` ${cls}"`)
      ) {
        return path;
      }
    }
  }

  // Fallback: index.html
  if ("index.html" in files) return "index.html";
  return null;
}

/**
 * Apply a style property change to an element's inline style in the HTML source.
 */
function patchInlineStyle(
  html: string,
  elementId: string,
  prop: string,
  value: string | null,
): string {
  // Find the element tag with this id
  const idPattern = new RegExp(`(<[^>]*\\bid=(["'])${escapeRegex(elementId)}\\2[^>]*)>`, "i");
  const match = idPattern.exec(html);
  if (!match) return html;

  const tag = match[1];
  return patchInlineStyleInTag(html, tag, prop, value);
}

function patchInlineStyleInTag(
  html: string,
  tag: string,
  prop: string,
  value: string | null,
): string {
  if (!tag) return html;

  // Check if there's an existing style attribute
  const styleMatch = /\bstyle=(["'])([\s\S]*?)\1/.exec(tag);
  if (styleMatch) {
    const existingStyle = styleMatch[2];
    const quote = styleMatch[1];
    // Parse existing properties
    const props = new Map<string, string>();
    for (const part of splitInlineStyleDeclarations(existingStyle)) {
      const colon = part.indexOf(":");
      if (colon < 0) continue;
      const key = part.slice(0, colon).trim();
      const val = part.slice(colon + 1).trim();
      if (key) props.set(key, val);
    }
    // Update/add or remove the property
    if (value === null) {
      props.delete(prop);
    } else {
      props.set(prop, value);
    }
    // Rebuild style string; keep style="" if empty (harmless)
    const newStyle = Array.from(props.entries())
      .map(([k, v]) => `${k}: ${escapeStyleAttributeValue(v, quote)}`)
      .join("; ");
    const newTag = tag.replace(styleMatch[0], `style=${quote}${newStyle}${quote}`);
    return html.replace(tag, newTag);
  } else {
    // No existing style attribute
    if (value === null) return html; // nothing to remove
    const selfClosing = /\s*\/$/.test(tag);
    const base = selfClosing ? tag.replace(/\s*\/$/, "") : tag;
    const newTag = `${base} style="${prop}: ${escapeStyleAttributeValue(value, '"')}"${selfClosing ? " /" : ""}`;
    return html.replace(tag, newTag);
  }
}

function patchInlineStyleByTarget(
  html: string,
  target: PatchTarget,
  prop: string,
  value: string | null,
): string {
  const match = findTagByTarget(html, target);
  if (!match) return html;
  const newTag = patchInlineStyleInTag(match.tag, match.tag, prop, value);
  return replaceTagAtMatch(html, match, newTag);
}

interface TagMatch {
  tag: string;
  start: number;
  end: number;
}

function replaceTagAtMatch(html: string, match: TagMatch, newTag: string): string {
  return `${html.slice(0, match.start)}${newTag}${html.slice(match.end)}`;
}

function execDataAttrPattern(html: string, attr: string, value: string): TagMatch | null {
  const pattern = new RegExp(`(<[^>]*\\b${attr}=(["'])${escapeRegex(value)}\\2[^>]*)>`, "i");
  const match = pattern.exec(html);
  if (match?.index == null) return null;
  return { tag: match[1], start: match.index, end: match.index + match[1].length };
}

function findTagByClass(html: string, target: PatchTarget): TagMatch | null {
  const classMatch = target.selector?.match(/^\.([a-zA-Z0-9_-]+)$/);
  if (!classMatch) return null;
  const cls = classMatch[1];
  const pattern = new RegExp(
    `(<[^>]*\\bclass=(["'])[^"']*\\b${escapeRegex(cls)}\\b[^"']*\\2[^>]*)>`,
    "gi",
  );
  const selectorIndex = target.selectorIndex ?? 0;
  let match: RegExpExecArray | null;
  let currentIndex = 0;
  while ((match = pattern.exec(html)) !== null) {
    if (currentIndex === selectorIndex && match.index != null) {
      return {
        tag: match[1],
        start: match.index,
        end: match.index + match[1].length,
      };
    }
    currentIndex += 1;
  }
  return null;
}

export function findTagByTarget(html: string, target: PatchTarget): TagMatch | null {
  if (target.hfId) {
    const result = execDataAttrPattern(html, "data-hf-id", target.hfId);
    if (result) return result;
  }

  if (target.id) {
    const result = execDataAttrPattern(html, "id", target.id);
    if (result) return result;
  }

  if (!target.selector) return null;

  const compositionIdMatch = target.selector.match(/^\[data-composition-id="([^"]+)"\]$/);
  if (compositionIdMatch) {
    const result = execDataAttrPattern(html, "data-composition-id", compositionIdMatch[1]);
    if (result) return result;
  }

  return findTagByClass(html, target);
}

export function readAttributeByTarget(
  html: string,
  target: PatchTarget,
  attr: string,
): string | undefined {
  const match = findTagByTarget(html, target);
  if (!match) return undefined;

  const fullAttr = attr.startsWith("data-") ? attr : `data-${attr}`;
  const valueMatch = new RegExp(`\\b${fullAttr}=(["'])([^"']*)\\1`).exec(match.tag);
  return valueMatch?.[2] != null ? unescapeHtmlAttribute(valueMatch[2]) : undefined;
}

export function readTagSnippetByTarget(html: string, target: PatchTarget): string | undefined {
  const match = findTagByTarget(html, target);
  return match?.tag;
}

function patchAttributeByTarget(
  html: string,
  target: PatchTarget,
  attr: string,
  value: string | null,
): string {
  const match = findTagByTarget(html, target);
  if (!match) return html;

  const fullAttr = attr.startsWith("data-") ? attr : `data-${attr}`;
  const attrPattern = new RegExp(`\\b${escapeRegex(fullAttr)}=(["'])([^"']*)\\1`);
  const tag = match.tag;

  if (value === null) {
    // Remove the attribute if present
    if (!attrPattern.test(tag)) return html;
    const removePattern = new RegExp(`\\s+${escapeRegex(fullAttr)}=(["'])[^"']*\\1`);
    const newTag = tag.replace(removePattern, "");
    return replaceTagAtMatch(html, match, newTag);
  }

  const escaped = escapeHtmlAttribute(value);
  if (attrPattern.test(tag)) {
    const newTag = tag.replace(attrPattern, `${fullAttr}="${escaped}"`);
    return replaceTagAtMatch(html, match, newTag);
  }

  const newTag = tag + ` ${fullAttr}="${escaped}"`;
  return replaceTagAtMatch(html, match, newTag);
}

/**
 * Apply an attribute change to an element in the HTML source.
 */
function patchAttribute(
  html: string,
  elementId: string,
  attr: string,
  value: string | null,
): string {
  const idPattern = new RegExp(`(<[^>]*\\bid=(["'])${escapeRegex(elementId)}\\2[^>]*)>`, "i");
  const match = idPattern.exec(html);
  if (!match) return html;

  const tag = match[1];
  const fullAttr = attr.startsWith("data-") ? attr : `data-${attr}`;
  const attrPattern = new RegExp(`\\b${escapeRegex(fullAttr)}=(["'])([^"']*)\\1`);

  if (value === null) {
    if (!attrPattern.test(tag)) return html;
    const removePattern = new RegExp(`\\s+${escapeRegex(fullAttr)}=(["'])[^"']*\\1`);
    const newTag = tag.replace(removePattern, "");
    return html.replace(tag, newTag);
  }

  const escaped = escapeHtmlAttribute(value);
  if (attrPattern.test(tag)) {
    // Update existing attribute
    const newTag = tag.replace(attrPattern, `${fullAttr}="${escaped}"`);
    return html.replace(tag, newTag);
  } else {
    // Add new attribute
    const newTag = tag + ` ${fullAttr}="${escaped}"`;
    return html.replace(tag, newTag);
  }
}

/**
 * Apply a text content change to an element.
 */
function patchTextContent(html: string, elementId: string, value: string): string {
  const openTagPattern = new RegExp(
    `(<([a-z0-9-]+)[^>]*\\bid=(["'])${escapeRegex(elementId)}\\3[^>]*>)`,
    "i",
  );
  const match = openTagPattern.exec(html);
  if (!match || match.index == null) return html;

  const openingTag = match[1];
  const tagName = match[2];
  const contentStart = match.index + openingTag.length;
  const closingIndex = findMatchingClosingTagIndex(html, tagName, contentStart);
  if (closingIndex < 0) return html;

  return `${html.slice(0, contentStart)}${value}${html.slice(closingIndex)}`;
}

function findMatchingClosingTagIndex(html: string, tagName: string, contentStart: number): number {
  const tagPattern = new RegExp(`</?${escapeRegex(tagName)}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = contentStart;
  let depth = 1;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(html)) !== null) {
    const tag = match[0];
    if (tag.startsWith("</")) {
      depth -= 1;
      if (depth === 0) return match.index;
      continue;
    }
    if (!tag.endsWith("/>")) depth += 1;
  }

  return -1;
}

const HTML_BOOLEAN_ATTRIBUTES = new Set([
  "loop",
  "muted",
  "autoplay",
  "playsinline",
  "controls",
  "default",
  "defer",
  "disabled",
  "hidden",
  "nomodule",
  "open",
  "readonly",
  "required",
  "reversed",
  "selected",
]);

function patchHtmlAttributeInTag(
  html: string,
  tag: string,
  attr: string,
  value: string | null,
): string {
  if (!tag) return html;

  const isBoolean = HTML_BOOLEAN_ATTRIBUTES.has(attr);

  if (isBoolean) {
    const escapedAttr = escapeRegex(attr);
    const hasBoolAttr = new RegExp(`(?:^|\\s)${escapedAttr}(?:\\s|=|$)`).test(tag);

    if (value === null || value === "" || value === "false") {
      if (!hasBoolAttr) return html;
      const removePattern = new RegExp(`\\s+${escapedAttr}(?:=(["'])[^"']*\\1)?`);
      const newTag = tag.replace(removePattern, "");
      return html.replace(tag, newTag);
    }
    if (hasBoolAttr) return html;
    const newTag = tag + ` ${attr}`;
    return html.replace(tag, newTag);
  }

  const attrPattern = new RegExp(`\\b${escapeRegex(attr)}=(["'])([^"']*)\\1`);
  if (value === null) {
    if (!attrPattern.test(tag)) return html;
    const removePattern = new RegExp(`\\s+${escapeRegex(attr)}=(["'])[^"']*\\1`);
    const newTag = tag.replace(removePattern, "");
    return html.replace(tag, newTag);
  }

  const escaped = escapeHtmlAttribute(value);
  if (attrPattern.test(tag)) {
    const newTag = tag.replace(attrPattern, `${attr}="${escaped}"`);
    return html.replace(tag, newTag);
  }

  const newTag = tag + ` ${attr}="${escaped}"`;
  return html.replace(tag, newTag);
}

function patchHtmlAttribute(
  html: string,
  elementId: string,
  attr: string,
  value: string | null,
): string {
  const idPattern = new RegExp(`(<[^>]*\\bid=(["'])${escapeRegex(elementId)}\\2[^>]*)>`, "i");
  const match = idPattern.exec(html);
  if (!match) return html;
  return patchHtmlAttributeInTag(html, match[1], attr, value);
}

function patchHtmlAttributeByTarget(
  html: string,
  target: PatchTarget,
  attr: string,
  value: string | null,
): string {
  const match = findTagByTarget(html, target);
  if (!match) return html;
  const newTag = patchHtmlAttributeInTag(match.tag, match.tag, attr, value);
  return replaceTagAtMatch(html, match, newTag);
}

function patchTextContentByTarget(html: string, target: PatchTarget, value: string): string {
  const match = findTagByTarget(html, target);
  if (!match) return html;

  const tagNameMatch = /^<([a-z0-9-]+)/i.exec(match.tag);
  const tagName = tagNameMatch?.[1];
  if (!tagName) return html;

  const closingIndex = findMatchingClosingTagIndex(html, tagName, match.end + 1);
  if (closingIndex < 0) return html;

  return `${html.slice(0, match.end + 1)}${value}${html.slice(closingIndex)}`;
}

/**
 * Apply a patch operation to an HTML source file.
 */
export function applyPatch(html: string, elementId: string, op: PatchOperation): string {
  switch (op.type) {
    case "inline-style":
      return patchInlineStyle(html, elementId, op.property, op.value);
    case "attribute":
      return patchAttribute(html, elementId, op.property, op.value);
    case "html-attribute":
      return patchHtmlAttribute(html, elementId, op.property, op.value);
    case "text-content":
      return op.value !== null ? patchTextContent(html, elementId, op.value) : html;
    default:
      return html;
  }
}

export function applyPatchByTarget(html: string, target: PatchTarget, op: PatchOperation): string {
  if (target.id) {
    const patchedById = applyPatch(html, target.id, op);
    if (patchedById !== html || !target.selector) {
      return patchedById;
    }
  }

  switch (op.type) {
    case "inline-style":
      return patchInlineStyleByTarget(html, target, op.property, op.value);
    case "attribute":
      return patchAttributeByTarget(html, target, op.property, op.value);
    case "html-attribute":
      return patchHtmlAttributeByTarget(html, target, op.property, op.value);
    case "text-content":
      return op.value !== null ? patchTextContentByTarget(html, target, op.value) : html;
    default:
      return html;
  }
}
