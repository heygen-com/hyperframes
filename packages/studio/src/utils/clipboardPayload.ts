import { COMPOSITION_ROOT_OPEN_TAG_RE } from "./compositionPatterns";

const CLIPBOARD_MARKER = "hyperframes-clipboard:v1";

export interface ClipboardPayload {
  kind: "timeline-clip" | "dom-element";
  html: string;
  sourceFile: string;
  originSelector?: string;
  originSelectorIndex?: number;
}

interface SerializedPayload {
  _marker: string;
  kind: "timeline-clip" | "dom-element";
  html: string;
  sourceFile: string;
  originSelector?: string;
  originSelectorIndex?: number;
}

export function serializeClipboardPayload(payload: ClipboardPayload): string {
  const data: SerializedPayload = {
    _marker: CLIPBOARD_MARKER,
    kind: payload.kind,
    html: payload.html,
    sourceFile: payload.sourceFile,
    originSelector: payload.originSelector,
    originSelectorIndex: payload.originSelectorIndex,
  };
  return JSON.stringify(data);
}

export function deserializeClipboardPayload(json: string): ClipboardPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (obj._marker !== CLIPBOARD_MARKER) return null;
  if (obj.kind !== "timeline-clip" && obj.kind !== "dom-element") return null;
  if (typeof obj.html !== "string" || typeof obj.sourceFile !== "string") return null;
  return {
    kind: obj.kind,
    html: obj.html,
    sourceFile: obj.sourceFile,
    originSelector: typeof obj.originSelector === "string" ? obj.originSelector : undefined,
    originSelectorIndex:
      typeof obj.originSelectorIndex === "number" ? obj.originSelectorIndex : undefined,
  };
}

/**
 * Insert `newHtml` as a sibling immediately after the element matched by
 * `selector` (at `selectorIndex`) in `source`. Falls back to inserting after
 * the composition root if the selector doesn't match — so paste never silently
 * drops the content.
 */
export function insertAsSibling(
  source: string,
  newHtml: string,
  selector: string | undefined,
  selectorIndex: number | undefined,
): string {
  if (selector) {
    const idx = selectorIndex ?? 0;
    let matchCount = 0;

    // Find the element by searching for its opening tag pattern.
    // For id selectors like #foo, search for id="foo".
    // For class selectors like .name-text, search for class="...name-text...".
    // For attribute selectors like [data-composition-id="x"], search literally.

    let searchPattern: RegExp | null = null;
    if (selector.startsWith("#")) {
      const id = selector.slice(1);
      searchPattern = new RegExp(`<[a-z][^>]*\\bid="${id}"[^>]*>`, "gi");
    } else if (selector.startsWith(".")) {
      const cls = selector.slice(1);
      searchPattern = new RegExp(`<[a-z][^>]*\\bclass="[^"]*\\b${cls}\\b[^"]*"[^>]*>`, "gi");
    } else if (selector.startsWith("[")) {
      const inner = selector.slice(1, -1);
      searchPattern = new RegExp(`<[a-z][^>]*\\b${inner}[^>]*>`, "gi");
    }

    if (searchPattern) {
      let match: RegExpExecArray | null;
      while ((match = searchPattern.exec(source)) !== null) {
        if (matchCount === idx) {
          const insertPos = findClosingTagPosition(source, match.index);
          if (insertPos > 0) {
            return source.slice(0, insertPos) + "\n" + newHtml + source.slice(insertPos);
          }
        }
        matchCount++;
      }
    }
  }

  // Fallback: insert after composition root opening tag (same as timeline clips)
  const rootMatch = COMPOSITION_ROOT_OPEN_TAG_RE.exec(source);
  if (rootMatch && rootMatch.index != null) {
    const insertAt = rootMatch.index + rootMatch[0].length;
    return source.slice(0, insertAt) + newHtml + source.slice(insertAt);
  }

  return source + newHtml;
}

function findClosingTagPosition(html: string, openTagStart: number): number {
  // Find the end of the opening tag
  const openTagEnd = html.indexOf(">", openTagStart);
  if (openTagEnd < 0) return -1;

  // Self-closing tag?
  if (html[openTagEnd - 1] === "/") return openTagEnd + 1;

  // Extract the tag name
  const tagNameMatch = html.slice(openTagStart).match(/^<([a-z][a-z0-9]*)/i);
  if (!tagNameMatch) return -1;
  const tagName = tagNameMatch[1]!;

  // Walk forward counting open/close tags of the same name
  let depth = 1;
  let pos = openTagEnd + 1;
  const openRe = new RegExp(`<${tagName}(?:\\s|>|/>)`, "gi");
  const closeRe = new RegExp(`</${tagName}\\s*>`, "gi");

  while (depth > 0 && pos < html.length) {
    openRe.lastIndex = pos;
    closeRe.lastIndex = pos;

    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);

    if (!nextClose) return -1;

    if (nextOpen && nextOpen.index < nextClose.index) {
      // Check if it's self-closing
      const selfCloseCheck = html.lastIndexOf("/", html.indexOf(">", nextOpen.index));
      if (selfCloseCheck > nextOpen.index) {
        pos = html.indexOf(">", nextOpen.index) + 1;
      } else {
        depth++;
        pos = html.indexOf(">", nextOpen.index) + 1;
      }
    } else {
      depth--;
      if (depth === 0) return nextClose.index + nextClose[0].length;
      pos = nextClose.index + nextClose[0].length;
    }
  }
  return -1;
}

export function deduplicateIds(html: string, existingIds: string[]): string {
  const existingSet = new Set(existingIds);
  return html.replace(/(?<=\s)id="([^"]+)"/g, (full, id: string) => {
    if (!existingSet.has(id)) return full;
    let counter = 2;
    while (existingSet.has(`${id}-${counter}`)) counter++;
    const newId = `${id}-${counter}`;
    existingSet.add(newId);
    return `id="${newId}"`;
  });
}
