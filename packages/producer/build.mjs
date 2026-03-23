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
    external: ["puppeteer", "esbuild"],
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
    external: ["puppeteer", "esbuild"],
    plugins: [workspaceAliasPlugin],
    minify: false,
    sourcemap: true,
    entryPoints: ["src/server.ts"],
    outfile: "dist/public-server.js",
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
