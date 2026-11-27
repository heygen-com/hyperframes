import {
  HF_COLOR_GRADING_COLOR_SPACE,
  HF_COLOR_GRADING_PRESETS,
  isHfColorGradingVariableRef,
} from "@hyperframes/core/color-grading";

const MEDIA_TAG_RE = /<\s*(video|img)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const TAG_NAME_RE = /^<\s*\w+/;
const HTML_SPACE = "\\t\\n\\f\\r ";
const NEXT_ATTRIBUTE_RE = new RegExp(
  `[${HTML_SPACE}/]*([^${HTML_SPACE}/>][^${HTML_SPACE}/>=]*)` +
    `(?:[${HTML_SPACE}]*=[${HTML_SPACE}]*(?:"[^"]*"|'[^']*'|[^${HTML_SPACE}>]+))?`,
  "y",
);
const SEPARATES_ATTRIBUTES = new RegExp(`[${HTML_SPACE}/>]`);
const IGNORED_HTML_RANGE_RE = /<!--[\s\S]*?-->|<(script|style)\b[\s\S]*?<\/\1\s*>/gi;

interface TextRange {
  start: number;
  end: number;
}

function collectIgnoredRanges(html: string): TextRange[] {
  const ranges: TextRange[] = [];
  let match: RegExpExecArray | null;
  IGNORED_HTML_RANGE_RE.lastIndex = 0;
  while ((match = IGNORED_HTML_RANGE_RE.exec(html)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

function isInsideRange(offset: number, ranges: TextRange[]): boolean {
  return ranges.some((range) => offset >= range.start && offset < range.end);
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function readAttributes(tag: string): { gradingSpans: TextRange[]; end: number } {
  const gradingSpans: TextRange[] = [];
  let end = TAG_NAME_RE.exec(tag)?.[0].length ?? 0;
  NEXT_ATTRIBUTE_RE.lastIndex = end;
  let match: RegExpExecArray | null;
  while ((match = NEXT_ATTRIBUTE_RE.exec(tag)) !== null && match[0] !== "") {
    end = match.index + match[0].length;
    if (match[1]?.toLowerCase() === "data-color-grading") {
      gradingSpans.push({ start: match.index, end });
    }
  }
  return { gradingSpans, end };
}

const keepsNextAttributeApart = (tag: string, end: number): string =>
  end < tag.length && !SEPARATES_ATTRIBUTES.test(tag.charAt(end)) ? " " : "";

function patchMediaTag(tag: string, value: string | null): string {
  const nextAttr = value ? ` data-color-grading="${escapeHtmlAttribute(value)}"` : "";
  const { gradingSpans, end } = readAttributes(tag);
  if (gradingSpans.length === 0) {
    return nextAttr ? tag.slice(0, end) + nextAttr + tag.slice(end) : tag;
  }
  let patched = tag;
  for (const [index, span] of [...gradingSpans.entries()].reverse()) {
    const written = index === 0 ? nextAttr : "";
    patched =
      patched.slice(0, span.start) +
      written +
      keepsNextAttributeApart(patched, span.end) +
      patched.slice(span.end);
  }
  return patched;
}

export function patchMediaColorGradingInHtml(
  html: string,
  value: string | null,
): { html: string; count: number } {
  let count = 0;
  const ignoredRanges = collectIgnoredRanges(html);
  const patched = html.replace(MEDIA_TAG_RE, (tag, _tagName, offset: number) => {
    if (isInsideRange(offset, ignoredRanges)) return tag;
    const next = patchMediaTag(tag, value);
    if (next !== tag) count += 1;
    return next;
  });
  return { html: patched, count };
}

const KNOWN_PRESETS = new Set<string>(HF_COLOR_GRADING_PRESETS.map((preset) => preset.id));
const LUT_SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const LOADABLE_LUT_SCHEMES = new Set(["data", "http", "https"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKnownPreset(value: unknown): boolean {
  return value === null || isHfColorGradingVariableRef(value) || KNOWN_PRESETS.has(value as string);
}

function isLoadableLut(value: unknown): boolean {
  if (value === null || isHfColorGradingVariableRef(value)) return true;
  if (!isRecord(value) || typeof value.src !== "string") return false;
  if (isHfColorGradingVariableRef(value.src)) return true;
  const scheme = LUT_SCHEME.exec(value.src.trim())?.[1]?.toLowerCase();
  return scheme === undefined || LOADABLE_LUT_SCHEMES.has(scheme);
}

export function keepKnownColorGradingValues(value: string): string | null {
  const presetOnly = value.trim();
  if (!presetOnly.startsWith("{")) return isKnownPreset(presetOnly) ? presetOnly : null;
  let grading: unknown;
  try {
    grading = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isRecord(grading)) return null;
  const kept = { ...grading };
  if ("preset" in kept && !isKnownPreset(kept.preset)) delete kept.preset;
  if ("colorSpace" in kept && kept.colorSpace !== HF_COLOR_GRADING_COLOR_SPACE)
    delete kept.colorSpace;
  if ("lut" in kept && !isLoadableLut(kept.lut)) delete kept.lut;
  return JSON.stringify(kept);
}
