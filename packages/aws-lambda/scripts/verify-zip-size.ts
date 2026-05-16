#!/usr/bin/env tsx
/**
 * CI gate on the Lambda ZIP size.
 *
 * Reads `dist/handler.zip.manifest.json` (written by `build-zip.ts`) and
 * exits non-zero if either the unzipped or zipped size exceeds the
 * declared limits. Lambda's hard ceiling for ZIP-deployed functions is
 * 250 MiB unzipped (262144000 bytes — AWS docs label it "250 MB" but use
 * binary mebibytes); the in-house budget is 248 MiB to keep headroom for
 * the Chrome tarball decompression that happens at cold start.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatBytes } from "./_formatBytes.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const distDir = join(packageRoot, "dist");
const zipPath = join(distDir, "handler.zip");
const manifestPath = join(distDir, "handler.zip.manifest.json");

interface Manifest {
  unzippedBytes: number;
  zippedBytes: number;
  source: string;
}

const IN_HOUSE_UNZIPPED_LIMIT = 248 * 1024 * 1024;
const IN_HOUSE_ZIPPED_LIMIT = 150 * 1024 * 1024;

function main(): void {
  if (!existsSync(zipPath)) {
    console.error(`[verify-zip-size] ${zipPath} not found. Run 'bun run build:zip' first.`);
    process.exit(1);
  }
  if (!existsSync(manifestPath)) {
    console.error(
      `[verify-zip-size] ${manifestPath} not found. The manifest is written by build-zip.ts; ` +
        `re-run the build.`,
    );
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;
  const actualZipped = statSync(zipPath).size;
  if (actualZipped !== manifest.zippedBytes) {
    console.warn(
      `[verify-zip-size] note: zip file size on disk (${actualZipped}) differs from ` +
        `manifest (${manifest.zippedBytes}). Using on-disk value.`,
    );
  }

  let failed = false;
  if (manifest.unzippedBytes > IN_HOUSE_UNZIPPED_LIMIT) {
    console.error(
      `[verify-zip-size] FAIL unzipped: ${formatBytes(manifest.unzippedBytes)} > ` +
        `${formatBytes(IN_HOUSE_UNZIPPED_LIMIT)} (in-house limit; Lambda hard ceiling is 250 MiB).`,
    );
    failed = true;
  }
  if (actualZipped > IN_HOUSE_ZIPPED_LIMIT) {
    console.error(
      `[verify-zip-size] FAIL zipped: ${formatBytes(actualZipped)} > ` +
        `${formatBytes(IN_HOUSE_ZIPPED_LIMIT)} (in-house limit; Lambda direct-upload ceiling is 50 MiB, ` +
        `S3-deploy ceiling is 250 MiB).`,
    );
    failed = true;
  }

  if (failed) {
    console.error("[verify-zip-size] FAILED — bundle is too large for Lambda ZIP deploy.");
    process.exit(1);
  }
  console.log(
    `[verify-zip-size] OK source=${manifest.source} unzipped=${formatBytes(
      manifest.unzippedBytes,
    )} zipped=${formatBytes(actualZipped)}`,
  );
}

main();
