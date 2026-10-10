import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { FONT_ALIAS_MAP, resolveAliasDisplayName } from "./aliases.js";
import { locateSystemFontVariants, SYSTEM_FONT_SIZE_LIMIT } from "./systemFontLocator.js";
import { parseHTML } from "linkedom";
import postcss, { type AtRule, type Declaration, type Rule } from "postcss";
import { EMBEDDED_FONT_DATA } from "./fontData.generated.js";
import { fontToDataUri } from "./fontCompression.js";
import { authoredGoogleFontStylesheets, withPageText } from "./authoredGoogleFonts.js";
import {
  FontDiagCollector,
  type FontAssetDiag,
  type FontAttemptDiag,
  type FontDiagnostics,
  type FontDiagPath,
} from "./fontDiagnostics.js";

export type { FontDiagnostics };

type FontFaceSpec = {
  weight: string;
  style?: "normal" | "italic";
};

type CanonicalFontSpec = {
  packageName: string;
  faces: FontFaceSpec[];
};

/**
 * Family names that resolve to a host-OS font (or a CSS generic that the
 * browser substitutes with a host-OS font). Exported so plan-time validators
 * can reject them as primary families in distributed renders.
 *
 * Lower-cased — call `normalizeFamilyName` on declared values before lookup.
 */
export const GENERIC_FAMILIES: ReadonlySet<string> = new Set([
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "emoji",
  "math",
  "fangsong",
  "-apple-system",
  "blinkmacsystemfont",
]);

// Keywords valid as a whole font-family value; they name no font.
const CSS_WIDE_KEYWORDS: ReadonlySet<string> = new Set([
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
]);

/**
 * Parse a single `font-family` value (e.g. `"Inter", -apple-system,
 * sans-serif`) into a list of unquoted family names in declaration order.
 * Whitespace and surrounding `"…"` / `'…'` quotes are stripped; case is
 * preserved. Pass each name through `normalizeFamilyName` for case-
 * insensitive comparisons.
 *
 * Only top-level commas split: a `var(--x, fallback)` expression stays one
 * token, as does a comma inside a quoted family name.
 */
// fallow-ignore-next-line complexity
export function parseFontFamilyValue(value: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char !== "," || depth !== 0) continue;
    pieces.push(value.slice(start, index));
    start = index + 1;
  }
  pieces.push(value.slice(start));

  return pieces
    .map((piece) => piece.trim().replace(/^['"]/, "").replace(/['"]$/, "").trim())
    .filter((piece) => piece.length > 0);
}

function systemPrimaryReplacement(
  value: string,
  deterministicPrimary: string,
  customProperties: ReadonlyMap<string, string>,
): string | null {
  const variable = primaryCssVariable(value);
  if (variable) {
    if (customProperties.get(variable.name) || variable.fallback === null) return null;
    // Rewrite the fallback in place so a property defined at runtime still wins.
    const fallback = systemPrimaryReplacement(
      variable.fallback,
      deterministicPrimary,
      customProperties,
    );
    return fallback ? `var(${variable.name}, ${fallback})${variable.rest}` : null;
  }
  const families = parseFontFamilyValue(value);
  if (families.length === 0) return null;
  if (!GENERIC_FAMILIES.has(normalizeFamilyName(families[0]!))) return null;
  return `${deterministicPrimary}, ${value.trim()}`;
}

function parseCssRoot(css: string): postcss.Root | null {
  try {
    return postcss.parse(css);
  } catch {
    return null;
  }
}

function isFontFaceDeclaration(decl: Declaration): boolean {
  const parent = decl.parent;
  return parent?.type === "atrule" && (parent as AtRule).name.toLowerCase() === "font-face";
}

type PrimaryReplacer = (value: string) => string | null;

function normalizeCssDeclarations(root: postcss.Root, replacePrimary: PrimaryReplacer): boolean {
  let changed = false;
  root.walkDecls((decl) => {
    if (decl.prop.startsWith("--")) {
      const replacement = replacePrimary(decl.value);
      if (!replacement) return;
      decl.value = replacement;
      changed = true;
      return;
    }

    if (decl.prop.toLowerCase() !== "font-family") return;
    if (isFontFaceDeclaration(decl)) {
      return;
    }
    const replacement = replacePrimary(decl.value);
    if (!replacement) return;
    decl.value = replacement;
    changed = true;
  });

  return changed;
}

function normalizeCssFontFamilyDeclarations(css: string, replacePrimary: PrimaryReplacer): string {
  const root = parseCssRoot(css);
  if (!root) return css;
  const changed = normalizeCssDeclarations(root, replacePrimary);
  return changed ? root.toString() : css;
}

function normalizeInlineStyleAttribute(style: string, replacePrimary: PrimaryReplacer): string {
  const root = parseCssRoot(`*{${style}}`);
  if (!root) return style;
  const rule = root.first;
  if (rule?.type !== "rule") return style;
  const before = rule.toString();
  normalizeCssDeclarations(root, replacePrimary);
  if (rule.toString() === before) return style;
  const serialized = ((rule as Rule).nodes ?? []).map((node) => node.toString()).join("; ");
  return serialized.endsWith(";") ? serialized : `${serialized};`;
}

/**
 * Import/generated HTML often uses host UI stacks such as
 * `-apple-system, BlinkMacSystemFont, sans-serif` as a primary family. That is
 * fine on the author's machine but not in distributed render workers, where
 * host fonts differ by OS. Promote a bundled deterministic family to the
 * primary slot while preserving the original stack as fallbacks.
 */
export function normalizeSystemFontPrimaryFamilies(
  html: string,
  deterministicPrimary = "Inter",
): string {
  const { document } = parseHTML(html);
  const customProperties = collectFontFamilyCustomProperties(html);
  const replacePrimary: PrimaryReplacer = (value) =>
    systemPrimaryReplacement(value, deterministicPrimary, customProperties);
  let changed = false;

  for (const styleEl of Array.from(document.querySelectorAll("style"))) {
    const current = styleEl.textContent ?? "";
    const next = normalizeCssFontFamilyDeclarations(current, replacePrimary);
    if (next === current) continue;
    styleEl.textContent = next;
    changed = true;
  }

  for (const el of Array.from(document.querySelectorAll("[style]"))) {
    const current = el.getAttribute("style") ?? "";
    const next = normalizeInlineStyleAttribute(current, replacePrimary);
    if (next === current) continue;
    el.setAttribute("style", next);
    changed = true;
  }

  for (const el of Array.from(document.querySelectorAll("[data-font-family]"))) {
    const current = el.getAttribute("data-font-family") ?? "";
    const next = replacePrimary(current);
    if (!next) continue;
    el.setAttribute("data-font-family", next);
    changed = true;
  }

  return changed ? document.toString() : html;
}

/** Surfaces font-family is declared on in served HTML. */
export type FontFamilySurface = "font-family" | "data-font-family";

export type FontFamilyDeclaration = {
  surface: FontFamilySurface;
  declaration: string;
  families: string[];
};

function collectCssCustomProperties(css: string, customProperties: Map<string, string>): void {
  const root = parseCssRoot(css);
  if (!root) return;
  root.walkDecls((decl) => {
    if (!decl.prop.startsWith("--")) return;
    customProperties.set(decl.prop, decl.value);
  });
}

function* iterateCssRootFontFamilyDeclarations(
  root: postcss.Root,
): Generator<FontFamilyDeclaration> {
  const declarations: FontFamilyDeclaration[] = [];
  root.walkDecls((decl) => {
    if (decl.prop.toLowerCase() !== "font-family") return;
    if (isFontFaceDeclaration(decl)) return;
    const declaration = decl.value;
    declarations.push({
      surface: "font-family",
      declaration,
      families: parseFontFamilyValue(declaration),
    });
  });
  yield* declarations;
}

function* iterateCssFontFamilyDeclarations(css: string): Generator<FontFamilyDeclaration> {
  const root = parseCssRoot(css);
  if (!root) return;
  yield* iterateCssRootFontFamilyDeclarations(root);
}

function* iterateInlineStyleFontFamilyDeclarations(
  style: string,
): Generator<FontFamilyDeclaration> {
  const root = parseCssRoot(`*{${style}}`);
  if (!root) return;
  yield* iterateCssRootFontFamilyDeclarations(root);
}

/**
 * Collect simple CSS custom-property font aliases from style blocks and inline
 * styles. CSS cascade is richer than this map, but for compiler-generated
 * imports the common shape is `--font: Inter, sans-serif` paired with
 * `font-family: var(--font)`.
 */
export function collectFontFamilyCustomProperties(html: string): Map<string, string> {
  const { document } = parseHTML(html);
  const customProperties = new Map<string, string>();

  for (const styleEl of Array.from(document.querySelectorAll("style"))) {
    collectCssCustomProperties(styleEl.textContent ?? "", customProperties);
  }
  for (const el of Array.from(document.querySelectorAll("[style]"))) {
    collectCssCustomProperties(`*{${el.getAttribute("style") ?? ""}}`, customProperties);
  }

  return customProperties;
}

function primaryCssVariable(
  value: string,
): { name: string; fallback: string | null; rest: string } | null {
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith("var(")) return null;

  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char !== ")") continue;
    depth -= 1;
    if (depth !== 0) continue;

    const inner = trimmed.slice(4, index).trim();
    const commaIndex = inner.indexOf(",");
    const name = (commaIndex === -1 ? inner : inner.slice(0, commaIndex)).trim();
    if (!/^--[A-Za-z0-9_-]+$/.test(name)) return null;
    return {
      name,
      fallback: commaIndex === -1 ? null : inner.slice(commaIndex + 1),
      rest: trimmed.slice(index + 1),
    };
  }

  return null;
}

/**
 * `optional`: reached only through a var() fallback or a chain of var()s; not-found is skipped
 * and a transient failure warns instead of throwing.
 */
type ResolvedFamily = { family: string; optional: boolean };

// Deep enough for real alias chains; stops `--a: var(--b); --b: var(--a)` cycles.
const MAX_CSS_VARIABLE_DEPTH = 8;

function resolveDeclaredFamilies(
  declaration: string,
  customProperties: ReadonlyMap<string, string>,
  optional = false,
  depth = 0,
): ResolvedFamily[] {
  const tag = (families: string[]) => families.map((family) => ({ family, optional }));
  const families = parseFontFamilyValue(declaration);
  const variable = depth < MAX_CSS_VARIABLE_DEPTH ? primaryCssVariable(declaration) : null;
  if (!variable) return tag(families);

  const resolved = customProperties.get(variable.name);
  // An undefined property uses the var() fallback, as the browser does.
  const source = resolved || variable.fallback;
  if (source === null) return tag(families);
  const primary = resolveDeclaredFamilies(
    source,
    customProperties,
    !resolved || depth > 0,
    depth + 1,
  );
  // An empty substitution makes the declaration invalid, so the browser inherits instead.
  if (primary.length === 0) return [];
  return [...primary, ...tag(families.slice(1))];
}

export function resolveFontFamilyDeclarationFamilies(
  declaration: string,
  customProperties: ReadonlyMap<string, string>,
): string[] {
  return resolveDeclaredFamilies(declaration, customProperties).map(({ family }) => family);
}

/**
 * Iterate every font-family declaration in a compiled HTML document. Yields
 * each declaration's surface (CSS property vs HTML attribute), raw value,
 * and the parsed family list. Used by both the @font-face injector and the
 * plan-time validator so they read the same surface area.
 */
export function* iterateFontFamilyDeclarations(
  html: string,
): Generator<FontFamilyDeclaration, void, void> {
  const { document } = parseHTML(html);

  for (const styleEl of Array.from(document.querySelectorAll("style"))) {
    yield* iterateCssFontFamilyDeclarations(styleEl.textContent ?? "");
  }

  for (const el of Array.from(document.querySelectorAll("[style]"))) {
    yield* iterateInlineStyleFontFamilyDeclarations(el.getAttribute("style") ?? "");
  }

  for (const el of Array.from(document.querySelectorAll("[data-font-family]"))) {
    const declaration = el.getAttribute("data-font-family") ?? "";
    yield { surface: "data-font-family", declaration, families: parseFontFamilyValue(declaration) };
  }
}

const CANONICAL_FONTS: Record<string, CanonicalFontSpec> = {
  inter: {
    packageName: "@fontsource/inter",
    faces: [{ weight: "400" }, { weight: "700" }, { weight: "900" }],
  },
  montserrat: {
    packageName: "@fontsource/montserrat",
    faces: [{ weight: "400" }, { weight: "700" }, { weight: "900" }],
  },
  outfit: {
    packageName: "@fontsource/outfit",
    faces: [{ weight: "400" }, { weight: "700" }, { weight: "900" }],
  },
  nunito: {
    packageName: "@fontsource/nunito",
    faces: [{ weight: "400" }, { weight: "700" }, { weight: "900" }],
  },
  oswald: {
    packageName: "@fontsource/oswald",
    faces: [{ weight: "400" }, { weight: "700" }],
  },
  "league-gothic": {
    packageName: "@fontsource/league-gothic",
    faces: [{ weight: "400" }],
  },
  "archivo-black": {
    packageName: "@fontsource/archivo-black",
    faces: [{ weight: "400" }],
  },
  "space-mono": {
    packageName: "@fontsource/space-mono",
    faces: [{ weight: "400" }, { weight: "700" }],
  },
  "ibm-plex-mono": {
    packageName: "@fontsource/ibm-plex-mono",
    faces: [{ weight: "400" }, { weight: "700" }],
  },
  "jetbrains-mono": {
    packageName: "@fontsource/jetbrains-mono",
    faces: [{ weight: "400" }, { weight: "700" }],
  },
  "eb-garamond": {
    packageName: "@fontsource/eb-garamond",
    faces: [{ weight: "400" }, { weight: "700" }],
  },
  "playfair-display": {
    packageName: "@fontsource/playfair-display",
    faces: [{ weight: "400" }, { weight: "700" }, { weight: "900" }],
  },
  "source-code-pro": {
    packageName: "@fontsource/source-code-pro",
    faces: [{ weight: "400" }, { weight: "700" }],
  },
  "noto-sans-jp": {
    packageName: "@fontsource/noto-sans-jp",
    faces: [{ weight: "400" }, { weight: "700" }],
  },
  roboto: {
    packageName: "@fontsource/roboto",
    faces: [{ weight: "400" }, { weight: "700" }, { weight: "900" }],
  },
  "open-sans": {
    packageName: "@fontsource/open-sans",
    faces: [{ weight: "400" }, { weight: "700" }],
  },
  lato: {
    packageName: "@fontsource/lato",
    faces: [{ weight: "400" }, { weight: "700" }, { weight: "900" }],
  },
  poppins: {
    packageName: "@fontsource/poppins",
    faces: [{ weight: "400" }, { weight: "700" }, { weight: "900" }],
  },
};

// FONT_ALIASES derives from the shared alias map; every FONT_ALIAS_MAP value is a CANONICAL_FONTS key.
export const FONT_ALIASES = FONT_ALIAS_MAP as Record<string, keyof typeof CANONICAL_FONTS>;

export { FONT_ALIAS_KEYS } from "./aliases.js";
export { fontToDataUri } from "./fontCompression.js";

function normalizeFamilyName(family: string): string {
  return family
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .trim()
    .toLowerCase();
}

function fontDataUri(
  packageName: string,
  weight: string,
  style: "normal" | "italic" = "normal",
): string {
  const key = `${packageName}:${weight}:${style}`;
  const uri = EMBEDDED_FONT_DATA.get(key);
  if (!uri) {
    throw new Error(
      `No embedded font data for ${key}. Regenerate with: tsx scripts/generate-font-data.ts`,
    );
  }
  return uri;
}

function extractExistingFontFaces(html: string): Set<string> {
  const families = new Set<string>();
  const opening = /@font-face\s*\{/gi;
  const family = /font-family\s*:/gi;
  while (opening.exec(html)) {
    family.lastIndex = opening.lastIndex;
    let declaration = family.exec(html);
    // The original matcher requires at least one character before ';'.
    while (declaration && html[family.lastIndex] === ";") {
      declaration = family.exec(html);
    }
    // If this opener has no complete family/semicolon/closer suffix, no later
    // opener can have one. Never retry the same unmatched suffix.
    if (!declaration) break;
    const valueStart = family.lastIndex;
    const semicolon = html.indexOf(";", valueStart);
    if (semicolon < 0) break;
    const end = html.indexOf("}", semicolon + 1);
    if (end < 0) break;
    const normalized = normalizeFamilyName(html.slice(valueStart, semicolon));
    if (normalized) families.add(normalized);
    opening.lastIndex = end + 1;
  }
  return families;
}

function isFetchableFamilyName(normalized: string): boolean {
  if (!normalized || normalized.startsWith("var(")) return false;
  return !GENERIC_FAMILIES.has(normalized) && !CSS_WIDE_KEYWORDS.has(normalized);
}

function extractRequestedFontFamilies(html: string): Map<string, ResolvedFamily> {
  const requested = new Map<string, ResolvedFamily>();
  const customProperties = collectFontFamilyCustomProperties(html);
  for (const { declaration } of iterateFontFamilyDeclarations(html)) {
    for (const { family, optional } of resolveDeclaredFamilies(declaration, customProperties)) {
      const normalized = family.toLowerCase();
      if (!isFetchableFamilyName(normalized)) continue;
      const seen = requested.get(normalized);
      requested.set(normalized, {
        family: seen?.family ?? family,
        optional: (seen?.optional ?? true) && optional,
      });
    }
  }
  return requested;
}

export function fontFormatHint(src: string): "collection" | "woff2" {
  return src.startsWith("data:font/collection;") ? "collection" : "woff2";
}

// generate-font-data.ts embeds Fontsource's -latin- subset for every family.
const BUNDLED_SUBSET_UNICODE_RANGE =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, " +
  "U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

function isBundledSubsetRange(unicodeRange: string | undefined): boolean {
  const normalize = (range: string) => range.toLowerCase().replace(/\s+/g, "");
  return (
    unicodeRange !== undefined &&
    normalize(unicodeRange) === normalize(BUNDLED_SUBSET_UNICODE_RANGE)
  );
}

function buildFontFaceRule(
  familyName: string,
  src: string,
  weight: string,
  style: string,
  unicodeRange?: string,
): string {
  return [
    "@font-face {",
    `  font-family: "${familyName}";`,
    `  src: url("${src}") format("${fontFormatHint(src)}");`,
    `  font-style: ${style};`,
    `  font-weight: ${weight};`,
    "  font-display: block;",
    // Preserve the subset's unicode-range so the browser selects the right
    // per-codepoint subset (matching Google Fonts' own CSS semantics).
    ...(unicodeRange ? [`  unicode-range: ${unicodeRange};`] : []),
    "}",
  ].join("\n");
}

/**
 * Google serves several canonical families as a variable font: every static
 * weight resolves to the same woff2. Faces sharing a source can be emitted as
 * one weight-range rule instead of embedding that blob once per weight.
 *
 * Without `text=` the response is ordered weight-major, subset-minor, so those
 * faces are not adjacent — group by source rather than scanning neighbours.
 * Insertion order keeps the emitted CSS deterministic.
 */
function normalizeWeightKey(weight: string): string {
  const numeric = Number(weight);
  return Number.isFinite(numeric) ? String(numeric) : weight.trim().toLowerCase();
}

function coverageKey(weight: string, style: string): string {
  return `${normalizeWeightKey(weight)}:${style}`;
}

function groupFacesBySource(faces: readonly GoogleFontFace[]): GoogleFontFace[][] {
  const groups = new Map<string, GoogleFontFace[]>();
  for (const face of faces) {
    const key = [face.dataUri, face.style, face.unicodeRange ?? ""].join("\u0000");
    const existing = groups.get(key);
    if (existing) existing.push(face);
    else groups.set(key, [face]);
  }
  return [...groups.values()];
}

/**
 * A weight range must not span a weight the embedded bundle already serves, or
 * the later rule would win for that weight and shadow the bundled face.
 */
function spansCoveredWeight(
  from: GoogleFontFace,
  to: GoogleFontFace,
  coveredWeights: ReadonlySet<string>,
): boolean {
  const start = Number(from.weight);
  const end = Number(to.weight);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return true;
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  for (const covered of coveredWeights) {
    const [weight, style] = covered.split(":");
    if (style !== from.style) continue;
    const value = Number(weight);
    if (Number.isFinite(value) && value > low && value < high) return true;
  }
  return false;
}

/**
 * Split one source group into ascending runs, breaking wherever the embedded
 * bundle already covers a weight inside the span. A weight that is not a plain
 * number (a variable `100 900` range, say) cannot be ordered, so it stays on
 * its own.
 */
function partitionWeightRuns(
  faces: readonly GoogleFontFace[],
  coveredWeights: ReadonlySet<string>,
): GoogleFontFace[][] {
  const runs: GoogleFontFace[][] = [];
  const sortable = faces.filter((face) => Number.isFinite(Number(face.weight)));
  const unsortable = faces.filter((face) => !Number.isFinite(Number(face.weight)));

  let current: GoogleFontFace[] = [];
  for (const face of [...sortable].sort((a, b) => Number(a.weight) - Number(b.weight))) {
    const previous = current[current.length - 1];
    if (previous && spansCoveredWeight(previous, face, coveredWeights)) {
      runs.push(current);
      current = [];
    }
    current.push(face);
  }
  if (current.length > 0) runs.push(current);
  for (const face of unsortable) runs.push([face]);
  return runs;
}

// Path 1: pre-bundled fonts via FONT_ALIASES — emit embedded faces,
// then fetch from Google Fonts to fill missing weights and character subsets.
async function bundledFamilyFaceRules(
  canonical: CanonicalFontSpec,
  normalizedFamily: string,
  emitFamily: string,
  optional: boolean,
  options: InternalFontFetchOptions,
  fontText?: string,
): Promise<string[]> {
  const rules: string[] = [];
  const coveredWeights = new Set<string>();
  const bundledRules: string[] = [];
  for (const face of canonical.faces) {
    const style = face.style || "normal";
    const src = fontDataUri(canonical.packageName, face.weight, style);
    bundledRules.push(
      buildFontFaceRule(emitFamily, src, face.weight, style, BUNDLED_SUBSET_UNICODE_RANGE),
    );
    coveredWeights.add(coverageKey(face.weight, style));
  }

  // Fetch all weights from Google Fonts and add any that aren't
  // already covered by the embedded bundle. This ensures that
  // compositions requesting e.g. wght@200 get that weight even
  // if the bundle only ships 400/700/900. Query the CANONICAL
  // family, not the authored one: for a cross-typeface alias
  // (helvetica → inter) the authored name is a different typeface,
  // so supplementing from it would mix two typefaces under one
  // font-family. The faces are still emitted under
  // `emitFamily` so the authored CSS keeps matching.
  const canonicalFamily = resolveAliasDisplayName(normalizedFamily);
  const googleFaces = canonicalFamily
    ? await fetchFamilyFaces(canonicalFamily, "bundled_supplement", optional, options, fontText)
    : [];

  // Bundled weights only cover Latin. Keep other subsets (including
  // text= responses without a range), even for weights already embedded.
  const supplementary = googleFaces.filter(
    (face) =>
      !coveredWeights.has(coverageKey(face.weight, face.style)) ||
      !isBundledSubsetRange(face.unicodeRange),
  );
  const runs = groupFacesBySource(supplementary).flatMap((group) =>
    partitionWeightRuns(group, coveredWeights),
  );
  // Overlapping `unicode-range` rules resolve last-defined-first, so a run
  // is emitted where its first face appeared in the response rather than
  // grouped by source. Collapsing must not reorder the faces.
  const firstAppearance = (run: readonly GoogleFontFace[]): number =>
    Math.min(...run.map((face) => supplementary.indexOf(face)));
  for (const run of [...runs].sort((a, b) => firstAppearance(a) - firstAppearance(b))) {
    const first = run[0];
    const last = run[run.length - 1];
    if (!first || !last) continue;
    const weight = run.length > 1 ? `${first.weight} ${last.weight}` : first.weight;
    rules.push(
      buildFontFaceRule(emitFamily, first.dataUri, weight, first.style, first.unicodeRange),
    );
  }
  // Broader or text-subset responses can overlap Latin. Emit the bundle
  // last so existing Latin glyphs keep their deterministic bundled source.
  rules.push(...bundledRules);
  return rules;
}

// Path 2: fetch from Google Fonts (with local cache)
async function googleFamilyFaceRules(
  lookupFamily: string,
  emitFamily: string,
  optional: boolean,
  options: InternalFontFetchOptions,
  fontText?: string,
): Promise<string[] | null> {
  const googleFaces = await fetchFamilyFaces(
    lookupFamily,
    "direct_google",
    optional,
    options,
    fontText,
  );
  if (googleFaces.length === 0) return null;
  return googleFaces.map((face) =>
    buildFontFaceRule(emitFamily, face.dataUri, face.weight, face.style, face.unicodeRange),
  );
}

// Path 3: locate font on the local filesystem, compress, and embed.
async function systemFamilyFaceRules(
  lookupFamily: string,
  emitFamily: string,
  log: FontLogger,
): Promise<string[] | null> {
  const variants = locateSystemFontVariants(lookupFamily);
  if (variants.length === 0) return null;
  const rules: string[] = [];
  let totalBytes = 0;
  for (const variant of variants) {
    const fontBuffer = readFileSync(variant.path);
    totalBytes += fontBuffer.length;
    const dataUri = await fontToDataUri(fontBuffer, variant.format);
    rules.push(buildFontFaceRule(emitFamily, dataUri, variant.weight, variant.style));
  }
  if (totalBytes > SYSTEM_FONT_SIZE_LIMIT) {
    log.warn(
      `[Compiler] System font "${lookupFamily}" is large (${(totalBytes / 1024 / 1024).toFixed(1)} MB total across ${variants.length} variant(s)), embedding anyway. Consider font subsetting for production.`,
    );
  }
  log.info(
    `[Compiler] Embedded system font "${lookupFamily}": ${variants.length} variant(s), ${(totalBytes / 1024).toFixed(0)} KB total`,
  );
  return rules;
}

/** Faces of `lookupFamily` named `emitFamily`, or `null` when no path resolves it. */
async function resolveFamilyFaceRules(
  normalizedFamily: string,
  lookupFamily: string,
  emitFamily: string,
  optional: boolean,
  options: InternalFontFetchOptions,
  fontText?: string,
): Promise<string[] | null> {
  const canonicalKey = FONT_ALIASES[normalizedFamily];
  if (canonicalKey) {
    const canonical = CANONICAL_FONTS[canonicalKey];
    if (!canonical) return [];
    return bundledFamilyFaceRules(
      canonical,
      normalizedFamily,
      emitFamily,
      optional,
      options,
      fontText,
    );
  }
  return (
    (await googleFamilyFaceRules(lookupFamily, emitFamily, optional, options, fontText)) ??
    (options.allowSystemFontCapture && !pageNamedThisFile(lookupFamily, options)
      ? await systemFamilyFaceRules(lookupFamily, emitFamily, options.log)
      : null)
  );
}

/** Named by a Google Fonts stylesheet URL or by the document's own top-level @font-face rules. */
type DeclaredFontFamily = {
  family: string;
  fontFaceRules: AtRule[];
};

type DeclaredFontFamilies = ReadonlyMap<string, DeclaredFontFamily>;

// css2 repeats `family=Name:axes`; the legacy css API packs `family=Name:400|Other`.
function googleFontsUrlFamilies(rawUrl: string): string[] {
  let url: URL;
  try {
    // A relative href resolves onto the placeholder host and is rejected below.
    url = new URL(rawUrl.trim(), "https://document.invalid/");
  } catch {
    return [];
  }
  if (url.hostname !== "fonts.googleapis.com") return [];
  if (url.pathname !== "/css" && url.pathname !== "/css2") return [];
  return url.searchParams
    .getAll("family")
    .flatMap((value) => value.split("|"))
    .map((entry) => (entry.split(":", 1)[0] ?? "").trim())
    .filter((family) => family.length > 0);
}

function importRuleUrl(params: string): string | null {
  const trimmed = params.trim();
  if (trimmed.toLowerCase().startsWith("url(")) {
    const close = trimmed.indexOf(")");
    if (close < 0 || !isUnconditionalMedia(trimmed.slice(close + 1))) return null;
    return trimmed.slice(4, close).trim().replace(/^['"]/, "").replace(/['"]$/, "");
  }
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'") return null;
  const end = trimmed.indexOf(quote, 1);
  return end > 0 && isUnconditionalMedia(trimmed.slice(end + 1)) ? trimmed.slice(1, end) : null;
}

function fontFaceRuleFamily(rule: AtRule): string | undefined {
  let family: string | undefined;
  rule.walkDecls((decl) => {
    if (decl.prop.toLowerCase() === "font-family") family = parseFontFamilyValue(decl.value)[0];
  });
  return family;
}

function isUnconditionalMedia(media: string | null): boolean {
  const normalized = (media ?? "").trim().toLowerCase();
  return normalized === "" || normalized === "all";
}

function isUnconditionalStylesheet(element: {
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}): boolean {
  const type = (element.getAttribute("type") ?? "").trim().toLowerCase();
  return (
    isUnconditionalMedia(element.getAttribute("media")) &&
    (type === "" || type === "text/css") &&
    !(element.getAttribute("title") ?? "").trim() &&
    !element.hasAttribute("disabled")
  );
}

type DeclaredFontRegister = (family: string, fontFaceRule?: AtRule) => void;

function declareStyleFontFamilies(
  styleEl: {
    textContent: string | null;
    getAttribute(name: string): string | null;
    hasAttribute(name: string): boolean;
  },
  register: DeclaredFontRegister,
): void {
  if (!isUnconditionalStylesheet(styleEl)) return;
  const root = parseCssRoot(styleEl.textContent ?? "");
  if (!root) return;
  root.walkAtRules((atRule) => {
    if (atRule.parent?.type !== "root") return;
    const name = atRule.name.toLowerCase();
    if (name === "import") {
      const url = importRuleUrl(atRule.params);
      if (url) for (const family of googleFontsUrlFamilies(url)) register(family);
      return;
    }
    if (name !== "font-face") return;
    const family = fontFaceRuleFamily(atRule);
    if (family) register(family, atRule);
  });
}

function declareLinkedFontFamilies(
  link: {
    getAttribute(name: string): string | null;
    hasAttribute(name: string): boolean;
  },
  register: DeclaredFontRegister,
): void {
  const rel = (link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
  if (!rel.includes("stylesheet") || rel.includes("alternate") || !isUnconditionalStylesheet(link))
    return;
  for (const family of googleFontsUrlFamilies(link.getAttribute("href") ?? "")) register(family);
}

function collectDeclaredFontFamilies(html: string): DeclaredFontFamilies {
  const { document } = parseHTML(html);
  const declared = new Map<string, DeclaredFontFamily>();
  const register: DeclaredFontRegister = (family, fontFaceRule) => {
    const key = normalizeFamilyName(family);
    if (!key || GENERIC_FAMILIES.has(key)) return;
    let entry = declared.get(key);
    if (!entry) {
      entry = { family, fontFaceRules: [] };
      declared.set(key, entry);
    }
    if (fontFaceRule) entry.fontFaceRules.push(fontFaceRule);
  };

  for (const styleEl of Array.from(document.querySelectorAll("style"))) {
    declareStyleFontFamilies(styleEl, register);
  }
  for (const link of Array.from(document.querySelectorAll("link[href]"))) {
    declareLinkedFontFamilies(link, register);
  }
  return declared;
}

// `+` too: fetchGoogleFont already reads it as the URL-encoded space.
function familySpellingKey(family: string): string {
  return family.toLowerCase().replace(/[\s_+-]+/g, "");
}

function findDeclaredFamilyAlias(
  authoredFamily: string,
  declaredFamilies: DeclaredFontFamilies,
): DeclaredFontFamily | null {
  // Declared verbatim yet unresolved: substituting a near-spelling would be a guess.
  if (declaredFamilies.has(normalizeFamilyName(authoredFamily))) return null;
  const key = familySpellingKey(authoredFamily);
  if (!key) return null;
  let match: DeclaredFontFamily | null = null;
  for (const entry of declaredFamilies.values()) {
    if (familySpellingKey(entry.family) !== key) continue;
    // Two declared families collapse to the same key; picking one is a guess.
    if (match) return null;
    match = entry;
  }
  return match;
}

// Emits under the authored name instead of rewriting usages, as FONT_ALIASES does,
// so script-assigned and var()-indirected usages match too.
async function resolveDeclaredFamilyAlias(
  authoredFamily: string,
  declaredFamilies: DeclaredFontFamilies,
  optional: boolean,
  options: InternalFontFetchOptions,
  fontText?: string,
): Promise<string[] | null> {
  const declared = findDeclaredFamilyAlias(authoredFamily, declaredFamilies);
  if (!declared) return null;

  let rules: string[] | null;
  if (declared.fontFaceRules.length > 0) {
    // The document's own faces win, as they would had the family been spelled as declared.
    rules = declared.fontFaceRules.map((rule) => {
      const renamed = rule.clone();
      renamed.walkDecls((decl) => {
        if (decl.prop.toLowerCase() === "font-family") decl.value = `"${authoredFamily}"`;
      });
      return renamed.toString();
    });
  } else {
    rules = await resolveFamilyFaceRules(
      normalizeFamilyName(declared.family),
      declared.family,
      authoredFamily,
      optional,
      options,
      fontText,
    );
  }
  if (!rules) return null;

  options.log.warn(
    `[Compiler] font-family "${authoredFamily}" is not a known family; resolved it to "${declared.family}", ` +
      `which this document declares. Correct the authored font-family to "${declared.family}".`,
  );
  return rules;
}

async function buildFontFaceCss(
  requestedFamilies: Map<string, ResolvedFamily>,
  options: InternalFontFetchOptions,
  declaredFamilies: () => DeclaredFontFamilies,
  fontText?: string,
): Promise<{
  css: string;
  unresolved: string[];
}> {
  const rules: string[] = [];
  const unresolved: string[] = [];

  // Required families fetch first, so optional ones cannot spend the shared fetch budget before them.
  const requiredFirst = [...requestedFamilies].sort(
    ([, a], [, b]) => Number(a.optional) - Number(b.optional),
  );
  for (const [normalizedFamily, { family: originalCaseFamily, optional }] of requiredFirst) {
    options.diag.beginFamily(!optional);
    const familyRules =
      (await resolveFamilyFaceRules(
        normalizedFamily,
        originalCaseFamily,
        originalCaseFamily,
        optional,
        options,
        fontText,
      )) ??
      // Last, so a family that already resolves keeps exactly the faces it had.
      (await resolveDeclaredFamilyAlias(
        originalCaseFamily,
        declaredFamilies(),
        optional,
        options,
        fontText,
      ));
    options.diag.endFamily(Boolean(familyRules));
    if (familyRules) {
      rules.push(...familyRules);
      continue;
    }
    // No path resolved
    unresolved.push(originalCaseFamily);
  }

  return {
    css: rules.join("\n\n").trim(),
    unresolved: unresolved.sort(),
  };
}

function warnUnresolvedFonts(unresolved: string[], log: FontLogger): void {
  const mapped = Object.entries(FONT_ALIASES)
    .reduce<string[]>((acc, [alias, canonical]) => {
      const display = alias === canonical ? alias : `${alias} → ${canonical}`;
      if (!acc.includes(display)) acc.push(display);
      return acc;
    }, [])
    .sort();
  log.warn(
    `[Compiler] No deterministic font mapping for: ${unresolved.join(", ")}\n` +
      `  Mapped fonts: ${mapped.join(", ")}\n` +
      `  To fix, pick one:\n` +
      `    1. Use a mapped font name instead (see list above)\n` +
      `    2. Add a @font-face block in your HTML with a local or hosted font file\n` +
      `    3. Install the font locally on the render machine (Docker: add to Dockerfile)\n` +
      `    4. Add an alias to FONT_ALIAS_MAP in packages/core/src/fonts/aliases.ts (for contributors)\n` +
      `  Docs: https://hyperframes.heygen.com/docs/fonts`,
  );
}

// ---------------------------------------------------------------------------
// Google Fonts on-demand fetch + local cache
// ---------------------------------------------------------------------------

let lambdaFontCacheRoot: string | undefined;

// On AWS Lambda `$HOME` resolves to a `/home/sbx_*` tree that's read-only;
// only `/tmp` is writable. Create one private, unguessable cache directory per
// warm process and reuse it across invocations. Honor HYPERFRAMES_FONT_CACHE_DIR
// as an explicit override for any environment.
function resolveFontCacheRoot(): string {
  if (process.env.HYPERFRAMES_FONT_CACHE_DIR) {
    return process.env.HYPERFRAMES_FONT_CACHE_DIR;
  }
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    lambdaFontCacheRoot ??= mkdtempSync(join(tmpdir(), "hyperframes-fonts-"));
    return lambdaFontCacheRoot;
  }
  return join(homedir(), ".cache", "hyperframes", "fonts");
}

// Chrome UA triggers woff2 responses from Google Fonts CSS API
const WOFF2_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function fontSlug(familyName: string): string {
  return familyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

let ephemeralFontCacheRoot: string | undefined;

function fontCacheDir(slug: string): string {
  const dir = join(resolveFontCacheRoot(), slug);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      const firstFallback = ephemeralFontCacheRoot === undefined;
      ephemeralFontCacheRoot ??= mkdtempSync(join(tmpdir(), "hyperframes-fonts-"));
      const fallback = join(ephemeralFontCacheRoot, slug);
      mkdirSync(fallback, { recursive: true });
      if (firstFallback) {
        STDERR_LOGGER.warn(
          `Font cache directory is unwritable (${dir}). ` +
            `Using temporary fallback, so fonts will re-download each run. ` +
            `Fix with: chmod 755 ${resolveFontCacheRoot()}`,
        );
      }
      return fallback;
    }
  }
  return dir;
}

// A short, stable discriminator for a single subset's woff2. Google Fonts'
// css2 API returns one @font-face per (weight × unicode-range subset) — e.g.
// `vietnamese`, `latin-ext`, and `latin` faces for the SAME weight, each with
// a distinct woff2 URL and glyph set. Keying the cache by weight+style alone
// collides every subset onto one filename, so only the first subset in the
// CSS gets downloaded and the rest read it back. Derive the cache key from the
// (subset-unique, version-stable) woff2 URL so each subset is cached on its own.
function subsetToken(woff2Url: string): string {
  return createHash("sha1").update(woff2Url).digest("hex").slice(0, 12);
}

function cachedWoff2Path(slug: string, weight: string, style: string, subset: string): string {
  return join(fontCacheDir(slug), `${weight}-${style}-${subset}.woff2`);
}

type GoogleFontFace = {
  weight: string;
  style: string;
  dataUri: string;
  unicodeRange?: string;
};

/**
 * Typed codes let distributed workflow adapters distinguish deterministic
 * resolution failures from temporary upstream unavailability.
 */
export const FONT_FETCH_FAILED = "FONT_FETCH_FAILED";
export const FONT_FETCH_UNAVAILABLE = "FONT_FETCH_UNAVAILABLE";
export type FontFetchErrorCode = typeof FONT_FETCH_FAILED | typeof FONT_FETCH_UNAVAILABLE;

/**
 * Typed error thrown by {@link injectDeterministicFontFaces} when
 * `failClosedFontFetch === true` and deterministic font resolution fails.
 * The default (swallow + warn) preserves the in-process behavior.
 */
export class FontFetchError extends Error {
  readonly code: FontFetchErrorCode;
  readonly familyName: string;
  readonly url: string;
  readonly cause?: unknown;
  /** Unlike `message`, holds no URLs: safe for callers that must not echo resolver output. */
  readonly unresolvedFamilies: readonly string[];
  /**
   * Resolver stage record for log forwarding. Set ONLY on the per-compile Unresolved error; shared
   * (cached or retry-exhausted) errors are never mutated. Never part of `message` or any response body.
   */
  declare diagnostics?: FontDiagnostics;

  constructor(
    familyName: string,
    url: string,
    message: string,
    cause?: unknown,
    code: FontFetchErrorCode = FONT_FETCH_FAILED,
    unresolvedFamilies: readonly string[] = [],
  ) {
    super(message);
    this.name = "FontFetchError";
    this.code = code;
    this.familyName = familyName;
    this.url = url;
    this.cause = cause;
    this.unresolvedFamilies = unresolvedFamilies;
  }
}

/**
 * Retryable font-fetch failure. Distributed adapters map this code to an
 * unavailable response so the workflow can retry the plan activity.
 */
export class FontFetchUnavailableError extends FontFetchError {
  constructor(familyName: string, url: string, message: string, cause?: unknown) {
    super(familyName, url, message, cause, FONT_FETCH_UNAVAILABLE);
    this.name = "FontFetchUnavailableError";
  }
}

export interface FontFetchRetryPolicy {
  /** Total fetch attempts for one CSS or woff2 URL. Default: 2. */
  maxAttempts: number;
  /** Timeout for each individual fetch attempt. Default: 8 seconds. */
  attemptTimeoutMs: number;
  /** Shared wall-clock budget for all Google Fonts requests in one compile. Default: 20 seconds. */
  maxElapsedMs: number;
  /** Initial full-jitter backoff ceiling. Default: 250 ms. */
  baseDelayMs: number;
}

const DEFAULT_FONT_FETCH_RETRY_POLICY: FontFetchRetryPolicy = {
  maxAttempts: 2,
  attemptTimeoutMs: 8_000,
  maxElapsedMs: 20_000,
  baseDelayMs: 250,
};

/** Internal threading of the failClosed flag + fetch override through callers. */
interface InternalFontFetchOptions {
  log: FontLogger;
  failClosedFontFetch: boolean;
  fetchImpl: typeof fetch;
  allowSystemFontCapture: boolean;
  abortSignal?: AbortSignal;
  retryPolicy: FontFetchRetryPolicy;
  retryDeadlineMs: number;
  /** Google stylesheet URL the page already wrote, keyed by normalized family name. */
  authoredStylesheets: ReadonlyMap<string, readonly string[]>;
  diag: FontDiagCollector;
}

/**
 * Build a typed FontFetchError describing why a Google Fonts request failed.
 * Centralizes the message wording so all four call sites (CSS/woff2 ×
 * HTTP-error/exception) stay phrased identically.
 */
function fontFetchError(
  familyName: string,
  url: string,
  what: "Google Fonts CSS" | `Google Fonts woff2 (${string}/${string})`,
  cause: { status: number } | { error: unknown },
  unavailable = false,
): FontFetchError {
  const reason =
    "status" in cause
      ? `returned HTTP ${cause.status}`
      : `failed: ${cause.error instanceof Error ? cause.error.message : String(cause.error)}`;
  const message =
    `[deterministicFonts] ${what} fetch for ${JSON.stringify(familyName)} ${reason}. ` +
    `Distributed renders require deterministic fonts; system-font fallback would produce ` +
    `non-byte-identical output.`;
  const errorCause = "error" in cause ? cause.error : undefined;
  return unavailable
    ? new FontFetchUnavailableError(familyName, url, message, errorCause)
    : new FontFetchError(familyName, url, message, errorCause);
}

function isRetryableFontFetchStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function callerAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Font fetch cancelled", "AbortError");
}

function throwIfCallerAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw callerAbortReason(signal);
}

async function waitForFontFetchRetry(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  throwIfCallerAborted(signal);
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(signal ? callerAbortReason(signal) : new DOMException("Cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function retryDelayMs(
  response: Response | undefined,
  attempt: number,
  baseDelayMs: number,
): number {
  const requestedDelay = response ? retryAfterMs(response) : null;
  if (requestedDelay !== null) return requestedDelay;
  const ceiling = baseDelayMs * 2 ** attempt;
  return Math.floor(Math.random() * (ceiling + 1));
}

function cancelResponseBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => {
      // Best-effort connection cleanup must not replace the original status.
    });
  } catch {
    // Best-effort connection cleanup must not replace the original status.
  }
}

type FontFetchResult<T> =
  | { ok: true; response: Response; body: T }
  | { ok: false; response: Response };

type FontFetchAttemptResult<T> =
  | { completed: true; result: FontFetchResult<T> }
  | {
      completed: false;
      response?: Response;
      cause: { status: number } | { error: unknown };
    };

async function runFontFetchAttempt<T>(
  url: string,
  init: RequestInit | undefined,
  readBody: (response: Response) => Promise<T>,
  options: InternalFontFetchOptions,
  remainingMs: number,
): Promise<FontFetchAttemptResult<T>> {
  const timeoutSignal = AbortSignal.timeout(
    Math.max(1, Math.min(options.retryPolicy.attemptTimeoutMs, remainingMs)),
  );
  const signal = options.abortSignal
    ? AbortSignal.any([options.abortSignal, timeoutSignal])
    : timeoutSignal;
  let response: Response | undefined;
  try {
    response = await options.fetchImpl(url, { ...init, signal });
    if (!isRetryableFontFetchStatus(response.status)) {
      if (!response.ok) return { completed: true, result: { ok: false, response } };
      const body = await readBody(response);
      return { completed: true, result: { ok: true, response, body } };
    }
    cancelResponseBody(response);
    return { completed: false, response, cause: { status: response.status } };
  } catch (error) {
    throwIfCallerAborted(options.abortSignal);
    return { completed: false, response, cause: { error } };
  }
}

async function fetchFontResource<T>(
  url: string,
  init: RequestInit | undefined,
  readBody: (response: Response) => Promise<T>,
  familyName: string,
  what: "Google Fonts CSS" | `Google Fonts woff2 (${string}/${string})`,
  options: InternalFontFetchOptions,
): Promise<FontFetchResult<T>> {
  if (!options.failClosedFontFetch) {
    const response = await options.fetchImpl(url, { ...init, signal: options.abortSignal });
    if (!response.ok) return { ok: false, response };
    return { ok: true, response, body: await readBody(response) };
  }

  let lastCause: { status: number } | { error: unknown } = {
    error: new DOMException("Font fetch budget exhausted", "TimeoutError"),
  };
  for (let attempt = 0; attempt < options.retryPolicy.maxAttempts; attempt += 1) {
    throwIfCallerAborted(options.abortSignal);
    const remainingMs = options.retryDeadlineMs - Date.now();
    if (remainingMs <= 0) break;

    const attemptResult = await runFontFetchAttempt(url, init, readBody, options, remainingMs);
    if (attemptResult.completed) return attemptResult.result;
    lastCause = attemptResult.cause;

    if (attempt + 1 >= options.retryPolicy.maxAttempts) break;
    const delayMs = retryDelayMs(attemptResult.response, attempt, options.retryPolicy.baseDelayMs);
    if (delayMs >= options.retryDeadlineMs - Date.now()) break;
    await waitForFontFetchRetry(delayMs, options.abortSignal);
  }

  throw fontFetchError(familyName, url, what, lastCause, true);
}

/**
 * Ensure one subset's woff2 is cached on disk (downloading if absent) and
 * return it as a `data:` URI. Returns `null` when the woff2 isn't served
 * (4xx) so the caller skips that face. Throws {@link FontFetchError} on
 * transient (5xx / network) failures when `failClosedFontFetch` is set.
 */
async function ensureWoff2DataUri(
  cachePath: string,
  woff2Url: string,
  familyName: string,
  weight: string,
  style: string,
  options: InternalFontFetchOptions,
  tally: FontAssetDiag,
): Promise<string | null> {
  tally.total += 1;
  try {
    const cached = `data:font/woff2;base64,${readFileSync(cachePath).toString("base64")}`;
    tally.diskCacheHit += 1;
    return cached;
  } catch {
    // Not cached yet — fall through to fetch.
  }

  const woff2What = `Google Fonts woff2 (${weight}/${style})` as const;
  try {
    const fontResult = await fetchFontResource(
      woff2Url,
      undefined,
      (response) => response.arrayBuffer(),
      familyName,
      woff2What,
      options,
    );
    if (!fontResult.ok) {
      const status = String(fontResult.response.status);
      tally.nonOk[status] = (tally.nonOk[status] ?? 0) + 1;
      return null;
    }
    // wx = O_CREAT|O_EXCL: atomic create, rejects symlinks, fails with
    // EEXIST if a concurrent call cached it between our read and write.
    writeFileSync(cachePath, Buffer.from(fontResult.body), { flag: "wx", mode: 0o644 });
    tally.fetchedOk += 1;
  } catch (err) {
    throwIfCallerAborted(options.abortSignal);
    if (err instanceof FontFetchError) throw err;
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      // Concurrent call wrote it — read their result below.
      tally.diskCacheHit += 1;
    } else if (options.failClosedFontFetch) {
      throw fontFetchError(familyName, woff2Url, woff2What, { error: err });
    } else {
      return null;
    }
  }
  return `data:font/woff2;base64,${readFileSync(cachePath).toString("base64")}`;
}

// Per-process cache for Google Fonts CSS lookups, keyed by request URL —
// repeat compiles of the same family reuse one network round trip. A
// rejected lookup evicts itself so a later call still retries.
type GoogleFontCssResult =
  | { ok: true; body: string; status: number }
  | { ok: false; status: number };

const googleFontCssCache = new Map<string, Promise<GoogleFontCssResult>>();

/** Test-only reset — the cache is otherwise process-lifetime, shared across calls. */
export function _clearGoogleFontCssCacheForTests(): void {
  googleFontCssCache.clear();
}

/** Rejects with `signal`'s own abort reason without cancelling `promise` itself. */
function raceAgainstAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(callerAbortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(callerAbortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function fetchGoogleFontCss(
  url: string,
  familyName: string,
  options: InternalFontFetchOptions,
  attempt: FontAttemptDiag,
): Promise<GoogleFontCssResult> {
  // Retries decide the outcome, so only callers with the same mode and attempt count share an entry.
  const mode = options.failClosedFontFetch ? `closed${options.retryPolicy.maxAttempts}` : "open";
  const key = `${mode}:${url}`;
  let shared = googleFontCssCache.get(key);
  attempt.cssCache = shared ? "hit" : "fresh";
  if (!shared) {
    // The shared fetch must not carry any one caller's abortSignal, or that
    // caller cancelling would fail the lookup for every other waiter.
    shared = fetchFontResource(
      url,
      { headers: { "User-Agent": WOFF2_USER_AGENT } },
      (response) => response.text(),
      familyName,
      "Google Fonts CSS",
      { ...options, abortSignal: undefined },
    ).then((result) => {
      if (result.ok)
        return { ok: true as const, body: result.body, status: result.response.status };
      // A transient status must not stick for the process lifetime.
      if (isRetryableFontFetchStatus(result.response.status)) googleFontCssCache.delete(key);
      return { ok: false as const, status: result.response.status };
    });
    googleFontCssCache.set(key, shared);
    shared.catch(() => googleFontCssCache.delete(key));
  }
  return raceAgainstAbort(shared, options.abortSignal);
}

function pageNamedThisFile(familyName: string, options: InternalFontFetchOptions): boolean {
  return options.authoredStylesheets.has(normalizeFamilyName(familyName.replace(/\+/g, " ")));
}

function declaredFaceFamily(block: string): string | undefined {
  const found = /font-family:\s*['"]([^'"]+)['"]/i.exec(block);
  return found?.[1];
}

// fallow-ignore-next-line complexity
async function fetchGoogleFont(
  familyName: string,
  path: FontDiagPath,
  options: InternalFontFetchOptions,
  fontText?: string,
): Promise<GoogleFontFace[]> {
  // Agents sometimes copy the `family=` value from a Google Fonts URL into
  // CSS, where `+` remains a literal character instead of being decoded as a
  // space. Resolve that URL-style spelling through the canonical Google family
  // while preserving `familyName` for the emitted @font-face alias so the
  // authored CSS still matches it.
  const googleFamilyName = familyName.replace(/\+/g, " ");
  const encodedFamily = encodeURIComponent(googleFamilyName);
  const textParam = fontText ? `&text=${encodeURIComponent(fontText)}` : "";
  // Bundled families need the full supplement, including italics a page's
  // link may omit. Other families need the authored URL to preserve axes
  // such as optical size instead of replacing them with a weight-only face.
  const normalizedFamily = normalizeFamilyName(googleFamilyName);
  const authoredStylesheet = FONT_ALIASES[normalizedFamily]
    ? undefined
    : options.authoredStylesheets.get(normalizedFamily);
  // `text=` asks Google for only the characters on the page. A CJK family
  // without it is a hundred files, and the compile's font budget is 20s.
  const defaultUrl = `https://fonts.googleapis.com/css2?family=${encodedFamily}:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700${textParam}`;
  const fetchStylesheet = (url: string, urlSource: FontAttemptDiag["urlSource"]) =>
    fetchGoogleFontStylesheet(
      googleFamilyName,
      url,
      options,
      options.diag.startAttempt(path, urlSource, /[?&]text=/.test(url) ? "present" : "absent"),
    );
  if (!authoredStylesheet) {
    return (await fetchStylesheet(defaultUrl, "default")).faces;
  }
  const faces: GoogleFontFace[] = [];
  const outcomes: string[] = [];
  for (const url of authoredStylesheet) {
    const result = await fetchStylesheet(withPageText(url, fontText), "authored");
    faces.push(...result.faces);
    if (result.faces.length === 0)
      outcomes.push(result.status ? `http_${result.status}` : "no_faces");
  }
  if (faces.length > 0) return faces;
  const fallback = (await fetchStylesheet(defaultUrl, "default")).faces;
  options.log.warn(
    `[Compiler] google_font_link_fallback family="${familyName}" link_outcomes=${outcomes.join(",")} ` +
      `fallback_faces=${fallback.length}`,
  );
  return fallback;
}

type GoogleFontStylesheetRead = { css: string } | { css: null; status?: number };

async function readGoogleFontStylesheet(
  familyName: string,
  url: string,
  options: InternalFontFetchOptions,
  attempt: FontAttemptDiag,
): Promise<GoogleFontStylesheetRead> {
  try {
    const cssResult = await fetchGoogleFontCss(url, familyName, options, attempt);
    attempt.cssStatus = cssResult.status;
    if (!cssResult.ok) {
      // Missing families are deterministic; transient failures follow the
      // caller's retry and fail-closed policy.
      return { css: null, status: cssResult.status };
    }
    return { css: cssResult.body };
  } catch (err) {
    // Rethrow typed error untouched. Network / DNS / fetch-throws are
    // non-deterministic infrastructure failures — wrapped when failClosed
    // is on, swallowed otherwise.
    throwIfCallerAborted(options.abortSignal);
    if (err instanceof FontFetchError) throw err;
    if (options.failClosedFontFetch) {
      throw fontFetchError(familyName, url, "Google Fonts CSS", { error: err });
    }
    return { css: null };
  }
}

type GoogleFontSource = Omit<GoogleFontFace, "dataUri"> & { url: string };

function parseGoogleFontSource(
  match: RegExpMatchArray,
  familyName: string,
): GoogleFontSource | null {
  const declared = declaredFaceFamily(match[0]);
  if (declared && normalizeFamilyName(declared) !== normalizeFamilyName(familyName)) return null;
  const url = match[3];
  if (!url) return null;
  return {
    style: match[1] || "normal",
    weight: (match[2] || "400").replace(/\s+/g, " "),
    url,
    unicodeRange: match[4]?.trim() || undefined,
  };
}

async function fetchGoogleFontStylesheet(
  familyName: string,
  url: string,
  options: InternalFontFetchOptions,
  attempt: FontAttemptDiag,
): Promise<{ faces: GoogleFontFace[]; status?: number }> {
  const slug = fontSlug(familyName);
  const read = await readGoogleFontStylesheet(familyName, url, options, attempt);
  if (read.css === null) return { faces: [], status: read.status };
  const cssText = read.css;
  attempt.blocksTotal = (cssText.match(/@font-face\s*\{/gi) ?? []).length;

  // Parse @font-face blocks from the CSS response. The optional trailing
  // capture grabs each face's `unicode-range` (Google emits it after `src`)
  // so the injected face only claims the codepoints the subset actually
  // covers — without it the face would advertise full coverage it lacks.
  // A variable face is `font-weight: 400 900`: one file for every weight in
  // the span. Keeping only the first number leaves 600/700/800 on the network.
  const faceRegex =
    /@font-face\s*\{[^}]*font-style:\s*(normal|italic|oblique(?:\s+-?\d+(?:\.\d+)?deg){0,2})\s*;[^}]*font-weight:\s*(\d+(?:\s+\d+)?)[^}]*src:\s*url\(([^)]+)\)\s*format\(['"]woff2['"]\)(?:[^}]*?unicode-range:\s*([^;}]+))?[^}]*\}/gi;

  const faces: GoogleFontFace[] = [];

  for (const match of cssText.matchAll(faceRegex)) {
    attempt.regexMatches += 1;
    const source = parseGoogleFontSource(match, familyName);
    if (!source) continue;
    const { weight, style, unicodeRange, url: woff2Url } = source;

    const cachePath = cachedWoff2Path(slug, weight, style, subsetToken(woff2Url));
    const dataUri = await ensureWoff2DataUri(
      cachePath,
      woff2Url,
      familyName,
      weight,
      style,
      options,
      attempt.assets,
    );
    if (dataUri) faces.push({ weight, style, dataUri, unicodeRange });
  }

  if (faces.length > 0) {
    options.log.info(
      `[Compiler] Fetched ${faces.length} font face(s) for "${familyName}" from Google Fonts (cached to ${fontCacheDir(slug)})`,
    );
  }

  return { faces };
}

/** An optional family gets one retry on a transient failure, then renders its fallback with a warning. */
async function fetchFamilyFaces(
  familyName: string,
  path: FontDiagPath,
  optional: boolean,
  options: InternalFontFetchOptions,
  fontText?: string,
): Promise<GoogleFontFace[]> {
  if (!optional) return fetchGoogleFont(familyName, path, options, fontText);
  const maxAttempts = Math.min(options.retryPolicy.maxAttempts, 2);
  try {
    return await fetchGoogleFont(
      familyName,
      path,
      { ...options, retryPolicy: { ...options.retryPolicy, maxAttempts } },
      fontText,
    );
  } catch (err) {
    if (!(err instanceof FontFetchUnavailableError)) throw err;
    options.log.warn(
      `[Compiler] Optional font "${familyName}" is unavailable, rendering its fallback: ${err.message}`,
    );
    return [];
  }
}

// ---------------------------------------------------------------------------

/**
 * Options for {@link injectDeterministicFontFaces}.
 */
export interface FontLogger {
  warn(message: string): void;
  info(message: string): void;
}

const STDERR_LOGGER: FontLogger = {
  warn: (message) => console.warn(`[WARN] ${message}`),
  info: (message) => console.error(`[INFO] ${message}`),
};

export interface InjectDeterministicFontFacesOptions {
  logger?: FontLogger;
  /**
   * When `true`, exhausted transient fetch failures of a required family throw
   * {@link FontFetchUnavailableError} with code `FONT_FETCH_UNAVAILABLE`;
   * deterministic resolution failures retain `FONT_FETCH_FAILED`.
   *
   * Default `false`: failed fetches are silently swallowed; the composition
   * falls back to system fonts via `warnUnresolvedFonts`. This preserves the
   * in-process behavior.
   *
   * Distributed callers pass `true` so font availability is part of the
   * planDir's content-addressed hash and failures surface as typed errors.
   */
  failClosedFontFetch?: boolean;
  /**
   * Injectable `fetch` implementation. Defaults to the global `fetch`.
   * Tests pass a stub to simulate fetch failures without going over the
   * network.
   */
  fetchImpl?: typeof fetch;
  /** Caller cancellation propagated through fetch attempts and retry waits. */
  abortSignal?: AbortSignal;
  /**
   * Optional retry tuning. Defaults are deliberately bounded for composition
   * planning; tests may lower delays and timeouts without replacing timers.
   */
  fontFetchRetryPolicy?: Partial<FontFetchRetryPolicy>;
  /**
   * When `true` (default for local renders), fonts that aren't resolved by
   * the bundled alias map or Google Fonts are located on the local filesystem,
   * compressed to woff2, and embedded as data URIs. Set to `false` for
   * distributed/Lambda renders where the host filesystem is not guaranteed
   * to contain the same fonts as the authoring machine.
   */
  allowSystemFontCapture?: boolean;
}

// Keep the complete CSS request under the broadly supported ~2 KB URL limit.
// Using unique source/decoded characters plus deterministic case variants covers
// static text, strings authored in scripts, and CSS case transforms while
// collapsing repeated prose and base64 assets to a tiny set.
const GOOGLE_FONTS_TEXT_MAX_ENCODED_LENGTH = 1_700;

const SMALL_TO_FULL_KANA: ReadonlyMap<string, string> = new Map([
  ["ぁ", "あ"],
  ["ぃ", "い"],
  ["ぅ", "う"],
  ["ぇ", "え"],
  ["ぉ", "お"],
  ["っ", "つ"],
  ["ゃ", "や"],
  ["ゅ", "ゆ"],
  ["ょ", "よ"],
  ["ゎ", "わ"],
  ["ァ", "ア"],
  ["ィ", "イ"],
  ["ゥ", "ウ"],
  ["ェ", "エ"],
  ["ォ", "オ"],
  ["ッ", "ツ"],
  ["ャ", "ヤ"],
  ["ュ", "ユ"],
  ["ョ", "ヨ"],
  ["ヮ", "ワ"],
  ["ヵ", "カ"],
  ["ヶ", "ケ"],
]);

function collectLangAttributes(document: {
  querySelectorAll(selector: string): Iterable<{ getAttribute(name: string): string | null }>;
}): Set<string> {
  const locales = new Set<string>();
  for (const element of document.querySelectorAll("[lang]")) {
    const lang = element.getAttribute("lang");
    if (!lang) continue;
    const primary = lang.split("-")[0]!.toLowerCase();
    try {
      Intl.getCanonicalLocales(primary);
      locales.add(primary);
    } catch {
      // Invalid BCP-47 tag (e.g. lang="en_US", lang="x") — skip silently.
    }
  }
  return locales;
}

function addCaseClosure(out: Set<string>, character: string, locales: ReadonlySet<string>): void {
  out.add(character);
  for (const variant of `${character.toUpperCase()}${character.toLowerCase()}`) {
    out.add(variant);
  }
  for (const locale of locales) {
    for (const variant of `${character.toLocaleUpperCase(locale)}${character.toLocaleLowerCase(locale)}`) {
      out.add(variant);
    }
  }
}

function addFullwidthVariants(chars: Set<string>): void {
  for (const character of [...chars]) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0x0021 && code <= 0x007e) {
      chars.add(String.fromCodePoint(code + 0xfee0));
    }
  }
}

function addFullSizeKanaVariants(chars: Set<string>): void {
  for (const character of [...chars]) {
    const full = SMALL_TO_FULL_KANA.get(character);
    if (full) chars.add(full);
  }
}

const FULL_WIDTH_KEYWORD_RE = /\bfull-width\b/;
const FULL_SIZE_KANA_KEYWORD_RE = /\bfull-size-kana\b/;
const DECLARATION_BOUNDARY_RE = /[;{}]/;

function skipWhitespace(s: string, pos: number): number {
  while (pos < s.length && " \t\n\r\f\v".includes(s[pos]!)) pos += 1;
  return pos;
}

function findDeclarationEnd(s: string, pos: number): number {
  const match = DECLARATION_BOUNDARY_RE.exec(s.slice(pos));
  return match ? pos + match.index : s.length;
}

// Linear indexOf/slice scan: a `text-transform\s*:[^;{}]*\bkw\b` regex backtracks
// O(n²) on input with many `text-transform:` runs (js/polynomial-redos).
function hasTextTransformKeyword(html: string, keyword: RegExp): boolean {
  const haystack = html.toLowerCase();
  const property = "text-transform";
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(property, from);
    if (at === -1) return false;
    const afterProp = skipWhitespace(haystack, at + property.length);
    if (haystack[afterProp] !== ":") {
      from = at + property.length;
      continue;
    }
    const end = findDeclarationEnd(haystack, afterProp + 1);
    if (keyword.test(haystack.slice(afterProp + 1, end))) return true;
    from = end;
  }
}

function extractGoogleFontsText(html: string): string | undefined {
  const { document } = parseHTML(html);
  const decodedBodyText = document.body?.textContent ?? "";
  const locales = collectLangAttributes(document);

  // Intentional over-approximation: raw html includes base64, scripts, and
  // class names, but they collapse in the Set and the budget gate catches bloat.
  const uniqueCharacters = new Set<string>();
  for (const character of new Set([...Array.from(html), ...Array.from(decodedBodyText)])) {
    addCaseClosure(uniqueCharacters, character, locales);
  }

  if (hasTextTransformKeyword(html, FULL_WIDTH_KEYWORD_RE)) addFullwidthVariants(uniqueCharacters);
  if (hasTextTransformKeyword(html, FULL_SIZE_KANA_KEYWORD_RE))
    addFullSizeKanaVariants(uniqueCharacters);

  const fontText = [...uniqueCharacters].join("");
  return encodeURIComponent(fontText).length <= GOOGLE_FONTS_TEXT_MAX_ENCODED_LENGTH
    ? fontText
    : undefined;
}

function resolveFontFetchRetryPolicy(
  configured: Partial<FontFetchRetryPolicy> | undefined,
): FontFetchRetryPolicy {
  return {
    maxAttempts: Math.max(
      1,
      Math.floor(configured?.maxAttempts ?? DEFAULT_FONT_FETCH_RETRY_POLICY.maxAttempts),
    ),
    attemptTimeoutMs: Math.max(
      1,
      configured?.attemptTimeoutMs ?? DEFAULT_FONT_FETCH_RETRY_POLICY.attemptTimeoutMs,
    ),
    maxElapsedMs: Math.max(
      1,
      configured?.maxElapsedMs ?? DEFAULT_FONT_FETCH_RETRY_POLICY.maxElapsedMs,
    ),
    baseDelayMs: Math.max(
      0,
      configured?.baseDelayMs ?? DEFAULT_FONT_FETCH_RETRY_POLICY.baseDelayMs,
    ),
  };
}

/**
 * Last in document order: a stylesheet declared after the deterministic faces would win the
 * cascade for the same family whenever it had loaded, so early frames could differ between renders.
 */
function placeAfterEveryStylesheet(document: Document, head: Element, styleEl: Element): void {
  const stylesheets = document.querySelectorAll("style, link[rel~=stylesheet]");
  const lastStylesheet = stylesheets[stylesheets.length - 1];
  if (lastStylesheet) lastStylesheet.after(styleEl);
  else head.appendChild(styleEl);
}

export async function injectDeterministicFontFaces(
  html: string,
  options: InjectDeterministicFontFacesOptions = {},
): Promise<string> {
  const diag = new FontDiagCollector();
  const failClosedFontFetch = options.failClosedFontFetch === true;
  const fetchImpl = options.fetchImpl ?? fetch;
  const allowSystemFontCapture = options.allowSystemFontCapture !== false;
  const retryPolicy = resolveFontFetchRetryPolicy(options.fontFetchRetryPolicy);
  const fetchOptions: InternalFontFetchOptions = {
    log: options.logger ?? STDERR_LOGGER,
    failClosedFontFetch,
    fetchImpl,
    allowSystemFontCapture,
    abortSignal: options.abortSignal,
    retryPolicy,
    retryDeadlineMs: Date.now() + retryPolicy.maxElapsedMs,
    authoredStylesheets: authoredGoogleFontStylesheets(html),
    diag,
  };

  const existingFaces = extractExistingFontFaces(html);
  const requestedFamilies = extractRequestedFontFamilies(html);
  const pendingFamilies = new Map<string, ResolvedFamily>();

  for (const [normalizedFamily, requested] of requestedFamilies) {
    if (!existingFaces.has(normalizedFamily)) {
      pendingFamilies.set(normalizedFamily, requested);
    }
  }

  if (pendingFamilies.size === 0) {
    return html;
  }

  let declaredFamilies: DeclaredFontFamilies | undefined;
  const { css, unresolved } = await buildFontFaceCss(
    pendingFamilies,
    fetchOptions,
    () => (declaredFamilies ??= collectDeclaredFontFamilies(html)),
    extractGoogleFontsText(html),
  );
  // An optional family that no source serves, or that stayed unavailable, is tolerated.
  const required = unresolved.filter(
    (family) => !pendingFamilies.get(family.toLowerCase())?.optional,
  );
  if (required.length > 0 && options.failClosedFontFetch) {
    const unresolvedError = new FontFetchError(
      required.join(", "),
      "",
      `[Compiler] Unresolved fonts in fail-closed mode: ${required.join(", ")}. ` +
        `Distributed renders require all fonts to be resolvable.`,
      undefined,
      FONT_FETCH_FAILED,
      unresolved,
    );
    unresolvedError.diagnostics = diag.snapshot();
    throw unresolvedError;
  }
  if (!css) {
    if (unresolved.length > 0) {
      warnUnresolvedFonts(unresolved, fetchOptions.log);
    }
    return html;
  }

  const { document } = parseHTML(html);
  const head = document.querySelector("head");
  if (!head) {
    return html;
  }

  const styleEl = document.createElement("style");
  styleEl.setAttribute("data-hyperframes-deterministic-fonts", "true");
  styleEl.textContent = css;
  placeAfterEveryStylesheet(document, head, styleEl);

  fetchOptions.log.info(
    `[Compiler] Injected deterministic @font-face rules for ${pendingFamilies.size - unresolved.length} requested font families`,
  );
  if (unresolved.length > 0) {
    warnUnresolvedFonts(unresolved, fetchOptions.log);
  }

  return document.toString();
}
