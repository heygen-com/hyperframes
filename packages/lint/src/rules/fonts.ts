import postcss from "postcss";
import { styleRoot } from "../styleRoots";
import type { SourceLocation } from "../sourceCoordinates";
import {
  FONT_ALIAS_KEYS,
  parseFontShorthand,
  resolveAliasDisplayName,
} from "@hyperframes/parsers/composition";
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
  "inherit",
  "initial",
  "unset",
  "revert",
]);

function parseFontCss(style: { content: string }): postcss.Root | null {
  try {
    return styleRoot(style);
  } catch {
    return null;
  }
}

function isFontFaceDeclaration(decl: postcss.Declaration): boolean {
  let parent: postcss.AnyNode | undefined = decl.parent;
  while (parent) {
    if (parent.type === "atrule" && parent.name.toLowerCase() === "font-face") return true;
    parent = parent.parent;
  }
  return false;
}

export function extractFontFaceFamilies(styles: Array<{ content: string }>): Set<string> {
  const families = new Set<string>();
  for (const style of styles) {
    parseFontCss(style)?.walkDecls(/^font-family$/i, (decl) => {
      if (!isFontFaceDeclaration(decl)) return;
      const name = normalizeUsedFontName(decl.value);
      if (name) families.add(name);
    });
  }
  return families;
}

function declaredFontFamilies(
  styles: Array<{ content: string }>,
  options: { projectFontFamilies?: string[] },
): Set<string> {
  return new Set([...extractFontFaceFamilies(styles), ...(options.projectFontFamilies ?? [])]);
}

// Function tokens and unresolved var() references are not literal family names.
function normalizeUsedFontName(part: string): string | null {
  const name = part
    .trim()
    .replace(/\s*!important\s*$/i, "")
    .replace(/^['"]|['"]$/g, "")
    .trim()
    .toLowerCase();
  if (!name || name.includes("(") || name.includes(")")) return null;
  return name;
}

function collectFontCustomProperties(styles: Array<{ content: string }>): Map<string, string> {
  const properties = new Map<string, string>();
  for (const style of styles) {
    parseFontCss(style)?.walkDecls(/^--/, (decl) => {
      if (!isFontFaceDeclaration(decl)) properties.set(decl.prop, decl.value);
    });
  }
  return properties;
}

function resolveUsedFontNames(
  value: string,
  properties: ReadonlyMap<string, string>,
  resolving: ReadonlySet<string> = new Set(),
): string[] {
  return postcss.list.comma(value).flatMap((part) => {
    const variable = /^var\(\s*(--[^\s,()]+)\s*(?:,[\s\S]*)?\)$/i.exec(part.trim());
    if (!variable) {
      const name = normalizeUsedFontName(part);
      return name ? [name] : [];
    }
    const property = variable[1];
    if (!property || resolving.has(property) || resolving.size >= 8) return [];
    const referenced = properties.get(property);
    if (referenced === undefined) return [];
    return resolveUsedFontNames(referenced, properties, new Set(resolving).add(property));
  });
}

function usedFamilyList(decl: postcss.Declaration): string {
  if (isFontFaceDeclaration(decl)) return "";
  if (decl.prop.toLowerCase() !== "font") return decl.value;
  const shorthand = parseFontShorthand(decl.value);
  return shorthand.certain ? shorthand.families : "";
}

const FONT_FAMILY_PROPS = /^font(?:-family)?$/i;

function extractUsedFontFamilies(styles: Array<{ content: string }>): string[] {
  const used: string[] = [];
  const seen = new Set<string>();
  const properties = collectFontCustomProperties(styles);
  for (const style of styles) {
    parseFontCss(style)?.walkDecls(FONT_FAMILY_PROPS, (decl) => {
      for (const name of resolveUsedFontNames(usedFamilyList(decl), properties)) {
        if (!GENERIC_FAMILIES.has(name) && !seen.has(name)) {
          seen.add(name);
          used.push(name);
        }
      }
    });
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

export function collectGoogleFontFamilies(
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
  // system_font_will_alias — only for distributed / Lambda renders, where
  // system-font capture is disabled and the alias substitution does NOT happen,
  // so the font silently falls back to whatever the OS provides. Under a local
  // render the substitution is the renderer working as designed, not a defect,
  // so there is nothing for the author to act on.
  ({ styles, options }) => {
    if (!options.distributed) return [];
    const declared = declaredFontFamilies(styles, options);
    const used = extractUsedFontFamilies(styles);
    const aliased = collectAliasedFonts(used, declared);
    if (aliased.length === 0) return [];
    return [
      {
        code: "system_font_will_alias",
        severity: "warning",
        message:
          `Font ${aliased.length === 1 ? "family" : "families"} will be substituted at render time: ${aliased.join(", ")}. ` +
          "In distributed/Lambda rendering system-font capture is disabled, so these fonts will fall " +
          "back to OS defaults. Embed explicit @font-face declarations instead.",
      },
    ];
  },

  // font_family_without_font_face
  ({ styles, source, rawSource, options, locate }) => {
    if (isRegistrySourceFile(options.filePath) || isRegistryInstalledFile(rawSource)) return [];
    const findings: HyperframeLintFinding[] = [];
    const declared = declaredFontFamilies(styles, options);
    const used = extractUsedFontFamilies(styles);
    const googleFonts = collectGoogleFontFamilies(source, styles);

    const undeclared = used.filter(
      (name) =>
        !declared.has(name) &&
        !FONT_ALIAS_KEYS.has(name) &&
        !googleFonts.has(name.replace(/\+/g, " ")),
    );
    if (undeclared.length === 0) return findings;

    findings.push({
      ...uniqueFontLocation(styles, undeclared, locate),
      code: "font_family_without_font_face",
      severity: "error",
      message:
        `Font ${undeclared.length === 1 ? "family" : "families"} used without @font-face declaration: ${undeclared.join(", ")}. ` +
        "These are not in the auto-resolved font list, so the renderer cannot supply them automatically. " +
        "Text will fall back to a generic font, producing incorrect typography in the video.",
      fixHint:
        "Add @font-face { font-family: '...'; src: url('capture/assets/fonts/...woff2'); } " +
        "for each font family, pointing to the captured .woff2 files, or switch to a Google Fonts " +
        "family. An OS font such as PingFang SC or Hiragino Sans renders locally from the " +
        "installed copy, but a cloud render has no copy and refuses it.",
    });
    return findings;
  },

  ({ styles, rawSource, options, locate }) => {
    if (isRegistrySourceFile(options.filePath) || isRegistryInstalledFile(rawSource)) return [];
    const findings: HyperframeLintFinding[] = [];
    for (const style of styles) {
      parseFontCss(style)?.walkAtRules(/^font-face$/i, (rule) => {
        let family: string | null = null;
        let sources = "";
        rule.walkDecls((decl) => {
          const prop = decl.prop.toLowerCase();
          if (prop === "font-family") family = normalizeUsedFontName(decl.value);
          else if (prop === "src") sources += ` ${decl.value}`;
        });
        if (!family || !/\blocal\s*\(/i.test(sources) || /\burl\s*\(/i.test(sources)) return;
        findings.push({
          ...locate(style, rule.source?.start?.offset),
          code: "font_face_local_only",
          severity: "warning",
          message:
            `@font-face '${family}' only names a font installed on this machine (src: local()). ` +
            "A local render uses the installed copy; a cloud render or another machine has none and " +
            "falls back to a different font.",
          fixHint:
            "Add a url() source to the font file (.woff2) inside the project, or use a Google Fonts " +
            "family, so every render draws the same glyphs.",
        });
      });
    }
    return findings;
  },
];

/** Aggregate diagnostics get a location only when exactly one declaration supplies their evidence. */
function uniqueFontLocation(
  styles: LintContext["styles"],
  families: string[],
  locate: LintContext["locate"],
): SourceLocation {
  const locations: SourceLocation[] = [];
  const properties = collectFontCustomProperties(styles);
  for (const style of styles) {
    try {
      styleRoot(style).walkDecls(FONT_FAMILY_PROPS, (decl) => {
        const named = resolveUsedFontNames(usedFamilyList(decl), properties);
        if (!named.some((name) => families.includes(name))) return;
        locations.push(locate(style, decl.source?.start?.offset));
      });
    } catch {
      // The CSS syntax rule reports malformed styles; a guessed declaration is not useful.
      return {};
    }
  }
  return locations.length === 1 ? (locations[0] ?? {}) : {};
}
