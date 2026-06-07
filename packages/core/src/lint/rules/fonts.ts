import { FONT_ALIAS_KEYS, resolveAliasDisplayName } from "../../fonts/aliases";
import type { LintContext, HyperframeLintFinding } from "../context";

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
  "inherit",
  "initial",
  "unset",
  "revert",
]);

function extractFontFaceFamilies(styles: Array<{ content: string }>): Set<string> {
  const families = new Set<string>();
  const fontFaceRe = /@font-face\s*\{[^}]*\}/gi;
  const familyRe = /font-family\s*:\s*(['"]?)([^;'"]+)\1/i;
  for (const style of styles) {
    let match: RegExpExecArray | null;
    while ((match = fontFaceRe.exec(style.content)) !== null) {
      const familyMatch = match[0].match(familyRe);
      if (familyMatch?.[2]) {
        families.add(familyMatch[2].trim().toLowerCase());
      }
    }
  }
  return families;
}

function extractUsedFontFamilies(styles: Array<{ content: string }>): string[] {
  const used: string[] = [];
  const seen = new Set<string>();
  const propRe = /font-family\s*:\s*([^;}{]+)/gi;
  for (const style of styles) {
    const withoutFontFace = style.content.replace(/@font-face\s*\{[^}]*\}/gi, "");
    let match: RegExpExecArray | null;
    while ((match = propRe.exec(withoutFontFace)) !== null) {
      const stack = match[1]!;
      for (const part of stack.split(",")) {
        const name = part
          .trim()
          .replace(/^['"]|['"]$/g, "")
          .trim()
          .toLowerCase();
        if (name && !GENERIC_FAMILIES.has(name) && !seen.has(name)) {
          seen.add(name);
          used.push(name);
        }
      }
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

export const fontRules: Array<(ctx: LintContext) => HyperframeLintFinding[]> = [
  // google_fonts_import
  ({ styles, source }) => {
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
          "Composition loads fonts from fonts.googleapis.com. External font requests " +
          "fail in sandboxed/offline renders and add latency. Use local @font-face " +
          "declarations with captured .woff2 files instead.",
        fixHint:
          "Replace the Google Fonts <link> or @import with @font-face { font-family: '...'; " +
          "src: url('capture/assets/fonts/Font.woff2'); } pointing to captured font files.",
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
  ({ styles }) => {
    const findings: HyperframeLintFinding[] = [];
    const declared = extractFontFaceFamilies(styles);
    const used = extractUsedFontFamilies(styles);

    const undeclared = used.filter((name) => !declared.has(name) && !FONT_ALIAS_KEYS.has(name));
    if (undeclared.length === 0) return findings;

    findings.push({
      code: "font_family_without_font_face",
      severity: "warning",
      message:
        `Font ${undeclared.length === 1 ? "family" : "families"} used without @font-face declaration: ${undeclared.join(", ")}. ` +
        "These are not in the auto-resolved font list, so the renderer cannot supply them automatically. " +
        "Text will fall back to a generic font, producing incorrect typography in the video.",
      fixHint:
        "Add @font-face { font-family: '...'; src: url('capture/assets/fonts/...woff2'); } " +
        "for each font family, pointing to the captured .woff2 files.",
    });
    return findings;
  },
];
