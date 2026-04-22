/**
 * Source Patcher — Maps visual property edits back to source HTML files.
 * Handles inline style updates, attribute changes, and text content.
 */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface PatchOperation {
  type: "inline-style" | "attribute" | "text-content";
  property: string;
  value: string;
}

export interface PatchTarget {
  id?: string | null;
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
function patchInlineStyle(html: string, elementId: string, prop: string, value: string): string {
  // Find the element tag with this id
  const idPattern = new RegExp(`(<[^>]*\\bid="${escapeRegex(elementId)}"[^>]*)>`, "i");
  const match = idPattern.exec(html);
  if (!match) return html;

  const tag = match[1];
  return patchInlineStyleInTag(html, tag, prop, value);
}

function patchInlineStyleInTag(html: string, tag: string, prop: string, value: string): string {
  if (!tag) return html;

  // Check if there's an existing style attribute
  const styleMatch = /\bstyle="([^"]*)"/.exec(tag);
  if (styleMatch) {
    const existingStyle = styleMatch[1];
    // Parse existing properties
    const props = new Map<string, string>();
    for (const part of existingStyle.split(";")) {
      const colon = part.indexOf(":");
      if (colon < 0) continue;
      const key = part.slice(0, colon).trim();
      const val = part.slice(colon + 1).trim();
      if (key) props.set(key, val);
    }
    // Update/add the property
    props.set(prop, value);
    // Rebuild style string
    const newStyle = Array.from(props.entries())
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
    const newTag = tag.replace(/\bstyle="[^"]*"/, `style="${newStyle}"`);
    return html.replace(tag, newTag);
  } else {
    // No existing style — add one
    const newTag = tag.replace(/>$/, "") + ` style="${prop}: ${value}"`;
    return html.replace(tag, newTag);
  }
}

function patchInlineStyleByTarget(
  html: string,
  target: PatchTarget,
  prop: string,
  value: string,
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

function findTagByTarget(html: string, target: PatchTarget): TagMatch | null {
  if (target.id) {
    const idPattern = new RegExp(`(<[^>]*\\bid="${escapeRegex(target.id)}"[^>]*)>`, "i");
    const match = idPattern.exec(html);
    if (match?.index != null) {
      return {
        tag: match[1],
        start: match.index,
        end: match.index + match[1].length,
      };
    }
  }

  if (!target.selector) return null;

  const compositionIdMatch = target.selector.match(/^\[data-composition-id="([^"]+)"\]$/);
  if (compositionIdMatch) {
    const compId = compositionIdMatch[1];
    const pattern = new RegExp(
      `(<[^>]*\\bdata-composition-id="${escapeRegex(compId)}"[^>]*)>`,
      "i",
    );
    const match = pattern.exec(html);
    if (match?.index != null) {
      return {
        tag: match[1],
        start: match.index,
        end: match.index + match[1].length,
      };
    }
  }

  const classMatch = target.selector.match(/^\.([a-zA-Z0-9_-]+)$/);
  if (classMatch) {
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
  }

  return null;
}

export function readAttributeByTarget(
  html: string,
  target: PatchTarget,
  attr: string,
): string | undefined {
  const match = findTagByTarget(html, target);
  if (!match) return undefined;

  const fullAttr = attr.startsWith("data-") ? attr : `data-${attr}`;
  const valueMatch = new RegExp(`\\b${fullAttr}="([^"]*)"`).exec(match.tag);
  return valueMatch?.[1];
}

function patchAttributeByTarget(
  html: string,
  target: PatchTarget,
  attr: string,
  value: string,
): string {
  const match = findTagByTarget(html, target);
  if (!match) return html;

  const fullAttr = attr.startsWith("data-") ? attr : `data-${attr}`;
  const attrPattern = new RegExp(`\\b${fullAttr}="[^"]*"`);
  const tag = match.tag;

  if (attrPattern.test(tag)) {
    const newTag = tag.replace(attrPattern, `${fullAttr}="${value}"`);
    return replaceTagAtMatch(html, match, newTag);
  }

  const newTag = tag + ` ${fullAttr}="${value}"`;
  return replaceTagAtMatch(html, match, newTag);
}

/**
 * Apply an attribute change to an element in the HTML source.
 */
function patchAttribute(html: string, elementId: string, attr: string, value: string): string {
  const idPattern = new RegExp(`(<[^>]*\\bid="${escapeRegex(elementId)}"[^>]*)>`, "i");
  const match = idPattern.exec(html);
  if (!match) return html;

  const tag = match[1];
  const fullAttr = attr.startsWith("data-") ? attr : `data-${attr}`;
  const attrPattern = new RegExp(`\\b${fullAttr}="[^"]*"`);

  if (attrPattern.test(tag)) {
    // Update existing attribute
    const newTag = tag.replace(attrPattern, `${fullAttr}="${value}"`);
    return html.replace(tag, newTag);
  } else {
    // Add new attribute
    const newTag = tag + ` ${fullAttr}="${value}"`;
    return html.replace(tag, newTag);
  }
}

/**
 * Apply a text content change to an element.
 */
function patchTextContent(html: string, elementId: string, value: string): string {
  // Match the element and its content: <tagname id="elementId"...>content</tagname>
  const pattern = new RegExp(`(<[^>]*\\bid="${elementId}"[^>]*>)([\\s\\S]*?)(<\\/[a-z]+>)`, "i");
  const match = pattern.exec(html);
  if (!match) return html;
  return html.replace(pattern, `${match[1]}${value}${match[3]}`);
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
    case "text-content":
      return patchTextContent(html, elementId, op.value);
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
    default:
      return html;
  }
}
