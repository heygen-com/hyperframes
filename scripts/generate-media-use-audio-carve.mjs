#!/usr/bin/env node
// Bundles the carve analysis carve.mjs uses (packages/core/src/audioCarve.ts and audioFx.ts), and the private-path
// rule it checks sources with (packages/parsers/src/privatePath.ts), into a single
// import-free .mjs beside the skill, so the skill never loads @hyperframes/core from the project it edits.
// Regenerate after editing the source: node scripts/generate-media-use-audio-carve.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const CORE_SRC = resolve(here, "../packages/core/src");
const OUTFILE = resolve(here, "../skills/media-use/audio/scripts/lib/audio-carve.mjs");
// scripts/ has no node_modules of its own (bun's per-consumer linking); reach into the one
// package that already depends on esbuild rather than adding a root-level dependency.
const { build } = await import(resolve(here, "../packages/core/node_modules/esbuild/lib/main.js"));

const ENTRY = `export {
  analyseCarveBands,
  analyseCarveDuck,
  analyseCarveDynamics,
  carveBandsToChain,
  carveProfile,
  classifyAudioName,
  clipsOverlap,
  mixCarveSources,
} from "./audioCarve.ts";
export {
  defaultAudioFxParams,
  mintAudioFxNodeId,
  parseAudioFxChain,
  serializeAudioFxChain,
} from "./audioFx.ts";
export { isStudioPrivatePath } from "../../parsers/src/privatePath.ts";
`;

const HEADER = `// GENERATED: do not hand-edit. Source: packages/core/src/audioCarve.ts and audioFx.ts, and
// packages/parsers/src/privatePath.ts, bundled by scripts/generate-media-use-audio-carve.mjs so carve.mjs
// runs the same analysis and private-path rule as Studio without loading @hyperframes/core from the project.
// Regenerate: node scripts/generate-media-use-audio-carve.mjs
`;

export async function generate() {
  const result = await build({
    stdin: {
      contents: ENTRY,
      resolveDir: CORE_SRC,
      loader: "ts",
      sourcefile: "audio-carve-entry.ts",
    },
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
