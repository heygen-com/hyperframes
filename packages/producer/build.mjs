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

await Promise.all([
  build({
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    external: ["puppeteer", "esbuild", "postcss", "wawoff2"],
    plugins: [workspaceAliasPlugin],
    minify: false,
    sourcemap: true,
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.js",
  }),
  build({
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    external: ["puppeteer", "esbuild", "postcss", "wawoff2"],
    plugins: [workspaceAliasPlugin],
    minify: false,
    sourcemap: true,
    entryPoints: ["src/server.ts"],
    outfile: "dist/public-server.js",
  }),
  // PNG decode + alpha-blit worker (hf#732 lever-4). Loaded by
  // `pngDecodeBlitWorkerPool.createPngDecodeBlitWorkerPool` via
  // `new Worker(<path>)`. Must be a separate entry point so the worker
  // module is standalone and shares no parent module-graph state.
  build({
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    external: ["puppeteer", "esbuild", "postcss", "wawoff2"],
    plugins: [workspaceAliasPlugin],
    minify: false,
    sourcemap: true,
    entryPoints: ["src/services/pngDecodeBlitWorker.ts"],
    outfile: "dist/services/pngDecodeBlitWorker.js",
  }),
  // Shader-blend worker (hf#677 follow-up). Loaded by
  // `shaderTransitionWorkerPool.createShaderTransitionWorkerPool` via
  // `new Worker(<path>)`. Same bundling rationale as the
  // `pngDecodeBlitWorker` entry above.
  build({
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    external: ["puppeteer", "esbuild", "postcss", "wawoff2"],
    plugins: [workspaceAliasPlugin],
    minify: false,
    sourcemap: true,
    entryPoints: ["src/services/shaderTransitionWorker.ts"],
    outfile: "dist/services/shaderTransitionWorker.js",
  }),
  // `@hyperframes/producer/distributed` subpath — the public distributed
  // render primitives (plan / renderChunk / assemble). Bundled as a
  // separate entry so adopters that don't need the in-process renderer
  // (Lambda chunk workers, CDK constructs, thin orchestrators) can import
  // only this surface and skip the rest of the producer's dependency tree.
  build({
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    external: ["puppeteer", "esbuild", "postcss", "wawoff2"],
    plugins: [workspaceAliasPlugin],
    minify: false,
    sourcemap: true,
    entryPoints: ["src/distributed.ts"],
    outfile: "dist/distributed.js",
  }),
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
