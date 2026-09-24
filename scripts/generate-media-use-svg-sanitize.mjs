#!/usr/bin/env node
// Bundles packages/core/src/figma/sanitizeSvg.ts (linkedom and all) into a single
// import-free .mjs so media-use's zero-install test lane can still run it under plain `node`.
// Regenerate after editing the source: node scripts/generate-media-use-svg-sanitize.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(here, "../packages/core/src/figma/sanitizeSvg.ts");
const OUTFILE = resolve(here, "../packages/cli/src/media-use/lib/svg-sanitize.mjs");
// scripts/ has no node_modules of its own (bun's per-consumer linking); reach into the one
// package that already depends on esbuild rather than adding a root-level dependency.
const { build } = await import(resolve(here, "../packages/core/node_modules/esbuild/lib/main.js"));

const HEADER = `// GENERATED — do not hand-edit. Source: packages/core/src/figma/sanitizeSvg.ts, bundled by
// scripts/generate-media-use-svg-sanitize.mjs so media-use's zero-install \`node --test\` lane can
// still run the real sanitizer. Regenerate: node scripts/generate-media-use-svg-sanitize.mjs
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
