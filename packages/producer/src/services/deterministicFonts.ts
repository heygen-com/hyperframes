import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLogger } from "../logger.js";

import { FONT_ALIAS_MAP, resolveAliasDisplayName } from "@hyperframes/core/fonts/aliases";
import {
  locateSystemFontVariants,
  SYSTEM_FONT_SIZE_LIMIT,
} from "@hyperframes/core/fonts/system-locator";
import { parseHTML } from "linkedom";
import postcss, { type AtRule, type Declaration, type Rule } from "postcss";
import { EMBEDDED_FONT_DATA } from "./fontData.generated.js";
import { fontToDataUri } from "./fontCompression.js";

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

function systemPrimaryReplacement(value: string, deterministicPrimary: string): string | null {
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

function normalizeCssDeclarations(root: postcss.Root, deterministicPrimary: string): boolean {
  let changed = false;
  root.walkDecls((decl) => {
    if (decl.prop.startsWith("--")) {
      const replacement = systemPrimaryReplacement(decl.value, deterministicPrimary);
      if (!replacement) return;
      decl.value = replacement;
      changed = true;
      return;
    }

    if (decl.prop.toLowerCase() !== "font-family") return;
    if (isFontFaceDeclaration(decl)) {
      return;
    }
    const replacement = systemPrimaryReplacement(decl.value, deterministicPrimary);
    if (!replacement) return;
    decl.value = replacement;
    changed = true;
  });

  return changed;
}

function normalizeCssFontFamilyDeclarations(css: string, deterministicPrimary: string): string {
  const root = parseCssRoot(css);
  if (!root) return css;
  const changed = normalizeCssDeclarations(root, deterministicPrimary);
  return changed ? root.toString() : css;
}

function normalizeInlineStyleAttribute(style: string, deterministicPrimary: string): string {
  const root = parseCssRoot(`*{${style}}`);
  if (!root) return style;
  const rule = root.first;
  if (rule?.type !== "rule") return style;
  const before = rule.toString();
  normalizeCssDeclarations(root, deterministicPrimary);
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
  let changed = false;

  for (const styleEl of Array.from(document.querySelectorAll("style"))) {
    const current = styleEl.textContent ?? "";
    const next = normalizeCssFontFamilyDeclarations(current, deterministicPrimary);
    if (next === current) continue;
    styleEl.textContent = next;
    changed = true;
  }

  for (const el of Array.from(document.querySelectorAll("[style]"))) {
    const current = el.getAttribute("style") ?? "";
    const next = normalizeInlineStyleAttribute(current, deterministicPrimary);
    if (next === current) continue;
    el.setAttribute("style", next);
    changed = true;
  }

  for (const el of Array.from(document.querySelectorAll("[data-font-family]"))) {
    const current = el.getAttribute("data-font-family") ?? "";
    const next = systemPrimaryReplacement(current, deterministicPrimary);
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

function primaryCssVariableName(value: string): string | null {
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

    const varExpression = trimmed.slice(0, index + 1);
    const inner = varExpression.slice(4, -1).trim();
    const commaIndex = inner.indexOf(",");
    const variableName = (commaIndex === -1 ? inner : inner.slice(0, commaIndex)).trim();
    return /^--[A-Za-z0-9_-]+$/.test(variableName) ? variableName : null;
  }

  return null;
}

export function resolveFontFamilyDeclarationFamilies(
  declaration: string,
  customProperties: ReadonlyMap<string, string>,
): string[] {
  const families = parseFontFamilyValue(declaration);
  const variableName = primaryCssVariableName(declaration);
  if (!variableName) return families;

  const resolved = customProperties.get(variableName);
  if (!resolved) return families;
  return [...parseFontFamilyValue(resolved), ...families.slice(1)];
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

// FONT_ALIASES derives from the shared alias map in @hyperframes/core.
// The cast is safe: every value in FONT_ALIAS_MAP is a valid CANONICAL_FONTS key.
export const FONT_ALIASES = FONT_ALIAS_MAP as Record<string, keyof typeof CANONICAL_FONTS>;

export { FONT_ALIAS_KEYS } from "@hyperframes/core/fonts/aliases";

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
  const fontFaceRegex = /@font-face\s*\{[\s\S]*?font-family\s*:\s*([^;]+);[\s\S]*?\}/gi;
  for (const match of html.matchAll(fontFaceRegex)) {
    const raw = match[1] || "";
    const normalized = normalizeFamilyName(raw);
    if (normalized) {
      families.add(normalized);
    }
  }
  return families;
}

function extractRequestedFontFamilies(html: string): Map<string, string> {
  const requested = new Map<string, string>();
  const customProperties = collectFontFamilyCustomProperties(html);
  for (const { declaration } of iterateFontFamilyDeclarations(html)) {
    for (const originalCase of resolveFontFamilyDeclarationFamilies(
      declaration,
      customProperties,
    )) {
      const normalized = originalCase.toLowerCase();
      if (!normalized || GENERIC_FAMILIES.has(normalized)) continue;
      if (normalized.startsWith("var(")) continue;
      if (!requested.has(normalized)) requested.set(normalized, originalCase);
    }
  }
  return requested;
}

export function fontFormatHint(src: string): "collection" | "woff2" {
  return src.startsWith("data:font/collection;") ? "collection" : "woff2";
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

async function buildFontFaceCss(
  requestedFamilies: Map<string, string>,
  options: InternalFontFetchOptions,
  fontText?: string,
): Promise<{
  css: string;
  unresolved: string[];
}> {
  const rules: string[] = [];
  const unresolved: string[] = [];

  for (const [normalizedFamily, originalCaseFamily] of requestedFamilies) {
    // Path 1: pre-bundled fonts via FONT_ALIASES — emit embedded faces,
    // then fetch from Google Fonts to fill any weights not in the bundle.
    const canonicalKey = FONT_ALIASES[normalizedFamily];
    if (canonicalKey) {
      const canonical = CANONICAL_FONTS[canonicalKey];
      if (!canonical) continue;

      const coveredWeights = new Set<string>();
      for (const face of canonical.faces) {
        const style = face.style || "normal";
        const src = fontDataUri(canonical.packageName, face.weight, style);
        rules.push(buildFontFaceRule(originalCaseFamily, src, face.weight, style));
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
      // `originalCaseFamily` so the authored CSS keeps matching.
      const canonicalFamily = resolveAliasDisplayName(normalizedFamily);
      const googleFaces = canonicalFamily
        ? await fetchGoogleFont(canonicalFamily, options, fontText)
        : [];

      // A weight covered by the embedded bundle is already full-coverage —
      // skip it. For weights the bundle lacks, keep EVERY subset face (a
      // weight has one face per unicode-range subset), not just the first.
      const supplementary = googleFaces.filter(
        (face) => !coveredWeights.has(coverageKey(face.weight, face.style)),
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
          buildFontFaceRule(
            originalCaseFamily,
            first.dataUri,
            weight,
            first.style,
            first.unicodeRange,
          ),
        );
      }
      continue;
    }

    // Path 2: fetch from Google Fonts (with local cache)
    const googleFaces = await fetchGoogleFont(originalCaseFamily, options, fontText);
    if (googleFaces.length > 0) {
      for (const face of googleFaces) {
        rules.push(
          buildFontFaceRule(
            originalCaseFamily,
            face.dataUri,
            face.weight,
            face.style,
            face.unicodeRange,
          ),
        );
      }
      continue;
    }

    // Path 3: locate font on the local filesystem, compress, and embed.
    if (options.allowSystemFontCapture) {
      const variants = locateSystemFontVariants(originalCaseFamily);
      if (variants.length > 0) {
        let totalBytes = 0;
        for (const variant of variants) {
          const fontBuffer = readFileSync(variant.path);
          totalBytes += fontBuffer.length;
          const dataUri = await fontToDataUri(fontBuffer, variant.format);
          rules.push(buildFontFaceRule(originalCaseFamily, dataUri, variant.weight, variant.style));
        }
        if (totalBytes > SYSTEM_FONT_SIZE_LIMIT) {
          defaultLogger.warn(
            `[Compiler] System font "${originalCaseFamily}" is large (${(totalBytes / 1024 / 1024).toFixed(1)} MB total across ${variants.length} variant(s)) — embedding anyway. Consider font subsetting for production.`,
          );
        }
        defaultLogger.info(
          `[Compiler] Embedded system font "${originalCaseFamily}" — ${variants.length} variant(s), ${(totalBytes / 1024).toFixed(0)} KB total`,
        );
        continue;
      }
    }

    // No path resolved
    unresolved.push(originalCaseFamily);
  }

  return {
    css: rules.join("\n\n").trim(),
    unresolved: unresolved.sort(),
  };
}

function warnUnresolvedFonts(unresolved: string[]): void {
  const mapped = Object.entries(FONT_ALIASES)
    .reduce<string[]>((acc, [alias, canonical]) => {
      const display = alias === canonical ? alias : `${alias} → ${canonical}`;
      if (!acc.includes(display)) acc.push(display);
      return acc;
    }, [])
    .sort();
  defaultLogger.warn(
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

function fontCacheDir(slug: string): string {
  const dir = join(resolveFontCacheRoot(), slug);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
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

  constructor(
    familyName: string,
    url: string,
    message: string,
    cause?: unknown,
    code: FontFetchErrorCode = FONT_FETCH_FAILED,
  ) {
    super(message);
    this.name = "FontFetchError";
    this.code = code;
    this.familyName = familyName;
    this.url = url;
    this.cause = cause;
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
  failClosedFontFetch: boolean;
  fetchImpl: typeof fetch;
  allowSystemFontCapture: boolean;
  abortSignal?: AbortSignal;
  retryPolicy: FontFetchRetryPolicy;
  retryDeadlineMs: number;
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
): Promise<string | null> {
  try {
    return `data:font/woff2;base64,${readFileSync(cachePath).toString("base64")}`;
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
    if (!fontResult.ok) return null;
    // wx = O_CREAT|O_EXCL: atomic create, rejects symlinks, fails with
    // EEXIST if a concurrent call cached it between our read and write.
    writeFileSync(cachePath, Buffer.from(fontResult.body), { flag: "wx", mode: 0o644 });
  } catch (err) {
    throwIfCallerAborted(options.abortSignal);
    if (err instanceof FontFetchError) throw err;
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      // Concurrent call wrote it — read their result below.
    } else if (options.failClosedFontFetch) {
      throw fontFetchError(familyName, woff2Url, woff2What, { error: err });
    } else {
      return null;
    }
  }
  return `data:font/woff2;base64,${readFileSync(cachePath).toString("base64")}`;
}

async function fetchGoogleFont(
  familyName: string,
  options: InternalFontFetchOptions,
  fontText?: string,
): Promise<GoogleFontFace[]> {
  const slug = fontSlug(familyName);
  // Agents sometimes copy the `family=` value from a Google Fonts URL into
  // CSS, where `+` remains a literal character instead of being decoded as a
  // space. Resolve that URL-style spelling through the canonical Google family
  // while preserving `familyName` for the emitted @font-face alias so the
  // authored CSS still matches it.
  const googleFamilyName = familyName.replace(/\+/g, " ");
  const encodedFamily = encodeURIComponent(googleFamilyName);
  const textParam = fontText ? `&text=${encodeURIComponent(fontText)}` : "";
  const url = `https://fonts.googleapis.com/css2?family=${encodedFamily}:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700${textParam}`;

  let cssText: string;
  try {
    const cssResult = await fetchFontResource(
      url,
      { headers: { "User-Agent": WOFF2_USER_AGENT } },
      (response) => response.text(),
      familyName,
      "Google Fonts CSS",
      options,
    );
    if (!cssResult.ok) {
      // 4xx is a *deterministic* answer from Google Fonts that this
      // family is not served (e.g. HTTP 400 for "Segoe UI", "Arial",
      // "Futura" — names absent from Google's catalog) or is misnamed.
      // The render falls back to embedded faces / the composition's
      // font-family chain; we return [] in both modes. 5xx (and other
      // transient upstream failures) could return faces on retry, which
      // would break the byte-identical-retry contract distributed
      // renders rely on — those still fail closed when requested.
      return [];
    }
    cssText = cssResult.body;
  } catch (err) {
    // Rethrow typed error untouched. Network / DNS / fetch-throws are
    // non-deterministic infrastructure failures — wrapped when failClosed
    // is on, swallowed otherwise.
    throwIfCallerAborted(options.abortSignal);
    if (err instanceof FontFetchError) throw err;
    if (options.failClosedFontFetch) {
      throw fontFetchError(familyName, url, "Google Fonts CSS", { error: err });
    }
    return [];
  }

  // Parse @font-face blocks from the CSS response. The optional trailing
  // capture grabs each face's `unicode-range` (Google emits it after `src`)
  // so the injected face only claims the codepoints the subset actually
  // covers — without it the face would advertise full coverage it lacks.
  const faceRegex =
    /@font-face\s*\{[^}]*font-style:\s*(normal|italic)[^}]*font-weight:\s*(\d+)[^}]*src:\s*url\(([^)]+)\)\s*format\(['"]woff2['"]\)(?:[^}]*?unicode-range:\s*([^;}]+))?[^}]*\}/gi;

  const faces: GoogleFontFace[] = [];

  for (const match of cssText.matchAll(faceRegex)) {
    const style = match[1] || "normal";
    const weight = match[2] || "400";
    const woff2Url = match[3] || "";
    const unicodeRange = match[4]?.trim() || undefined;

    if (!woff2Url) continue;

    const cachePath = cachedWoff2Path(slug, weight, style, subsetToken(woff2Url));
    const dataUri = await ensureWoff2DataUri(
      cachePath,
      woff2Url,
      familyName,
      weight,
      style,
      options,
    );
    if (dataUri) faces.push({ weight, style, dataUri, unicodeRange });
  }

  if (faces.length > 0) {
    defaultLogger.info(
      `[Compiler] Fetched ${faces.length} font face(s) for "${familyName}" from Google Fonts (cached to ${fontCacheDir(slug)})`,
    );
  }

  return faces;
}

// ---------------------------------------------------------------------------

/**
 * Options for {@link injectDeterministicFontFaces}.
 */
export interface InjectDeterministicFontFacesOptions {
  /**
   * When `true`, exhausted transient fetch failures throw
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
// Using unique source characters covers static text plus strings authored in
// scripts, while collapsing repeated prose and base64 assets to a tiny set.
const GOOGLE_FONTS_TEXT_MAX_ENCODED_LENGTH = 1_700;

function extractGoogleFontsText(html: string): string | undefined {
  const { document } = parseHTML(html);
  const decodedBodyText = document.body?.textContent ?? "";
  const uniqueCharacters = [...new Set([...Array.from(html), ...Array.from(decodedBodyText)])].join(
    "",
  );
  return encodeURIComponent(uniqueCharacters).length <= GOOGLE_FONTS_TEXT_MAX_ENCODED_LENGTH
    ? uniqueCharacters
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

export async function injectDeterministicFontFaces(
  html: string,
  options: InjectDeterministicFontFacesOptions = {},
): Promise<string> {
  const failClosedFontFetch = options.failClosedFontFetch === true;
  const fetchImpl = options.fetchImpl ?? fetch;
  const allowSystemFontCapture = options.allowSystemFontCapture !== false;
  const retryPolicy = resolveFontFetchRetryPolicy(options.fontFetchRetryPolicy);
  const fetchOptions: InternalFontFetchOptions = {
    failClosedFontFetch,
    fetchImpl,
    allowSystemFontCapture,
    abortSignal: options.abortSignal,
    retryPolicy,
    retryDeadlineMs: Date.now() + retryPolicy.maxElapsedMs,
  };

  const existingFaces = extractExistingFontFaces(html);
  const requestedFamilies = extractRequestedFontFamilies(html);
  const pendingFamilies = new Map<string, string>();

  for (const [normalizedFamily, originalCaseFamily] of requestedFamilies) {
    if (!existingFaces.has(normalizedFamily)) {
      pendingFamilies.set(normalizedFamily, originalCaseFamily);
    }
  }

  if (pendingFamilies.size === 0) {
    return html;
  }

  const { css, unresolved } = await buildFontFaceCss(
    pendingFamilies,
    fetchOptions,
    extractGoogleFontsText(html),
  );
  if (unresolved.length > 0 && options.failClosedFontFetch) {
    throw new FontFetchError(
      unresolved.join(", "),
      "",
      `[Compiler] Unresolved fonts in fail-closed mode: ${unresolved.join(", ")}. ` +
        `Distributed renders require all fonts to be resolvable.`,
    );
  }
  if (!css) {
    if (unresolved.length > 0) {
      warnUnresolvedFonts(unresolved);
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
  head.insertBefore(styleEl, head.firstChild);

  defaultLogger.info(
    `[Compiler] Injected deterministic @font-face rules for ${pendingFamilies.size - unresolved.length} requested font families`,
  );
  if (unresolved.length > 0) {
    warnUnresolvedFonts(unresolved);
  }

  return document.toString();
}
