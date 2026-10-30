#!/usr/bin/env bun
// Release step: writes the handler ZIP's pin (asset URL + sha256) and the SAM template into the
// package, or with --video-image the arm64 video image's pin. A retried release run reuses the
// asset already on the release.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HANDLER_MANIFEST_FILE,
  HANDLER_ZIP_ASSET,
  PREBUILT_DIR,
  type ReleaseAssetManifest,
  VIDEO_IMAGE_ASSET,
  VIDEO_IMAGE_MANIFEST_FILE,
} from "../src/sdk/prebuiltHandler.js";
import { writePrebuiltTemplate } from "./prebuilt-template.mjs";

/** Hashes `dist/<asset>`, writes its `.sha256` beside it and its pin to `prebuilt/<manifestFile>`. */
export function pinReleaseAsset(
  repoRoot: string,
  asset: string,
  manifestFile: string,
): ReleaseAssetManifest {
  const pkgDir = join(repoRoot, "packages", "aws-lambda");
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8")) as {
    version: string;
    repository: { url: string };
  };
  const bytes = readFileSync(join(repoRoot, "dist", asset));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(repoRoot, "dist", `${asset.split(".")[0]}.sha256`), `${sha256}  ${asset}\n`);

  const manifest: ReleaseAssetManifest = {
    version: pkg.version,
    url: `${pkg.repository.url}/releases/download/v${pkg.version}/${asset}`,
    sha256,
    bytes: bytes.length,
  };
  const outDir = join(pkgDir, PREBUILT_DIR);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, manifestFile), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function pinHandlerZip(repoRoot: string): ReleaseAssetManifest {
  const pkgDir = join(repoRoot, "packages", "aws-lambda");
  const asset = join(repoRoot, "dist", HANDLER_ZIP_ASSET);
  const built = join(pkgDir, "dist", "handler.zip");
  if (existsSync(built)) {
    mkdirSync(dirname(asset), { recursive: true });
    renameSync(built, asset);
    rmSync(`${built}.manifest.json`, { force: true });
  }
  writePrebuiltTemplate(repoRoot, join(pkgDir, PREBUILT_DIR));
  return pinReleaseAsset(repoRoot, HANDLER_ZIP_ASSET, HANDLER_MANIFEST_FILE);
}

if (import.meta.main) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const manifest = process.argv.includes("--video-image")
    ? pinReleaseAsset(repoRoot, VIDEO_IMAGE_ASSET, VIDEO_IMAGE_MANIFEST_FILE)
    : pinHandlerZip(repoRoot);
  console.log(JSON.stringify(manifest, null, 2));
}
