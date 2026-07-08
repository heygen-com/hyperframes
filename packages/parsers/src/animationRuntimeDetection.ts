/**
 * Static animation-runtime classification for HyperFrames composition HTML.
 *
 * `classifyAnimationRuntime(html)` parses the source with linkedom and returns
 * every inline script block with its content span in the original HTML string.
 * A block engine may be `"mixed"` when GSAP and anime.js signals appear in the
 * same script. Scripts nested under `<template>` are still returned with
 * `insideTemplate: true` for future span-level ownership, but they do not affect
 * the file-level verdict because template contents are inert until cloned.
 */
import { parseHTML } from "linkedom";

export type AnimationRuntimeEngine = "gsap" | "animejs";
export type AnimationRuntimeScriptEngine = AnimationRuntimeEngine | "mixed" | "none";
export type AnimationRuntimeVerdict = AnimationRuntimeScriptEngine;

export interface AnimationRuntimeScriptBlock {
  engine: AnimationRuntimeScriptEngine;
  start: number;
  end: number;
  insideTemplate: boolean;
}

export interface AnimationRuntimeClassification {
  verdict: AnimationRuntimeVerdict;
  blocks: AnimationRuntimeScriptBlock[];
}

interface RawScriptBlock {
  text: string;
  start: number;
  end: number;
  insideTemplate: boolean;
}

interface HtmlTag {
  name: string;
  source: string;
  end: number;
  closing: boolean;
  selfClosing: boolean;
}

const GSAP_SIGNAL_PATTERNS = [
  /\bgsap\s*\.\s*timeline\b/,
  /\bgsap\s*\.\s*(?:fromTo|from|set|to)\s*\(/,
  /\bgsap\s*\.\s*(?:config|defaults|registerPlugin)\s*\(/,
  /\bgsap\s*\.\s*version\b/,
  /\b(?:GreenSock|_gsScope)\b/,
  /\bwindow\s*\.\s*__timelines\b/,
];

const ANIME_SIGNAL_PATTERNS = [
  /\banime\s*\.\s*(?:animate|createTimeline|timeline)\s*\(/,
  /\bhyperframesAnime\s*\.\s*register\s*\(/,
  /\bwindow\s*\.\s*__hfAnime\b/,
];

export function classifyAnimationRuntime(html: string): AnimationRuntimeClassification {
  const { document } = parseHTML(html);
  if (collectInlineScriptElements(document).length === 0) {
    return { verdict: "none", blocks: [] };
  }

  const blocks = findInlineScriptBlocks(html).map((block) => ({
    engine: classifyScriptEngine(block.text),
    start: block.start,
    end: block.end,
    insideTemplate: block.insideTemplate,
  }));

  return {
    verdict: classifyFileVerdict(blocks),
    blocks,
  };
}

function collectInlineScriptElements(document: Document): Element[] {
  const scripts: Element[] = [];
  const seen = new Set<Element>();
  const add = (script: Element): void => {
    if (seen.has(script)) return;
    seen.add(script);
    scripts.push(script);
  };

  document.querySelectorAll("script:not([src])").forEach(add);
  document.querySelectorAll("template").forEach((template) => {
    template.querySelectorAll("script:not([src])").forEach(add);
  });

  return scripts;
}

function classifyFileVerdict(blocks: AnimationRuntimeScriptBlock[]): AnimationRuntimeVerdict {
  const engines = new Set<AnimationRuntimeEngine>();
  for (const block of blocks) {
    if (block.insideTemplate) continue;
    addBlockEngine(engines, block.engine);
  }

  if (engines.size === 2) return "mixed";
  if (engines.has("gsap")) return "gsap";
  if (engines.has("animejs")) return "animejs";
  return "none";
}

function addBlockEngine(
  engines: Set<AnimationRuntimeEngine>,
  engine: AnimationRuntimeScriptEngine,
): void {
  if (engine === "gsap" || engine === "mixed") engines.add("gsap");
  if (engine === "animejs" || engine === "mixed") engines.add("animejs");
}

function classifyScriptEngine(scriptText: string): AnimationRuntimeScriptEngine {
  const uncommented = stripJavaScriptComments(scriptText);
  const hasGsap = GSAP_SIGNAL_PATTERNS.some((pattern) => pattern.test(uncommented));
  const hasAnime = ANIME_SIGNAL_PATTERNS.some((pattern) => pattern.test(uncommented));

  if (hasGsap && hasAnime) return "mixed";
  if (hasGsap) return "gsap";
  if (hasAnime) return "animejs";
  return "none";
}

function nextTemplateDepth(tag: HtmlTag, depth: number): number {
  if (tag.closing) return Math.max(0, depth - 1);
  return tag.selfClosing ? depth : depth + 1;
}

function collectScriptBlock(
  html: string,
  lowerHtml: string,
  tag: HtmlTag,
  insideTemplate: boolean,
  blocks: RawScriptBlock[],
): number {
  const contentStart = tag.end + 1;
  const closeStart = findClosingScriptStart(lowerHtml, contentStart);
  const contentEnd = closeStart ?? html.length;
  if (!tagHasAttribute(tag.source, "src")) {
    blocks.push({
      text: html.slice(contentStart, contentEnd),
      start: contentStart,
      end: contentEnd,
      insideTemplate,
    });
  }
  if (closeStart === null) return html.length;
  const closeTagEnd = findTagEnd(html, closeStart);
  return closeTagEnd === -1 ? html.length : closeTagEnd + 1;
}

// fallow-ignore-next-line complexity
function findInlineScriptBlocks(html: string): RawScriptBlock[] {
  const lowerHtml = html.toLowerCase();
  const blocks: RawScriptBlock[] = [];
  let index = 0;
  let templateDepth = 0;

  while (index < html.length) {
    const tagStart = html.indexOf("<", index);
    if (tagStart === -1) break;

    if (html.startsWith("<!--", tagStart)) {
      index = afterHtmlComment(html, tagStart);
      continue;
    }

    const tag = readHtmlTag(html, tagStart);
    if (!tag) {
      index = tagStart + 1;
      continue;
    }

    if (tag.name === "template") {
      templateDepth = nextTemplateDepth(tag, templateDepth);
      index = tag.end + 1;
    } else if (tag.name === "script" && !tag.closing) {
      index = collectScriptBlock(html, lowerHtml, tag, templateDepth > 0, blocks);
    } else {
      index = tag.end + 1;
    }
  }

  return blocks;
}

function afterHtmlComment(html: string, start: number): number {
  const close = html.indexOf("-->", start + 4);
  return close === -1 ? html.length : close + 3;
}

function readHtmlTag(html: string, start: number): HtmlTag | null {
  const end = findTagEnd(html, start);
  if (end === -1) return null;

  const source = html.slice(start, end + 1);
  const nameStart = tagNameStart(source);
  if (nameStart === null) return null;

  let nameEnd = nameStart;
  while (nameEnd < source.length && isTagNameChar(source.charAt(nameEnd))) {
    nameEnd += 1;
  }
  if (nameEnd === nameStart) return null;

  return {
    name: source.slice(nameStart, nameEnd).toLowerCase(),
    source,
    end,
    closing: source.charAt(1) === "/",
    selfClosing: tagIsSelfClosing(source),
  };
}

function tagNameStart(source: string): number | null {
  let index = 1;
  if (source.charAt(index) === "/") index += 1;
  while (index < source.length && isHtmlWhitespace(source.charAt(index))) {
    index += 1;
  }
  return index < source.length ? index : null;
}

function findTagEnd(html: string, start: number): number {
  let quote = "";
  for (let index = start + 1; index < html.length; index += 1) {
    const char = html.charAt(index);
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return index;
  }
  return -1;
}

function tagIsSelfClosing(source: string): boolean {
  let index = source.length - 2;
  while (index >= 0 && isHtmlWhitespace(source.charAt(index))) {
    index -= 1;
  }
  return source.charAt(index) === "/";
}

function skipHtmlWhitespace(source: string, index: number): number {
  let next = index;
  while (next < source.length && isHtmlWhitespace(source.charAt(next))) {
    next += 1;
  }
  return next;
}

interface TagAttributeScan {
  name: string;
  nextIndex: number;
}

function readNextAttribute(source: string, startIndex: number): TagAttributeScan | null {
  let index = skipHtmlWhitespace(source, startIndex);
  if (index >= source.length - 1) return null;
  const boundary = source.charAt(index);
  if (boundary === "/" || boundary === ">") return null;

  const nameStart = index;
  while (index < source.length && isAttributeNameChar(source.charAt(index))) {
    index += 1;
  }
  if (nameStart === index) return null;

  const name = source.slice(nameStart, index).toLowerCase();
  index = skipHtmlWhitespace(source, index);
  if (source.charAt(index) !== "=") return { name, nextIndex: index };

  index = skipHtmlWhitespace(source, index + 1);
  return { name, nextIndex: skipAttributeValue(source, index) };
}

function tagHasAttribute(source: string, attrName: string): boolean {
  const initialIndex = tagNameStart(source);
  if (initialIndex === null) return false;

  let index = initialIndex;
  while (index < source.length && isTagNameChar(source.charAt(index))) {
    index += 1;
  }

  const target = attrName.toLowerCase();
  let attribute = readNextAttribute(source, index);
  while (attribute) {
    if (attribute.name === target) return true;
    attribute = readNextAttribute(source, attribute.nextIndex);
  }
  return false;
}

function skipAttributeValue(source: string, index: number): number {
  const quote = source.charAt(index);
  if (quote === '"' || quote === "'") {
    let next = index + 1;
    while (next < source.length && source.charAt(next) !== quote) {
      next += 1;
    }
    return next < source.length ? next + 1 : source.length;
  }

  let next = index;
  while (
    next < source.length &&
    !isHtmlWhitespace(source.charAt(next)) &&
    source.charAt(next) !== ">"
  ) {
    next += 1;
  }
  return next;
}

function findClosingScriptStart(lowerHtml: string, from: number): number | null {
  let searchFrom = from;
  while (searchFrom < lowerHtml.length) {
    const candidate = lowerHtml.indexOf("</script", searchFrom);
    if (candidate === -1) return null;

    const afterName = lowerHtml.charAt(candidate + "</script".length);
    if (afterName === ">" || isHtmlWhitespace(afterName)) return candidate;
    searchFrom = candidate + "</script".length;
  }
  return null;
}

type CommentScanState = "code" | "lineComment" | "blockComment" | "single" | "double" | "template";

interface CommentScanner {
  output: string;
  state: CommentScanState;
  escaped: boolean;
}

function scanLineCommentChar(scanner: CommentScanner, char: string): void {
  if (char === "\n" || char === "\r") {
    scanner.output += char;
    scanner.state = "code";
  } else {
    scanner.output += " ";
  }
}

function scanBlockCommentChar(scanner: CommentScanner, char: string, next: string): number {
  if (char === "*" && next === "/") {
    scanner.output += "  ";
    scanner.state = "code";
    return 1;
  }
  scanner.output += char === "\n" || char === "\r" ? char : " ";
  return 0;
}

function stringCloserFor(state: CommentScanState): string | null {
  if (state === "single") return "'";
  if (state === "double") return '"';
  return state === "template" ? "`" : null;
}

// fallow-ignore-next-line complexity
function scanStringChar(scanner: CommentScanner, char: string): void {
  scanner.output += char;
  if (scanner.escaped) {
    scanner.escaped = false;
    return;
  }
  if (char === "\\") {
    scanner.escaped = true;
    return;
  }
  if (char === stringCloserFor(scanner.state)) {
    scanner.state = "code";
  }
}

// fallow-ignore-next-line complexity
function scanCodeChar(scanner: CommentScanner, char: string, next: string): number {
  scanner.output += char;
  if (char === "/" && (next === "/" || next === "*")) {
    scanner.output = scanner.output.slice(0, -1) + "  ";
    scanner.state = next === "/" ? "lineComment" : "blockComment";
    return 1;
  }
  if (char === "'") scanner.state = "single";
  else if (char === '"') scanner.state = "double";
  else if (char === "`") scanner.state = "template";
  return 0;
}

// fallow-ignore-next-line complexity
function stripJavaScriptComments(source: string): string {
  const scanner: CommentScanner = { output: "", state: "code", escaped: false };

  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);
    const next = source.charAt(index + 1);

    if (scanner.state === "lineComment") {
      scanLineCommentChar(scanner, char);
    } else if (scanner.state === "blockComment") {
      index += scanBlockCommentChar(scanner, char, next);
    } else if (scanner.state === "code") {
      index += scanCodeChar(scanner, char, next);
    } else {
      scanStringChar(scanner, char);
    }
  }

  return scanner.output;
}

function isHtmlWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\t" || char === "\r" || char === "\f";
}

function isTagNameChar(char: string): boolean {
  return (
    (char >= "a" && char <= "z") ||
    (char >= "A" && char <= "Z") ||
    (char >= "0" && char <= "9") ||
    char === ":" ||
    char === "-"
  );
}

function isAttributeNameChar(char: string): boolean {
  return char !== "" && !isHtmlWhitespace(char) && char !== "/" && char !== ">" && char !== "=";
}
