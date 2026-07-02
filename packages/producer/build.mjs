#!/usr/bin/env node
/**
 * Build script for @hyperframes/producer (public OSS package)
 *
 * Bundles src/server.ts → dist/public-server.js (standalone server).
 */

import { build } from "esbuild";
import { mkdirSync, rmSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

const scriptDir = dirname(fileURLToPath(import.meta.url));

// The banner provides a real `require` (via createRequire) plus the CJS-only
// `__filename`/`__dirname` globals so esbuild's CJS interop works in ESM output.
// Without `require`, bundled CJS deps (recast, yauzl, etc.) that call
// require("fs") throw "Dynamic require of 'fs' is not supported"; without the
// dirname shims, deps like wawoff2 throw "__dirname is not defined in ES module".
const cjsBanner = {
  js: `import { createRequire as __cjsRequire } from 'module';
import { fileURLToPath as __cjsFileURLToPath } from 'url';
import { dirname as __cjsDirname } from 'path';
const require = __cjsRequire(import.meta.url);
const __filename = __cjsFileURLToPath(import.meta.url);
const __dirname = __cjsDirname(__filename);`,
};

const workspaceAliasPlugin = {
  name: "workspace-alias",
  setup(build) {
    build.onResolve({ filter: /^@hyperframes\/engine$/ }, () => ({
      path: resolve(scriptDir, "../engine/src/index.ts"),
    }));
    build.onResolve({ filter: /^@hyperframes\/engine\/alpha-blit$/ }, () => ({
      path: resolve(scriptDir, "../engine/src/utils/alphaBlit.ts"),
    }));
    build.onResolve({ filter: /^@hyperframes\/engine\/shader-transitions$/ }, () => ({
      path: resolve(scriptDir, "../engine/src/utils/shaderTransitions.ts"),
    }));
    build.onResolve({ filter: /^@hyperframes\/core$/ }, () => ({
      path: resolve(scriptDir, "../core/src/index.ts"),
    }));
    build.onResolve({ filter: /^@hyperframes\/core\/lint$/ }, () => ({
      path: resolve(scriptDir, "../core/src/lint/index.ts"),
    }));
  },
};

const sharedOpts = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["puppeteer", "esbuild", "postcss"],
  plugins: [workspaceAliasPlugin],
  minify: false,
  sourcemap: true,
  banner: cjsBanner,
};

await Promise.all([
  build({ ...sharedOpts, entryPoints: ["src/index.ts"], outfile: "dist/index.js" }),
  build({ ...sharedOpts, entryPoints: ["src/server.ts"], outfile: "dist/public-server.js" }),
  build({
    ...sharedOpts,
    entryPoints: ["src/services/shaderTransitionWorker.ts"],
    outfile: "dist/services/shaderTransitionWorker.js",
  }),
  build({
    ...sharedOpts,
    entryPoints: ["src/services/healthWorkerThread.ts"],
    outfile: "dist/services/healthWorkerThread.js",
  }),
  build({ ...sharedOpts, entryPoints: ["src/distributed.ts"], outfile: "dist/distributed.js" }),
]);

// Copy core runtime artifacts so the producer can find them at dist/
import { copyFileSync, existsSync, readFileSync } from "fs";
const coreDistDir = resolve(scriptDir, "../core/dist");
try {
  const manifestSrc = resolve(coreDistDir, "hyperframe.manifest.json");
  if (existsSync(manifestSrc)) {
    copyFileSync(manifestSrc, "dist/hyperframe.manifest.json");
    const manifest = JSON.parse(readFileSync(manifestSrc, "utf8"));
    const runtimeIife = manifest?.artifacts?.iife || "hyperframe.runtime.iife.js";
    copyFileSync(resolve(coreDistDir, runtimeIife), `dist/${runtimeIife}`);
    console.log(`[Build] Copied runtime: hyperframe.manifest.json, ${runtimeIife}`);
  }
} catch (e) {
  console.warn("[Build] Warning: Could not copy runtime artifacts:", e.message);
}

// Generate .d.ts declarations (esbuild doesn't emit them)
import { execSync } from "child_process";
execSync("tsc --emitDeclarationOnly --declaration --declarationMap", {
  stdio: "inherit",
});

console.log("[Build] Complete: dist/index.js, dist/public-server.js, *.d.ts");
