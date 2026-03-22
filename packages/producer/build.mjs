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

console.log("[Build] Complete: dist/index.js, dist/public-server.js");
