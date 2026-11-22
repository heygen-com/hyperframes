import { acceleratedCanvasTrackerSource } from "../pageMotionBlur.js";
import { findSceneTemplate, templateContent } from "@hyperframes/parsers/sub-composition-validity";
import { parseHTML } from "linkedom";
import {
  escapeInlineScriptSource,
  indexOfLower,
  lowerAscii,
  startsWithLower,
} from "./htmlTokens.js";
export { escapeInlineScriptSource };

export const RUNTIME_BOOTSTRAP_ATTR = "data-hyperframes-preview-runtime";

const RUNTIME_FILES = [
  "hyperframe.runtime.iife.js",
  "hyperframes-runtime.modular.inline.js",
  "hyperframe-runtime.modular-runtime.inline.js",
];

const SIMPLE_RUNTIME_FLAG_ASSIGNMENTS = [
  /^window\.__playerReady\s*=\s*(?:true|false)\s*;?$/,
  /^window\.__renderReady\s*=\s*(?:true|false)\s*;?$/,
];

const LEADING_COMMENTS = /^(?:\s|<!--(?:>|->|[\s\S]*?-->))*/;

export interface SceneRootLookup {
  root: Element | null;
  hasTemplate: boolean;
  hasLiveRoot: boolean;
}

export function locateSceneRoot(html: string): SceneRootLookup {
  const { document } = parseHTML(html);
  const liveRoot = document.querySelector("[data-composition-id]") as Element | null;
  const templates = Array.from(document.querySelectorAll("template"));
  const scene = findSceneTemplate(templates);
  const sceneRoot =
    (scene && templateContent(scene)?.querySelector("[data-composition-id]")) ?? null;
  return {
    root: sceneRoot,
    hasTemplate: templates.length > 0,
    hasLiveRoot: liveRoot !== null,
  };
}

export function isTemplateEntry(html: string): boolean {
  const { root, hasTemplate, hasLiveRoot } = locateSceneRoot(html);
  return hasTemplate && root !== null && !hasLiveRoot;
}

export function isFullHtmlDocument(html: string): boolean {
  return /^(?:<!doctype|<html[\s>/])/i.test(html.replace(LEADING_COMMENTS, ""));
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

function lastIndexOfLower(text: string, token: string): number {
  for (
    let at = text.lastIndexOf(token.charAt(0));
    at !== -1;
    at = at === 0 ? -1 : text.lastIndexOf(token.charAt(0), at - 1)
  ) {
    if (startsWithLower(text, token, at)) return at;
  }
  return -1;
}

export function stripEmbeddedRuntimeScripts(html: string): string {
  if (!html) return html;
  let output = "";
  let cursor = 0;

  while (cursor < html.length) {
    const scriptStart = findScriptStart(html, cursor);
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

    const closeTagEnd = findScriptCloseTagEnd(html, startTagEnd + 1);
    const scriptEnd = closeTagEnd === -1 ? html.length : closeTagEnd;
    const block = html.slice(scriptStart, scriptEnd);
    if (!shouldStripRuntimeScriptBlock(block, html.slice(scriptStart, startTagEnd + 1))) {
      output += block;
    }
    cursor = scriptEnd;
  }

  return output;
}

function findScriptStart(html: string, from: number): number {
  let index = indexOfLower(html, "<script", from);
  while (index !== -1) {
    const next = html[index + "<script".length] ?? "";
    if (isTagBoundary(next)) return index;
    index = indexOfLower(html, "<script", index + 1);
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

function findScriptCloseTagEnd(html: string, from: number): number {
  let index = indexOfLower(html, "</script", from);
  while (index !== -1) {
    const closeTagEnd = findScriptCloseTagBoundary(html, index + "</script".length);
    if (closeTagEnd !== -1) return closeTagEnd;
    index = indexOfLower(html, "</script", index + 1);
  }
  return -1;
}

function findScriptCloseTagBoundary(html: string, from: number): number {
  let cursor = from;
  while (cursor < html.length && isHtmlWhitespace(html[cursor] ?? "")) {
    cursor += 1;
  }
  return html[cursor] === ">" ? cursor + 1 : -1;
}

function shouldStripRuntimeScriptBlock(block: string, startTag: string): boolean {
  const script = parseHTML(`${startTag}</script>`).document.querySelector("script");
  if (
    script?.hasAttribute(RUNTIME_BOOTSTRAP_ATTR) ||
    isRuntimeFileUrl(script?.getAttribute("src"))
  ) {
    return true;
  }
  const scriptSource = getScriptSource(block).trim();
  return SIMPLE_RUNTIME_FLAG_ASSIGNMENTS.some((pattern) => pattern.test(scriptSource));
}

export function isRuntimeFileUrl(src: string | null | undefined): boolean {
  const path = lowerAscii(src?.split(/[?#]/, 1)[0] ?? "");
  return RUNTIME_FILES.some((file) => path === file || path.endsWith(`/${file}`));
}

function getScriptSource(block: string): string {
  const startTagEnd = findTagEnd(block, 1);
  if (startTagEnd === -1) return "";
  const closeTagStart = lastIndexOfLower(block, "</script");
  const end = closeTagStart === -1 ? block.length : closeTagStart;
  return block.slice(startTagEnd + 1, end);
}

function isTagBoundary(char: string): boolean {
  return char === "" || char === ">" || char === "/" || isHtmlWhitespace(char);
}

function isHtmlWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\t" || char === "\r" || char === "\f";
}

function inlineScriptTags(scripts: readonly string[]): string {
  return scripts
    .map((source, index) => `${source}\n//# sourceURL=hyperframes://injected/${index}`)
    .map((source) => `<script>${escapeInlineScriptSource(source)}</script>`)
    .join("\n");
}

const RAW_TEXT_TAGS = ["script", "style", "title", "textarea"] as const;

type DocumentTag = "<head" | "</head" | "<body" | "</body" | "</template";
const COMMENT_END = /--!?>/g;

function* markupStarts(html: string): Generator<number> {
  const unclosedRawText = new Set<string>();
  let cursor = 0;
  while (cursor !== -1) {
    const open = html.indexOf("<", cursor);
    if (open === -1) return;
    yield open;
    cursor = skipMarkup(html, open, unclosedRawText);
  }
}

function findDocumentTag(html: string, tag: DocumentTag): number {
  for (const open of markupStarts(html)) {
    if (isTagAt(html, open, tag)) return open;
  }
  return -1;
}

export function mapStartTagsAndStyles(
  html: string,
  map: { tag: (tag: string) => string; style: (css: string) => string },
): string {
  let out = "";
  let cursor = 0;
  for (const open of markupStarts(html)) {
    if (open < cursor || !/[a-z]/i.test(html.charAt(open + 1))) continue;
    const end = findTagEnd(html, open + 1);
    if (end === -1) break;
    out += html.slice(cursor, open) + map.tag(html.slice(open, end + 1));
    cursor = end + 1;
    if (!isTagAt(html, open, "<style")) continue;
    const close = findRawTextClose(html, "style", cursor);
    if (close === -1) continue;
    out += map.style(html.slice(cursor, close));
    cursor = close;
  }
  return out + html.slice(cursor);
}

export interface SourceTag {
  start: number;
  endAfterBracket: number;
  lowercaseName: string;
  closing: boolean;
}

export function* tagsOutsideCommentsAndRawText(html: string): Generator<SourceTag> {
  for (const open of markupStarts(html)) {
    const closing = html.charAt(open + 1) === "/";
    const nameStart = open + (closing ? 2 : 1);
    if (!/[a-z]/i.test(html.charAt(nameStart))) continue;
    const end = findTagEnd(html, nameStart);
    if (end === -1) return;
    let nameEnd = nameStart;
    while (nameEnd < end && !isTagBoundary(html.charAt(nameEnd))) nameEnd++;
    const lowercaseName = lowerAscii(html.slice(nameStart, nameEnd));
    yield { start: open, endAfterBracket: end + 1, lowercaseName, closing };
  }
}

export function findStartTags(html: string, name: string): number[] {
  const token = `<${lowerAscii(name)}`;
  const starts: number[] = [];
  let templateDepth = 0;
  for (const open of markupStarts(html)) {
    if (templateDepth === 0 && isTagAt(html, open, token)) starts.push(open);
    if (isTagAt(html, open, "<template")) templateDepth++;
    else if (templateDepth > 0 && isTagAt(html, open, "</template")) templateDepth--;
  }
  return starts;
}

function isTagAt(html: string, at: number, token: string): boolean {
  return startsWithLower(html, token, at) && isTagBoundary(html.charAt(at + token.length));
}

/** Cursor just past the markup that starts at `open`, or -1 when the document ends inside it. */
function skipMarkup(html: string, open: number, unclosedRawText: Set<string>): number {
  if (html.startsWith("<!--", open)) return skipComment(html, open);
  const next = html.charAt(open + 1);
  if (next === "/" && !/[a-z]/i.test(html.charAt(open + 2))) {
    const bogusEnd = html.indexOf(">", open);
    return bogusEnd === -1 ? -1 : bogusEnd + 1;
  }
  if (!/[a-z/]/i.test(next)) return open + 1;
  const tagEnd = findTagEnd(html, open + 1);
  return tagEnd === -1 ? -1 : skipRawText(html, open, tagEnd, unclosedRawText);
}

function skipComment(html: string, open: number): number {
  if (html.startsWith("<!-->", open) || html.startsWith("<!--->", open)) {
    return html.indexOf(">", open) + 1;
  }
  COMMENT_END.lastIndex = open + 4;
  const end = COMMENT_END.exec(html);
  return end ? end.index + end[0].length : -1;
}

function skipRawText(
  html: string,
  open: number,
  tagEnd: number,
  unclosedRawText: Set<string>,
): number {
  const rawText = RAW_TEXT_TAGS.find((name) => isTagAt(html, open, `<${name}`));
  if (!rawText) return tagEnd + 1;
  const close = unclosedRawText.has(rawText) ? -1 : findRawTextClose(html, rawText, tagEnd + 1);
  if (close !== -1) return close;
  unclosedRawText.add(rawText);
  return html.charAt(tagEnd - 1) === "/" ? tagEnd + 1 : -1;
}

function findRawTextClose(html: string, name: string, from: number): number {
  const close = `</${name}`;
  for (
    let at = indexOfLower(html, close, from);
    at !== -1;
    at = indexOfLower(html, close, at + 1)
  ) {
    if (isTagAt(html, at, close)) return at;
  }
  return -1;
}

function findOuterTemplateClose(html: string): number {
  let depth = 0;
  for (const open of markupStarts(html)) {
    if (isTagAt(html, open, "<template")) depth++;
    else if (isTagAt(html, open, "</template") && --depth === 0) return open;
  }
  return -1;
}

const COMPOSITION_ID_ATTR = /\sdata-composition-id\s*=/i;

const isDocumentWrapper = (html: string, open: number): boolean =>
  isTagAt(html, open, "<html") || isTagAt(html, open, "<body");

function carriesCompositionId(html: string, open: number): boolean {
  const end = findTagEnd(html, open + 1);
  return end !== -1 && COMPOSITION_ID_ATTR.test(html.slice(open, end));
}

export function hasCompositionOutsideTemplates(html: string): boolean {
  let depth = 0;
  let idOnWrapper = false;
  let idInTemplate = false;
  for (const open of markupStarts(html)) {
    if (isTagAt(html, open, "<template")) {
      depth++;
      if (carriesCompositionId(html, open)) idInTemplate = true;
    } else if (isTagAt(html, open, "</template")) depth = Math.max(0, depth - 1);
    else if (/[a-z]/i.test(html.charAt(open + 1)) && carriesCompositionId(html, open)) {
      if (depth > 0) idInTemplate = true;
      else if (isDocumentWrapper(html, open)) idOnWrapper = true;
      else return true;
    }
  }
  return idOnWrapper && !idInTemplate;
}

function insertBeforeDocumentTag(html: string, tag: DocumentTag, markup: string): string | null {
  const at = tag === "</template" ? findOuterTemplateClose(html) : findDocumentTag(html, tag);
  return at === -1 ? null : html.slice(0, at) + markup + html.slice(at);
}

/** Insert markup before the document's own `</head>`, `</body>` or `</template>`; null if it has none. */
export function insertBeforeCloseTag(
  html: string,
  name: "head" | "body" | "template",
  markup: string,
): string | null {
  return insertBeforeDocumentTag(html, `</${name}`, markup);
}

function insertTagInHead(html: string, tag: string): string {
  const withHead = insertBeforeCloseTag(html, "head", `${tag}\n`);
  if (withHead !== null) return withHead;
  const htmlOpenMatch = html.match(/<html\b[^>]*>/i);
  if (htmlOpenMatch?.index != null) {
    const insertPos = htmlOpenMatch.index + htmlOpenMatch[0].length;
    return `${html.slice(0, insertPos)}<head>${tag}</head>${html.slice(insertPos)}`;
  }
  const doctypeIdx = indexOfLower(html, "<!doctype", 0);
  if (doctypeIdx >= 0) {
    const insertPos = html.indexOf(">", doctypeIdx) + 1;
    return html.slice(0, insertPos) + tag + html.slice(insertPos);
  }
  return tag + html;
}

const ACCEL_TRACKER_ATTR = "data-hf-accel-tracker";
const OPTS_INTO_MOTION_BLUR = /\sdata-motion-blur\s*=\s*["']?on[\s"'>]/i;

export function insertRuntimeTag(html: string, tag: string, atHeadStart = false): string {
  const withRuntime = atHeadStart ? injectTagsAtHeadStart(html, tag) : insertTagInHead(html, tag);
  if (!OPTS_INTO_MOTION_BLUR.test(html) || html.includes(ACCEL_TRACKER_ATTR)) return withRuntime;
  const tracker = `<script ${ACCEL_TRACKER_ATTR}>${acceleratedCanvasTrackerSource()}</script>`;
  return injectTagsAtHeadStart(withRuntime, tracker);
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
