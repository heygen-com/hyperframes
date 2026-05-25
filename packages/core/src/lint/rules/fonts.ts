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

// Fonts pre-bundled as data URIs in the producer (deterministicFonts.ts FONT_ALIASES).
// These render correctly without @font-face — the producer injects them automatically.
// Must match the keys in packages/producer/src/services/deterministicFonts.ts exactly.
const PRODUCER_BUNDLED_FONTS = new Set([
  "inter",
  "helvetica neue",
  "helvetica",
  "arial",
  "helvetica bold",
  "montserrat",
  "futura",
  "din alternate",
  "arial black",
  "outfit",
  "nunito",
  "oswald",
  "bebas neue",
  "league gothic",
  "archivo black",
  "space mono",
  "ibm plex mono",
  "jetbrains mono",
  "courier new",
  "courier",
  "eb garamond",
  "garamond",
  "playfair display",
  "source code pro",
  "noto sans jp",
  "noto sans japanese",
  "roboto",
  "open sans",
  "lato",
  "poppins",
  "segoe ui",
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

  // font_family_without_font_face
  ({ styles }) => {
    const findings: HyperframeLintFinding[] = [];
    const declared = extractFontFaceFamilies(styles);
    const used = extractUsedFontFamilies(styles);

    const undeclared = used.filter(
      (name) => !declared.has(name) && !PRODUCER_BUNDLED_FONTS.has(name),
    );
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
