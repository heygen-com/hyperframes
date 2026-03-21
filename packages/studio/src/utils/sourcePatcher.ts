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
      if (content.includes(`class="${cls}"`) || content.includes(`class="${cls} `) || content.includes(` ${cls}"`)) {
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
