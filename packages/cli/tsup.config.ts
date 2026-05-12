import { defineConfig } from "tsup";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

export default defineConfig({
  // hf#732 lever-4: emit BOTH the CLI bundle and the PNG decode + alpha-blit
  // worker entry. The producer's `pngDecodeBlitWorkerPool` instantiates a
  // Node `worker_threads` Worker via `new Worker(<path>)`, which is a
  // filesystem load — it cannot share the parent module graph. The pool's
  // path resolver probes for `pngDecodeBlitWorker.js` next to its own loaded
  // module (which lives inside `dist/cli.js` after the producer is
  // `noExternal`'d and bundled in). Without this entry the file would not
  // exist at runtime and the pool would either crash or silently fall back
  // to inline decode/blit, killing the perf gain.
  entry: {
    cli: "src/cli.ts",
    pngDecodeBlitWorker: "../producer/src/services/pngDecodeBlitWorker.ts",
    // hf#677/#732: shader-blend worker. Same `new Worker(<path>)`
    // bundling rationale as `pngDecodeBlitWorker` above.
    shaderTransitionWorker: "../producer/src/services/shaderTransitionWorker.ts",
  },
  format: ["esm"],
  outDir: "dist",
  target: "node22",
  platform: "node",
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  banner: {
    js: `import { createRequire as __hf_createRequire } from "node:module";
import { fileURLToPath as __hf_fileURLToPath } from "node:url";
import { dirname as __hf_dirname } from "node:path";
var require = __hf_createRequire(import.meta.url);
var __filename = __hf_fileURLToPath(import.meta.url);
var __dirname = __hf_dirname(__filename);`,
  },
  external: [
    "puppeteer-core",
    "puppeteer",
    "@puppeteer/browsers",
    "open",
    "hono",
    "hono/*",
    "@hono/node-server",
    "mime-types",
    "adm-zip",
    "esbuild",
    "giget",
    "postcss",
  ],
  noExternal: [
    "@hyperframes/core",
    "@hyperframes/producer",
    "@hyperframes/engine",
    "@clack/prompts",
    "@clack/core",
    "picocolors",
    "linkedom",
    "sisteransi",
    "is-unicode-supported",
    "citty",
  ],
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
  },
  esbuildOptions(options) {
    options.alias = {
      "@hyperframes/producer": resolve(__dirname, "../producer/src/index.ts"),
      // hf#732 lever-4: alias for the PNG decode+blit worker's import.
      // `alphaBlit.ts` is import-free (only zlib) so the worker survives
      // the worker_thread loader boundary directly via this TS source.
      "@hyperframes/engine/alpha-blit": resolve(__dirname, "../engine/src/utils/alphaBlit.ts"),
      // hf#677 follow-up: the shader-blend worker imports from
      // `@hyperframes/engine/shader-transitions` (subpath export) — a
      // standalone TS file with zero internal imports that survives the
      // worker_thread loader boundary.
      "@hyperframes/engine/shader-transitions": resolve(
        __dirname,
        "../engine/src/utils/shaderTransitions.ts",
      ),
    };
    options.loader = { ...options.loader, ".browser.js": "text" };
  },
});
