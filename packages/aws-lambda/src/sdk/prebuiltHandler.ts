// The release assets pinned to this package version; the release workflow writes `prebuilt/`.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HANDLER_ZIP_ASSET = "hyperframes-lambda-handler.zip";
export const PREBUILT_DIR = "prebuilt";
export const HANDLER_MANIFEST_FILE = "handler-zip.json";
export const VIDEO_IMAGE_ASSET = "hyperframes-lambda-video-arm64.oci.tar";
export const VIDEO_IMAGE_MANIFEST_FILE = "video-image.json";

export interface ReleaseAssetManifest {
  version: string;
  url: string;
  sha256: string;
  bytes: number;
}

export interface PrebuiltHandler extends ReleaseAssetManifest {
  /** SAM template whose `CodeUri` is `handler.zip` in the same directory. */
  templatePath: string;
}

/** This package's root, found by walking up from the running module (source or bundle). */
export function adapterPackageRoot(): string {
  const from = fileURLToPath(import.meta.url);
  for (let dir = dirname(from); dir !== dirname(dir); dir = dirname(dir)) {
    const pkg = join(dir, "package.json");
    if (
      existsSync(pkg) &&
      JSON.parse(readFileSync(pkg, "utf-8")).name === "@hyperframes/aws-lambda"
    )
      return dir;
  }
  throw new Error(`[aws-lambda] no @hyperframes/aws-lambda package.json above ${from}`);
}

function readManifest(root: string, file: string): ReleaseAssetManifest | undefined {
  const path = join(root, PREBUILT_DIR, file);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf-8")) as ReleaseAssetManifest;
}

/** The pinned handler for this install, or undefined when this build carries none. */
export function prebuiltHandler(root: string = adapterPackageRoot()): PrebuiltHandler | undefined {
  const manifest = readManifest(root, HANDLER_MANIFEST_FILE);
  return manifest && { ...manifest, templatePath: join(root, PREBUILT_DIR, "template.yaml") };
}

/** The pinned arm64 video function image (an OCI layout tarball), or undefined when none is pinned. */
export function prebuiltVideoImage(
  root: string = adapterPackageRoot(),
): ReleaseAssetManifest | undefined {
  return readManifest(root, VIDEO_IMAGE_MANIFEST_FILE);
}
