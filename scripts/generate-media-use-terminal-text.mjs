#!/usr/bin/env node
// Bundles packages/core/src/terminalText.ts into a single import-free .mjs so the media-use engine,
// which runs unbundled from the published CLI, escapes printed text the way the rest of the CLI does.
// Regenerate after editing the source: node scripts/generate-media-use-terminal-text.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(here, "../packages/core/src/terminalText.ts");
const OUTFILE = resolve(here, "../packages/cli/src/media-use/lib/terminal-text.mjs");
// scripts/ has no node_modules of its own (bun's per-consumer linking); reach into the one
// package that already depends on esbuild rather than adding a root-level dependency.
const { build } = await import(resolve(here, "../packages/core/node_modules/esbuild/lib/main.js"));

const HEADER = `// GENERATED — do not hand-edit. Source: packages/core/src/terminalText.ts, bundled by
// scripts/generate-media-use-terminal-text.mjs so the unbundled media-use engine shows control
// characters the way the rest of the CLI does. Regenerate: node scripts/generate-media-use-terminal-text.mjs
`;

export async function generate() {
  const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    minify: true,
    legalComments: "none",
  });
  return HEADER + result.outputFiles[0].text;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await generate();
  writeFileSync(OUTFILE, code);
  console.log(`wrote ${OUTFILE} (${code.length} bytes)`);
}
