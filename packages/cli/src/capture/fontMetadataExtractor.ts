/**
 * Extract font metadata from downloaded font files.
 *
 * Modern web frameworks (Next.js, Webpack) rename fonts with content hashes for
 * cache-busting, leaving downloaded files like `19cfc7226ec3afaa-s.woff2` with
 * no human-readable identification. The CSS @font-face mapping that originally
 * tied each hash back to a family name is often lost during capture.
 *
 * Every OpenType / WOFF / WOFF2 file embeds a `name` table (part of the spec
 * since 1996) containing the family, subfamily, full name, PostScript name,
 * weight class, and variation axes. Subsetting and hashing do not strip it.
 * This extractor uses `fontkit` to read the name table from each downloaded
 * font and writes a manifest the rest of the pipeline can consult instead of
 * guessing from filename patterns.
 *
 * Output: extracted/fonts-manifest.json with per-file metadata + per-family
 * aggregation. See FontsManifest type for shape.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as fontkit from "fontkit";
import type { Font, FontCollection } from "fontkit";

function isFontCollection(value: Font | FontCollection): value is FontCollection {
  return value.type === "TTC" || value.type === "DFont";
}

export interface FontFileMetadata {
  /** Filename relative to capture/assets/fonts/ (e.g. "19cfc7226ec3afaa-s.woff2") */
  file: string;
  /**
   * Canonical family name. Many static-weight font files package each weight as
   * a separate "family" in nameID 1 (e.g. "Inter Medium" instead of "Inter").
   * This field strips trailing weight tokens so multiple weights of the same
   * typographic family aggregate cleanly. See rawFamily for the unmodified value.
   */
  family: string;
  /**
   * Raw family name as extracted, before canonicalization. Source precedence:
   *   1. OpenType `name` table (nameID 16 if present, else nameID 1)
   *   2. Fallback: derived from the PostScript name (nameID 6) before the first
   *      `-` (e.g. PostScript "Inter-Regular" → "Inter")
   * Empty string when both the name table and PostScript name are absent
   * (i.e. when `identified` is false).
   */
  rawFamily: string;
  /** Subfamily / style name from nameID 17 or 2 (e.g. "Regular", "Bold Italic") */
  subfamily: string;
  /** PostScript name from nameID 6 (e.g. "Inter-Regular") */
  postscript: string;
  /**
   * Weight value. Typically the OS/2 `usWeightClass` (100–900) when present.
   * Other values you may see:
   *   - `0`: returned when the file is `identified: false` (no name-table data
   *     to infer from); treat as unknown.
   *   - `950`: emitted by the family-name canonicalization when a foundry
   *     packaged "ExtraBlack" or "UltraBlack" as its own family. This is
   *     outside the 100-900 standard range but mirrors the foundry intent.
   * For variable fonts, this is the file's default axis position — see
   * `variationAxes` for the available `wght` range.
   */
  weight: number;
  /** "normal" or "italic" — derived from subfamily and OS/2 fsSelection */
  style: "normal" | "italic";
  /** If this is a variable font, the axes present (e.g. ["wght", "slnt"]). Empty for static fonts. */
  variationAxes: string[];
  /** Whether identification came from the binary name table (the trustworthy source). */
  identified: boolean;
  /**
   * True when this is an ICON font — it has no basic Latin letters, or its glyphs live mostly in
   * the Unicode Private Use Area (Font Awesome, swiper-icons, a custom "hushly" icon set, …).
   * Consumers must NOT treat it as a text family: binding it to one renders headings as tofu/icons.
   */
  isIcon: boolean;
}

export interface FontFamilySummary {
  /** Family name */
  family: string;
  /** Distinct weights captured (from OS/2 weight class — for variable fonts shows the default) */
  weights: number[];
  /** Whether any file in this family is a variable font */
  variable: boolean;
  /** Number of files in this family (typically subsets of the same weight) */
  fileCount: number;
  /** Files in this family — useful for picking the @font-face src */
  files: string[];
}

export interface FontsManifest {
  /** Per-file metadata, one entry per downloaded font */
  files: FontFileMetadata[];
  /** Aggregated per-family summary — most useful for DESIGN.md authoring */
  families: FontFamilySummary[];
  /** Files where identification failed entirely. Should be empty for typical captures. */
  unidentified: string[];
  /** Generated-at timestamp + tool version for debugging */
  meta: { generatedAt: string; tool: string };
}

/**
 * Read all font files in fontsDir, extract metadata via fontkit, and write
 * the manifest to outputPath. Returns the manifest in case callers want to log it.
 *
 * Failures are non-fatal: if a single font's name table is missing or corrupt,
 * the file is added to `unidentified` and the rest continue. If the fonts
 * directory doesn't exist, returns an empty manifest without throwing.
 */
export function extractFontMetadata(fontsDir: string, outputPath: string): FontsManifest {
  const files: FontFileMetadata[] = [];
  const unidentified: string[] = [];

  if (existsSync(fontsDir)) {
    const fontFiles = readdirSync(fontsDir).filter((f) => /\.(woff2?|ttf|otf)$/i.test(f));
    for (const filename of fontFiles) {
      const fullPath = join(fontsDir, filename);
      const meta = readSingleFont(fullPath, filename);
      if (meta.identified) {
        files.push(meta);
      } else {
        files.push(meta);
        unidentified.push(filename);
      }
    }
  }

  const families = aggregateFamilies(files);

  const manifest: FontsManifest = {
    files,
    families,
    unidentified,
    meta: {
      generatedAt: new Date().toISOString(),
      // Record just the tool name; the version moves with the dep and would
      // otherwise drift from a hardcoded string on every fontkit bump.
      tool: "fontkit",
    },
  };

  writeFileSync(outputPath, JSON.stringify(manifest, null, 2), "utf-8");
  return manifest;
}

// fallow-ignore-next-line complexity
function readSingleFont(fullPath: string, filename: string): FontFileMetadata {
  const empty: FontFileMetadata = {
    file: filename,
    family: "",
    rawFamily: "",
    subfamily: "",
    postscript: "",
    weight: 0,
    style: "normal",
    variationAxes: [],
    identified: false,
    isIcon: false,
  };

  try {
    const buf = readFileSync(fullPath);
    // fontkit.create returns Font | FontCollection. For TTC/DFont collections,
    // take the first font inside; otherwise the value is already a single Font.
    const created: Font | FontCollection = fontkit.create(buf);
    const font: Font | undefined = isFontCollection(created) ? created.fonts[0] : created;
    if (!font) return empty;

    const rawFamily = (font.familyName || "").trim();
    const subfamily = (font.subfamilyName || "").trim();
    const postscript = (font.postscriptName || "").trim();
    const fsSelection = font["OS/2"]?.fsSelection;
    const italicBit = Boolean(fsSelection?.italic || fsSelection?.oblique);
    const style: "normal" | "italic" =
      italicBit || /italic|oblique/i.test(subfamily) ? "italic" : "normal";
    const variationAxes = font.variationAxes ? Object.keys(font.variationAxes) : [];

    if (!rawFamily && !postscript) return empty; // name table empty — cannot identify

    const familyForCanonicalization = rawFamily || deriveFamilyFromPostscript(postscript);
    const { canonical, inferredWeight } = canonicalizeFamily(familyForCanonicalization);
    const weight =
      font["OS/2"]?.usWeightClass ?? inferredWeight ?? inferWeightFromSubfamily(subfamily);

    return {
      file: filename,
      family: canonical || familyForCanonicalization,
      rawFamily: familyForCanonicalization,
      subfamily,
      postscript,
      weight,
      style,
      variationAxes,
      identified: true,
      isIcon: detectIconFont(font),
    };
  } catch {
    return empty;
  }
}

/**
 * Detect an ICON font by glyph coverage rather than by name (icon fonts often have arbitrary
 * names like "hushly" or "swiper-icons" that no name-list can enumerate). See isIconCharacterSet
 * for the rule (lacks a Latin alphabet AND mostly Private-Use-Area glyphs). `characterSet` is a
 * fontkit runtime member not always in its typings, so it's read through a narrow local shape.
 */
function detectIconFont(font: Font): boolean {
  const f = font as unknown as { characterSet?: number[] };
  try {
    return isIconCharacterSet(Array.isArray(f.characterSet) ? f.characterSet : []);
  } catch {
    return false;
  }
}

/**
 * Detect an icon font from glyph coverage. Two conditions must BOTH hold:
 *   1. it lacks a real Latin alphabet (< 26 of A-Za-z) — a text font ships the full alphabet;
 *   2. most of its glyphs (> 50%) live in a Unicode Private Use Area.
 * The Latin gate is essential: some text fonts pack thousands of PUA glyphs yet are plainly text —
 * Apple's SF Pro (81% PUA, full A-Za-z, ships SF Symbols in the PUA), Descript's Booton (50% PUA,
 * full A-Za-z). Flagging those by PUA ratio alone strips a brand's real typeface. Measured icon
 * fonts: "hushly" 63% PUA / 7 letters, Font Awesome 95% PUA / 0 letters. Exported for testing.
 */
export function isIconCharacterSet(characterSet: number[]): boolean {
  if (!characterSet.length) return false;
  const isLatinLetter = (cp: number) => (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
  if (characterSet.filter(isLatinLetter).length >= 26) return false; // has an alphabet → a text font
  const inPua = (cp: number) => (cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0x10fffd);
  return characterSet.filter(inPua).length / characterSet.length > 0.5;
}

/** Aggregate per-file entries into per-family summaries — most useful shape for DESIGN.md. */
// fallow-ignore-next-line complexity
function aggregateFamilies(files: FontFileMetadata[]): FontFamilySummary[] {
  const byFamily = new Map<string, FontFamilySummary>();
  for (const f of files) {
    if (!f.family) continue;
    let entry = byFamily.get(f.family);
    if (!entry) {
      entry = { family: f.family, weights: [], variable: false, fileCount: 0, files: [] };
      byFamily.set(f.family, entry);
    }
    entry.fileCount++;
    entry.files.push(f.file);
    if (f.variationAxes.length > 0) entry.variable = true;
    if (f.weight && !entry.weights.includes(f.weight)) entry.weights.push(f.weight);
  }
  for (const entry of byFamily.values()) {
    entry.weights.sort((a, b) => a - b);
    entry.files.sort();
  }
  return Array.from(byFamily.values()).sort((a, b) => a.family.localeCompare(b.family));
}

/**
 * PostScript names follow the convention `Family-Style`. When the family name
 * record (nameID 1) is missing but PostScript is present, recover the family
 * portion as a best-effort fallback.
 */
function deriveFamilyFromPostscript(postscript: string): string {
  if (!postscript) return "";
  const dashIdx = postscript.indexOf("-");
  return (dashIdx > 0 ? postscript.slice(0, dashIdx) : postscript).trim();
}

/**
 * Fallback when OS/2 table is missing — guess weight from "Bold", "Light", etc.
 *
 * Normalizes spaces and hyphens out of the subfamily before matching so that
 * fonts using spaced names ("Extra Light", "Semi Bold") or hyphenated names
 * ("Extra-Light", "Semi-Bold") resolve to the same weight as the concatenated
 * forms ("ExtraLight", "SemiBold"). Without this, a font subfamily of
 * "Extra Light" would fall through every concat check and end at the 400
 * default, misreporting a 200-weight font as 400.
 *
 * Exported for unit testing.
 */
// fallow-ignore-next-line complexity
export function inferWeightFromSubfamily(subfamily: string): number {
  const s = subfamily.toLowerCase().replace(/[\s-]+/g, "");
  if (s.includes("thin")) return 100;
  if (s.includes("extralight") || s.includes("ultralight")) return 200;
  if (s.includes("light")) return 300;
  if (s.includes("medium")) return 500;
  if (s.includes("semibold") || s.includes("demibold")) return 600;
  if (s.includes("extrabold") || s.includes("ultrabold")) return 800;
  if (s.includes("black") || s.includes("heavy")) return 900;
  if (s.includes("bold")) return 700;
  return 400;
}

/**
 * Map of trailing weight tokens found in family names (e.g. "Inter Medium" →
 * "Inter") to their numeric OS/2 weight equivalent. Used to canonicalize family
 * names when a foundry packaged each weight as a separate "family" instead of
 * setting nameID 16 / 17 (Preferred Family / Subfamily).
 *
 * Conservative: only strips well-known English weight tokens. Width modifiers
 * like "Tight", "Condensed", "Extended" are intentionally NOT stripped — they
 * denote separate typographic families, not weight variants. Localized weight
 * tokens (German "Fett", "Extrafett"; French "Maigre"; etc.) and abbreviations
 * ("ExtBd", "ExtBlk") are not stripped either — the resulting family stays
 * separate, which is an honest representation of what's in the file.
 */
const WEIGHT_TOKEN_TO_VALUE: Record<string, number> = {
  Thin: 100,
  Hairline: 100,
  ExtraLight: 200,
  UltraLight: 200,
  Light: 300,
  Book: 400,
  Regular: 400,
  Normal: 400,
  Medium: 500,
  SemiBold: 600,
  DemiBold: 600,
  Bold: 700,
  ExtraBold: 800,
  UltraBold: 800,
  Black: 900,
  Heavy: 900,
  ExtraBlack: 950,
  UltraBlack: 950,
};

const WEIGHT_TOKEN_RE = new RegExp(`\\s+(${Object.keys(WEIGHT_TOKEN_TO_VALUE).join("|")})$`, "i");

/**
 * Strip a trailing weight token from a family name and return both the
 * canonicalized form and the weight value the stripped token implied.
 *
 * Examples:
 *   "Inter Medium"          → { canonical: "Inter", inferredWeight: 500 }
 *   "Inter Tight Medium"    → { canonical: "Inter Tight", inferredWeight: 500 }
 *   "Funnel Display Light"  → { canonical: "Funnel Display", inferredWeight: 300 }
 *   "Tiempos Headline"      → { canonical: "Tiempos Headline", inferredWeight: null }
 *   "Söhne Breit Extrafett" → { canonical: "Söhne Breit Extrafett", inferredWeight: null }
 *
 * Trailing "Italic"/"Oblique" is stripped before weight detection so families
 * like "Inter Italic" or "Inter Medium Italic" canonicalize correctly. The
 * italic flag is recovered separately from the OS/2 fsSelection bit, so no
 * information is lost.
 */
// Exported for unit testing.
// fallow-ignore-next-line complexity
export function canonicalizeFamily(family: string): {
  canonical: string;
  inferredWeight: number | null;
} {
  if (!family) return { canonical: family, inferredWeight: null };
  let result = family.trim();
  // Strip trailing "Italic" or "Oblique" first — handled by the style field.
  result = result.replace(/\s+(Italic|Oblique)$/i, "").trim();
  // Normalize compound weight tokens written with a space ("Semi Bold" → "SemiBold")
  // so the single-token matcher below catches them. Anchored to end-of-string to
  // avoid touching family names that legitimately contain these words mid-string.
  result = result.replace(
    /\s+(Semi|Extra|Ultra|Demi)\s+(Bold|Black|Light)$/i,
    (_, prefix: string, suffix: string) => ` ${capitalize(prefix)}${capitalize(suffix)}`,
  );
  // Strip trailing weight token if any.
  const match = result.match(WEIGHT_TOKEN_RE);
  if (match && match[1]) {
    // Look up the canonical (case-sensitive) key for the matched token.
    const matchedKey = Object.keys(WEIGHT_TOKEN_TO_VALUE).find(
      (k) => k.toLowerCase() === match[1]!.toLowerCase(),
    );
    const inferredWeight = matchedKey ? WEIGHT_TOKEN_TO_VALUE[matchedKey]! : null;
    result = result.slice(0, result.length - match[0].length).trim();
    return { canonical: result, inferredWeight };
  }
  return { canonical: result, inferredWeight: null };
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1).toLowerCase();
}
