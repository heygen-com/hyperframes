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

/**
 * Parse a full HTML document or wrap a fragment so linkedom consistently puts
 * fragment content under document.body.
 */
export function parseHTMLContent(html: string): Document {
  const trimmed = html.trimStart().toLowerCase();
  if (trimmed.startsWith("<!doctype") || trimmed.startsWith("<html")) {
    return parseHTML(html).document;
  }
  return parseHTML(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`).document;
}

export function stripEmbeddedRuntimeScripts(html: string): string {
  if (!html) return html;
  const loweredHtml = html.toLowerCase();
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

function findTagEnd(html: string, from: number): number {
  let quote: string | undefined;
  for (let index = from; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (char === quote) quote = undefined;
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
  const loweredBlock = block.toLowerCase();
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
  const loweredSource = source.toLowerCase();
  const loweredToken = token.toLowerCase();
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

export function injectScriptsAtHeadStart(html: string, scripts: readonly string[]): string {
  if (scripts.length === 0) return html;
  const headTags = inlineScriptTags(scripts);
  if (html.includes("<head")) {
    return html.replace(/<head\b[^>]*>/i, (match) => `${match}\n${headTags}`);
  }
  if (html.includes("<body")) {
    return html.replace("<body", () => `${headTags}\n<body`);
  }
  return `${headTags}\n${html}`;
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
    if (html.includes("</head>")) {
      // Function replacement avoids `$&` interpolation in runtime source.
      html = html.replace("</head>", () => `${headTags}\n</head>`);
    } else if (html.includes("<body")) {
      html = html.replace("<body", () => `${headTags}\n<body`);
    } else {
      html = `${headTags}\n${html}`;
    }
  }

  if (bodyScripts.length > 0) {
    const bodyTags = inlineScriptTags(bodyScripts);
    if (html.includes("</body>")) {
      html = html.replace("</body>", () => `${bodyTags}\n</body>`);
    } else {
      html = `${html}\n${bodyTags}`;
    }
  }

  return html;
}
