import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parseCoverageMap } from "./build-qa-gallery";

const THEME_NAMES = ["neutral", "bold", "editorial"] as const;

type ThemeName = (typeof THEME_NAMES)[number];

interface Theme {
  name: ThemeName;
  css: string;
}

interface StagedTriple {
  primitive: string;
  neutral: string;
  bold: string;
  editorial: string;
}

export function injectTheme(html: string, theme: Theme): string {
  const closingHead = html.search(/<\/head\s*>/i);
  if (closingHead === -1) throw new Error("QA page has no closing head tag");

  // Demos declare contract tokens on element scope (#root { --bg: ... }),
  // which beats a plain :root injection for every descendant. Re-target the
  // theme block at both scopes and mark each declaration !important so the
  // injected theme actually wins, emulating a host that supplies the theme.
  const forced = theme.css
    .trim()
    .replace(/^:root\s*\{/, ":root, #root, [data-composition-id] {")
    .replace(/;(\s*\n)/g, " !important;$1");
  const style = `  <style data-hyperframes-theme="${theme.name}">\n${forced}\n  </style>\n`;
  return `${html.slice(0, closingHead)}${style}${html.slice(closingHead)}`;
}

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dir, "..");
  const coveragePath = resolve(repoRoot, "../../../..", "candidates-registry-coverage.md");
  const outputDir = join(repoRoot, "docs/public/theme-gate");

  const candidates = parseCoverageMap(await readFile(coveragePath, "utf8"));
  // Explicit names win (bun scripts/theme-gate.ts name1 name2 ...); default: all BUILT.
  const requested = process.argv.slice(2);
  const primitiveNames =
    requested.length > 0
      ? requested
      : [
          ...new Set(
            candidates
              .filter((candidate) => candidate.status === "BUILT")
              .map((candidate) => candidate.candidate),
          ),
        ];
  if (primitiveNames.length === 0) throw new Error("coverage map contains no BUILT primitives");

  const themes: Theme[] = await Promise.all(
    THEME_NAMES.map(async (name) => ({
      name,
      css: await readFile(join(repoRoot, "themes", `${name}.css`), "utf8"),
    })),
  );
  const pages = await Promise.all(
    primitiveNames.map(async (primitive) => ({
      primitive,
      html: await readFile(join(repoRoot, "docs/public/qa", `${primitive}.html`), "utf8"),
    })),
  );

  await rm(outputDir, { force: true, recursive: true });
  await mkdir(outputDir, { recursive: true });

  const index: StagedTriple[] = [];
  for (const page of pages) {
    const triple: StagedTriple = {
      primitive: page.primitive,
      neutral: `${page.primitive}.neutral.html`,
      bold: `${page.primitive}.bold.html`,
      editorial: `${page.primitive}.editorial.html`,
    };
    for (const theme of themes) {
      await writeFile(join(outputDir, triple[theme.name]), injectTheme(page.html, theme));
    }
    index.push(triple);
  }

  await writeFile(join(outputDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  console.log(
    `Staged ${index.length * themes.length} theme variants for ${index.length} BUILT primitives.`,
  );
}

if (import.meta.main) {
  await main();
}
