import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ClipboardList,
  Eye,
  Layers,
  Move,
  Palette,
  Plus,
  RotateCcw,
  Settings,
  Type,
  X,
} from "../../icons/SystemIcons";
import { mergeColorWithExistingAlpha, parseCssColor, toColorPickerValue } from "./colorValue";
import {
  buildDefaultGradientModel,
  insertGradientStop,
  parseGradient,
  serializeGradient,
  type GradientModel,
} from "./gradientValue";
import { isTextEditableSelection, type DomEditSelection } from "./domEditing";
import {
  COMMON_LOCAL_FONT_FAMILIES,
  googleFontStylesheetUrl,
  POPULAR_GOOGLE_FONT_FAMILIES,
} from "./fontCatalog";
import { IMAGE_EXT } from "../../utils/mediaTypes";

type FocusedSection = "position" | "styles" | null;

interface PropertyPanelProps {
  projectId: string;
  assets: string[];
  element: DomEditSelection | null;
  copiedAgentPrompt: boolean;
  focusedSection?: FocusedSection;
  onFocusSectionHandled?: () => void;
  onClearSelection: () => void;
  onSetStyle: (prop: string, value: string) => void;
  onSetText: (value: string, fieldKey?: string) => void;
  onSetTextFieldStyle: (fieldKey: string, property: string, value: string) => void;
  onAddTextField: (afterFieldKey?: string) => string | Promise<string | null> | null;
  onRemoveTextField: (fieldKey: string) => void;
  onAskAgent: () => void;
  onImportAssets?: (files: FileList) => Promise<string[]>;
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
}

type FontSource = "Current" | "Document" | "Local" | "Google" | "System";

interface FontOption {
  family: string;
  source: FontSource;
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFontData[]>;
  }
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

function formatColorToken(value: string): string {
  const parsed = parseCssColor(value);
  if (!parsed) return value;
  const hex = toColorPickerValue(value).replace(/^#/, "").toUpperCase();
  return `${hex} / ${Math.round(parsed.alpha * 100)}%`;
}

function extractBackgroundImageUrl(value: string | undefined): string {
  if (!value) return "";
  const match = value.match(/url\((['"]?)(.*?)\1\)/i);
  return match?.[2] ?? "";
}

function normalizeProjectPath(value: string): string {
  const trimmed = value.trim();
  const maybeUrl = /^[a-z]+:\/\//i.test(trimmed) ? new URL(trimmed).pathname : trimmed;
  return decodeURIComponent(maybeUrl)
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
}

function toRelativeProjectAssetPath(sourceFile: string, assetPath: string): string {
  const fromParts = normalizeProjectPath(sourceFile).split("/").filter(Boolean);
  const targetParts = normalizeProjectPath(assetPath).split("/").filter(Boolean);

  fromParts.pop();

  while (fromParts.length > 0 && targetParts.length > 0 && fromParts[0] === targetParts[0]) {
    fromParts.shift();
    targetParts.shift();
  }

  return [...fromParts.map(() => ".."), ...targetParts].join("/") || assetPath;
}

function toProjectRootAssetPath(assetPath: string): string {
  return normalizeProjectPath(assetPath);
}

function resolveSelectedAsset(
  imageUrl: string,
  sourceFile: string,
  assets: string[],
): string | null {
  const normalizedUrl = normalizeProjectPath(imageUrl);
  if (!normalizedUrl) return null;

  for (const asset of assets) {
    const normalizedAsset = normalizeProjectPath(asset);
    const relativeAsset = toRelativeProjectAssetPath(sourceFile, asset);
    if (
      normalizedUrl === normalizedAsset ||
      normalizedUrl === relativeAsset ||
      normalizedUrl.endsWith(`/${normalizedAsset}`) ||
      normalizedUrl.endsWith(`/${relativeAsset}`)
    ) {
      return asset;
    }
  }

  return null;
}

function collectSelectionColors(styles: Record<string, string>) {
  const candidates = [
    { source: "Fill", value: styles["background-color"] },
    { source: "Text", value: styles.color },
  ];

  const deduped = new Map<string, { swatch: string; token: string; sources: string[] }>();

  for (const candidate of candidates) {
    if (!candidate.value) continue;
    const parsed = parseCssColor(candidate.value);
    if (!parsed || parsed.alpha <= 0) continue;

    const key = `${toColorPickerValue(candidate.value)}-${Math.round(parsed.alpha * 100)}`;
    const existing = deduped.get(key);
    if (existing) {
      existing.sources.push(candidate.source);
      continue;
    }

    deduped.set(key, {
      swatch: toColorPickerValue(candidate.value),
      token: formatColorToken(candidate.value),
      sources: [candidate.source],
    });
  }

  return Array.from(deduped.values());
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

function DetailField({
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
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className={LABEL}>{label}</span>
      <div className={FIELD}>
        <CommitField value={value} disabled={disabled} onCommit={onCommit} />
      </div>
    </label>
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

  useEffect(() => {
    if (!autoFocus) return;
    textareaRef.current?.focus();
  }, [autoFocus, label, value]);

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
          onChange={(e) => {
            setDraft(e.target.value);
            scheduleCommit(e.target.value);
          }}
          onBlur={() => commitDraft(draft)}
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
  if (source === "Local") return 2;
  if (source === "Google") return 3;
  return 4;
}

function sortFontOptions(options: FontOption[]): FontOption[] {
  return [...options].sort((a, b) => {
    const rankDelta = fontSourceRank(a.source) - fontSourceRank(b.source);
    return rankDelta === 0 ? a.family.localeCompare(b.family) : rankDelta;
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
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  onCommit: (nextValue: string) => void;
}) {
  const currentFamily = primaryFontFamily(value);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [localFonts, setLocalFonts] = useState<string[]>([]);
  const [googleFonts, setGoogleFonts] = useState<string[]>(() => [...POPULAR_GOOGLE_FONT_FAMILIES]);
  const [loadingLocalFonts, setLoadingLocalFonts] = useState(false);
  const [loadingGoogleFonts, setLoadingGoogleFonts] = useState(false);
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
  }, [currentFamily, googleFonts]);

  const loadBrowserLocalFonts = async () => {
    if (!canQueryLocalFonts || !window.queryLocalFonts) return;
    setLoadingLocalFonts(true);
    try {
      const fonts = await window.queryLocalFonts();
      setLocalFonts((current) =>
        uniqueFontFamilies([...current, ...fonts.map((font) => font.family).filter(Boolean)]),
      );
    } catch {
      // Browser permission can be denied; server and Google fonts still populate the picker.
    } finally {
      setLoadingLocalFonts(false);
    }
  };

  const options = useMemo(() => {
    const documentFonts = collectDocumentFontFamilies();
    return sortFontOptions(
      uniqueFontOptions([
        { family: currentFamily, source: "Current" },
        ...documentFonts.map((family): FontOption => ({ family, source: "Document" })),
        ...localFonts.map((family): FontOption => ({ family, source: "Local" })),
        ...googleFonts.map((family): FontOption => ({ family, source: "Google" })),
        ...DEFAULT_FONT_FAMILIES.map((family): FontOption => ({ family, source: "System" })),
      ]),
    );
  }, [currentFamily, googleFonts, localFonts]);

  const filteredOptions = useMemo(() => {
    const matches = options.filter((option) => fontMatchesQuery(option.family, query));
    return matches.slice(0, 90);
  }, [options, query]);

  const commitFamily = (option: FontOption) => {
    if (option.source === "Google") {
      loadGoogleFontStylesheet(option.family);
    }
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
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-neutral-800 p-2">
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
          </div>
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
  const pickerRef = useRef<HTMLInputElement | null>(null);
  const [pickerValue, setPickerValue] = useState(toColorPickerValue(value));

  useEffect(() => {
    setPickerValue(toColorPickerValue(value));
  }, [value]);

  const openPicker = () => {
    const picker = pickerRef.current;
    if (!picker || disabled) return;
    if (typeof picker.showPicker === "function") {
      picker.showPicker();
      return;
    }
    picker.click();
  };

  return (
    <div className="grid min-w-0 gap-1.5">
      <span className={LABEL}>{label}</span>
      <button
        type="button"
        disabled={disabled}
        aria-label={`Pick ${label.toLowerCase()} color`}
        onClick={openPicker}
        className={`${FIELD} flex items-center gap-3 text-left hover:border-neutral-700 disabled:cursor-not-allowed`}
      >
        <div
          className="relative h-7 w-7 flex-shrink-0 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
          style={{ backgroundColor: value || "transparent" }}
        />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-neutral-100">
          {value}
        </span>
      </button>
      <input
        ref={pickerRef}
        type="color"
        tabIndex={-1}
        disabled={disabled}
        value={pickerValue}
        onChange={(e) => {
          const nextValue = e.target.value;
          setPickerValue(nextValue);
          onCommit(mergeColorWithExistingAlpha(nextValue, value));
        }}
        className="pointer-events-none absolute opacity-0"
        aria-hidden="true"
      />
    </div>
  );
}

function ImageFillField({
  projectId,
  sourceFile,
  value,
  assets,
  disabled,
  onCommit,
  onImportAssets,
}: {
  projectId: string;
  sourceFile: string;
  value: string;
  assets: string[];
  disabled?: boolean;
  onCommit: (nextValue: string) => void;
  onImportAssets?: (files: FileList) => Promise<string[]>;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const imageAssets = useMemo(() => assets.filter((asset) => IMAGE_EXT.test(asset)), [assets]);
  const selectedAsset = useMemo(
    () => resolveSelectedAsset(value, sourceFile, imageAssets),
    [imageAssets, sourceFile, value],
  );
  const externalUrlValue = selectedAsset ? "" : value;

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length || !onImportAssets) return;
    setUploading(true);
    try {
      const uploaded = await onImportAssets(files);
      const nextImage = uploaded.find((asset) => IMAGE_EXT.test(asset));
      if (nextImage) {
        onCommit(`url("${toProjectRootAssetPath(nextImage)}")`);
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid min-w-0 gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <span className={LABEL}>Project asset</span>
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => fileInputRef.current?.click()}
            className={`inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 text-[11px] font-medium text-neutral-300 transition-colors ${
              disabled || uploading
                ? "cursor-not-allowed text-neutral-600"
                : "cursor-pointer hover:border-neutral-600 hover:text-white"
            }`}
          >
            <Plus size={12} className="flex-shrink-0" />
            <span className="truncate">{uploading ? "Uploading…" : "Upload image"}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            aria-label="Upload image asset"
            disabled={disabled || uploading}
            className="hidden"
            onChange={async (event) => {
              await handleUpload(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
        {imageAssets.length > 0 ? (
          <div className="space-y-3">
            {selectedAsset && (
              <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/80">
                <img
                  src={`/api/projects/${projectId}/preview/${selectedAsset}`}
                  alt={selectedAsset.split("/").pop() ?? selectedAsset}
                  className="h-28 w-full object-contain bg-neutral-950/80"
                />
              </div>
            )}
            <div className={FIELD}>
              <select
                value={selectedAsset ?? ""}
                disabled={disabled}
                onChange={(e) => {
                  const nextAsset = e.target.value;
                  if (!nextAsset) {
                    onCommit("none");
                    return;
                  }
                  onCommit(`url("${toProjectRootAssetPath(nextAsset)}")`);
                }}
                className="min-w-0 w-full appearance-none bg-transparent text-[11px] font-medium text-neutral-100 outline-none disabled:cursor-not-allowed disabled:text-neutral-600"
              >
                <option value="">None</option>
                {imageAssets.map((asset) => (
                  <option key={asset} value={asset}>
                    {asset}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/50 px-3 py-3 text-[11px] leading-5 text-neutral-500">
            No image assets yet. Upload one here and Studio will also add it to the Assets tab.
          </div>
        )}
      </div>

      <DetailField
        label="External URL"
        value={externalUrlValue}
        disabled={disabled}
        onCommit={(next) => onCommit(next.trim() ? `url("${next.trim()}")` : "none")}
      />
    </div>
  );
}

function GradientField({
  value,
  fallbackColor,
  disabled,
  onCommit,
}: {
  value: string;
  fallbackColor: string | undefined;
  disabled?: boolean;
  onCommit: (nextValue: string) => void;
}) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const parsed = parseGradient(value) ?? buildDefaultGradientModel(fallbackColor);

  const commit = (next: GradientModel) => onCommit(serializeGradient(next));

  const patch = (partial: Partial<GradientModel>) => commit({ ...parsed, ...partial });

  const updateStop = (index: number, partial: Partial<GradientModel["stops"][number]>) => {
    const stops = parsed.stops.map((stop, stopIndex) =>
      stopIndex === index ? { ...stop, ...partial } : stop,
    );
    commit({ ...parsed, stops });
  };

  const addStop = (position?: number) => {
    const nextGradient =
      position != null
        ? insertGradientStop(parsed, position)
        : insertGradientStop(
            parsed,
            parsed.stops.at(-1)?.position != null
              ? Math.min(100, (parsed.stops.at(-1)?.position ?? 90) + 10)
              : 100,
          );
    commit(nextGradient);
  };

  const removeStop = (index: number) => {
    if (parsed.stops.length <= 2) return;
    commit({ ...parsed, stops: parsed.stops.filter((_, stopIndex) => stopIndex !== index) });
  };

  const previewStyle = {
    backgroundImage: serializeGradient(parsed),
  };

  return (
    <div className="space-y-4">
      <div className={`${FIELD} space-y-3 p-3`}>
        <div
          ref={previewRef}
          className="relative h-11 overflow-hidden rounded-lg border border-neutral-700"
          style={previewStyle}
          onClick={(event) => {
            if (disabled) return;
            const rect = previewRef.current?.getBoundingClientRect();
            if (!rect || rect.width <= 0) return;
            const position = ((event.clientX - rect.left) / rect.width) * 100;
            addStop(position);
          }}
        >
          {parsed.stops.map((stop, index) => (
            <div
              key={`${stop.color}-${stop.position}-${index}`}
              className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
              style={{
                left: `calc(${stop.position}% - 8px)`,
                backgroundColor: stop.color,
              }}
            />
          ))}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SegmentedControl
            disabled={disabled}
            value={parsed.kind}
            onChange={(next) => patch({ kind: next as GradientModel["kind"] })}
            options={[
              { label: "Linear", value: "linear" },
              { label: "Radial", value: "radial" },
              { label: "Conic", value: "conic" },
            ]}
          />
          <label className="flex items-center gap-2 text-[11px] font-medium text-neutral-400">
            <input
              type="checkbox"
              checked={parsed.repeating}
              disabled={disabled}
              onChange={(e) => patch({ repeating: e.target.checked })}
              className="h-4 w-4 rounded border-neutral-700 bg-neutral-950 text-[#3ce6ac] focus:ring-[#3ce6ac]"
            />
            Repeat
          </label>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              commit({
                ...parsed,
                stops: [...parsed.stops].reverse().map((stop) => ({
                  ...stop,
                  position: 100 - stop.position,
                })),
              })
            }
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 text-[11px] font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:text-white disabled:cursor-not-allowed disabled:text-neutral-600"
          >
            <RotateCcw size={12} />
            Reverse
          </button>
        </div>
      </div>

      {(parsed.kind === "linear" || parsed.kind === "conic") && (
        <div className="grid gap-1.5">
          <span className={LABEL}>{parsed.kind === "linear" ? "Angle" : "Start angle"}</span>
          <SliderControl
            value={parsed.angle}
            min={0}
            max={360}
            step={1}
            disabled={disabled}
            displayValue={`${Math.round(parsed.angle)}°`}
            formatDisplayValue={(next) => `${Math.round(next)}°`}
            onCommit={(next) => patch({ angle: next })}
          />
        </div>
      )}

      {parsed.kind === "radial" && (
        <div className={RESPONSIVE_GRID}>
          <SelectField
            label="Shape"
            value={parsed.shape}
            disabled={disabled}
            onChange={(next) => patch({ shape: next as GradientModel["shape"] })}
            options={["ellipse", "circle"]}
          />
          <SelectField
            label="Size"
            value={parsed.radialSize}
            disabled={disabled}
            onChange={(next) => patch({ radialSize: next as GradientModel["radialSize"] })}
            options={["closest-side", "closest-corner", "farthest-side", "farthest-corner"]}
          />
        </div>
      )}

      {(parsed.kind === "radial" || parsed.kind === "conic") && (
        <div className={RESPONSIVE_GRID}>
          <div className="grid min-w-0 gap-1.5">
            <span className={LABEL}>Center X</span>
            <SliderControl
              value={parsed.centerX}
              min={0}
              max={100}
              step={1}
              disabled={disabled}
              displayValue={`${Math.round(parsed.centerX)}%`}
              formatDisplayValue={(next) => `${Math.round(next)}%`}
              onCommit={(next) => patch({ centerX: next })}
            />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <span className={LABEL}>Center Y</span>
            <SliderControl
              value={parsed.centerY}
              min={0}
              max={100}
              step={1}
              disabled={disabled}
              displayValue={`${Math.round(parsed.centerY)}%`}
              formatDisplayValue={(next) => `${Math.round(next)}%`}
              onCommit={(next) => patch({ centerY: next })}
            />
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className={LABEL}>Stops</span>
          <button
            type="button"
            disabled={disabled || parsed.stops.length >= 6}
            onClick={() => addStop()}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 text-[11px] font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:text-white disabled:cursor-not-allowed disabled:text-neutral-600"
          >
            <Plus size={12} />
            Add stop
          </button>
        </div>
        <div className="space-y-3">
          {parsed.stops.map((stop, index) => (
            <div
              key={`${stop.color}-${stop.position}-${index}`}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_68px_28px] gap-2"
            >
              <ColorField
                label={`Stop ${index + 1}`}
                value={stop.color}
                disabled={disabled}
                onCommit={(next) => updateStop(index, { color: next })}
              />
              <DetailField
                label="Pos"
                value={`${Math.round(stop.position)}%`}
                disabled={disabled}
                onCommit={(next) =>
                  updateStop(index, {
                    position: Number.parseFloat(next.replace("%", "")) || 0,
                  })
                }
              />
              <button
                type="button"
                disabled={disabled || parsed.stops.length <= 2}
                onClick={() => removeStop(index)}
                className="mt-[22px] flex h-10 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-950 text-neutral-400 transition-colors hover:border-neutral-600 hover:text-white disabled:cursor-not-allowed disabled:text-neutral-700"
                aria-label={`Remove stop ${index + 1}`}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
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

function SegmentedControl({
  options,
  value,
  disabled,
  onChange,
}: {
  options: Array<{ label: string; value: string }>;
  value: string;
  disabled?: boolean;
  onChange: (nextValue: string) => void;
}) {
  return (
    <div
      className="grid min-w-0 gap-1 rounded-xl bg-neutral-900 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`min-w-0 truncate rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed ${
              selected
                ? "bg-neutral-800 text-white shadow-[0_1px_3px_rgba(0,0,0,0.28)]"
                : "text-neutral-500 hover:text-neutral-200"
            }`}
          >
            {option.label}
          </button>
        );
      })}
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
          {options.map((option) => (
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
  sectionRef,
  accessory,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  sectionRef?: React.RefObject<HTMLDivElement | null>;
  accessory?: ReactNode;
}) {
  return (
    <section ref={sectionRef} className="min-w-0 border-t border-neutral-800/80 px-4 py-4">
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

function SelectionColorRow({
  swatch,
  token,
  sources,
}: {
  swatch: string;
  token: string;
  sources: string[];
}) {
  return (
    <div className={`${FIELD} flex min-w-0 items-center gap-3`}>
      <div
        className="h-7 w-7 flex-shrink-0 rounded-lg border border-neutral-700"
        style={{ backgroundColor: swatch }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium text-neutral-100">{token}</div>
        <div className="truncate text-[11px] uppercase tracking-[0.18em] text-neutral-500">
          {sources.join(" · ")}
        </div>
      </div>
    </div>
  );
}

export const PropertyPanel = memo(function PropertyPanel({
  projectId,
  assets,
  element,
  copiedAgentPrompt,
  focusedSection = null,
  onFocusSectionHandled,
  onClearSelection,
  onSetStyle,
  onSetText,
  onSetTextFieldStyle,
  onAddTextField,
  onRemoveTextField,
  onAskAgent,
  onImportAssets,
}: PropertyPanelProps) {
  const positionRef = useRef<HTMLDivElement | null>(null);
  const stylesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!focusedSection) return;
    const target = focusedSection === "position" ? positionRef.current : stylesRef.current;
    target?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    onFocusSectionHandled?.();
  }, [focusedSection, onFocusSectionHandled]);

  const styles = element?.computedStyles ?? EMPTY_STYLES;
  const selectionColors = useMemo(() => collectSelectionColors(styles), [styles]);
  const backgroundImage = styles["background-image"] ?? "none";
  const fillMode =
    backgroundImage && backgroundImage !== "none"
      ? backgroundImage.includes("gradient")
        ? "Gradient"
        : "Image"
      : "Solid";
  const [preferredFillMode, setPreferredFillMode] = useState(fillMode);
  const imageUrl = extractBackgroundImageUrl(backgroundImage);
  const [activeTextFieldKey, setActiveTextFieldKey] = useState<string | null>(
    element?.textFields[0]?.key ?? null,
  );

  useEffect(() => {
    setPreferredFillMode(fillMode);
  }, [fillMode, element?.id, element?.selector, backgroundImage]);

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
        <Eye size={18} className="mb-3 text-neutral-600" />
        <p className="text-sm font-medium text-neutral-200">Select an element in the preview.</p>
        <p className="mt-2 max-w-[260px] text-xs leading-5 text-neutral-500">
          The inspector is tuned for direct DOM edits with safer geometry controls, color picking,
          and cleaner Paper-style grouping.
        </p>
      </div>
    );
  }

  const styleEditingDisabled = !element.capabilities.canEditStyles;
  const moveEditingDisabled = styleEditingDisabled || !element.capabilities.canMove;
  const resizeEditingDisabled = styleEditingDisabled || !element.capabilities.canResize;
  const isFlex = styles.display === "flex" || styles.display === "inline-flex";
  const radiusValue = parseNumericValue(styles["border-radius"]) ?? 0;
  const opacityValue = Math.round((parseNumericValue(styles.opacity) ?? 1) * 100);
  const clipContent = ["hidden", "clip"].includes((styles.overflow ?? "").trim());
  const sourceLabel = element.id ? `#${element.id}` : element.selector;
  const showEditableSections = element.capabilities.canEditStyles;

  const handleFillModeChange = (nextMode: string) => {
    setPreferredFillMode(nextMode);
    if (nextMode === "Solid") {
      onSetStyle("background-image", "none");
      return;
    }
    if (nextMode === "Gradient" && !backgroundImage.includes("gradient")) {
      onSetStyle(
        "background-image",
        serializeGradient(buildDefaultGradientModel(styles["background-color"])),
      );
    }
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
        <button
          type="button"
          onClick={onAskAgent}
          className="mt-4 inline-flex h-8 items-center justify-center gap-2 rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 text-[11px] font-medium text-neutral-100 transition-colors hover:border-studio-accent/40 hover:text-studio-accent"
        >
          <ClipboardList size={15} />
          <span>{copiedAgentPrompt ? "Prompt copied" : "Ask agent"}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Section title="Layout" icon={<Move size={15} />} sectionRef={positionRef}>
          <div className={RESPONSIVE_GRID}>
            <MetricField
              label="X"
              value={styles.left ?? "auto"}
              disabled={moveEditingDisabled}
              onCommit={(next) => onSetStyle("left", next)}
            />
            <MetricField
              label="Y"
              value={styles.top ?? "auto"}
              disabled={moveEditingDisabled}
              onCommit={(next) => onSetStyle("top", next)}
            />
            <MetricField
              label="W"
              value={styles.width ?? "auto"}
              disabled={resizeEditingDisabled}
              onCommit={(next) => onSetStyle("width", next)}
            />
            <MetricField
              label="H"
              value={styles.height ?? "auto"}
              disabled={resizeEditingDisabled}
              onCommit={(next) => onSetStyle("height", next)}
            />
          </div>
          {element.capabilities.reasonIfDisabled && (
            <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[12px] leading-6 text-amber-200">
              {element.capabilities.reasonIfDisabled}
            </div>
          )}
        </Section>

        {showEditableSections && isFlex && (
          <Section title="Flex" icon={<Layers size={15} />}>
            <div className="space-y-4">
              <SegmentedControl
                disabled={styleEditingDisabled}
                value={styles["flex-direction"] || "row"}
                onChange={(next) => onSetStyle("flex-direction", next)}
                options={[
                  { label: "→ Row", value: "row" },
                  { label: "↓ Column", value: "column" },
                ]}
              />
              <div className={RESPONSIVE_GRID}>
                <SelectField
                  label="Justify"
                  value={styles["justify-content"] || "flex-start"}
                  disabled={styleEditingDisabled}
                  onChange={(next) => onSetStyle("justify-content", next)}
                  options={[
                    "flex-start",
                    "center",
                    "space-between",
                    "space-around",
                    "space-evenly",
                    "flex-end",
                  ]}
                />
                <SelectField
                  label="Align"
                  value={styles["align-items"] || "stretch"}
                  disabled={styleEditingDisabled}
                  onChange={(next) => onSetStyle("align-items", next)}
                  options={["stretch", "flex-start", "center", "flex-end", "baseline"]}
                />
              </div>
              <DetailField
                label="Gap"
                value={styles.gap ?? "0px"}
                disabled={styleEditingDisabled}
                onCommit={(next) => onSetStyle("gap", next.endsWith("px") ? next : `${next}px`)}
              />
              <label className="flex items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 px-3 py-3 text-[12px] text-neutral-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <input
                  type="checkbox"
                  checked={clipContent}
                  disabled={styleEditingDisabled}
                  onChange={(e) => onSetStyle("overflow", e.target.checked ? "hidden" : "visible")}
                  className="h-4 w-4 rounded border-neutral-700 bg-neutral-950 text-[#3ce6ac] focus:ring-[#3ce6ac]"
                />
                <span>Clip content</span>
              </label>
            </div>
          </Section>
        )}

        {showEditableSections && (
          <>
            <Section title="Radius" icon={<Settings size={15} />} sectionRef={stylesRef}>
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

            <Section title="Blending" icon={<Eye size={15} />}>
              <div className="space-y-4">
                <SliderControl
                  value={opacityValue}
                  min={0}
                  max={100}
                  step={1}
                  disabled={styleEditingDisabled}
                  displayValue={`${opacityValue}%`}
                  formatDisplayValue={(next) => `${Math.round(next)}%`}
                  onCommit={(next) => onSetStyle("opacity", formatNumericValue(next / 100))}
                />
                <SelectField
                  label="Mode"
                  value={styles["mix-blend-mode"] || "normal"}
                  disabled={styleEditingDisabled}
                  onChange={(next) => onSetStyle("mix-blend-mode", next)}
                  options={["normal", "multiply", "screen", "overlay", "darken", "lighten"]}
                />
              </div>
            </Section>

            <Section
              title="Fill"
              icon={<Palette size={15} />}
              accessory={
                <div className="rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-400">
                  {preferredFillMode}
                </div>
              }
            >
              <div className="space-y-4">
                <SegmentedControl
                  disabled={styleEditingDisabled}
                  value={preferredFillMode}
                  onChange={handleFillModeChange}
                  options={[
                    { label: "Solid", value: "Solid" },
                    { label: "Gradient", value: "Gradient" },
                    { label: "Image", value: "Image" },
                  ]}
                />
                {preferredFillMode === "Solid" ? (
                  <ColorField
                    label="Fill color"
                    value={styles["background-color"] ?? "transparent"}
                    disabled={styleEditingDisabled}
                    onCommit={(next) => onSetStyle("background-color", next)}
                  />
                ) : preferredFillMode === "Gradient" ? (
                  <GradientField
                    value={
                      backgroundImage !== "none"
                        ? backgroundImage
                        : serializeGradient(buildDefaultGradientModel(styles["background-color"]))
                    }
                    fallbackColor={styles["background-color"]}
                    disabled={styleEditingDisabled}
                    onCommit={(next) => onSetStyle("background-image", next)}
                  />
                ) : (
                  <ImageFillField
                    projectId={projectId}
                    sourceFile={element.sourceFile}
                    value={imageUrl}
                    assets={assets}
                    disabled={styleEditingDisabled}
                    onCommit={(next) => onSetStyle("background-image", next)}
                    onImportAssets={onImportAssets}
                  />
                )}
                <ColorField
                  label="Text color"
                  value={styles.color ?? "rgb(0, 0, 0)"}
                  disabled={styleEditingDisabled}
                  onCommit={(next) => onSetStyle("color", next)}
                />
              </div>
            </Section>

            {isTextEditableSelection(element) && (
              <Section title="Text" icon={<Type size={15} />}>
                {(() => {
                  const textFields = element.textFields;
                  const activeField =
                    textFields.find((field) => field.key === activeTextFieldKey) ?? textFields[0];
                  if (!activeField) return null;

                  if (textFields.length === 1) {
                    return (
                      <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-medium text-neutral-100">
                            {formatTextFieldPreview(activeField.value) || "Text"}
                          </div>
                          <div className="text-[10px] uppercase tracking-[0.12em] text-neutral-500">
                            {activeField.tagName}
                          </div>
                        </div>

                        <TextAreaField
                          label="Content"
                          value={activeField.value}
                          disabled={false}
                          onCommit={(next) => onSetText(next, activeField.key)}
                        />

                        <div className={RESPONSIVE_GRID}>
                          <MetricField
                            label="Size"
                            value={
                              activeField.computedStyles["font-size"] ||
                              styles["font-size"] ||
                              "16px"
                            }
                            disabled={false}
                            liveCommit
                            onCommit={(next) =>
                              onSetTextFieldStyle(activeField.key, "font-size", next)
                            }
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

                        <FontFamilyField
                          value={
                            activeField.computedStyles["font-family"] ||
                            styles["font-family"] ||
                            "inherit"
                          }
                          disabled={false}
                          onCommit={(next) =>
                            onSetTextFieldStyle(activeField.key, "font-family", next)
                          }
                        />
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-4">
                      <div className="grid gap-1.5">
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                          <span className={LABEL}>Text layers</span>
                          <button
                            type="button"
                            onClick={() => {
                              void Promise.resolve(onAddTextField(activeField.key)).then(
                                (nextKey) => {
                                  if (nextKey) setActiveTextFieldKey(nextKey);
                                },
                              );
                            }}
                            className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 text-[11px] font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:text-white"
                          >
                            <Plus size={12} className="flex-shrink-0" />
                            <span className="truncate">Add text</span>
                          </button>
                        </div>
                        <div className="grid gap-2">
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
                                  <span className="min-w-0 truncate text-[11px] font-medium text-neutral-100">
                                    {formatTextFieldPreview(field.value) || `Text ${index + 1}`}
                                  </span>
                                  <span className="flex-shrink-0 rounded-md border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-neutral-500">
                                    {field.tagName}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-[11px] font-medium text-neutral-100">
                              {formatTextFieldPreview(activeField.value) || "Text"}
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.12em] text-neutral-500">
                              {activeField.tagName}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => onRemoveTextField(activeField.key)}
                            className="inline-flex h-7 flex-shrink-0 items-center rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 text-[11px] font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:text-white"
                          >
                            Remove
                          </button>
                        </div>

                        <TextAreaField
                          key={activeField.key}
                          label="Content"
                          value={activeField.value}
                          disabled={false}
                          autoFocus
                          onCommit={(next) => onSetText(next, activeField.key)}
                        />

                        <div className={RESPONSIVE_GRID}>
                          <MetricField
                            label="Size"
                            value={activeField.computedStyles["font-size"] || "16px"}
                            disabled={false}
                            liveCommit
                            onCommit={(next) =>
                              onSetTextFieldStyle(activeField.key, "font-size", next)
                            }
                          />
                          <FontWeightField
                            value={activeField.computedStyles["font-weight"] || "400"}
                            disabled={false}
                            onCommit={(next) =>
                              onSetTextFieldStyle(activeField.key, "font-weight", next)
                            }
                          />
                        </div>

                        <FontFamilyField
                          value={
                            activeField.computedStyles["font-family"] ||
                            styles["font-family"] ||
                            "inherit"
                          }
                          disabled={false}
                          onCommit={(next) =>
                            onSetTextFieldStyle(activeField.key, "font-family", next)
                          }
                        />
                      </div>
                    </div>
                  );
                })()}
              </Section>
            )}

            {selectionColors.length > 0 && (
              <Section title="Selection colors" icon={<Palette size={15} />}>
                <div className="space-y-3">
                  {selectionColors.map((entry) => (
                    <SelectionColorRow
                      key={`${entry.swatch}-${entry.token}`}
                      swatch={entry.swatch}
                      token={entry.token}
                      sources={entry.sources}
                    />
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
});
