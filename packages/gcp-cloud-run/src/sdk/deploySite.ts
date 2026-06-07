/**
 * `deploySite` — upload a project directory to GCS once per content hash
 * and return a reusable handle.
 *
 * `renderToCloudRun` calls this implicitly when no `siteHandle` is passed,
 * but exposing it as a standalone verb lets adopters bundle a project ahead
 * of time and reuse the handle across many renders without re-tarring the
 * project tree on every call.
 *
 * The handle is **content-addressed**: `siteId` is derived from a SHA-256
 * over the project files. Two `deploySite` calls on an unchanged tree
 * produce the same `siteId` and short-circuit the upload after a single
 * existence check.
 */

import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "@google-cloud/storage";
import { hashProjectDir } from "@hyperframes/producer/distributed";
import { formatGcsUri, tarDirectory, uploadFileToGcs } from "../gcsTransport.js";

/** Options for {@link deploySite}. */
export interface DeploySiteOptions {
  /** Local project directory containing `index.html` (and any composition assets). */
  projectDir: string;
  /** GCS bucket the Terraform module provisioned. */
  bucketName: string;
  /**
   * Override the content-addressed site id. Useful when the caller has a
   * stable external identifier they want to use (e.g. a git SHA); if unset,
   * the hash of the project tree picks it.
   */
  siteId?: string;
  /** Injection seam for tests. Production callers leave unset. */
  storage?: Storage;
}

/** Stable handle returned by {@link deploySite}. Pass back to {@link renderToCloudRun}. */
export interface SiteHandle {
  /** Content-addressed (or caller-supplied) identifier; stable across re-uploads of the same tree. */
  siteId: string;
  /** Bucket the site landed in. Surfaced separately so callers don't have to re-parse `projectGcsUri`. */
  bucketName: string;
  /** Full `gs://bucket/sites/<siteId>/project.tar.gz` URI; pass through to `renderToCloudRun`. */
  projectGcsUri: string;
  /** Tarball size in bytes; useful for "did we actually skip the upload?" assertions. */
  bytes: number;
  /** ISO timestamp of the most recent upload OR the existing object the short-circuit found. */
  uploadedAt: string;
  /** `false` if the object already existed and we skipped the upload. */
  uploaded: boolean;
}

/**
 * Upload `projectDir` to `gs://bucketName/sites/<siteId>/project.tar.gz`.
 *
 * Short-circuits when an object with the same key already exists in the
 * bucket — `siteId` derives from the project's content hash, so the same
 * bytes produce the same key, and re-uploading would be redundant.
 */
// fallow-ignore-next-line complexity
export async function deploySite(opts: DeploySiteOptions): Promise<SiteHandle> {
  if (!statSync(opts.projectDir).isDirectory()) {
    throw new Error(`[deploySite] projectDir is not a directory: ${opts.projectDir}`);
  }

  const siteId = opts.siteId ?? hashProjectDir(opts.projectDir);
  const key = `sites/${siteId}/project.tar.gz`;
  const projectGcsUri = formatGcsUri({ bucket: opts.bucketName, key });
  const storage = opts.storage ?? new Storage();
  const file = storage.bucket(opts.bucketName).file(key);

  // Existence short-circuit. Adopters re-rendering the same project on a
  // tight inner loop (CI smoke, demo flows) save the tar+gzip+upload pass
  // on every iteration.
  const existing = await headObject(file);
  if (existing) {
    return {
      siteId,
      bucketName: opts.bucketName,
      projectGcsUri,
      bytes: existing.bytes,
      uploadedAt: existing.lastModified,
      uploaded: false,
    };
  }

  const workdir = mkdtempSync(join(tmpdir(), "hf-deploy-site-"));
  try {
    const tarball = join(workdir, "project.tar.gz");
    await tarDirectory(opts.projectDir, tarball);
    const size = statSync(tarball).size;
    await uploadFileToGcs(storage, tarball, projectGcsUri, "application/gzip");
    return {
      siteId,
      bucketName: opts.bucketName,
      projectGcsUri,
      bytes: size,
      uploadedAt: new Date().toISOString(),
      uploaded: true,
    };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

/**
 * Narrow surface of the `@google-cloud/storage` `File` this module uses —
 * lets the test double implement just `exists()` + `getMetadata()` without
 * pulling the full client type.
 */
interface FileLike {
  exists(): Promise<[boolean, ...unknown[]]>;
  getMetadata(): Promise<[{ size?: string | number; updated?: string }, ...unknown[]]>;
}

// fallow-ignore-next-line complexity
async function headObject(file: FileLike): Promise<{ bytes: number; lastModified: string } | null> {
  const [exists] = await file.exists();
  if (!exists) return null;
  const [meta] = await file.getMetadata();
  const sizeRaw = meta.size;
  const bytes =
    typeof sizeRaw === "string" ? Number(sizeRaw) : typeof sizeRaw === "number" ? sizeRaw : 0;
  return {
    bytes: Number.isFinite(bytes) ? bytes : 0,
    lastModified: meta.updated ?? new Date().toISOString(),
  };
}
