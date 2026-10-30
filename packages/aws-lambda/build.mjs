#!/usr/bin/env node
/**
 * Build script for @hyperframes/aws-lambda (public OSS package).
 *
 * Bundles the subpath barrels in one esbuild pass → dist/, then emits .d.ts via tsc.
 *
 * Subpaths (each gets its own dist entry so adopters that import one path
 * don't load the others' transitive graphs at module-load time; code two
 * entries share is emitted once, in dist/_chunks/):
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
import { writePrebuiltTemplate } from "./scripts/prebuilt-template.mjs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

const sharedOpts = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  minify: false,
  external: [
    "@aws-sdk/client-ecr",
    "@aws-sdk/client-lambda",
    "@aws-sdk/client-s3",
    "@aws-sdk/client-sfn",
    "@aws-sdk/s3-request-presigner",
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

await build({
  ...sharedOpts,
  entryPoints: {
    index: "src/index.ts",
    handler: "src/handler.ts",
    "sdk/index": "src/sdk/index.ts",
    "cdk/index": "src/cdk/index.ts",
  },
  outdir: "dist",
  splitting: true,
  chunkNames: "_chunks/[name]-[hash]",
});

// esbuild doesn't emit .d.ts. tsc does, with a build-only tsconfig that
// drops the workspace `paths` overrides so `@hyperframes/producer` resolves
// through node_modules to the sibling package's already-built `dist/`
// types instead of pulling its full source tree into emit (which would
// violate rootDir).
execSync(
  "tsc -p tsconfig.build.json --emitDeclarationOnly && node ../../scripts/rewrite-relative-import-extensions.mjs dist",
  { stdio: "inherit" },
);

// The template ships in every build, so a PR packs and size-checks what a release publishes.
writePrebuiltTemplate("../..", "prebuilt");

console.log("[Build] Complete: dist/{index,handler,sdk/index,cdk/index}.js + dist/_chunks + .d.ts");
