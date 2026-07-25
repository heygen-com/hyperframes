import {
  collectStaticRootFontFamilyCustomProperties,
  FONT_ALIAS_KEYS,
  GOOGLE_FONT_FAMILY_ALIAS_KEYS,
  isCssWideFontFamilyKeyword,
  resolveAliasDisplayName,
  resolveFontFamilyDeclarationCandidates,
  type FontFamilyCustomPropertyDeclaration,
  type FontFamilyValueToken,
} from "@hyperframes/parsers/composition";
import postcss, { type AtRule, type Declaration, type Rule, type Root } from "postcss";
import type { LintContext, HyperframeLintFinding } from "../context";
import { isRegistrySourceFile, isRegistryInstalledFile } from "./composition";

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
  // Vendor-prefixed system-font keywords. Like `system-ui`, the engine resolves
  // these to the OS UI font — they are never installable files and must not be
  // flagged as a missing @font-face, even when a generic fallback follows them
  // (e.g. `-apple-system, system-ui, sans-serif`).
  "-apple-system",
  "blinkmacsystemfont",
]);

// A CSS comment can contain a `}` (e.g. `@font-face { /* 400 } regular */
// font-family: 'X'; ... }`), which truncates the naive `@font-face\s*\{[^}]*\}`
// block match at the comment's brace — so the rule never sees the real
// `font-family` and reports a false-positive font_family_without_font_face.
// Large/"framework" stylesheets hit this far more often than minimal ones,
// which is why a simple <style> passes while a complex one fails. Strip
// comments before scanning so a brace inside one cannot split a block. See #1534.
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

function extractFontFaceFamilies(styles: Array<{ content: string }>): Set<string> {
  const families = new Set<string>();
  const fontFaceRe = /@font-face\s*\{[^}]*\}/gi;
  const familyRe = /font-family\s*:\s*(['"]?)([^;'"]+)\1/i;
  for (const style of styles) {
    const content = stripCssComments(style.content);
    let match: RegExpExecArray | null;
    while ((match = fontFaceRe.exec(content)) !== null) {
      const familyMatch = match[0].match(familyRe);
      if (familyMatch?.[2]) {
        families.add(familyMatch[2].trim().toLowerCase());
      }
    }
  }
  return families;
}

function normalizeUsedFontName(candidate: FontFamilyValueToken): string | null {
  const name = candidate.value
    .trim()
    .replace(/\s*!important\s*$/i, "")
    .trim()
    .toLowerCase();
  if (
    !name ||
    candidate.kind === "function" ||
    (!candidate.quoted && (isCssWideFontFamilyKeyword(name) || GENERIC_FAMILIES.has(name)))
  ) {
    return null;
  }
  return name;
}

function parseCssRoot(css: string): Root | null {
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

function collectLintCustomProperties(
  styles: Array<{ content: string }>,
  parsedRoots: Array<Root | null>,
): Map<string, string> {
  const declarations: FontFamilyCustomPropertyDeclaration[] = [];
  for (let index = 0; index < styles.length; index += 1) {
    const root = parsedRoots[index];
    if (!root) {
      for (const match of styles[index]!.content.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) {
        declarations.push({
          name: match[1]!,
          value: "",
          staticRoot: false,
        });
      }
      continue;
    }
    root.walkDecls((decl) => {
      if (!decl.prop.startsWith("--")) return;
      const parent = decl.parent;
      declarations.push({
        name: decl.prop,
        value: decl.value,
        staticRoot:
          parent?.type === "rule" &&
          (parent as Rule).selector.trim() === ":root" &&
          parent.parent?.type === "root",
        important: decl.important,
      });
    });
  }
  return collectStaticRootFontFamilyCustomProperties(declarations);
}

function extractUsedFontFamilies(styles: Array<{ content: string }>): string[] {
  const used: string[] = [];
  const seen = new Set<string>();
  const parsedRoots = styles.map((style) => parseCssRoot(style.content));
  const roots = parsedRoots.filter((root) => root !== null);
  const customProperties = collectLintCustomProperties(styles, parsedRoots);

  const addDeclaration = (declaration: string) => {
    for (const candidate of resolveFontFamilyDeclarationCandidates(declaration, customProperties)) {
      const name = normalizeUsedFontName(candidate);
      if (name && !seen.has(name)) {
        seen.add(name);
        used.push(name);
      }
    }
  };

  for (const root of roots) {
    root.walkDecls((decl) => {
      if (decl.prop.toLowerCase() !== "font-family" || isFontFaceDeclaration(decl)) return;
      addDeclaration(decl.value);
    });
  }

  // Preserve best-effort lint coverage for malformed stylesheets PostCSS
  // cannot parse. The shared value parser still prevents function commas from
  // manufacturing stray `)` family names.
  const propRe = /font-family\s*:\s*([^;}{]+)/gi;
  for (const style of styles) {
    if (parseCssRoot(style.content)) continue;
    const withoutFontFace = stripCssComments(style.content).replace(/@font-face\s*\{[^}]*\}/gi, "");
    let match: RegExpExecArray | null;
    while ((match = propRe.exec(withoutFontFace)) !== null) {
      addDeclaration(match[1]!);
    }
  }
  return used;
}

function collectAliasedFonts(used: string[], declared: Set<string>): string[] {
  const aliased: string[] = [];
  for (const name of used) {
    if (declared.has(name)) continue;
    const displayName = resolveAliasDisplayName(name);
    if (!displayName) continue;
    if (displayName.toLowerCase() === name) continue;
    aliased.push(`'${name}' → ${displayName}`);
  }
  return aliased;
}

function normalizeFontFamily(name: string): string | null {
  const decoded = name.replace(/\+/g, " ").trim();
  if (!decoded) return null;
  try {
    return decodeURIComponent(decoded).trim().toLowerCase() || null;
  } catch {
    return decoded.toLowerCase();
  }
}

function extractGoogleFontFamiliesFromUrl(rawUrl: string): string[] {
  const url = rawUrl.replace(/&amp;/gi, "&");
  let parsed: URL;
  try {
    parsed = new URL(url, "https://fonts.googleapis.com");
  } catch {
    return [];
  }

  if (parsed.hostname.toLowerCase() !== "fonts.googleapis.com") return [];
  const families: string[] = [];
  for (const value of parsed.searchParams.getAll("family")) {
    for (const familySpec of value.split("|")) {
      const family = normalizeFontFamily(familySpec.split(":")[0] || "");
      if (family) families.push(family);
    }
  }
  return families;
}

function collectGoogleFontFamilies(
  source: string,
  styles: Array<{ content: string }>,
): Set<string> {
  const families = new Set<string>();
  const addUrl = (url: string) => {
    for (const family of extractGoogleFontFamiliesFromUrl(url)) families.add(family);
  };

  const linkHrefRe =
    /<link\b[^>]*\bhref\s*=\s*(?:(["'])([^"']*fonts\.googleapis\.com[^"']*)\1|([^\s>]*fonts\.googleapis\.com[^\s>]*))[^>]*>/gi;
  for (const match of source.matchAll(linkHrefRe)) {
    const href = match[2] || match[3];
    if (href) addUrl(href);
  }

  const importUrlRe =
    /@import\s+(?:url\(\s*)?(["']?)([^"')\s]*fonts\.googleapis\.com[^"')\s]*)\1\s*\)?/gi;
  for (const style of styles) {
    for (const match of style.content.matchAll(importUrlRe)) {
      if (match[2]) addUrl(match[2]);
    }
  }

  return families;
}

export const fontRules: Array<(ctx: LintContext) => HyperframeLintFinding[]> = [
  // google_fonts_import
  ({ styles, source, rawSource, options }) => {
    if (isRegistrySourceFile(options.filePath) || isRegistryInstalledFile(rawSource)) return [];
    const findings: HyperframeLintFinding[] = [];
    const googleFontsInLink = /<link\b[^>]*fonts\.googleapis\.com[^>]*>/i.test(source);
    const googleFontsInImport = styles.some((s) =>
      /@import\s+url\s*\(\s*['"]?[^)]*fonts\.googleapis\.com/i.test(s.content),
    );

    if (googleFontsInLink || googleFontsInImport) {
      findings.push({
        code: "google_fonts_import",
        severity: "warning",
        message:
          "Composition loads fonts from fonts.googleapis.com. The producer resolves Google Fonts " +
          "during compile/render, but raw external font requests add latency and can fail before " +
          "canonicalization. Prefer mapped family names or local @font-face declarations when possible.",
        fixHint:
          "For bundled fonts, remove the Google Fonts <link> or @import and keep the font-family " +
          "declaration. For custom fonts, use @font-face { font-family: '...'; src: url('...woff2'); }.",
      });
    }
    return findings;
  },

  // system_font_will_alias — inform when a font will be silently substituted
  ({ styles, options }) => {
    const declared = extractFontFaceFamilies(styles);
    const used = extractUsedFontFamilies(styles);
    const aliased = collectAliasedFonts(used, declared);
    if (aliased.length === 0) return [];
    // In distributed / Lambda renders system-font capture is disabled, so
    // the alias substitution does NOT happen — elevate to a warning.
    const severity = options.distributed ? ("warning" as const) : ("info" as const);
    return [
      {
        code: "system_font_will_alias",
        severity,
        message:
          `Font ${aliased.length === 1 ? "family" : "families"} will be substituted at render time: ${aliased.join(", ")}. ` +
          (options.distributed
            ? "In distributed/Lambda rendering system-font capture is disabled — these fonts will fall back to OS defaults. Embed explicit @font-face declarations instead."
            : "The renderer maps these to bundled fonts for cross-platform consistency. " +
              "Use the target font name directly for consistent preview and render results."),
      },
    ];
  },

  // font_family_without_font_face
  ({ styles, source, rawSource, options }) => {
    if (isRegistrySourceFile(options.filePath) || isRegistryInstalledFile(rawSource)) return [];
    const findings: HyperframeLintFinding[] = [];
    const declared = extractFontFaceFamilies(styles);
    const used = extractUsedFontFamilies(styles);
    const googleFonts = collectGoogleFontFamilies(source, styles);

    const undeclared = used.filter(
      (name) =>
        !declared.has(name) &&
        !FONT_ALIAS_KEYS.has(name) &&
        !GOOGLE_FONT_FAMILY_ALIAS_KEYS.has(name) &&
        !googleFonts.has(name.replace(/\+/g, " ")),
    );
    if (undeclared.length === 0) return findings;

    findings.push({
      code: "font_family_without_font_face",
      severity: "error",
      message:
        `Font ${undeclared.length === 1 ? "family" : "families"} used without @font-face declaration: ${undeclared.join(", ")}. ` +
        "These are not in the auto-resolved font list, so the renderer cannot supply them automatically. " +
        "Text will fall back to a generic font, producing incorrect typography in the video.",
      fixHint:
        "Add @font-face { font-family: '...'; src: url('capture/assets/fonts/...woff2'); } " +
        "for each font family, pointing to the captured .woff2 files. For an OS-bundled " +
        "system font (e.g. Hiragino Sans, Microsoft YaHei) that has no downloadable file, " +
        "use src: local('Exact Font Name') instead — the declaration alone satisfies this " +
        "check without needing a font file.",
    });
    return findings;
  },
];
