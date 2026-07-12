// Shared types, regex constants, and utility functions used across lint rule modules.
// Nothing in this file should emit findings — it only parses and extracts.

import { Parser } from "htmlparser2";

export type OpenTag = {
  raw: string;
  name: string;
  attrs: string;
  index: number;
  closeIndex?: number;
  endIndex?: number;
};

export type ExtractedBlock = {
  attrs: string;
  content: string;
  raw: string;
  index: number;
};

const COMPOSITION_ID_IN_CSS_PATTERN = /\[data-composition-id=["']([^"']+)["']\]/g;
export const TIMELINE_REGISTRY_INIT_PATTERN =
  /window\.__timelines\s*=\s*window\.__timelines\s*\|\|\s*\{\}|window\.__timelines\s*=\s*\{\}|window\.__timelines\s*\?\?=\s*\{\}/i;
// Object-literal registration that assigns at least one `key: value` entry inline,
// e.g. `window.__timelines = { main: tl }` or `window.__timelines = { "comp-1": tl }`.
// Distinct from the empty-init form (`= {}`) — requires a key followed by `:`.
export const TIMELINE_REGISTRY_OBJECT_LITERAL_PATTERN =
  /window\.__timelines\s*=\s*\{\s*(?:["'][^"']+["']|[A-Za-z_$][\w$]*)\s*:/i;
export const TIMELINE_REGISTRY_ASSIGN_PATTERN =
  /window\.__timelines(?:\[[^\]]+\]|\.[A-Za-z_$][\w$]*)\s*=/i;
// The bracket branch accepts either a quoted string key (`["root"]`) or a
// computed key (`[spec.id]`, `[id]`) — a bare-identifier-only bracket branch
// missed `window.__timelines[spec.id] = tl`, a pattern the shipped
// code-particle-assemble/code-3d-extrude registry blocks actually use,
// making gsap_timeline_not_registered false-fire on correctly registered
// timelines. The computed-key alternative is deliberately non-capturing:
// its text isn't a literal composition id, so callers reading group 1/2
// (readRegisteredTimelineCompositionId) must keep falling back to null for it.
export const WINDOW_TIMELINE_ASSIGN_PATTERN =
  /window\.__timelines(?:\[\s*(?:["']([^"']+)["']|[A-Za-z_$][\w$.]*)\s*\]|\.\s*([A-Za-z_$][\w$]*))\s*=\s*([A-Za-z_$][\w$]*)/i;
export const INVALID_SCRIPT_CLOSE_PATTERN = /<script[^>]*>[\s\S]*?<\s*\/\s*script(?!>)/i;

const TIMELINE_REGISTRY_KEY_PATTERN =
  /window\.__timelines(?:\[\s*["']([^"']+)["']\s*\]|\.\s*([A-Za-z_$][\w$]*))\s*=/g;

// The `window.__timelines = { ... }` object-literal body (group 1), captured so its
// `key: value` entries can be scanned for registered keys.
const TIMELINE_REGISTRY_OBJECT_BODY_PATTERN = /window\.__timelines\s*=\s*\{([\s\S]*?)\}/i;
// A single object-literal entry whose value is an identifier (real timeline registration),
// e.g. `main: tl` or `"comp-1": tl`. Captures the key in group 1 (quoted) or 2 (bare).
const TIMELINE_REGISTRY_OBJECT_ENTRY_PATTERN =
  /(?:["']([^"']+)["']|([A-Za-z_$][\w$]*))\s*:\s*[A-Za-z_$][\w$]*/g;

export function parseHtmlStructure(source: string): {
  tags: OpenTag[];
  scripts: ExtractedBlock[];
  styles: ExtractedBlock[];
} {
  const tags: OpenTag[] = [];
  const blocks = { script: [] as ExtractedBlock[], style: [] as ExtractedBlock[] };
  const openTagsByName = new Map<string, OpenTag[]>();
  const openBlocks: Array<{
    name: "script" | "style";
    attrs: string;
    contentStart: number;
    index: number;
  }> = [];
  const parser: Parser = new Parser(
    {
      onopentag(name) {
        const index = parser.startIndex;
        const raw = source.slice(index, parser.endIndex + 1);
        const attrs = raw.slice(name.length + 1, -1).replace(/\s*\/$/, "");
        const tag = { raw, name, attrs, index };
        tags.push(tag);
        const sameNameStack = openTagsByName.get(name) ?? [];
        sameNameStack.push(tag);
        openTagsByName.set(name, sameNameStack);
        if (name === "script" || name === "style") {
          openBlocks.push({ name, attrs, contentStart: parser.endIndex + 1, index });
        }
      },
      onclosetag(name) {
        const tag = openTagsByName.get(name)?.pop();
        if (tag) {
          tag.closeIndex = parser.startIndex;
          tag.endIndex = parser.endIndex + 1;
        }
        if (name !== "script" && name !== "style") return;
        const block = openBlocks.pop();
        if (!block || block.name !== name) return;
        blocks[name].push({
          attrs: block.attrs,
          content: source.slice(block.contentStart, parser.startIndex),
          raw: source.slice(block.index, parser.endIndex + 1),
          index: block.index,
        });
      },
    },
    { decodeEntities: false, lowerCaseAttributeNames: false, lowerCaseTags: true },
  );
  parser.end(source);

  return { tags, scripts: blocks.script, styles: blocks.style };
}

/**
 * Find the `<html>` open tag in the source. Distinct from `findRootTag`,
 * which returns the first element inside `<body>` — the latter is "the
 * composition's visible root", whereas `<html>` is where document-level
 * metadata like `data-composition-variables` lives.
 */
export function findHtmlTag(tags: readonly OpenTag[]): OpenTag | null {
  return tags.find((tag) => tag.name === "html") ?? null;
}

// fallow-ignore-next-line complexity
export function findRootTag(source: string, parsedTags?: readonly OpenTag[]): OpenTag | null {
  const tags = parsedTags ?? parseHtmlStructure(source).tags;
  const bodyTag = tags.find((tag) => tag.name === "body");
  if (
    bodyTag &&
    (readAttr(bodyTag.raw, "data-composition-id") ||
      readAttr(bodyTag.raw, "data-width") ||
      readAttr(bodyTag.raw, "data-height"))
  ) {
    return bodyTag;
  }
  const bodyStart = bodyTag ? bodyTag.index + bodyTag.raw.length : 0;
  const bodyEnd = bodyTag?.closeIndex ?? source.length;
  const bodyTags = tags.filter((tag) => tag.index >= bodyStart && tag.index < bodyEnd);
  // Set when a leading <svg> defs block is skipped (see below) — extractOpenTags
  // is a flat, nesting-unaware scan, so without this the very next tag it
  // returns is the svg's own nested child (<defs>, <filter>, ...), not the
  // sibling that follows the closed </svg>.
  let skipBefore = -1;
  for (const tag of bodyTags) {
    if (tag.index < skipBefore) continue;
    if (["script", "style", "meta", "link", "title"].includes(tag.name)) continue;
    // A leading <svg> block (icon/gradient/filter <defs>, referenced by url(#id)
    // from elsewhere in the document) is shared visual plumbing, not the
    // composition root — two independent reports of this being mistaken for
    // the root, manufacturing root_missing_composition_id/root_missing_dimensions
    // on an otherwise-correct composition. Only skip it when it carries none of
    // the composition markers itself, so an intentionally SVG-rooted composition
    // (data-composition-id/data-width/data-height directly on the <svg>) is
    // still eligible as the root.
    if (
      tag.name === "svg" &&
      !readAttr(tag.raw, "data-composition-id") &&
      !readAttr(tag.raw, "data-width") &&
      !readAttr(tag.raw, "data-height")
    ) {
      // No closing tag found (malformed HTML) — skip everything rather than
      // risk returning one of the svg's own children as the root.
      skipBefore = tag.endIndex ?? Infinity;
      continue;
    }
    return tag;
  }
  return null;
}

export function readAttr(tagSource: string, attr: string): string | null {
  if (!tagSource) return null;
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `(?<![\w-])` not `\b`: a plain `\b` boundary treats the hyphen in a longer
  // attribute as a word break, so reading "id" would wrongly match the trailing
  // `id="…"` inside `data-hf-id="…"` (and "width" inside `data-width`, etc.).
  // The lookbehind requires the match to start a fresh attribute name.
  const match = tagSource.match(new RegExp(`(?<![\\w-])${escaped}\\s*=\\s*["']([^"']+)["']`, "i"));
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
  // See readAttr: `(?<![\w-])` prevents a short name from matching the tail of a
  // longer hyphenated attribute (e.g. "id" inside `data-hf-id`).
  const match = tagSource.match(
    new RegExp(`(?<![\\w-])${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"),
  );
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
  const objectBody = TIMELINE_REGISTRY_OBJECT_BODY_PATTERN.exec(source)?.[1];
  if (objectBody) {
    const entryPattern = new RegExp(
      TIMELINE_REGISTRY_OBJECT_ENTRY_PATTERN.source,
      TIMELINE_REGISTRY_OBJECT_ENTRY_PATTERN.flags,
    );
    while ((match = entryPattern.exec(objectBody)) !== null) {
      const key = match[1] ?? match[2];
      if (key) keys.add(key);
    }
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

// Whether any <style> block in the composition defines caption group/word
// classes (`.caption-group`, `.caption_word`, etc.) — the signal several
// caption-specific rules use to skip non-caption compositions entirely.
export function hasCaptionStyles(styles: ExtractedBlock[]): boolean {
  return styles.some((s) => /\.caption[-_]?(?:group|word)/i.test(s.content));
}

export function truncateSnippet(value: string, maxLength = 220): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}
