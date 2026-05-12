import { useEffect, useMemo, useRef, useState } from "react";
import { googleFontStylesheetUrl, POPULAR_GOOGLE_FONT_FAMILIES } from "./fontCatalog";
import { fontFamilyFromAssetPath, importedFontFaceCss, type ImportedFontAsset } from "./fontAssets";
import {
  DEFAULT_FONT_FAMILIES,
  FIELD,
  GENERIC_FONT_FAMILIES,
  LABEL,
  localFontSortScore,
  sanitizeFontFilePart,
  sortFontOptions,
  uniqueFontFamilies,
  uniqueFontOptions,
  type FontOption,
  type LocalFontData,
} from "./propertyPanelHelpers";

/* ------------------------------------------------------------------ */
/*  Font helper functions                                              */
/* ------------------------------------------------------------------ */

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
  return families.map((f) => f.replace(/^["']|["']$/g, "").trim()).filter(Boolean);
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
  return Array.from(fontSet, (ff) => ff.family.replace(/^["']|["']$/g, "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function fontSearchKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function fontMatchesQuery(family: string, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  if (family.toLowerCase().includes(normalizedQuery)) return true;
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
    const el = document.createElement("link");
    el.setAttribute("data-studio-google-font-preconnect", "true");
    el.rel = "preconnect";
    el.href = "https://fonts.gstatic.com";
    el.crossOrigin = "anonymous";
    document.head.appendChild(el);
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

/* ------------------------------------------------------------------ */
/*  FontFamilyField                                                    */
/* ------------------------------------------------------------------ */

export function FontFamilyField({
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
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/fonts")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { fonts?: string[] } | null) => {
        if (cancelled || !Array.isArray(data?.fonts)) return;
        setLocalFonts((cur) => uniqueFontFamilies([...cur, ...data.fonts!]));
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
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { fonts?: string[] } | null) => {
        if (cancelled || !Array.isArray(data?.fonts)) return;
        setGoogleFonts(uniqueFontFamilies([...data.fonts!, ...POPULAR_GOOGLE_FONT_FAMILIES]));
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
    if (googleFonts.some((f) => f.toLowerCase() === currentFamily.toLowerCase())) {
      loadGoogleFontStylesheet(currentFamily);
    }
    const imported = importedFonts.find(
      (f) => f.family.toLowerCase() === currentFamily.toLowerCase(),
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
      const sorted = [...fonts].sort((a, b) => localFontSortScore(a) - localFontSortScore(b));
      const families = sorted
        .map((f) => f.family)
        .filter((name): name is string => Boolean(name))
        .map((name) => fontFamilyFromAssetPath(`${name}.ttf`));
      setLocalFontData(sorted);
      setLocalFonts((cur) => uniqueFontFamilies([...cur, ...families]));
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
        importedFonts.map((f): FontOption => ({ family: f.family, source: "Imported" })),
      ),
    [importedFonts],
  );

  const options = useMemo(() => {
    const documentFonts = collectDocumentFontFamilies();
    const googleSet = new Set(googleFonts.map((f) => f.toLowerCase()));
    const taggedLocal = localFonts.map(
      (family): FontOption => ({
        family,
        source: googleSet.has(family.toLowerCase()) ? "Google" : "Local",
      }),
    );
    return sortFontOptions(
      uniqueFontOptions([
        { family: currentFamily, source: "Current" },
        ...documentFonts.map((f): FontOption => ({ family: f, source: "Document" })),
        ...projectFontAssets,
        ...googleFonts.map((f): FontOption => ({ family: f, source: "Google" })),
        ...taggedLocal,
        ...DEFAULT_FONT_FAMILIES.map((f): FontOption => ({ family: f, source: "System" })),
      ]),
    );
  }, [currentFamily, googleFonts, localFonts, projectFontAssets]);

  const filteredOptions = useMemo(() => {
    const matches = options.filter((o) => fontMatchesQuery(o.family, query));
    if (query.trim()) return matches.slice(0, 200);
    const bySource = new Map<string, FontOption[]>();
    for (const m of matches) {
      const list = bySource.get(m.source) ?? [];
      list.push(m);
      bySource.set(m.source, list);
    }
    const result: FontOption[] = [];
    for (const s of ["Current", "Document", "Imported"]) result.push(...(bySource.get(s) ?? []));
    result.push(...(bySource.get("Google") ?? []).slice(0, 100));
    result.push(...(bySource.get("Local") ?? []).slice(0, 80));
    result.push(...(bySource.get("System") ?? []));
    return result;
  }, [options, query]);

  const importLocalFont = async (family: string): Promise<ImportedFontAsset | null> => {
    if (!onImportFonts) return null;
    const candidates = localFontData
      .filter((f) => fontFamilyFromAssetPath(`${f.family}.ttf`) === family)
      .sort((a, b) => localFontSortScore(a) - localFontSortScore(b));
    const font = candidates.find((entry) => typeof entry.blob === "function");
    if (!font?.blob) return null;
    const blob = await font.blob();
    const style = sanitizeFontFilePart(font.style ?? "Regular") || "Regular";
    const name = sanitizeFontFilePart(`${family} ${style}`) || family;
    const file = new File([blob], `${name}.ttf`, { type: blob.type || "font/ttf" });
    const imported = await onImportFonts([file]);
    return (
      imported.find((a) => a.family.toLowerCase() === family.toLowerCase()) ?? imported[0] ?? null
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
    if (option.source === "Google") loadGoogleFontStylesheet(option.family);
    const imported = importedFonts.find(
      (f) => f.family.toLowerCase() === option.family.toLowerCase(),
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
