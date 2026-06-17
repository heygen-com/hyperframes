// Prebuild the beat-detection browser bundle into dist so `hyperframes beats`
// works in the published CLI (which ships only dist, not source). Mirrors how
// the runtime IIFE is shipped. headlessAnalyzer.ts loads this at runtime and
// injects it into a headless page.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const coreRoot = dirname(require.resolve("@hyperframes/core/package.json"));
const entry = join(coreRoot, "src/beats/beatDetection.ts");

await build({
  stdin: {
    contents:
      `import { analyzeMusicFromBuffer } from ${JSON.stringify(entry)};\n` +
      `globalThis.__hfAnalyze = analyzeMusicFromBuffer;`,
    resolveDir: coreRoot,
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  outfile: "dist/beat-analyzer.global.js",
});

console.log("built dist/beat-analyzer.global.js");
