/**
 * Generate AGENTS.md and CLAUDE.md for captured website projects.
 *
 * Writes the same content to both filenames so any AI agent auto-discovers it:
 *   - AGENTS.md  — universal convention (Cursor, Codex, Gemini CLI, Windsurf, Aider, Jules)
 *   - CLAUDE.md  — Claude Code convention
 *
 * This file generates a DATA INVENTORY that tells the AI agent what files
 * exist and what they contain. The actual workflow lives in the
 * product-launch-video skill — this file points agents there.
 */

import { writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { DesignTokens } from "./types.js";
import type { AnimationCatalog } from "./animationCataloger.js";
import type { CatalogedAsset } from "./assetCataloger.js";

/**
 * Infer a human-readable role hint from a hex color based on luminance and saturation.
 * Not a substitute for DESIGN.md — just helps orient agents scanning the brand summary.
 */
// fallow-ignore-next-line complexity
function inferColorRole(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  if (isNaN(r) || isNaN(g) || isNaN(b)) return "color";

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const saturation = max === 0 ? 0 : (max - min) / max;

  if (luminance < 0.04) return "bg-dark";
  if (luminance > 0.9) return "bg-light";
  if (saturation > 0.4 && luminance > 0.05 && luminance < 0.7) return "accent";
  if (luminance < 0.2) return "surface-dark";
  if (luminance > 0.7) return "surface-light";
  return "neutral";
}

export function generateAgentPrompt(
  outputDir: string,
  url: string,
  tokens: DesignTokens,
  _animations: AnimationCatalog | undefined, // reserved for future animation summary
  hasScreenshot: boolean,
  hasLottie?: boolean,
  hasShaders?: boolean,
  _catalogedAssets?: CatalogedAsset[], // reserved for future asset inventory
  _detectedLibraries?: string[],
): void {
  const prompt = buildPrompt(outputDir, url, tokens, hasScreenshot, hasLottie, hasShaders);
  writeFileSync(join(outputDir, "AGENTS.md"), prompt, "utf-8");
  writeFileSync(join(outputDir, "CLAUDE.md"), prompt, "utf-8");
  writeFileSync(join(outputDir, ".cursorrules"), prompt, "utf-8");
}

// fallow-ignore-next-line complexity
function buildPrompt(
  outputDir: string,
  url: string,
  tokens: DesignTokens,
  hasScreenshot: boolean,
  hasLottie?: boolean,
  hasShaders?: boolean,
): string {
  const title = tokens.title || new URL(url).hostname.replace(/^www\./, "");

  const colorSummary = tokens.colors
    .slice(0, 10)
    .map((hex) => `${hex} (${inferColorRole(hex)})`)
    .join(", ");
  const fontSummary =
    tokens.fonts
      .map(
        (f) =>
          f.family +
          (f.variable && f.weightRange
            ? ` (${f.weightRange[0]}-${f.weightRange[1]} variable)`
            : f.weights.length > 0
              ? ` (${f.weights.join(",")})`
              : ""),
      )
      .join(", ") || "none detected";

  // Build the data inventory table rows
  // Helper: find all contact sheet pages for a given base name. Matches the
  // exact base file plus paginated variants only (e.g. `contact-sheet.jpg`,
  // `contact-sheet-2.jpg`, `contact-sheet-3.jpg`). The "-NNN" suffix is digits
  // only, so unrelated files that happen to share the prefix (notably the
  // `contact-sheet-svgs.jpg` SVG fallback sheet in assets/) don't get mixed in.
  function contactSheetRows(dir: string, baseFile: string, label: string): string[] {
    const fullDir = join(outputDir, dir);
    if (!existsSync(fullDir)) return [];
    const baseName = baseFile.replace(/\.jpg$/, "");
    // Escape regex metacharacters in baseName so future callers can pass
    // filenames containing `.`, `+`, `(`, etc. without the regex breaking.
    const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const paginatedRe = new RegExp(`^${escapedBase}(?:-(\\d+))?\\.jpg$`);
    // Sort by the numeric page suffix so `contact-sheet-10.jpg` lands after
    // `contact-sheet-2.jpg`, not before (default string sort orders them
    // lexicographically and breaks at 10+ pages). Unpaginated `contact-sheet.jpg`
    // gets page 0 so it sorts first if it co-exists with paginated files.
    const all = readdirSync(fullDir)
      .filter((f) => paginatedRe.test(f))
      .map((f) => ({ name: f, page: parseInt(f.match(paginatedRe)?.[1] ?? "0", 10) }))
      .sort((a, b) => a.page - b.page)
      .map((entry) => entry.name);
    if (all.length === 0) return [];
    if (all.length === 1) {
      return [`| \`${dir}/${all[0]}\` | ${label} |`];
    }
    return all.map((f, i) => `| \`${dir}/${f}\` | ${label} — page ${i + 1} of ${all.length} |`);
  }

  const tableRows: string[] = [];
  if (hasScreenshot) {
    const screenshotRows = contactSheetRows(
      "screenshots",
      "contact-sheet.jpg",
      "**View this first.** All scroll screenshots in labeled grid — see the entire page at a glance",
    );
    if (screenshotRows.length > 0) {
      tableRows.push(...screenshotRows);
    } else {
      tableRows.push(
        "| `screenshots/contact-sheet.jpg` | **View this first.** All scroll screenshots in one labeled grid. |",
      );
    }
    tableRows.push(
      "| `screenshots/scroll-*.png` | Individual viewport screenshots if you need detail on a specific section. |",
    );
  }
  tableRows.push(
    `| \`extracted/tokens.json\` | Design tokens: ${tokens.colors.length} colors, ${tokens.fonts.length} fonts, ${tokens.headings?.length ?? 0} headings, ${tokens.ctas?.length ?? 0} CTAs |`,
  );
  // design-styles.json is written from a try/catch in capture/index.ts and
  // gets skipped when the live-DOM style extraction fails. Only list it in the
  // agent prompt when it actually exists, so the agent isn't pointed at a 404.
  if (existsSync(join(outputDir, "extracted", "design-styles.json"))) {
    tableRows.push(
      "| `extracted/design-styles.json` | Computed styles from live DOM: typography hierarchy, button/card/nav styles, spacing scale, border-radius, box shadows. Primary data source for DESIGN.md. |",
    );
  }
  tableRows.push(
    "| `extracted/asset-descriptions.md` | One-line description of every downloaded asset. Read this for asset selection — only open individual files for safe-zone checking. |",
  );
  tableRows.push(
    "| `extracted/visible-text.txt` | Page text in DOM order, prefixed with HTML tag (`[h1]`, `[p]`, `[a]`). Use as context — rephrase freely. |",
  );
  if (hasLottie) {
    tableRows.push(
      "| `extracted/lottie-manifest.json` | Lottie animations with previews at `assets/lottie/previews/`. |",
    );
  }
  if (hasShaders) {
    tableRows.push("| `extracted/shaders.json` | WebGL shader source (GLSL). |");
  }

  // Asset contact sheets — dynamically list all pages
  const assetSheetRows = contactSheetRows(
    "assets",
    "contact-sheet.jpg",
    "Downloaded images in labeled grid — view before opening individual files",
  );
  if (assetSheetRows.length > 0) {
    tableRows.push(...assetSheetRows);
  } else {
    tableRows.push("| `assets/contact-sheet.jpg` | All downloaded images in one labeled grid. |");
  }

  // SVG contact sheets — check both assets/svgs/ and assets/ root fallback
  const svgSubdirRows = contactSheetRows(
    "assets/svgs",
    "contact-sheet.jpg",
    "SVGs rendered as thumbnails in labeled grid",
  );
  const svgRootRows = contactSheetRows(
    "assets",
    "contact-sheet-svgs.jpg",
    "SVGs rendered as thumbnails in labeled grid",
  );
  const svgRows = svgSubdirRows.length > 0 ? svgSubdirRows : svgRootRows;
  if (svgRows.length > 0) {
    tableRows.push(...svgRows);
  }

  tableRows.push("| `assets/` | Individual downloaded images, SVGs, and font files. |");

  // Brand summary — just the essentials
  const brandLines: string[] = [];
  brandLines.push(`- **Colors**: ${colorSummary || "see tokens.json"}`);
  brandLines.push(`- **Fonts**: ${fontSummary}`);

  return `# ${title}

Source: ${url}

To create a video from this capture, use the \`product-launch-video\` skill.

## What's in This Capture

| File | Contents |
|------|----------|
${tableRows.join("\n")}

## Brand Summary

${brandLines.join("\n")}
`;
}
