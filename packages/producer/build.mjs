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
import { BUNDLES, WORKERS } from "./buildEntries.mjs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

const scriptDir = dirname(fileURLToPath(import.meta.url));

const sharedOpts = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // Dependencies install from package.json like any other package's, so the
  // tarball carries only producer's own code (as aws-lambda and gcp-cloud-run do).
  packages: "external",
  minify: false,
};

await Promise.all(
  [...BUNDLES, ...WORKERS].map(({ entry, outfile }) =>
    build({ ...sharedOpts, entryPoints: [entry], outfile }),
  ),
);

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
execSync("tsc --emitDeclarationOnly --declaration --declarationMap false", {
  stdio: "inherit",
});

console.log("[Build] Complete: dist/index.js, dist/public-server.js, *.d.ts");
