import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Eye,
  Layers,
  MessageSquare,
  Move,
  Palette,
  RotateCcw,
  Settings,
  Type,
  X,
} from "../../icons/SystemIcons";
import {
  formatCssColor,
  hsvToRgb,
  parseCssColor,
  rgbToHsv,
  toHexColor,
  type ParsedColor,
} from "./colorValue";
import { isTextEditableSelection, type DomEditSelection } from "./domEditing";
import { readStudioBoxSize, readStudioPathOffset, readStudioRotation } from "./manualEdits";
import {
  COMMON_LOCAL_FONT_FAMILIES,
  googleFontStylesheetUrl,
  POPULAR_GOOGLE_FONT_FAMILIES,
} from "./fontCatalog";
import { fontFamilyFromAssetPath, importedFontFaceCss, type ImportedFontAsset } from "./fontAssets";
import { resolveFloatingPanelPosition, type FloatingPosition } from "./floatingPanel";

interface PropertyPanelProps {
  element: DomEditSelection | null;
  multiSelectCount?: number;
  copiedAgentPrompt: boolean;
  onClearSelection: () => void;
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
  onSetManualOffset: (element: DomEditSelection, next: { x: number; y: number }) => void;
  onSetManualSize: (element: DomEditSelection, next: { width: number; height: number }) => void;
  onSetRotation: (element: DomEditSelection, next: { angle: number }) => void;
  onSetText: (value: string, fieldKey?: string) => void;
  onSetTextFieldStyle: (fieldKey: string, property: string, value: string) => void;
  onResetManualEdits: (element: DomEditSelection) => void;
  onAskAgent: () => void;
  fontAssets?: ImportedFontAsset[];
  onImportFonts?: (files: FileList | File[]) => Promise<ImportedFontAsset[]>;
}

const FIELD =
  "min-w-0 rounded-xl border border-neutral-800 bg-neutral-900/95 px-3 py-2 text-neutral-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors focus-within:border-neutral-600";
const LABEL = "text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-500";
const RESPONSIVE_GRID = "grid grid-cols-[repeat(auto-fit,minmax(118px,1fr))] gap-3";
const EMPTY_STYLES: Record<string, string> = {};
const GENERIC_FONT_FAMILIES = new Set([
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
const DEFAULT_FONT_FAMILIES = [
  ...COMMON_LOCAL_FONT_FAMILIES,
  "Inter",
  "system-ui",
  "sans-serif",
  "serif",
  "monospace",
];
interface LocalFontData {
  family: string;
  fullName?: string;
  postscriptName?: string;
  style?: string;
  blob?: () => Promise<Blob>;
}

type FontSource = "Current" | "Document" | "Imported" | "Local" | "Google" | "System";

interface FontOption {
  family: string;
  source: FontSource;
}

const COLOR_PICKER_SIZE = { width: 292, height: 386 };
const EMPTY_FILTER_VALUE = "none";
const BOX_SHADOW_PRESETS = {
  none: "none",
  soft: "0 12px 36px rgba(0, 0, 0, 0.28)",
  lift: "0 18px 54px rgba(0, 0, 0, 0.38)",
  glow: "0 0 0 1px rgba(60, 230, 172, 0.34), 0 18px 56px rgba(60, 230, 172, 0.2)",
} as const;

type BoxShadowPreset = keyof typeof BOX_SHADOW_PRESETS | "custom";

function colorFromCss(value: string): ParsedColor {
  return parseCssColor(value) ?? { red: 0, green: 0, blue: 0, alpha: 1 };
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFontData[]>;
  }
}

function sanitizeFontFilePart(value: string): string {
  return value
    .replace(/[^\w .-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function localFontSortScore(font: LocalFontData): number {
  const style = font.style?.toLowerCase() ?? "";
  const fullName = font.fullName?.toLowerCase() ?? "";
  if (style === "regular" || fullName.endsWith(" regular")) return 0;
  if (style === "normal" || fullName.endsWith(" normal")) return 1;
  if (style === "medium" || fullName.endsWith(" medium")) return 2;
  return 3;
}

function parseNumericValue(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumericValue(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? `${rounded}`
    : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

interface ParsedNumericToken {
  value: number;
  unit: string;
}

function parseNumericToken(value: string | undefined): ParsedNumericToken | null {
  if (!value) return null;
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)([a-z%]*)$/i);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  if (!Number.isFinite(parsed)) return null;
  return {
    value: parsed,
    unit: match[2] ?? "",
  };
}

function parsePxMetricValue(value: string): number | null {
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

function formatPxMetricValue(value: number): string {
  return `${formatNumericValue(value)}px`;
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

function buildBoxShadowPresetValue(preset: BoxShadowPreset, fallback: string | undefined): string {
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

function adjustNumericToken(
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

function CommitField({
  value,
  disabled,
  liveCommit,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  liveCommit?: boolean;
  onCommit: (nextValue: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);

  valueRef.current = value;

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(
    () => () => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    },
    [],
  );

  const commitDraft = (nextDraft: string) => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    if (nextDraft !== valueRef.current) {
      onCommit(nextDraft);
    }
  };

  const scheduleCommit = (nextDraft: string) => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      if (nextDraft !== valueRef.current) {
        onCommit(nextDraft);
      }
    }, 120);
  };

  return (
    <input
      type="text"
      value={draft}
      disabled={disabled}
      onChange={(e) => {
        setDraft(e.target.value);
        if (liveCommit) scheduleCommit(e.target.value);
      }}
      onBlur={() => commitDraft(draft)}
      onWheel={(e) => {
        if (disabled) return;
        const delta = e.deltaY === 0 ? e.deltaX : e.deltaY;
        if (delta === 0) return;
        const nextDraft = adjustNumericToken(draft, delta < 0 ? 1 : -1, e);
        if (!nextDraft) return;
        e.preventDefault();
        setDraft(nextDraft);
        scheduleCommit(nextDraft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
          return;
        }
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        const nextDraft = adjustNumericToken(draft, e.key === "ArrowUp" ? 1 : -1, e);
        if (!nextDraft) return;
        e.preventDefault();
        setDraft(nextDraft);
        scheduleCommit(nextDraft);
      }}
      title={parseNumericToken(value) ? "Scroll or use Arrow keys to adjust" : undefined}
      className="min-w-0 w-full bg-transparent text-[11px] font-medium text-neutral-100 outline-none disabled:cursor-not-allowed disabled:text-neutral-600"
    />
  );
}

function MetricField({
  label,
  value,
  disabled,
  liveCommit,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  liveCommit?: boolean;
  onCommit: (nextValue: string) => void;
}) {
  return (
    <div className={FIELD}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex-shrink-0 text-[11px] font-medium text-neutral-500">{label}</span>
        <CommitField
          value={value}
          disabled={disabled}
          liveCommit={liveCommit}
          onCommit={onCommit}
        />
      </div>
    </div>
  );
}

function TextAreaField({
  label,
  value,
  disabled,
  autoFocus,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onCommit: (nextValue: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedRef = useRef(false);
  const valueRef = useRef(value);

  valueRef.current = value;

  useEffect(() => {
    if (focusedRef.current) return;
    setDraft(value);
  }, [value]);

  useEffect(
    () => () => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!autoFocus) return;
    textareaRef.current?.focus();
  }, [autoFocus]);

  const commitDraft = (nextDraft: string) => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    if (nextDraft !== valueRef.current) {
      onCommit(nextDraft);
    }
  };

  const scheduleCommit = (nextDraft: string) => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      if (nextDraft !== valueRef.current) {
        onCommit(nextDraft);
      }
    }, 120);
  };

  return (
    <label className="grid min-w-0 gap-1.5">
      <span className={LABEL}>{label}</span>
      <div className={FIELD}>
        <textarea
          ref={textareaRef}
          value={draft}
          disabled={disabled}
          rows={4}
          onFocus={() => {
            focusedRef.current = true;
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            scheduleCommit(e.target.value);
          }}
          onBlur={() => {
            focusedRef.current = false;
            commitDraft(draft);
          }}
          className="w-full resize-none bg-transparent text-[11px] font-medium text-neutral-100 outline-none disabled:cursor-not-allowed disabled:text-neutral-600"
        />
      </div>
    </label>
  );
}

function formatTextFieldPreview(value: string): string {
  const collapsed = value.trim().replace(/\s+/g, " ");
  if (collapsed.length <= 56) return collapsed;
  return `${collapsed.slice(0, 55)}…`;
}

function getTextFieldColor(
  field: { computedStyles: Record<string, string> },
  inheritedStyles: Record<string, string>,
): string {
  return field.computedStyles.color || inheritedStyles.color || "rgb(0, 0, 0)";
}

function splitFontFamilies(value: string): string[] {
  const families: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (const char of value) {
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (char === "," && !quote) {
      if (current.trim()) families.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) families.push(current.trim());
  return families.map((family) => family.replace(/^["']|["']$/g, "").trim()).filter(Boolean);
}

function primaryFontFamily(value: string): string {
  return splitFontFamilies(value)[0] ?? "inherit";
}

function quoteFontFamily(family: string): string {
  const trimmed = family.trim();
  if (GENERIC_FONT_FAMILIES.has(trimmed.toLowerCase())) return trimmed;
  return `"${trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function buildFontFamilyValue(family: string): string {
  const trimmed = family.trim();
  if (!trimmed) return "inherit";
  if (GENERIC_FONT_FAMILIES.has(trimmed.toLowerCase())) return trimmed;
  return `${quoteFontFamily(trimmed)}, ui-sans-serif, system-ui, sans-serif`;
}

function collectDocumentFontFamilies(): string[] {
  if (typeof document === "undefined") return [];
  const fontSet = document.fonts;
  if (!fontSet) return [];
  return Array.from(fontSet, (fontFace) => fontFace.family.replace(/^["']|["']$/g, "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function uniqueFontFamilies(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const family = value.trim();
    if (!family) continue;
    const key = family.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(family);
  }
  return result;
}

function uniqueFontOptions(values: FontOption[]): FontOption[] {
  const seen = new Set<string>();
  const result: FontOption[] = [];
  for (const value of values) {
    const family = value.family.trim();
    if (!family) continue;
    const key = family.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ family, source: value.source });
  }
  return result;
}

function fontSourceRank(source: FontSource): number {
  if (source === "Current") return 0;
  if (source === "Document") return 1;
  if (source === "Imported") return 2;
  if (source === "Local") return 3;
  if (source === "Google") return 4;
  return 5;
}

function sortFontOptions(options: FontOption[]): FontOption[] {
  return [...options].sort((a, b) => {
    const rankDelta = fontSourceRank(a.source) - fontSourceRank(b.source);
    if (rankDelta !== 0) return rankDelta;

    const commonA = COMMON_LOCAL_FONT_FAMILIES.findIndex(
      (family) => family.toLowerCase() === a.family.toLowerCase(),
    );
    const commonB = COMMON_LOCAL_FONT_FAMILIES.findIndex(
      (family) => family.toLowerCase() === b.family.toLowerCase(),
    );
    const commonDelta =
      (commonA === -1 ? Number.MAX_SAFE_INTEGER : commonA) -
      (commonB === -1 ? Number.MAX_SAFE_INTEGER : commonB);

    return commonDelta === 0 ? a.family.localeCompare(b.family) : commonDelta;
  });
}

function fontSearchKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function fontMatchesQuery(family: string, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  const normalizedFamily = family.toLowerCase();
  if (normalizedFamily.includes(normalizedQuery)) return true;
  return fontSearchKey(family).includes(fontSearchKey(normalizedQuery));
}

function loadGoogleFontStylesheet(family: string): void {
  if (typeof document === "undefined") return;
  const trimmed = family.trim();
  if (!trimmed) return;

  const id = `studio-google-font-${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  if (document.getElementById(id)) return;

  const preconnect = document.querySelector('link[data-studio-google-font-preconnect="true"]');
  if (!preconnect) {
    const preconnectEl = document.createElement("link");
    preconnectEl.setAttribute("data-studio-google-font-preconnect", "true");
    preconnectEl.rel = "preconnect";
    preconnectEl.href = "https://fonts.gstatic.com";
    preconnectEl.crossOrigin = "anonymous";
    document.head.appendChild(preconnectEl);
  }

  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = googleFontStylesheetUrl(trimmed);
  document.head.appendChild(link);
}

function loadImportedFontStylesheet(asset: ImportedFontAsset): void {
  if (typeof document === "undefined") return;
  const id = `studio-imported-font-${asset.family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  if (document.getElementById(id)) return;

  const style = document.createElement("style");
  style.id = id;
  style.textContent = importedFontFaceCss(asset);
  document.head.appendChild(style);
}

function FontWeightField({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  onCommit: (nextValue: string) => void;
}) {
  const options = ["300", "400", "500", "600", "700", "800"];
  return (
    <div className={FIELD}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex-shrink-0 text-[11px] font-medium text-neutral-500">Weight</span>
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onCommit(e.target.value)}
          className="min-w-0 w-full appearance-none bg-transparent text-[11px] font-medium text-neutral-100 outline-none disabled:cursor-not-allowed disabled:text-neutral-600"
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function FontFamilyField({
  value,
  disabled,
  importedFonts,
  onImportFonts,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  importedFonts: ImportedFontAsset[];
  onImportFonts?: (files: FileList | File[]) => Promise<ImportedFontAsset[]>;
  onCommit: (nextValue: string) => void;
}) {
  const currentFamily = primaryFontFamily(value);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fontInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [localFonts, setLocalFonts] = useState<string[]>([]);
  const [localFontData, setLocalFontData] = useState<LocalFontData[]>([]);
  const [googleFonts, setGoogleFonts] = useState<string[]>(() => [...POPULAR_GOOGLE_FONT_FAMILIES]);
  const [loadingLocalFonts, setLoadingLocalFonts] = useState(false);
  const [loadingGoogleFonts, setLoadingGoogleFonts] = useState(false);
  const [importingFonts, setImportingFonts] = useState(false);
  const [fontNotice, setFontNotice] = useState<string | null>(null);
  const canQueryLocalFonts =
    typeof window !== "undefined" && typeof window.queryLocalFonts === "function";

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!containerRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/fonts")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { fonts?: string[] } | null) => {
        const fonts = data?.fonts;
        if (cancelled || !Array.isArray(fonts)) return;
        setLocalFonts((current) => uniqueFontFamilies([...current, ...fonts]));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingGoogleFonts(true);
    void fetch("/api/fonts/google")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { fonts?: string[] } | null) => {
        const fonts = data?.fonts;
        if (cancelled || !Array.isArray(fonts)) return;
        setGoogleFonts(uniqueFontFamilies([...fonts, ...POPULAR_GOOGLE_FONT_FAMILIES]));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoadingGoogleFonts(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (googleFonts.some((family) => family.toLowerCase() === currentFamily.toLowerCase())) {
      loadGoogleFontStylesheet(currentFamily);
    }
    const imported = importedFonts.find(
      (font) => font.family.toLowerCase() === currentFamily.toLowerCase(),
    );
    if (imported) loadImportedFontStylesheet(imported);
  }, [currentFamily, googleFonts, importedFonts]);

  const loadBrowserLocalFonts = async () => {
    if (!canQueryLocalFonts || !window.queryLocalFonts) {
      setFontNotice("This browser does not expose installed fonts. Import a font file instead.");
      return;
    }
    setLoadingLocalFonts(true);
    setFontNotice(null);
    try {
      const fonts = await window.queryLocalFonts();
      const sortedFonts = [...fonts].sort((a, b) => localFontSortScore(a) - localFontSortScore(b));
      const families = sortedFonts
        .map((font) => font.family)
        .filter((name): name is string => Boolean(name))
        .map((name) => fontFamilyFromAssetPath(`${name}.ttf`));
      setLocalFontData(sortedFonts);
      setLocalFonts((current) => uniqueFontFamilies([...current, ...families]));
      setFontNotice(fonts.length === 0 ? "No browser-local fonts were returned." : null);
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      setFontNotice(
        name === "NotAllowedError"
          ? "Local font access was denied. Import a font file instead."
          : "Local font access is unavailable. Import a font file instead.",
      );
    } finally {
      setLoadingLocalFonts(false);
    }
  };

  const handleImportFonts = async (files: FileList | File[] | null) => {
    if (!files?.length || !onImportFonts) return;
    setImportingFonts(true);
    setFontNotice(null);
    try {
      const imported = await onImportFonts(files);
      for (const font of imported) loadImportedFontStylesheet(font);
      const first = imported[0];
      if (first) {
        onCommit(buildFontFamilyValue(first.family));
        setQuery("");
        setOpen(false);
      } else {
        setFontNotice("No supported font files were imported.");
      }
    } finally {
      setImportingFonts(false);
    }
  };

  const projectFontAssets = useMemo(
    () =>
      uniqueFontOptions(
        importedFonts.map((font): FontOption => ({ family: font.family, source: "Imported" })),
      ),
    [importedFonts],
  );

  const options = useMemo(() => {
    const documentFonts = collectDocumentFontFamilies();
    return sortFontOptions(
      uniqueFontOptions([
        { family: currentFamily, source: "Current" },
        ...documentFonts.map((family): FontOption => ({ family, source: "Document" })),
        ...projectFontAssets,
        ...localFonts.map((family): FontOption => ({ family, source: "Local" })),
        ...googleFonts.map((family): FontOption => ({ family, source: "Google" })),
        ...DEFAULT_FONT_FAMILIES.map((family): FontOption => ({ family, source: "System" })),
      ]),
    );
  }, [currentFamily, googleFonts, localFonts, projectFontAssets]);

  const filteredOptions = useMemo(() => {
    const matches = options.filter((option) => fontMatchesQuery(option.family, query));
    return matches.slice(0, query.trim() ? 120 : 160);
  }, [options, query]);

  const importLocalFont = async (family: string): Promise<ImportedFontAsset | null> => {
    if (!onImportFonts) return null;
    const candidates = localFontData
      .filter((font) => fontFamilyFromAssetPath(`${font.family}.ttf`) === family)
      .sort((a, b) => localFontSortScore(a) - localFontSortScore(b));
    const font = candidates.find((entry) => typeof entry.blob === "function");
    if (!font?.blob) return null;

    const blob = await font.blob();
    const style = sanitizeFontFilePart(font.style ?? "Regular") || "Regular";
    const name = sanitizeFontFilePart(`${family} ${style}`) || family;
    const file = new File([blob], `${name}.ttf`, {
      type: blob.type || "font/ttf",
    });
    const imported = await onImportFonts([file]);
    return (
      imported.find((asset) => asset.family.toLowerCase() === family.toLowerCase()) ??
      imported[0] ??
      null
    );
  };

  const commitFamily = async (option: FontOption) => {
    if (option.source === "Local") {
      setImportingFonts(true);
      setFontNotice(null);
      try {
        const imported = await importLocalFont(option.family);
        if (imported) {
          loadImportedFontStylesheet(imported);
          onCommit(buildFontFamilyValue(imported.family));
          setQuery("");
          setOpen(false);
          return;
        }
        onCommit(buildFontFamilyValue(option.family));
        setQuery("");
        setOpen(false);
      } finally {
        setImportingFonts(false);
      }
      return;
    }

    if (option.source === "Google") {
      loadGoogleFontStylesheet(option.family);
    }
    const imported = importedFonts.find(
      (font) => font.family.toLowerCase() === option.family.toLowerCase(),
    );
    if (imported) loadImportedFontStylesheet(imported);
    onCommit(buildFontFamilyValue(option.family));
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative grid min-w-0 gap-1.5">
      <span className={LABEL}>Font family</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((next) => !next)}
        className={`${FIELD} flex h-10 items-center justify-between gap-3 text-left hover:border-neutral-700 disabled:cursor-not-allowed`}
      >
        <span
          className="min-w-0 flex-1 truncate text-[11px] font-medium text-neutral-100"
          style={{ fontFamily: value }}
        >
          {currentFamily}
        </span>
        <span className="flex-shrink-0 text-[10px] uppercase tracking-[0.14em] text-neutral-600">
          Font
        </span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950 shadow-2xl">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 border-b border-neutral-800 p-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              disabled={disabled}
              placeholder={loadingGoogleFonts ? "Loading Google Fonts..." : "Search fonts"}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setOpen(false);
                }
                if (e.key === "Enter" && filteredOptions[0]) {
                  e.preventDefault();
                  commitFamily(filteredOptions[0]);
                }
              }}
              className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-2 text-[11px] font-medium text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-600"
            />
            {canQueryLocalFonts && (
              <button
                type="button"
                disabled={disabled || loadingLocalFonts}
                onClick={loadBrowserLocalFonts}
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 text-[10px] font-medium text-neutral-400 transition-colors hover:border-neutral-600 hover:text-neutral-100 disabled:cursor-not-allowed disabled:text-neutral-700"
              >
                {loadingLocalFonts ? "..." : "Local"}
              </button>
            )}
            <button
              type="button"
              disabled={disabled || importingFonts || !onImportFonts}
              onClick={() => fontInputRef.current?.click()}
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 text-[10px] font-medium text-neutral-400 transition-colors hover:border-neutral-600 hover:text-neutral-100 disabled:cursor-not-allowed disabled:text-neutral-700"
            >
              {importingFonts ? "..." : "Import"}
            </button>
            <input
              ref={fontInputRef}
              type="file"
              accept=".ttf,.otf,.ttc,.woff,.woff2,.eot,font/*"
              multiple
              aria-label="Import local font files"
              disabled={disabled || importingFonts || !onImportFonts}
              className="hidden"
              onChange={async (event) => {
                await handleImportFonts(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
          {fontNotice && (
            <div className="border-b border-neutral-800 px-3 py-2 text-[10px] leading-4 text-neutral-500">
              {fontNotice}
            </div>
          )}
          <div className="max-h-64 overflow-y-auto p-1">
            {filteredOptions.length === 0 ? (
              <div className="px-2 py-3 text-[11px] text-neutral-500">No fonts found.</div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={`${option.source}-${option.family}`}
                  type="button"
                  onClick={() => commitFamily(option)}
                  className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-[11px] transition-colors ${
                    option.family === currentFamily
                      ? "bg-studio-accent/15 text-neutral-50"
                      : "text-neutral-300 hover:bg-neutral-900 hover:text-neutral-100"
                  }`}
                >
                  <span className="min-w-0 truncate font-medium">{option.family}</span>
                  <span className="flex-shrink-0 text-[9px] uppercase tracking-[0.14em] text-neutral-600">
                    {option.source}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ColorField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onCommit: (nextValue: string) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<FloatingPosition | null>(null);
  const [draftColor, setDraftColor] = useState<ParsedColor>(() => colorFromCss(value));
  const [hexDraft, setHexDraft] = useState(() => toHexColor(colorFromCss(value)).toUpperCase());
  const hsv = rgbToHsv(draftColor);
  const hueColor = formatCssColor({
    ...hsvToRgb({ hue: hsv.hue, saturation: 1, value: 1 }),
    alpha: 1,
  });
  const opaqueColor = formatCssColor({ ...draftColor, alpha: 1 });
  const currentColor = formatCssColor(draftColor);
  const saturationPercent = Math.round(hsv.saturation * 100);
  const brightnessPercent = Math.round(hsv.value * 100);
  const alphaPercent = Math.round(draftColor.alpha * 100);

  useEffect(() => {
    const nextColor = colorFromCss(value);
    setDraftColor(nextColor);
    setHexDraft(toHexColor(nextColor).toUpperCase());
  }, [value]);

  const updatePanelPosition = useCallback(() => {
    const anchor = buttonRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const measured = panelRef.current?.getBoundingClientRect();
    setPanelPosition(
      resolveFloatingPanelPosition(
        anchor,
        { width: window.innerWidth, height: window.innerHeight },
        {
          width: measured?.width || COLOR_PICKER_SIZE.width,
          height: measured?.height || COLOR_PICKER_SIZE.height,
        },
      ),
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePanelPosition();

    const handlePositionInvalidated = () => updatePanelPosition();
    window.addEventListener("resize", handlePositionInvalidated);
    window.addEventListener("scroll", handlePositionInvalidated, true);
    return () => {
      window.removeEventListener("resize", handlePositionInvalidated);
      window.removeEventListener("scroll", handlePositionInvalidated, true);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const commitColor = (nextColor: ParsedColor) => {
    setDraftColor(nextColor);
    setHexDraft(toHexColor(nextColor).toUpperCase());
    onCommit(formatCssColor(nextColor));
  };

  const commitHsv = (nextHsv: { hue?: number; saturation?: number; value?: number }) => {
    const rgb = hsvToRgb({
      hue: nextHsv.hue ?? hsv.hue,
      saturation: nextHsv.saturation ?? hsv.saturation,
      value: nextHsv.value ?? hsv.value,
    });
    commitColor({ ...rgb, alpha: draftColor.alpha });
  };

  const updateSaturationValue = (clientX: number, clientY: number, target: HTMLDivElement) => {
    const rect = target.getBoundingClientRect();
    const saturation = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const nextValue = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    commitHsv({ saturation, value: nextValue });
  };

  const handleHexCommit = (nextHex: string) => {
    setHexDraft(nextHex);
    const normalized = nextHex.trim().startsWith("#") ? nextHex.trim() : `#${nextHex.trim()}`;
    const parsed = parseCssColor(normalized);
    if (!parsed) return;
    commitColor({ ...parsed, alpha: draftColor.alpha });
  };

  const picker = open
    ? createPortal(
        <div
          ref={panelRef}
          className="fixed z-[9999] w-[292px] overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/50"
          style={{
            left: panelPosition?.left ?? -9999,
            top: panelPosition?.top ?? -9999,
          }}
        >
          <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-[11px] font-medium text-neutral-100">{label}</div>
              <div className="text-[9px] uppercase tracking-[0.16em] text-neutral-600">Color</div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-200"
              aria-label="Close color picker"
            >
              <X size={13} />
            </button>
          </div>
          <div className="space-y-3 p-3">
            <div
              className="relative h-36 cursor-crosshair overflow-hidden rounded-xl border border-neutral-700 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
              style={{
                backgroundColor: hueColor,
              }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                updateSaturationValue(event.clientX, event.clientY, event.currentTarget);
              }}
              onPointerMove={(event) => {
                if (event.buttons !== 1) return;
                updateSaturationValue(event.clientX, event.clientY, event.currentTarget);
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-white to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
              <div
                className="pointer-events-none absolute top-0 h-full w-px -translate-x-1/2 bg-white/70 shadow-[0_0_0_1px_rgba(0,0,0,0.45)] mix-blend-difference"
                style={{ left: `${hsv.saturation * 100}%` }}
              />
              <div
                className="pointer-events-none absolute left-0 h-px w-full -translate-y-1/2 bg-white/70 shadow-[0_0_0_1px_rgba(0,0,0,0.45)] mix-blend-difference"
                style={{ top: `${(1 - hsv.value) * 100}%` }}
              />
              <div
                className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.85),0_8px_18px_rgba(0,0,0,0.45)]"
                style={{
                  left: `${hsv.saturation * 100}%`,
                  top: `${(1 - hsv.value) * 100}%`,
                  backgroundColor: opaqueColor,
                }}
              />
            </div>

            <div className="flex min-w-0 items-center gap-3">
              <div
                className="h-9 w-9 flex-shrink-0 rounded-xl border border-neutral-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                style={{ backgroundColor: currentColor }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-medium text-neutral-100">
                  {currentColor}
                </div>
                <div className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-neutral-600">
                  S {saturationPercent}% · B {brightnessPercent}% · A {alphaPercent}%
                </div>
              </div>
            </div>

            <ColorSlider
              label="Hue"
              value={hsv.hue}
              min={0}
              max={360}
              step={1}
              displayValue={`${Math.round(hsv.hue)}°`}
              background="linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
              thumbColor={hueColor}
              disabled={disabled}
              onCommit={(nextHue) => commitHsv({ hue: nextHue })}
            />

            <ColorSlider
              label="Alpha"
              value={draftColor.alpha}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${alphaPercent}%`}
              background={`linear-gradient(90deg, transparent, ${opaqueColor})`}
              thumbColor={currentColor}
              disabled={disabled}
              onCommit={(nextAlpha) => commitColor({ ...draftColor, alpha: nextAlpha })}
            />

            <label className="grid gap-1.5">
              <span className={LABEL}>Hex</span>
              <input
                value={hexDraft}
                onChange={(event) => handleHexCommit(event.target.value)}
                className={`${FIELD} h-10 w-full text-[11px] font-medium outline-none`}
                spellCheck={false}
              />
            </label>
          </div>
        </div>,
        document.body,
      )
    : null;

  const openPicker = () => {
    if (disabled) return;
    setOpen((current) => !current);
    if (!open) {
      requestAnimationFrame(updatePanelPosition);
    }
  };

  return (
    <div className="grid min-w-0 gap-1.5">
      <span className={LABEL}>{label}</span>
      <button
        type="button"
        disabled={disabled}
        aria-label={`Pick ${label.toLowerCase()} color`}
        ref={buttonRef}
        onClick={openPicker}
        className={`${FIELD} flex items-center gap-3 text-left hover:border-neutral-700 disabled:cursor-not-allowed ${open ? "border-neutral-600" : ""}`}
      >
        <div
          className="relative h-7 w-7 flex-shrink-0 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
          style={{ backgroundColor: value || "transparent" }}
        />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-neutral-100">
          {value}
        </span>
      </button>
      {picker}
    </div>
  );
}

function ColorSlider({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  background,
  thumbColor,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  background: string;
  thumbColor: string;
  disabled?: boolean;
  onCommit: (nextValue: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const percent = ((value - min) / (max - min)) * 100;

  const commitFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const rawValue = min + ((clientX - rect.left) / rect.width) * (max - min);
    const stepped = Math.round(rawValue / step) * step;
    onCommit(Math.max(min, Math.min(max, stepped)));
  };

  const commitKeyboardValue = (nextValue: number) => {
    onCommit(Math.max(min, Math.min(max, nextValue)));
  };

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <span className={LABEL}>{label}</span>
        <span className="text-[10px] font-medium text-neutral-400">{displayValue}</span>
      </div>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-disabled={disabled}
        className={`relative h-4 rounded-full border border-neutral-700 shadow-[inset_0_1px_2px_rgba(0,0,0,0.55)] outline-none focus:border-[#f5a400] focus:ring-2 focus:ring-[#f5a400]/40 ${
          disabled ? "cursor-not-allowed opacity-50" : "cursor-ew-resize"
        }`}
        style={{ background }}
        onPointerDown={(event) => {
          if (disabled) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          commitFromClientX(event.clientX);
        }}
        onPointerMove={(event) => {
          if (disabled || event.buttons !== 1) return;
          commitFromClientX(event.clientX);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "ArrowRight" || event.key === "ArrowUp") {
            event.preventDefault();
            commitKeyboardValue(value + step);
          } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
            event.preventDefault();
            commitKeyboardValue(value - step);
          } else if (event.key === "Home") {
            event.preventDefault();
            commitKeyboardValue(min);
          } else if (event.key === "End") {
            event.preventDefault();
            commitKeyboardValue(max);
          }
        }}
      >
        <div
          className="pointer-events-none absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.85),0_6px_14px_rgba(0,0,0,0.5)]"
          style={{ left: `${Math.max(0, Math.min(100, percent))}%`, backgroundColor: thumbColor }}
        />
      </div>
    </div>
  );
}

function SliderControl({
  value,
  min,
  max,
  step,
  displayValue,
  formatDisplayValue,
  disabled,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  formatDisplayValue?: (nextValue: number) => string;
  disabled?: boolean;
  onCommit: (nextValue: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);

  valueRef.current = value;

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(
    () => () => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    },
    [],
  );

  const commitDraft = (nextDraft: number) => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    if (nextDraft !== valueRef.current) {
      onCommit(nextDraft);
    }
  };

  const scheduleCommit = (nextDraft: number) => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      if (nextDraft !== valueRef.current) {
        onCommit(nextDraft);
      }
    }, 40);
  };

  const renderedDisplayValue = formatDisplayValue?.(draft) ?? displayValue;

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          const nextDraft = Number(e.target.value);
          setDraft(nextDraft);
          scheduleCommit(nextDraft);
        }}
        onMouseUp={() => commitDraft(draft)}
        onTouchEnd={() => commitDraft(draft)}
        onBlur={() => commitDraft(draft)}
        className="h-2 min-w-0 w-full cursor-pointer appearance-none rounded-full bg-neutral-800 accent-[#3ce6ac] disabled:cursor-not-allowed"
      />
      <div className="min-w-[52px] rounded-xl border border-neutral-800 bg-neutral-900 px-2 py-2 text-right text-[11px] font-medium text-neutral-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        {renderedDisplayValue}
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  disabled,
  options,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  options: string[];
  onChange: (nextValue: string) => void;
}) {
  const renderedOptions = value && !options.includes(value) ? [value, ...options] : options;

  return (
    <label className="grid min-w-0 gap-1.5">
      <span className={LABEL}>{label}</span>
      <div className={FIELD}>
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 w-full appearance-none bg-transparent text-[11px] font-medium text-neutral-100 outline-none disabled:cursor-not-allowed disabled:text-neutral-600"
        >
          {renderedOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

function Section({
  title,
  icon,
  children,
  accessory,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  accessory?: ReactNode;
}) {
  return (
    <section className="min-w-0 border-t border-neutral-800/80 px-4 py-4">
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex-shrink-0 text-neutral-500">{icon}</span>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-300">
            {title}
          </h3>
        </div>
        {accessory}
      </div>
      {children}
    </section>
  );
}

export type PropertyPanelSectionId = "Text" | "Layout" | "Colors" | "Radius" | "Shadow";

export function getPropertyPanelVisibleSections(input: {
  hasSelection: boolean;
  canEditStyles: boolean;
  hasTextControls: boolean;
  hasColorControls: boolean;
}): PropertyPanelSectionId[] {
  if (!input.hasSelection) return [];

  const sections: PropertyPanelSectionId[] = [];
  if (input.hasTextControls) sections.push("Text");
  sections.push("Layout");
  if (input.canEditStyles) {
    if (input.hasColorControls) sections.push("Colors");
    sections.push("Radius", "Shadow");
  }
  return sections;
}

export function isPropertyPanelMediaLikeSelection(input: {
  tagName: string;
  styles: Record<string, string>;
}): boolean {
  if (["img", "video", "audio", "canvas"].includes(input.tagName)) return true;
  const backgroundImage = input.styles["background-image"]?.trim();
  return Boolean(backgroundImage && backgroundImage !== "none");
}

export const PropertyPanel = memo(function PropertyPanel({
  element,
  multiSelectCount = 0,
  copiedAgentPrompt,
  onClearSelection,
  onSetStyle,
  onSetManualOffset,
  onSetManualSize,
  onSetRotation,
  onSetText,
  onSetTextFieldStyle,
  onResetManualEdits,
  onAskAgent,
  fontAssets = [],
  onImportFonts,
}: PropertyPanelProps) {
  const styles = element?.computedStyles ?? EMPTY_STYLES;
  const [activeTextFieldKey, setActiveTextFieldKey] = useState<string | null>(
    element?.textFields[0]?.key ?? null,
  );
  const hasTextControls = element != null && isTextEditableSelection(element);

  useEffect(() => {
    const nextFields = element?.textFields ?? [];
    setActiveTextFieldKey((current) => {
      if (current && nextFields.some((field) => field.key === current)) return current;
      return nextFields[0]?.key ?? null;
    });
  }, [element?.id, element?.selector, element?.textFields]);

  if (!element) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-neutral-900 px-6 text-center">
        {multiSelectCount > 1 ? (
          <>
            <Layers size={18} className="mb-3 text-neutral-600" />
            <p className="text-sm font-medium text-neutral-200">
              {multiSelectCount} elements selected
            </p>
            <p className="mt-2 max-w-[260px] text-xs leading-5 text-neutral-500">
              Select a single element to edit its properties. Click an element in the preview or use
              the timeline layer panel.
            </p>
          </>
        ) : (
          <>
            <Eye size={18} className="mb-3 text-neutral-600" />
            <p className="text-sm font-medium text-neutral-200">
              Select an element in the preview.
            </p>
            <p className="mt-2 max-w-[260px] text-xs leading-5 text-neutral-500">
              Click any element to inspect and edit it. Click deeper to select child elements.
            </p>
          </>
        )}
      </div>
    );
  }

  const styleEditingDisabled = !element.capabilities.canEditStyles;
  const manualOffsetEditingDisabled = !element.capabilities.canApplyManualOffset;
  const manualSizeEditingDisabled = !element.capabilities.canApplyManualSize;
  const radiusValue = parseNumericValue(styles["border-radius"]) ?? 0;
  const boxShadowPreset = inferBoxShadowPreset(styles["box-shadow"]);
  const sourceLabel = element.id ? `#${element.id}` : element.selector;
  const showEditableSections = element.capabilities.canEditStyles;
  const mediaLikeSelection = isPropertyPanelMediaLikeSelection({
    tagName: element.tagName,
    styles,
  });
  const bgColor = styles["background-color"]?.trim();
  const hasExplicitFillColor =
    !mediaLikeSelection &&
    Boolean(bgColor) &&
    bgColor !== "rgba(0, 0, 0, 0)" &&
    bgColor !== "transparent";
  const canShowFillColor = hasExplicitFillColor;
  const canShowTextColor = !mediaLikeSelection && Boolean(styles.color?.trim());
  const visibleSections = getPropertyPanelVisibleSections({
    hasSelection: true,
    canEditStyles: showEditableSections,
    hasTextControls,
    hasColorControls: canShowFillColor || canShowTextColor,
  });
  const manualOffset = readStudioPathOffset(element.element);
  const manualSize = readStudioBoxSize(element.element);
  const manualRotation = readStudioRotation(element.element);
  const resolvedWidth =
    manualSize.width > 0
      ? manualSize.width
      : (parsePxMetricValue(styles.width ?? "") ?? element.boundingBox.width);
  const resolvedHeight =
    manualSize.height > 0
      ? manualSize.height
      : (parsePxMetricValue(styles.height ?? "") ?? element.boundingBox.height);

  const commitManualOffset = (axis: "x" | "y", nextValue: string) => {
    const parsed = parsePxMetricValue(nextValue);
    if (parsed == null) return;
    const current = readStudioPathOffset(element.element);
    onSetManualOffset(element, {
      x: axis === "x" ? parsed : current.x,
      y: axis === "y" ? parsed : current.y,
    });
  };

  const commitManualSize = (axis: "width" | "height", nextValue: string) => {
    const parsed = parsePxMetricValue(nextValue);
    if (parsed == null || parsed <= 0) return;
    const current = readStudioBoxSize(element.element);
    const width =
      current.width > 0
        ? current.width
        : (parsePxMetricValue(styles.width ?? "") ?? element.boundingBox.width);
    const height =
      current.height > 0
        ? current.height
        : (parsePxMetricValue(styles.height ?? "") ?? element.boundingBox.height);
    onSetManualSize(element, {
      width: axis === "width" ? parsed : width,
      height: axis === "height" ? parsed : height,
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-neutral-900 text-neutral-100">
      <div className="border-b border-neutral-800 px-4 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className={LABEL}>Document</div>
            <div className="mt-3 truncate text-[12px] font-semibold text-neutral-100">
              {element.label}
            </div>
            <div className="mt-1 truncate text-[11px] text-neutral-500">{sourceLabel}</div>
          </div>
          <button
            type="button"
            aria-label="Clear selection"
            onClick={onClearSelection}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-700 bg-neutral-950 text-neutral-500 shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-colors hover:border-neutral-600 hover:text-neutral-200"
          >
            <X size={13} />
          </button>
        </div>
        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onAskAgent}
            className="inline-flex h-8 items-center justify-center gap-2 rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 text-[11px] font-medium text-neutral-100 transition-colors hover:border-studio-accent/40 hover:text-studio-accent"
          >
            <MessageSquare size={15} />
            <span>{copiedAgentPrompt ? "Prompt copied" : "Ask agent"}</span>
          </button>
          <button
            type="button"
            onClick={() => onResetManualEdits(element)}
            title="Reset move, size, and rotation edits"
            className="inline-flex h-8 items-center justify-center gap-2 rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 text-[11px] font-medium text-neutral-100 transition-colors hover:border-neutral-500 hover:text-white"
          >
            <RotateCcw size={14} />
            <span>Reset edits</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {visibleSections.includes("Text") && (
          <Section title="Text" icon={<Type size={15} />}>
            {(() => {
              const textFields = element.textFields;
              const activeField =
                textFields.find((field) => field.key === activeTextFieldKey) ?? textFields[0];
              if (!activeField) return null;

              return (
                <div className="space-y-4">
                  {textFields.length > 1 && (
                    <div className="grid gap-2">
                      <span className={LABEL}>Text layers</span>
                      {textFields.map((field, index) => {
                        const active = field.key === activeField.key;
                        return (
                          <button
                            key={field.key}
                            type="button"
                            onClick={() => setActiveTextFieldKey(field.key)}
                            className={`min-w-0 w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                              active
                                ? "border-studio-accent/50 bg-studio-accent/10"
                                : "border-neutral-800 bg-neutral-900/80 hover:border-neutral-700 hover:bg-neutral-900"
                            }`}
                          >
                            <div className="flex min-w-0 items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <span
                                  className="h-4 w-4 flex-shrink-0 rounded border border-neutral-700 bg-neutral-950"
                                  style={{ backgroundColor: getTextFieldColor(field, styles) }}
                                />
                                <span className="min-w-0 truncate text-[11px] font-medium text-neutral-100">
                                  {formatTextFieldPreview(field.value) || `Text ${index + 1}`}
                                </span>
                              </div>
                              <span className="flex-shrink-0 rounded-md border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-neutral-500">
                                {field.tagName}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
                    <TextAreaField
                      key={activeField.key}
                      label="Content"
                      value={activeField.value}
                      disabled={false}
                      onCommit={(next) => onSetText(next, activeField.key)}
                    />

                    <ColorField
                      label="Text color"
                      value={getTextFieldColor(activeField, styles)}
                      disabled={false}
                      onCommit={(next) => onSetTextFieldStyle(activeField.key, "color", next)}
                    />

                    <FontFamilyField
                      value={
                        activeField.computedStyles["font-family"] ||
                        styles["font-family"] ||
                        "inherit"
                      }
                      disabled={false}
                      importedFonts={fontAssets}
                      onImportFonts={onImportFonts}
                      onCommit={(next) => onSetTextFieldStyle(activeField.key, "font-family", next)}
                    />

                    <div className={RESPONSIVE_GRID}>
                      <MetricField
                        label="Size"
                        value={
                          activeField.computedStyles["font-size"] || styles["font-size"] || "16px"
                        }
                        disabled={false}
                        liveCommit
                        onCommit={(next) => onSetTextFieldStyle(activeField.key, "font-size", next)}
                      />
                      <FontWeightField
                        value={
                          activeField.computedStyles["font-weight"] ||
                          styles["font-weight"] ||
                          "400"
                        }
                        disabled={false}
                        onCommit={(next) =>
                          onSetTextFieldStyle(activeField.key, "font-weight", next)
                        }
                      />
                    </div>
                  </div>
                </div>
              );
            })()}
          </Section>
        )}

        {visibleSections.includes("Layout") && (
          <Section title="Layout" icon={<Move size={15} />}>
            <div className={RESPONSIVE_GRID}>
              <MetricField
                label="X"
                value={formatPxMetricValue(manualOffset.x)}
                disabled={manualOffsetEditingDisabled}
                onCommit={(next) => commitManualOffset("x", next)}
              />
              <MetricField
                label="Y"
                value={formatPxMetricValue(manualOffset.y)}
                disabled={manualOffsetEditingDisabled}
                onCommit={(next) => commitManualOffset("y", next)}
              />
              <MetricField
                label="W"
                value={formatPxMetricValue(resolvedWidth)}
                disabled={manualSizeEditingDisabled}
                onCommit={(next) => commitManualSize("width", next)}
              />
              <MetricField
                label="H"
                value={formatPxMetricValue(resolvedHeight)}
                disabled={manualSizeEditingDisabled}
                onCommit={(next) => commitManualSize("height", next)}
              />
              <MetricField
                label="Rotate"
                value={`${formatNumericValue(manualRotation.angle)}°`}
                disabled={manualOffsetEditingDisabled}
                onCommit={(next) => {
                  const parsed = parseFloat(next.replace("°", "").trim());
                  if (Number.isFinite(parsed)) {
                    onSetRotation(element, { angle: parsed % 360 });
                  }
                }}
              />
            </div>
          </Section>
        )}

        {visibleSections.includes("Colors") && (
          <Section title="Colors" icon={<Palette size={15} />}>
            <div className="space-y-4">
              {canShowFillColor && (
                <ColorField
                  label="Fill color"
                  value={styles["background-color"] ?? "transparent"}
                  disabled={styleEditingDisabled}
                  onCommit={(next) => onSetStyle("background-color", next)}
                />
              )}
              {canShowTextColor && (
                <ColorField
                  label="Text color"
                  value={styles.color ?? "rgb(0, 0, 0)"}
                  disabled={styleEditingDisabled}
                  onCommit={(next) => onSetStyle("color", next)}
                />
              )}
            </div>
          </Section>
        )}

        {visibleSections.includes("Radius") && (
          <Section title="Radius" icon={<Settings size={15} />}>
            <SliderControl
              value={radiusValue}
              min={0}
              max={Math.max(240, Math.ceil(radiusValue))}
              step={1}
              disabled={styleEditingDisabled}
              displayValue={`${formatNumericValue(radiusValue)}px`}
              formatDisplayValue={(next) => `${formatNumericValue(next)}px`}
              onCommit={(next) => onSetStyle("border-radius", `${formatNumericValue(next)}px`)}
            />
          </Section>
        )}

        {visibleSections.includes("Shadow") && (
          <Section title="Shadow" icon={<Eye size={15} />}>
            <SelectField
              label="Box shadow"
              value={boxShadowPreset}
              disabled={styleEditingDisabled}
              onChange={(next) => {
                if (next === "custom") return;
                onSetStyle(
                  "box-shadow",
                  buildBoxShadowPresetValue(next as BoxShadowPreset, styles["box-shadow"]),
                );
              }}
              options={["custom", "none", "soft", "lift", "glow"]}
            />
          </Section>
        )}
      </div>
    </div>
  );
});
