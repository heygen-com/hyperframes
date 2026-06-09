import { parseCssColor, type ParsedColor } from "./colorValue";
import { COMMON_LOCAL_FONT_FAMILIES } from "./fontCatalog";
import type { DomEditSelection } from "./domEditing";
import type { ImportedFontAsset } from "./fontAssets";

export interface PropertyPanelProps {
  projectId: string;
  projectDir: string | null;
  assets: string[];
  element: DomEditSelection | null;
  multiSelectCount?: number;
  copiedAgentPrompt: boolean;
  onClearSelection: () => void;
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
  onSetAttribute: (attr: string, value: string) => void | Promise<void>;
  onSetHtmlAttribute: (attr: string, value: string | null) => void | Promise<void>;
  onSetManualOffset: (element: DomEditSelection, next: { x: number; y: number }) => void;
  onSetManualSize: (element: DomEditSelection, next: { width: number; height: number }) => void;
  onSetManualRotation: (element: DomEditSelection, next: { angle: number }) => void;
  onSetText: (value: string, fieldKey?: string) => void;
  onSetTextFieldStyle: (fieldKey: string, property: string, value: string) => void;
  onAddTextField: (afterFieldKey?: string) => string | Promise<string | null> | null;
  onRemoveTextField: (fieldKey: string) => void;
  onAskAgent: () => void;
  onImportAssets?: (files: FileList) => Promise<string[]>;
  fontAssets?: ImportedFontAsset[];
  onImportFonts?: (files: FileList | File[]) => Promise<ImportedFontAsset[]>;
  previewIframeRef?: React.RefObject<HTMLIFrameElement | null>;
  gsapAnimations?: import("@hyperframes/core/gsap-parser").GsapAnimation[];
  gsapMultipleTimelines?: boolean;
  gsapUnsupportedTimelinePattern?: boolean;
  onUpdateGsapProperty?: (animId: string, prop: string, value: number | string) => void;
  onUpdateGsapMeta?: (
    animId: string,
    updates: { duration?: number; ease?: string; position?: number },
  ) => void;
  onDeleteGsapAnimation?: (animId: string) => void;
  onAddGsapProperty?: (animId: string, prop: string) => void;
  onRemoveGsapProperty?: (animId: string, prop: string) => void;
  onUpdateGsapFromProperty?: (animId: string, prop: string, value: number | string) => void;
  onAddGsapFromProperty?: (animId: string, prop: string) => void;
  onRemoveGsapFromProperty?: (animId: string, prop: string) => void;
  onAddGsapAnimation?: (method: "to" | "from" | "set" | "fromTo") => void;
  onSetArcPath?: (
    animId: string,
    config: {
      enabled: boolean;
      autoRotate?: boolean | number;
      segments?: import("@hyperframes/core/gsap-parser").ArcPathSegment[];
    },
  ) => void;
  onUpdateArcSegment?: (
    animId: string,
    segmentIndex: number,
    update: Partial<import("@hyperframes/core/gsap-parser").ArcPathSegment>,
  ) => void;
  onAddKeyframe?: (
    animationId: string,
    percentage: number,
    property: string,
    value: number | string,
  ) => void;
  onRemoveKeyframe?: (animationId: string, percentage: number) => void;
  onConvertToKeyframes?: (animationId: string) => void;
  onCommitAnimatedProperty?: (
    selection: DomEditSelection,
    property: string,
    value: number | string,
  ) => Promise<void>;
  onSeekToTime?: (time: number) => void;
}

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
  "min-w-0 rounded-md bg-panel-input px-3 py-[7px] text-panel-text-1 transition-colors focus-within:ring-1 focus-within:ring-panel-accent/30";
export const LABEL = "text-[11px] font-medium text-panel-text-3";
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

// ── Fit to children ──────────────────────────────────────────────────

export function computeFitToChildrenSize(
  element: DomEditSelection,
): { width: number; height: number } | null {
  const el = element.element;
  const win = el.ownerDocument?.defaultView;
  const children = Array.from(el.children).filter((c): c is HTMLElement => c.nodeType === 1);
  if (children.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const child of children) {
    if (win) {
      const cs = win.getComputedStyle(child);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
    }
    const r = child.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    minX = Math.min(minX, r.left);
    minY = Math.min(minY, r.top);
    maxX = Math.max(maxX, r.right);
    maxY = Math.max(maxY, r.bottom);
  }
  if (!isFinite(minX)) return null;
  const parentRect = el.getBoundingClientRect();
  const scaleX = parentRect.width > 0 ? element.boundingBox.width / parentRect.width : 1;
  const scaleY = parentRect.height > 0 ? element.boundingBox.height / parentRect.height : 1;
  const width = Math.round((maxX - minX) * scaleX);
  const height = Math.round((maxY - minY) * scaleY);
  return width > 0 && height > 0 ? { width, height } : null;
}
