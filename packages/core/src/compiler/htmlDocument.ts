import { parseHTML } from "linkedom";

export const RUNTIME_BOOTSTRAP_ATTR = "data-hyperframes-preview-runtime";

const RUNTIME_SRC_MARKERS = [
  "hyperframe.runtime.iife.js",
  "hyperframes-runtime.modular.inline.js",
  "hyperframe-runtime.modular-runtime.inline.js",
  RUNTIME_BOOTSTRAP_ATTR,
];

const RUNTIME_INLINE_MARKERS = [
  "__hyperframeRuntimeBootstrapped",
  "__hyperframeRuntime",
  "__hyperframeRuntimeTeardown",
  "__HF_EXPORT_RENDER_SEEK_CONFIG",
  "window.__player =",
];

const SIMPLE_RUNTIME_FLAG_ASSIGNMENTS = [
  /^window\.__playerReady\s*=\s*(?:true|false)\s*;?$/,
  /^window\.__renderReady\s*=\s*(?:true|false)\s*;?$/,
];

const LEADING_COMMENTS = /^(?:\s|<!--(?:>|->|[\s\S]*?-->))*/;

export function isFullHtmlDocument(html: string): boolean {
  return /^(?:<!doctype[\s>]|<html[\s>])/i.test(html.replace(LEADING_COMMENTS, ""));
}

/**
 * Parse a full HTML document or wrap a fragment so linkedom consistently puts
 * fragment content under document.body.
 */
export function parseHTMLContent(html: string): Document {
  if (isFullHtmlDocument(html)) {
    return parseHTML(html).document;
  }
  return parseHTML(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`).document;
}

/** Lowercases A-Z only, so indexes found in the result are valid in the input ("İ" lowercases to two chars). */
function lowerAscii(text: string): string {
  return text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

export function stripEmbeddedRuntimeScripts(html: string): string {
  if (!html) return html;
  const loweredHtml = lowerAscii(html);
  let output = "";
  let cursor = 0;

  while (cursor < html.length) {
    const scriptStart = findScriptStart(loweredHtml, cursor);
    if (scriptStart === -1) {
      output += html.slice(cursor);
      break;
    }

    output += html.slice(cursor, scriptStart);
    const startTagEnd = findTagEnd(html, scriptStart + 1);
    if (startTagEnd === -1) {
      output += html.slice(scriptStart);
      break;
    }

    const closeTagEnd = findScriptCloseTagEnd(loweredHtml, startTagEnd + 1);
    const scriptEnd = closeTagEnd === -1 ? html.length : closeTagEnd;
    const block = html.slice(scriptStart, scriptEnd);
    if (!shouldStripRuntimeScriptBlock(block)) {
      output += block;
    }
    cursor = scriptEnd;
  }

  return output;
}

function findScriptStart(loweredHtml: string, from: number): number {
  let index = loweredHtml.indexOf("<script", from);
  while (index !== -1) {
    const next = loweredHtml[index + "<script".length] ?? "";
    if (isTagBoundary(next)) return index;
    index = loweredHtml.indexOf("<script", index + 1);
  }
  return -1;
}

type TagState = "tagName" | "between" | "name" | "equals" | "value";

function findTagEnd(html: string, from: number): number {
  let quote: string | undefined;
  let state: TagState = "tagName";
  for (let index = from; index < html.length; index += 1) {
    const char = html.charAt(index);
    if (quote) {
      quote = char === quote ? undefined : quote;
      continue;
    }
    if (char === ">") return index;
    if (state === "equals" && (char === '"' || char === "'")) {
      quote = char;
      state = "between";
      continue;
    }
    state = nextTagState(state, char, index === from);
  }
  return -1;
}

function nextTagState(state: TagState, char: string, first: boolean): TagState {
  if (isHtmlWhitespace(char)) return stateAfterWhitespace(state);
  if (char === "/" && !first) return stateAfterSlash(state);
  if (char === "=" && state === "name") return "equals";
  if (state === "equals") return "value";
  return state === "between" ? "name" : state;
}

function stateAfterWhitespace(state: TagState): TagState {
  return state === "tagName" || state === "value" ? "between" : state;
}

function stateAfterSlash(state: TagState): TagState {
  return state === "equals" || state === "value" ? "value" : "between";
}

function findScriptCloseTagEnd(loweredHtml: string, from: number): number {
  let index = loweredHtml.indexOf("</script", from);
  while (index !== -1) {
    const closeTagEnd = findScriptCloseTagBoundary(loweredHtml, index + "</script".length);
    if (closeTagEnd !== -1) return closeTagEnd;
    index = loweredHtml.indexOf("</script", index + 1);
  }
  return -1;
}

function findScriptCloseTagBoundary(loweredHtml: string, from: number): number {
  let cursor = from;
  while (cursor < loweredHtml.length && isHtmlWhitespace(loweredHtml[cursor] ?? "")) {
    cursor += 1;
  }
  return loweredHtml[cursor] === ">" ? cursor + 1 : -1;
}

function shouldStripRuntimeScriptBlock(block: string): boolean {
  const lowered = block.toLowerCase();
  for (const marker of RUNTIME_SRC_MARKERS) {
    if (lowered.includes(marker.toLowerCase())) return true;
  }
  for (const marker of RUNTIME_INLINE_MARKERS) {
    if (block.includes(marker)) return true;
  }
  const scriptSource = getScriptSource(block).trim();
  for (const pattern of SIMPLE_RUNTIME_FLAG_ASSIGNMENTS) {
    if (pattern.test(scriptSource)) return true;
  }
  return false;
}

function getScriptSource(block: string): string {
  const startTagEnd = findTagEnd(block, 1);
  if (startTagEnd === -1) return "";
  const loweredBlock = lowerAscii(block);
  const closeTagStart = loweredBlock.lastIndexOf("</script");
  const end = closeTagStart === -1 ? block.length : closeTagStart;
  return block.slice(startTagEnd + 1, end);
}

function isTagBoundary(char: string): boolean {
  return char === "" || char === ">" || char === "/" || isHtmlWhitespace(char);
}

function isHtmlWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\t" || char === "\r" || char === "\f";
}

function escapeInlineScriptSource(source: string): string {
  return escapeCaseInsensitiveToken(
    escapeCaseInsensitiveToken(source, "</script", "<\\/script"),
    "<!--",
    "<\\!--",
  );
}

function escapeCaseInsensitiveToken(source: string, token: string, replacement: string): string {
  const loweredSource = lowerAscii(source);
  const loweredToken = lowerAscii(token);
  let output = "";
  let cursor = 0;

  while (cursor < source.length) {
    const tokenStart = loweredSource.indexOf(loweredToken, cursor);
    if (tokenStart === -1) {
      output += source.slice(cursor);
      break;
    }
    output += source.slice(cursor, tokenStart) + replacement;
    cursor = tokenStart + token.length;
  }

  return output;
}

function inlineScriptTags(scripts: readonly string[]): string {
  return scripts.map((source) => `<script>${escapeInlineScriptSource(source)}</script>`).join("\n");
}

const RAW_TEXT_TAGS = ["script", "style", "title", "textarea"] as const;

type DocumentTag = "<head" | "</head" | "<body" | "</body";
const COMMENT_END = /--!?>/g;

function findDocumentTag(html: string, tag: DocumentTag): number {
  const lowered = lowerAscii(html);
  const unclosedRawText = new Set<string>();
  let cursor = 0;
  while (cursor !== -1) {
    const open = lowered.indexOf("<", cursor);
    if (open === -1) return -1;
    if (isTagAt(lowered, open, tag)) return open;
    cursor = skipMarkup(lowered, open, unclosedRawText);
  }
  return -1;
}

function isTagAt(lowered: string, at: number, token: string): boolean {
  return lowered.startsWith(token, at) && isTagBoundary(lowered.charAt(at + token.length));
}

/** Cursor just past the markup that starts at `open`, or -1 when the document ends inside it. */
function skipMarkup(lowered: string, open: number, unclosedRawText: Set<string>): number {
  if (lowered.startsWith("<!--", open)) return skipComment(lowered, open);
  const next = lowered.charAt(open + 1);
  if (next === "/" && !/[a-z]/.test(lowered.charAt(open + 2))) {
    const bogusEnd = lowered.indexOf(">", open);
    return bogusEnd === -1 ? -1 : bogusEnd + 1;
  }
  if (!/[a-z/]/.test(next)) return open + 1;
  const tagEnd = findTagEnd(lowered, open + 1);
  return tagEnd === -1 ? -1 : skipRawText(lowered, open, tagEnd, unclosedRawText);
}

function skipComment(lowered: string, open: number): number {
  if (lowered.startsWith("<!-->", open) || lowered.startsWith("<!--->", open)) {
    return lowered.indexOf(">", open) + 1;
  }
  COMMENT_END.lastIndex = open + 4;
  const end = COMMENT_END.exec(lowered);
  return end ? end.index + end[0].length : -1;
}

function skipRawText(
  lowered: string,
  open: number,
  tagEnd: number,
  unclosedRawText: Set<string>,
): number {
  const rawText = RAW_TEXT_TAGS.find((name) => isTagAt(lowered, open, `<${name}`));
  if (!rawText) return tagEnd + 1;
  const close = unclosedRawText.has(rawText) ? -1 : findRawTextClose(lowered, rawText, tagEnd + 1);
  if (close !== -1) return close;
  unclosedRawText.add(rawText);
  return lowered.charAt(tagEnd - 1) === "/" ? tagEnd + 1 : -1;
}

function findRawTextClose(lowered: string, name: string, from: number): number {
  const close = `</${name}`;
  for (let at = lowered.indexOf(close, from); at !== -1; at = lowered.indexOf(close, at + 1)) {
    if (isTagAt(lowered, at, close)) return at;
  }
  return -1;
}

function insertBeforeDocumentTag(html: string, tag: DocumentTag, markup: string): string | null {
  const at = findDocumentTag(html, tag);
  return at === -1 ? null : html.slice(0, at) + markup + html.slice(at);
}

/** Insert markup just before the document's own `</head>` or `</body>`; null when it has none. */
export function insertBeforeCloseTag(
  html: string,
  name: "head" | "body",
  markup: string,
): string | null {
  return insertBeforeDocumentTag(html, `</${name}`, markup);
}

/**
 * Insert raw tag markup at the very start of `<head>`, ahead of every author
 * script (inline or external). Falls back to just before `<body>`, then to the
 * top of the document, for fragments that carry neither.
 */
export function injectTagsAtHeadStart(html: string, tags: string): string {
  const headOpen = findDocumentTag(html, "<head");
  const headOpenEnd = headOpen === -1 ? -1 : findTagEnd(html, headOpen + 1);
  if (headOpenEnd !== -1) {
    return `${html.slice(0, headOpenEnd + 1)}\n${tags}${html.slice(headOpenEnd + 1)}`;
  }
  return insertBeforeDocumentTag(html, "<body", `${tags}\n`) ?? `${tags}\n${html}`;
}

export function injectScriptsAtHeadStart(html: string, scripts: readonly string[]): string {
  if (scripts.length === 0) return html;
  return injectTagsAtHeadStart(html, inlineScriptTags(scripts));
}

export function injectScriptsIntoHtml(
  html: string,
  headScripts: readonly string[],
  bodyScripts: readonly string[],
  stripEmbeddedRuntime = true,
): string {
  if (stripEmbeddedRuntime) {
    html = stripEmbeddedRuntimeScripts(html);
  }

  if (headScripts.length > 0) {
    const headTags = inlineScriptTags(headScripts);
    const withHead = insertBeforeCloseTag(html, "head", `${headTags}\n`);
    html =
      withHead ?? insertBeforeDocumentTag(html, "<body", `${headTags}\n`) ?? `${headTags}\n${html}`;
  }

  if (bodyScripts.length > 0) {
    const bodyTags = inlineScriptTags(bodyScripts);
    html = insertBeforeCloseTag(html, "body", `${bodyTags}\n`) ?? `${html}\n${bodyTags}`;
  }

  return html;
}
