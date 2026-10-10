#!/usr/bin/env node
/**
 * Build script for @hyperframes/aws-lambda (public OSS package).
 *
 * Bundles each subpath barrel via esbuild → dist/, then emits .d.ts via tsc.
 *
 * Subpaths (each gets its own dist entry so adopters that import one path
 * don't load the others' transitive graphs at module-load time):
 *
 *   .         (the umbrella barrel: handler + sdk + cdk types re-exported)
 *   ./handler (the Lambda runtime entry — what `scripts/build-zip.ts` ZIPs)
 *   ./sdk     (client-side helpers — AWS-SDK only, no chromium/puppeteer)
 *   ./cdk     (CDK L2 construct — aws-cdk-lib is a peer dep)
 *
 * All production deps and peer deps are kept external so consumers resolve
 * them via their own node_modules.
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
  external: [
    "@aws-sdk/client-s3",
    "@aws-sdk/client-sfn",
    "@hyperframes/producer",
    "@hyperframes/producer/distributed",
    "@sparticuz/chromium",
    "aws-cdk-lib",
    "constructs",
    "ffmpeg-static",
    "ffprobe-static",
    "puppeteer-core",
    "tar",
  ],
};

await Promise.all([
  build({ ...sharedOpts, entryPoints: ["src/index.ts"], outfile: "dist/index.js" }),
  build({ ...sharedOpts, entryPoints: ["src/handler.ts"], outfile: "dist/handler.js" }),
  build({ ...sharedOpts, entryPoints: ["src/sdk/index.ts"], outfile: "dist/sdk/index.js" }),
  build({ ...sharedOpts, entryPoints: ["src/cdk/index.ts"], outfile: "dist/cdk/index.js" }),
]);

// esbuild doesn't emit .d.ts. tsc does, with a build-only tsconfig that
// drops the workspace `paths` overrides so `@hyperframes/producer` resolves
// through node_modules to the sibling package's already-built `dist/`
// types instead of pulling its full source tree into emit (which would
// violate rootDir).
execSync("tsc -p tsconfig.build.json --emitDeclarationOnly", { stdio: "inherit" });

console.log("[Build] Complete: dist/{index,handler,sdk/index,cdk/index}.js + .d.ts");
