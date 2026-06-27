// Shared types, regex constants, and utility functions used across lint rule modules.
// Nothing in this file should emit findings — it only parses and extracts.

export type OpenTag = {
  raw: string;
  name: string;
  attrs: string;
  index: number;
};

export type ExtractedBlock = {
  attrs: string;
  content: string;
  raw: string;
  index: number;
};

const TAG_PATTERN = /<([a-z][\w:-]*)(\s[^<>]*?)?>/gi;
export const STYLE_BLOCK_PATTERN = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
export const SCRIPT_BLOCK_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const COMPOSITION_ID_IN_CSS_PATTERN = /\[data-composition-id=["']([^"']+)["']\]/g;
export const TIMELINE_REGISTRY_INIT_PATTERN =
  /window\.__timelines\s*=\s*window\.__timelines\s*\|\|\s*\{\}|window\.__timelines\s*=\s*\{\}|window\.__timelines\s*\?\?=\s*\{\}/i;
export const TIMELINE_REGISTRY_ASSIGN_PATTERN =
  /window\.__timelines(?:\[[^\]]+\]|\.[A-Za-z_$][\w$]*)\s*=/i;
export const WINDOW_TIMELINE_ASSIGN_PATTERN =
  /window\.__timelines(?:\[\s*["']([^"']+)["']\s*\]|\.\s*([A-Za-z_$][\w$]*))\s*=\s*([A-Za-z_$][\w$]*)/i;
export const INVALID_SCRIPT_CLOSE_PATTERN = /<script[^>]*>[\s\S]*?<\s*\/\s*script(?!>)/i;

const TIMELINE_REGISTRY_KEY_PATTERN =
  /window\.__timelines(?:\[\s*["']([^"']+)["']\s*\]|\.\s*([A-Za-z_$][\w$]*))\s*=/g;

export function extractOpenTags(source: string): OpenTag[] {
  const tags: OpenTag[] = [];
  let match: RegExpExecArray | null;
  const pattern = new RegExp(TAG_PATTERN.source, TAG_PATTERN.flags);
  while ((match = pattern.exec(source)) !== null) {
    const raw = match[0];
    if (raw.startsWith("</") || raw.startsWith("<!")) continue;
    tags.push({
      raw,
      name: (match[1] || "").toLowerCase(),
      attrs: match[2] || "",
      index: match.index,
    });
  }
  return tags;
}

export function extractBlocks(source: string, pattern: RegExp): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  let match: RegExpExecArray | null;
  const p = new RegExp(pattern.source, pattern.flags);
  while ((match = p.exec(source)) !== null) {
    blocks.push({
      attrs: match[1] || "",
      content: match[2] || "",
      raw: match[0],
      index: match.index,
    });
  }
  return blocks;
}

/**
 * Find the `<html>` open tag in the source. Distinct from `findRootTag`,
 * which returns the first element inside `<body>` — the latter is "the
 * composition's visible root", whereas `<html>` is where document-level
 * metadata like `data-composition-variables` lives.
 */
export function findHtmlTag(source: string): OpenTag | null {
  const match = /<html\b([^<>]*)>/i.exec(source);
  if (!match) return null;
  return {
    raw: match[0],
    name: "html",
    attrs: match[1] ?? "",
    index: match.index,
  };
}

export function findRootTag(source: string): OpenTag | null {
  const bodyOpenMatch = /<body\b([^>]*)>/i.exec(source);
  const bodyCloseMatch = /<\/body>/i.exec(source);
  if (
    bodyOpenMatch &&
    (readAttr(bodyOpenMatch[0], "data-composition-id") ||
      readAttr(bodyOpenMatch[0], "data-width") ||
      readAttr(bodyOpenMatch[0], "data-height"))
  ) {
    return {
      raw: bodyOpenMatch[0],
      name: "body",
      attrs: bodyOpenMatch[1] ?? "",
      index: bodyOpenMatch.index,
    };
  }
  const bodyStart = bodyOpenMatch ? bodyOpenMatch.index + bodyOpenMatch[0].length : 0;
  const bodyEnd =
    bodyOpenMatch && bodyCloseMatch && bodyCloseMatch.index > bodyStart
      ? bodyCloseMatch.index
      : source.length;
  const bodyContent = bodyOpenMatch ? source.slice(bodyStart, bodyEnd) : source;
  const bodyTags = extractOpenTags(bodyContent);
  for (const tag of bodyTags) {
    if (["script", "style", "meta", "link", "title"].includes(tag.name)) continue;
    return { ...tag, index: tag.index + bodyStart };
  }
  return null;
}

export function readAttr(tagSource: string, attr: string): string | null {
  if (!tagSource) return null;
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tagSource.match(new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1] || null;
}

/**
 * Read an attribute that may legitimately contain the opposite quote
 * character. `readAttr` truncates `data-variable-values='{"title":"Hello"}'`
 * at the first internal `"` because its `[^"']+` class excludes both quote
 * types. This variant alternates: a double-quoted value never contains an
 * unescaped `"`, and a single-quoted value never contains an unescaped `'`,
 * so each branch can use a quote-specific class.
 *
 * Use for attributes whose values are JSON or otherwise carry the opposite
 * quote character. Existing single-token attributes (`id`, `class`, etc.)
 * stick with `readAttr` for consistency with the rest of the lint code.
 */
export function readJsonAttr(tagSource: string, attr: string): string | null {
  if (!tagSource) return null;
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tagSource.match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

export function collectCompositionIds(tags: OpenTag[]): Set<string> {
  const ids = new Set<string>();
  for (const tag of tags) {
    const compId = readAttr(tag.raw, "data-composition-id");
    if (compId) ids.add(compId);
  }
  return ids;
}

export function extractCompositionIdsFromCss(css: string): string[] {
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  const pattern = new RegExp(
    COMPOSITION_ID_IN_CSS_PATTERN.source,
    COMPOSITION_ID_IN_CSS_PATTERN.flags,
  );
  while ((match = pattern.exec(css)) !== null) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids];
}

export function extractTimelineRegistryKeys(source: string): string[] {
  const keys = new Set<string>();
  let match: RegExpExecArray | null;
  const pattern = new RegExp(
    TIMELINE_REGISTRY_KEY_PATTERN.source,
    TIMELINE_REGISTRY_KEY_PATTERN.flags,
  );
  while ((match = pattern.exec(source)) !== null) {
    const key = match[1] ?? match[2];
    if (key) keys.add(key);
  }
  return [...keys];
}

export function getInlineScriptSyntaxError(source: string): string | null {
  if (!source.trim()) return null;
  try {
    // eslint-disable-next-line no-new-func
    new Function(source);
    return null;
  } catch (error) {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}

// fallow-ignore-next-line complexity
export function stripJsComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;

  while (i < source.length) {
    const ch = source[i] ?? "";
    const next = source[i + 1] ?? "";

    if (quote) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "/") {
      out += "  ";
      i += 2;
      while (i < source.length && source[i] !== "\n" && source[i] !== "\r") {
        out += " ";
        i += 1;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < source.length) {
        const blockCh = source[i] ?? "";
        const blockNext = source[i + 1] ?? "";
        if (blockCh === "*" && blockNext === "/") {
          out += "  ";
          i += 2;
          break;
        }
        out += blockCh === "\n" || blockCh === "\r" ? blockCh : " ";
        i += 1;
      }
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

// One linear pass that drops every `<!-- … -->` region. Uses indexOf, not a
// `/<!--[\s\S]*?-->/` regex: that pattern backtracks O(n²) on inputs with many
// unterminated "<!--" (CodeQL js/polynomial-redos). An unterminated "<!--" with
// no closing "-->" is kept verbatim, matching the prior regex's no-match behavior.
function stripHtmlCommentsOnce(source: string): string {
  let out = "";
  let i = 0;
  for (;;) {
    const start = source.indexOf("<!--", i);
    if (start < 0) return out + source.slice(i);
    const end = source.indexOf("-->", start + 4);
    if (end < 0) return out + source.slice(i);
    out += source.slice(i, start);
    i = end + 3;
  }
}

// Strip HTML comments to a fixpoint. A single pass is not enough: deleting one
// comment can splice adjacent markers into a fresh, complete <!-- … --> (e.g.
// "<<!-- -->!-- … -->" → "<!-- … -->"), which would otherwise survive and let a
// commented-out <template>/tag hijack the linter's tag scan.
export function stripHtmlComments(source: string): string {
  let out = source;
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = stripHtmlCommentsOnce(out);
  }
  return out;
}

export function extractScriptTextsAndSrcs(scripts: ExtractedBlock[]): {
  texts: string[];
  srcs: string[];
} {
  const texts = scripts.filter((s) => !/\bsrc\s*=/.test(s.attrs)).map((s) => s.content);
  const srcs = scripts.map((s) => readAttr(`<script ${s.attrs}>`, "src") || "").filter(Boolean);
  return { texts, srcs };
}

export function isMediaTag(tagName: string): boolean {
  return tagName === "video" || tagName === "audio" || tagName === "img";
}

export function truncateSnippet(value: string, maxLength = 220): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}
