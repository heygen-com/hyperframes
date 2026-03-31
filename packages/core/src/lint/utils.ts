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

export const TAG_PATTERN = /<([a-z][\w:-]*)(\s[^<>]*?)?>/gi;
export const STYLE_BLOCK_PATTERN = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
export const SCRIPT_BLOCK_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
export const COMPOSITION_ID_IN_CSS_PATTERN = /\[data-composition-id=["']([^"']+)["']\]/g;
export const TIMELINE_REGISTRY_INIT_PATTERN =
  /window\.__timelines\s*=\s*window\.__timelines\s*\|\|\s*\{\}|window\.__timelines\s*=\s*\{\}|window\.__timelines\s*\?\?=\s*\{\}/i;
export const TIMELINE_REGISTRY_ASSIGN_PATTERN = /window\.__timelines\[[^\]]+\]\s*=/i;
export const WINDOW_TIMELINE_ASSIGN_PATTERN =
  /window\.__timelines\[\s*["']([^"']+)["']\s*\]\s*=\s*([A-Za-z_$][\w$]*)/i;
export const INVALID_SCRIPT_CLOSE_PATTERN = /<script[^>]*>[\s\S]*?<\s*\/\s*script(?!>)/i;

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

export function findRootTag(source: string): OpenTag | null {
  const bodyMatch = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const bodyContent = bodyMatch ? (bodyMatch[1] ?? source) : source;
  const bodyTags = extractOpenTags(bodyContent);
  for (const tag of bodyTags) {
    if (["script", "style", "meta", "link", "title"].includes(tag.name)) continue;
    return tag;
  }
  return null;
}

export function readAttr(tagSource: string, attr: string): string | null {
  if (!tagSource) return null;
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tagSource.match(new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1] || null;
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

export function isMediaTag(tagName: string): boolean {
  return tagName === "video" || tagName === "audio" || tagName === "img";
}

export function truncateSnippet(value: string, maxLength = 220): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}
