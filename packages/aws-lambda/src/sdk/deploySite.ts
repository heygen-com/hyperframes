/**
 * `deploySite` — upload a project directory to S3 once per content hash
 * and return a reusable handle.
 *
 * `renderToLambda` calls this implicitly when no `siteHandle` is passed,
 * but exposing it as a standalone verb lets adopters bundle a project
 * ahead of time and reuse the handle across many renders without
 * re-tarring the project tree on every call.
 *
 * The handle is **content-addressed**: `siteId` is derived from a SHA-256
 * over the project files. Two `deploySite` calls on an unchanged tree
 * produce the same `siteId` and `HeadObject`-short-circuit the upload.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PLAN_PROJECT_DIR_SKIP_SEGMENTS } from "@hyperframes/producer/distributed";
import { formatS3Uri, tarDirectory, uploadFileToS3 } from "../s3Transport.js";

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
  /** Injection seam for tests. Production callers leave unset. */
  s3?: S3Client;
}

/** Stable handle returned by {@link deploySite}. Pass back to {@link renderToLambda}. */
export interface SiteHandle {
  /** Content-addressed (or caller-supplied) identifier; stable across re-uploads of the same tree. */
  siteId: string;
  /** Bucket the site landed in. Surfaced separately so callers don't have to re-parse `projectS3Uri`. */
  bucketName: string;
  /** Full `s3://bucket/sites/<siteId>/project.tar.gz` URI; pass through to `renderToLambda`. */
  projectS3Uri: string;
  /** Tarball size in bytes; useful for "did we actually skip the upload?" assertions. */
  bytes: number;
  /** ISO timestamp of the most recent upload OR the existing object the short-circuit found. */
  uploadedAt: string;
  /** `false` if the object already existed and we skipped the PUT. */
  uploaded: boolean;
}

/**
 * Upload `projectDir` to `s3://bucketName/sites/<siteId>/project.tar.gz`.
 *
 * Short-circuits when an object with the same key already exists in the
 * bucket — `siteId` derives from the project's content hash, so the same
 * bytes produce the same key, and re-uploading would be redundant.
 */
export async function deploySite(opts: DeploySiteOptions): Promise<SiteHandle> {
  if (!statSync(opts.projectDir).isDirectory()) {
    throw new Error(`[deploySite] projectDir is not a directory: ${opts.projectDir}`);
  }

  const siteId = opts.siteId ?? hashProjectDir(opts.projectDir);
  const key = `sites/${siteId}/project.tar.gz`;
  const projectS3Uri = formatS3Uri({ bucket: opts.bucketName, key });
  const s3 = opts.s3 ?? new S3Client({ region: opts.region });

  // HeadObject short-circuit. Adopters re-rendering the same project on
  // a tight inner loop (CI smoke, demo flows) save the tar+gzip+PUT pass
  // on every iteration.
  const existing = await headObject(s3, opts.bucketName, key);
  if (existing) {
    return {
      siteId,
      bucketName: opts.bucketName,
      projectS3Uri,
      bytes: existing.bytes,
      uploadedAt: existing.lastModified,
      uploaded: false,
    };
  }

  const workdir = mkdtempSync(join(tmpdir(), "hf-deploy-site-"));
  try {
    const tarball = join(workdir, "project.tar.gz");
    await tarDirectory(opts.projectDir, tarball);
    // Note: tarDirectory packs *everything* under `cwd`. We don't need to
    // re-implement the skip list inside the tar pack because the
    // producer's plan stage applies the same skip during its copy; the
    // archive is slightly bigger than the planDir's compiled/ subtree
    // but the cost is bounded by the project's user-authored content.
    const size = statSync(tarball).size;
    await uploadFileToS3(s3, tarball, projectS3Uri, "application/gzip");
    return {
      siteId,
      bucketName: opts.bucketName,
      projectS3Uri,
      bytes: size,
      uploadedAt: new Date().toISOString(),
      uploaded: true,
    };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

/**
 * SHA-256 over every regular file under `projectDir` (sorted by relative
 * path) → 16-character hex prefix. The prefix is the `siteId`.
 *
 * The hash includes the relative path plus every byte of each file, so a
 * same-bytes rename still yields a fresh id. We trim to 16 chars because
 * the full 64 isn't useful in an S3 key for legibility.
 *
 * Reads are synchronous: project trees are typically tens of MB at most
 * (HTML/CSS/JS plus a few composition assets), so the simpler shape wins
 * over a streaming pipeline.
 */
function hashProjectDir(projectDir: string): string {
  const hash = createHash("sha256");
  const files: string[] = [];
  function walk(dir: string, isRoot: boolean): void {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      if (isRoot && PLAN_PROJECT_DIR_SKIP_SEGMENTS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, false);
      else if (entry.isFile()) files.push(full);
    }
  }
  walk(projectDir, true);
  for (const file of files) {
    const rel = relative(projectDir, file).replaceAll("\\", "/");
    hash.update(rel);
    hash.update("\0");
    hash.update(readFileSync(file));
  }
  return hash.digest("hex").slice(0, 16);
}

async function headObject(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<{ bytes: number; lastModified: string } | null> {
  try {
    const res = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return {
      bytes: typeof res.ContentLength === "number" ? res.ContentLength : 0,
      lastModified:
        res.LastModified instanceof Date
          ? res.LastModified.toISOString()
          : new Date().toISOString(),
    };
  } catch (err) {
    // The SDK throws different error shapes for 404 vs 403 vs network;
    // a 404 means "needs upload" and is the most common case. Anything
    // else propagates so callers see auth / network failures.
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    const name = (err as { name?: string }).name;
    if (name === "NotFound" || name === "NoSuchKey") return null;
    throw err;
  }
}
