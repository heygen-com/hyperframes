import { parseCssColor, type ParsedColor } from "./colorValue";
import { COMMON_LOCAL_FONT_FAMILIES } from "./fontCatalog";

/* ------------------------------------------------------------------ */
/*  Font types & constants (shared by font and section modules)        */
/* ------------------------------------------------------------------ */

export const GENERIC_FONT_FAMILIES = new Set([
  "inherit",
  "initial",
  "revert",
  "revert-layer",
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
]);

export const DEFAULT_FONT_FAMILIES = [
  ...COMMON_LOCAL_FONT_FAMILIES,
  "Inter",
  "system-ui",
  "sans-serif",
  "serif",
  "monospace",
];

export interface LocalFontData {
  family: string;
  fullName?: string;
  postscriptName?: string;
  style?: string;
  blob?: () => Promise<Blob>;
}

export type FontSource = "Current" | "Document" | "Imported" | "Local" | "Google" | "System";

export interface FontOption {
  family: string;
  source: FontSource;
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFontData[]>;
  }
}

export function sanitizeFontFilePart(value: string): string {
  return value
    .replace(/[^\w .-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function localFontSortScore(font: LocalFontData): number {
  const style = font.style?.toLowerCase() ?? "";
  const fullName = font.fullName?.toLowerCase() ?? "";
  if (style === "regular" || fullName.endsWith(" regular")) return 0;
  if (style === "normal" || fullName.endsWith(" normal")) return 1;
  if (style === "medium" || fullName.endsWith(" medium")) return 2;
  return 3;
}

export function uniqueFontFamilies(values: string[]): string[] {
  const seen = new Set<string>();
  return values.reduce<string[]>((result, value) => {
    const family = value.trim();
    if (!family) return result;
    const key = family.toLowerCase();
    if (seen.has(key)) return result;
    seen.add(key);
    result.push(family);
    return result;
  }, []);
}

export function uniqueFontOptions(values: FontOption[]): FontOption[] {
  const seen = new Set<string>();
  return values.reduce<FontOption[]>((result, value) => {
    const family = value.family.trim();
    if (!family) return result;
    const key = family.toLowerCase();
    if (seen.has(key)) return result;
    seen.add(key);
    result.push({ family, source: value.source });
    return result;
  }, []);
}

export function sortFontOptions(options: FontOption[]): FontOption[] {
  return [...options].sort((a, b) => {
    const rankDelta = fontSourceRank(a.source) - fontSourceRank(b.source);
    if (rankDelta !== 0) return rankDelta;
    const commonA = COMMON_LOCAL_FONT_FAMILIES.findIndex(
      (f) => f.toLowerCase() === a.family.toLowerCase(),
    );
    const commonB = COMMON_LOCAL_FONT_FAMILIES.findIndex(
      (f) => f.toLowerCase() === b.family.toLowerCase(),
    );
    const commonDelta =
      (commonA === -1 ? Number.MAX_SAFE_INTEGER : commonA) -
      (commonB === -1 ? Number.MAX_SAFE_INTEGER : commonB);
    return commonDelta === 0 ? a.family.localeCompare(b.family) : commonDelta;
  });
}

function fontSourceRank(source: FontSource): number {
  if (source === "Current") return 0;
  if (source === "Document") return 1;
  if (source === "Imported") return 2;
  if (source === "Google") return 3;
  if (source === "Local") return 4;
  return 5;
}

/* ------------------------------------------------------------------ */
/*  Shared constants                                                   */
/* ------------------------------------------------------------------ */

export const FIELD =
  "min-w-0 rounded-xl border border-neutral-800 bg-neutral-900/95 px-3 py-2 text-neutral-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors focus-within:border-neutral-600";
export const LABEL = "text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-500";
export const RESPONSIVE_GRID = "grid grid-cols-[repeat(auto-fit,minmax(118px,1fr))] gap-3";
export const EMPTY_STYLES: Record<string, string> = {};

export const EMPTY_FILTER_VALUE = "none";
export const BOX_SHADOW_PRESETS = {
  none: "none",
  soft: "0 12px 36px rgba(0, 0, 0, 0.28)",
  lift: "0 18px 54px rgba(0, 0, 0, 0.38)",
  glow: "0 0 0 1px rgba(60, 230, 172, 0.34), 0 18px 56px rgba(60, 230, 172, 0.2)",
} as const;

export type BoxShadowPreset = keyof typeof BOX_SHADOW_PRESETS | "custom";

/* ------------------------------------------------------------------ */
/*  Shared types                                                       */
/* ------------------------------------------------------------------ */

export interface ParsedNumericToken {
  value: number;
  unit: string;
}

/* ------------------------------------------------------------------ */
/*  Pure utility functions                                             */
/* ------------------------------------------------------------------ */

export function colorFromCss(value: string): ParsedColor {
  return parseCssColor(value) ?? { red: 0, green: 0, blue: 0, alpha: 1 };
}

export function parseNumericValue(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatNumericValue(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? `${rounded}`
    : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function parseNumericToken(value: string | undefined): ParsedNumericToken | null {
  if (!value) return null;
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)([a-z%]*)$/i);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  if (!Number.isFinite(parsed)) return null;
  return { value: parsed, unit: match[2] ?? "" };
}

export function parsePxMetricValue(value: string): number | null {
  const token = parseNumericToken(value);
  if (!token) return null;
  if (token.unit && token.unit.toLowerCase() !== "px") return null;
  return token.value;
}

export function clampPanelNumber(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function normalizePanelPxValue(
  value: string,
  options: { min?: number; max?: number; fallback?: number } = {},
): string | null {
  const token = parseNumericToken(value.trim());
  if (!token) return null;
  if (token.unit && token.unit.toLowerCase() !== "px") return null;
  const next = clampPanelNumber(
    token.value,
    options.min ?? Number.NEGATIVE_INFINITY,
    options.max ?? Number.POSITIVE_INFINITY,
    options.fallback ?? 0,
  );
  return `${formatNumericValue(next)}px`;
}

export function formatPxMetricValue(value: number): string {
  return `${formatNumericValue(value)}px`;
}

export function normalizeTextMetricValue(
  property: "letter-spacing" | "line-height",
  value: string,
) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "normal") return trimmed || "normal";
  const token = parseNumericToken(trimmed);
  if (!token) return trimmed;
  if (property === "letter-spacing") {
    return token.unit ? trimmed : `${formatNumericValue(token.value)}px`;
  }
  if (token.unit) return trimmed;
  return token.value > 4 ? `${formatNumericValue(token.value)}px` : formatNumericValue(token.value);
}

function splitCssFunctions(value: string): string[] {
  const functions: string[] = [];
  let current = "";
  let depth = 0;

  for (const char of value.trim()) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(char) && depth === 0) {
      if (current.trim()) functions.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) functions.push(current.trim());
  return functions;
}

export function getCssFilterFunctionPx(value: string | undefined, name: string): number {
  const normalized = value?.trim();
  if (!normalized || normalized === EMPTY_FILTER_VALUE) return 0;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\s)${escapedName}\\((-?\\d+(?:\\.\\d+)?)px\\)`, "i").exec(
    normalized,
  );
  if (!match) return 0;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function setCssFilterFunctionPx(
  value: string | undefined,
  name: string,
  nextPx: number,
): string {
  const nextValue = clampPanelNumber(nextPx, 0, 200, 0);
  const functions = splitCssFunctions(value && value.trim() !== EMPTY_FILTER_VALUE ? value : "");
  const lowerName = name.toLowerCase();
  const filtered = functions.filter((entry) => !entry.toLowerCase().startsWith(`${lowerName}(`));
  if (nextValue > 0) filtered.push(`${name}(${formatNumericValue(nextValue)}px)`);
  return filtered.length > 0 ? filtered.join(" ") : EMPTY_FILTER_VALUE;
}

export function inferBoxShadowPreset(value: string | undefined): BoxShadowPreset {
  const normalized = value?.trim() || "none";
  for (const [preset, shadow] of Object.entries(BOX_SHADOW_PRESETS)) {
    if (normalized === shadow) return preset as BoxShadowPreset;
  }
  return normalized === "none" ? "none" : "custom";
}

export function buildBoxShadowPresetValue(
  preset: BoxShadowPreset,
  fallback: string | undefined,
): string {
  if (preset === "custom") return fallback?.trim() || "none";
  return BOX_SHADOW_PRESETS[preset];
}

export function inferClipPathPreset(
  value: string | undefined,
): "none" | "inset" | "circle" | "custom" {
  const normalized = value?.trim();
  if (!normalized || normalized === "none") return "none";
  if (/^inset\(/i.test(normalized)) return "inset";
  if (/^circle\(/i.test(normalized)) return "circle";
  return "custom";
}

export function getClipPathInsetPx(value: string | undefined): number {
  const match = /^inset\(\s*(-?\d+(?:\.\d+)?)px\b/i.exec(value?.trim() ?? "");
  if (!match) return 0;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function buildStrokeWidthStyleUpdates(
  nextWidth: string,
  currentBorderStyle: string | undefined,
): Array<[property: string, value: string]> {
  const updates: Array<[property: string, value: string]> = [["border-width", nextWidth]];
  const token = parseNumericToken(nextWidth);
  const style = currentBorderStyle?.trim().toLowerCase() || "none";
  if (token && token.value > 0 && (style === "none" || style === "hidden")) {
    updates.push(["border-style", "solid"]);
  }
  return updates;
}

export function buildStrokeStyleUpdates(
  nextStyle: string,
  currentBorderWidth: string | undefined,
): Array<[property: string, value: string]> {
  const updates: Array<[property: string, value: string]> = [["border-style", nextStyle]];
  const style = nextStyle.trim().toLowerCase();
  if (!style || style === "none" || style === "hidden") return updates;

  const token = parseNumericToken(currentBorderWidth?.trim() || "0");
  if (!token || token.value <= 0) {
    updates.push(["border-width", "1px"]);
  }
  return updates;
}

export function buildClipPathValue(
  preset: "none" | "inset" | "circle" | "custom",
  radiusValue: number,
  fallback: string | undefined,
) {
  if (preset === "custom") return fallback?.trim() || "none";
  if (preset === "circle") return "circle(50% at 50% 50%)";
  if (preset === "inset") {
    return `inset(0 round ${formatNumericValue(Math.max(0, radiusValue))}px)`;
  }
  return "none";
}

export function buildInsetClipPathValue(insetPx: number, radiusValue: number): string {
  return `inset(${formatNumericValue(Math.max(0, insetPx))}px round ${formatNumericValue(Math.max(0, radiusValue))}px)`;
}

export function adjustNumericToken(
  value: string,
  direction: 1 | -1,
  modifiers?: { shiftKey?: boolean; altKey?: boolean },
): string | null {
  const token = parseNumericToken(value);
  if (!token) return null;

  const baseStep = modifiers?.altKey ? 0.1 : modifiers?.shiftKey ? 10 : 1;
  const nextValue = token.value + baseStep * direction;
  return `${formatNumericValue(nextValue)}${token.unit}`;
}

export function extractBackgroundImageUrl(value: string | undefined): string {
  if (!value) return "";
  const lowerValue = value.toLowerCase();
  const urlStart = lowerValue.indexOf("url(");
  if (urlStart < 0) return "";

  let index = urlStart + 4;
  while (
    index < value.length &&
    (value[index] === " " ||
      value[index] === "\n" ||
      value[index] === "\r" ||
      value[index] === "\t" ||
      value[index] === "\f")
  ) {
    index += 1;
  }

  const quote = value[index] === '"' || value[index] === "'" ? value[index] : null;
  if (quote) {
    index += 1;
    const endQuote = value.indexOf(quote, index);
    return endQuote >= index ? value.slice(index, endQuote) : "";
  }

  const endParen = value.indexOf(")", index);
  if (endParen < index) return "";
  return value.slice(index, endParen).trim();
}
