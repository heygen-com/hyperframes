#!/usr/bin/env node
/**
 * Build script for @hyperframes/gcp-cloud-run (public OSS package).
 *
 * Bundles each subpath barrel via esbuild → dist/, then emits .d.ts via tsc.
 *
 * Subpaths (each gets its own dist entry so adopters that import one path
 * don't load the others' transitive graphs at module-load time):
 *
 *   .         (the umbrella barrel: server + sdk types re-exported)
 *   ./server  (the Cloud Run runtime entry — what the Dockerfile runs)
 *   ./sdk     (client-side helpers — GCS + Workflows clients only, no
 *             chromium/puppeteer)
 *
 * All production deps are kept external so consumers (and the container
 * image) resolve them via their own node_modules.
 */

import { build } from "esbuild";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

const sharedOpts = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  minify: false,
  sourcemap: true,
  external: [
    "@google-cloud/storage",
    "@google-cloud/workflows",
    "@hono/node-server",
    "@hyperframes/producer",
    "@hyperframes/producer/distributed",
    "hono",
    "puppeteer-core",
    "tar",
  ],
};

await Promise.all([
  build({ ...sharedOpts, entryPoints: ["src/index.ts"], outfile: "dist/index.js" }),
  build({ ...sharedOpts, entryPoints: ["src/server.ts"], outfile: "dist/server.js" }),
  build({ ...sharedOpts, entryPoints: ["src/sdk/index.ts"], outfile: "dist/sdk/index.js" }),
]);

// esbuild doesn't emit .d.ts. tsc does, with a build-only tsconfig that
// drops the workspace `paths` overrides so `@hyperframes/producer` resolves
// through node_modules to the sibling package's already-built `dist/`
// types instead of pulling its full source tree into emit (which would
// violate rootDir).
execSync("tsc -p tsconfig.build.json --emitDeclarationOnly", { stdio: "inherit" });

console.log("[Build] Complete: dist/{index,server,sdk/index}.js + .d.ts");
