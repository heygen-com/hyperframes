/**
 * `deploySite` — upload a project directory to S3 and return a reusable handle.
 *
 * `renderToLambda` calls this implicitly when no `siteHandle` is passed,
 * but exposing it as a standalone verb lets adopters upload a project
 * ahead of time and reuse the handle across many renders.
 *
 * Every file goes into the bucket's shared content store under its SHA-256,
 * once: a file any earlier site or render already stored is skipped. The
 * site itself is a small `sites/<siteId>/files.json` listing path → hash,
 * where `siteId` is derived from a SHA-256 over the project files.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { CONTENT_STORE_RETENTION_DAYS, audioSidecarUri } from "../contentStore.js";
import {
  buildAudioSidecar,
  hashProjectDir,
  listSiteFiles,
  wantsAudioSidecar,
} from "@hyperframes/producer/distributed";
import {
  downloadS3ObjectToFile,
  ensureContentStoreObject,
  isS3NotFound,
  mapConcurrent,
  parseS3Uri,
  putAudioSidecar,
  putContentStoreFile,
  s3ObjectExists,
  sha256File,
  uploadContentAddressedFileToS3,
} from "../s3Transport.js";
import {
  isSiteManifestUri,
  parseSiteManifest,
  serializeSiteManifest,
  siteManifestUri,
  siteTarballUri,
  type SiteFile,
} from "../siteManifest.js";

/** Options for {@link deploySite}. */
export interface DeploySiteOptions {
  /** Local project directory containing `index.html` (and any composition assets). */
  projectDir: string;
  /** S3 bucket the SAM stack / CDK construct provisioned. */
  bucketName: string;
  /** AWS region for the S3 client. Defaults to the SDK's default chain (env / config / IMDS). */
  region?: string;
  /**
   * Override the content-addressed site id. Useful when the caller has a
   * stable external identifier they want to use (e.g. a git SHA); if
   * unset, the hash of the project tree picks it.
   */
  siteId?: string;
  /** Called with a line a user should see, such as audio sidecars skipped for want of ffmpeg. */
  onNotice?: (message: string) => void;
  /** Injection seam for tests. Production callers leave unset. */
  s3?: S3Client;
}

/** Stable handle returned by {@link deploySite}. Pass back to {@link renderToLambda}. */
export interface SiteHandle {
  /** Content-addressed (or caller-supplied) identifier; stable across re-uploads of the same tree. */
  siteId: string;
  /** Bucket the site landed in. Surfaced separately so callers don't have to re-parse `projectS3Uri`. */
  bucketName: string;
  /** Full `s3://bucket/sites/<siteId>/files.json` URI; pass through to `renderToLambda`. */
  projectS3Uri: string;
  /** Total size of the project's files in bytes. */
  bytes: number;
  /** ISO timestamp of this `deploySite` call. */
  uploadedAt: string;
  /** `false` if every file and the site manifest were already in the bucket. */
  uploaded: boolean;
}

/** Handle for a site an earlier {@link deploySite} uploaded; `bytes` and `uploadedAt` are unknown. */
export function siteHandleFromId(bucketName: string, siteId: string): SiteHandle {
  const projectS3Uri = siteManifestUri(bucketName, siteId);
  return { siteId, bucketName, projectS3Uri, bytes: 0, uploadedAt: "", uploaded: false };
}

/**
 * Before a render reuses `site`, re-store any file the content store expired, from `projectDir`.
 * Returns the handle to render: a site uploaded before site manifests resolves to its tarball.
 */
export async function ensureSiteStored(
  site: SiteHandle,
  s3: S3Client,
  projectDir?: string,
): Promise<SiteHandle> {
  if (!isSiteManifestUri(site.projectS3Uri)) return site;
  const { bucket } = parseS3Uri(site.projectS3Uri);
  const workdir = mkdtempSync(join(tmpdir(), "hf-site-check-"));
  try {
    const manifestPath = join(workdir, "files.json");
    try {
      await downloadS3ObjectToFile(s3, site.projectS3Uri, manifestPath);
    } catch (error) {
      if (!isS3NotFound(error)) throw error;
      return await tarballSite(site, s3, bucket);
    }
    const files = parseSiteManifest(readFileSync(manifestPath, "utf-8"));
    const missing: string[] = [];
    await mapConcurrent(files, 16, async ({ path, sha256, sizeBytes }) => {
      try {
        await ensureContentStoreObject(s3, bucket, sha256, sizeBytes);
      } catch (error) {
        if ((error as Error).name !== "PLAN_ARTIFACT_MISSING") throw error;
        const localPath = projectDir && join(projectDir, path);
        if (!localPath || !(await hasContent(localPath, sha256))) return void missing.push(path);
        await putContentStoreFile(s3, localPath, bucket, sha256);
      }
    });
    if (missing.length > 0) {
      const error = new Error(
        `[deploySite] SITE_FILES_MISSING: ${missing.length} of ${files.length} files of site ` +
          `${site.siteId} are no longer stored (unused for ${CONTENT_STORE_RETENTION_DAYS} days). ` +
          "Run `hyperframes lambda sites create`, or render from the project directory that has them.",
      );
      error.name = "SITE_FILES_MISSING";
      throw error;
    }
    return site;
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

async function hasContent(localPath: string, sha256: string): Promise<boolean> {
  return existsSync(localPath) && (await sha256File(localPath)) === sha256;
}

async function tarballSite(site: SiteHandle, s3: S3Client, bucket: string): Promise<SiteHandle> {
  const projectS3Uri = siteTarballUri(bucket, site.siteId);
  if (await s3ObjectExists(s3, projectS3Uri)) return { ...site, projectS3Uri };
  const error = new Error(
    `[deploySite] SITE_NOT_FOUND: site ${site.siteId} has neither ${site.projectS3Uri} nor ` +
      `${projectS3Uri}. Run \`hyperframes lambda sites create\` again and use the new site id.`,
  );
  error.name = "SITE_NOT_FOUND";
  throw error;
}

/** Upload `projectDir`'s files to the content store and write the site manifest. */
export async function deploySite(opts: DeploySiteOptions): Promise<SiteHandle> {
  const s3 = opts.s3 ?? new S3Client({ region: opts.region });
  if (!statSync(opts.projectDir).isDirectory()) {
    throw new Error(`[deploySite] projectDir is not a directory: ${opts.projectDir}`);
  }
  const files = listSiteFiles(opts.projectDir);
  const siteId = opts.siteId ?? hashProjectDir(opts.projectDir, files);
  const projectS3Uri = siteManifestUri(opts.bucketName, siteId);

  const stored: SiteFile[] = [];
  let uploaded = false;
  await mapConcurrent(files, 8, async (path) => {
    const localPath = join(opts.projectDir, path);
    const sha256 = await sha256File(localPath);
    stored.push({ path, sha256, sizeBytes: statSync(localPath).size });
    const outcome = await putContentStoreFile(s3, localPath, opts.bucketName, sha256);
    uploaded ||= outcome === "uploaded";
  });
  stored.sort((a, b) => (a.path < b.path ? -1 : 1));
  await storeAudioSidecars(s3, opts, stored);

  const workdir = mkdtempSync(join(tmpdir(), "hf-deploy-site-"));
  try {
    const manifestPath = join(workdir, "files.json");
    const manifest = serializeSiteManifest(stored);
    writeFileSync(manifestPath, manifest);
    const outcome = await uploadContentAddressedFileToS3(
      s3,
      manifestPath,
      projectS3Uri,
      await sha256File(manifestPath),
      "application/json",
    );
    uploaded ||= outcome === "uploaded";
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
  return {
    siteId,
    bucketName: opts.bucketName,
    projectS3Uri,
    bytes: stored.reduce((sum, file) => sum + file.sizeBytes, 0),
    uploadedAt: new Date().toISOString(),
    uploaded,
  };
}

/**
 * Each large video's audio, stored on its own so a render reads kilobytes instead of the whole video.
 * Optional: a machine that cannot make them leaves the site exactly as it was, and renders read the video.
 */
async function storeAudioSidecars(
  s3: S3Client,
  opts: DeploySiteOptions,
  files: readonly SiteFile[],
): Promise<void> {
  const videos = files.filter((file) => wantsAudioSidecar(file.path, file.sizeBytes));
  if (videos.length === 0) return;
  const workdir = mkdtempSync(join(tmpdir(), "hf-audio-sidecar-"));
  let unavailable = false;
  try {
    await mapConcurrent(videos, 2, async ({ path, sha256 }) => {
      if (unavailable || (await s3ObjectExists(s3, audioSidecarUri(opts.bucketName, sha256))))
        return;
      const sidecarPath = join(workdir, `${sha256}.m4a`);
      const outcome = await buildAudioSidecar(join(opts.projectDir, path), sidecarPath);
      if (outcome === "unavailable") unavailable = true;
      if (outcome === "built") await putAudioSidecar(s3, sidecarPath, opts.bucketName, sha256);
      rmSync(sidecarPath, { force: true });
    });
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
  if (unavailable) {
    opts.onNotice?.(
      "ffmpeg was not found on this machine, so the audio of large videos was not stored on its own: " +
        "renders will read the whole video for its audio and take longer. Install ffmpeg and run `sites create` again.",
    );
  }
}
