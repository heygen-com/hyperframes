// A deployed site is `sites/<siteId>/files.json`: the project's files by path, each stored once
// in the shared content store under its SHA-256 (see `contentStoreUri`).

import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import type { RemoteProjectFile } from "@hyperframes/producer/distributed";
import { audioSidecarUri, contentStoreUri } from "./contentStore.js";
import {
  downloadS3ObjectToFile,
  downloadS3ObjectToFileVerified,
  formatS3Uri,
  mapConcurrent,
  parseS3Uri,
  presignS3GetUrl,
  s3ObjectExists,
} from "./s3Transport.js";

const SITE_MANIFEST_NAME = "files.json";
/** Stacks that read site manifests list this as a terminal plan error; the SDK checks for it. */
export const SITE_MANIFEST_INVALID = "SITE_MANIFEST_INVALID";
const VIDEO_EXTENSIONS_PLANNED_IN_PLACE = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);
const REMOTE_URL_TTL_SECONDS = 3600;

export interface SiteFile {
  /** `/`-separated, relative to the project root. */
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export function siteManifestUri(bucket: string, siteId: string): string {
  return formatS3Uri({ bucket, key: `sites/${siteId}/${SITE_MANIFEST_NAME}` });
}

/** Sites uploaded before site manifests are one tarball; the plan step still reads them. */
export function siteTarballUri(bucket: string, siteId: string): string {
  return formatS3Uri({ bucket, key: `sites/${siteId}/project.tar.gz` });
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

/** Rebuild the project under `projectDir`, SHA-256 verified; videos can stay remote, as URLs. */
export async function downloadSiteFiles(
  s3: S3Client,
  manifestUri: string,
  projectDir: string,
  leaveVideosRemote: boolean,
): Promise<Record<string, RemoteProjectFile>> {
  const manifestPath = `${projectDir}.${SITE_MANIFEST_NAME}`;
  await downloadS3ObjectToFile(s3, manifestUri, manifestPath);
  const files = parseSiteManifest(readFileSync(manifestPath, "utf-8"));
  const { bucket } = parseS3Uri(manifestUri);
  const remoteFiles: Record<string, RemoteProjectFile> = {};
  await mapConcurrent(files, 16, async ({ path, sha256, sizeBytes }) => {
    const uri = contentStoreUri(bucket, sha256);
    if (leaveVideosRemote && VIDEO_EXTENSIONS_PLANNED_IN_PLACE.has(extname(path).toLowerCase())) {
      const sidecar = audioSidecarUri(bucket, sha256);
      remoteFiles[path] = {
        url: await presignS3GetUrl(s3, uri, REMOTE_URL_TTL_SECONDS),
        ...((await s3ObjectExists(s3, sidecar))
          ? { audioSidecarUrl: await presignS3GetUrl(s3, sidecar, REMOTE_URL_TTL_SECONDS) }
          : {}),
        sha256,
        sizeBytes,
      };
      return;
    }
    await downloadS3ObjectToFileVerified(s3, uri, join(projectDir, ...path.split("/")), sha256);
  });
  return remoteFiles;
}

function isSafeRelativePath(path: string): boolean {
  return (
    path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..") &&
    !path.includes("\\")
  );
}

function siteManifestError(detail: string): Error {
  const error = new Error(`[siteManifest] ${SITE_MANIFEST_INVALID}: ${detail}`);
  error.name = SITE_MANIFEST_INVALID;
  return error;
}
