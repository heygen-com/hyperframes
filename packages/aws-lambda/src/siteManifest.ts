/**
 * A deployed site is `sites/<siteId>/files.json`: the project's files by path, each stored once
 * in the shared content store under its SHA-256 (see {@link contentStoreUri}).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import { contentStoreUri } from "./contentStore.js";
import {
  downloadS3ObjectToFile,
  downloadS3ObjectToFileVerified,
  formatS3Uri,
  mapConcurrent,
  parseS3Uri,
} from "./s3Transport.js";

const SITE_MANIFEST_NAME = "files.json";

export interface SiteFile {
  /** `/`-separated, relative to the project root. */
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export function siteManifestUri(bucket: string, siteId: string): string {
  return formatS3Uri({ bucket, key: `sites/${siteId}/${SITE_MANIFEST_NAME}` });
}

export function isSiteManifestUri(uri: string): boolean {
  return uri.endsWith(`/${SITE_MANIFEST_NAME}`);
}

export function serializeSiteManifest(files: readonly SiteFile[]): string {
  return JSON.stringify({ files });
}

export function parseSiteManifest(text: string): SiteFile[] {
  const value = JSON.parse(text) as { files?: unknown };
  if (!Array.isArray(value.files)) throw siteManifestError("files must be an array");
  const seen = new Set<string>();
  return value.files.map((entry: Partial<SiteFile>, index) => {
    const { path, sha256, sizeBytes } = entry ?? {};
    if (typeof path !== "string" || !isSafeRelativePath(path) || seen.has(path)) {
      throw siteManifestError(`files[${index}].path is not a unique relative path`);
    }
    if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
      throw siteManifestError(`files[${index}].sha256 is not a lowercase SHA-256 digest`);
    }
    if (!Number.isSafeInteger(sizeBytes) || (sizeBytes as number) < 0) {
      throw siteManifestError(`files[${index}].sizeBytes is not a byte count`);
    }
    seen.add(path);
    return { path, sha256, sizeBytes: sizeBytes as number };
  });
}

/** Rebuild the project under `projectDir`, verifying every file's SHA-256 on the way. */
export async function downloadSiteFiles(
  s3: S3Client,
  manifestUri: string,
  projectDir: string,
): Promise<void> {
  const manifestPath = `${projectDir}.${SITE_MANIFEST_NAME}`;
  await downloadS3ObjectToFile(s3, manifestUri, manifestPath);
  const files = parseSiteManifest(readFileSync(manifestPath, "utf-8"));
  const { bucket } = parseS3Uri(manifestUri);
  await mapConcurrent(files, 16, (file) =>
    downloadS3ObjectToFileVerified(
      s3,
      contentStoreUri(bucket, file.sha256),
      join(projectDir, ...file.path.split("/")),
      file.sha256,
    ),
  );
}

function isSafeRelativePath(path: string): boolean {
  return (
    path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..") &&
    !path.includes("\\")
  );
}

function siteManifestError(detail: string): Error {
  const error = new Error(`[siteManifest] SITE_MANIFEST_INVALID: ${detail}`);
  error.name = "SITE_MANIFEST_INVALID";
  return error;
}
