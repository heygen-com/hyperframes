/**
 * Thin GCS transport for the Cloud Run handler.
 *
 * The OSS distributed primitives are pure functions over local file paths;
 * the handler bridges GCS ↔ the container's writable `/tmp` filesystem on
 * each request. Functions here are intentionally narrow: parse a URI,
 * download an object to a local path, upload a path, tar-pack a planDir,
 * tar-extract a planDir back out.
 *
 * Tar (not zip) for planDir transit:
 *   - planDirs contain symlinks (the extract stage materializes them but
 *     the compiled/ subtree may include linked assets); tar preserves them,
 *     zip does not.
 *   - We use the `tar` npm package (pure JS over `node:zlib`) so the
 *     archive format doesn't depend on a system `tar`/`unzip` being present
 *     in the container image.
 *
 * Apart from the `gs://` scheme and the `@google-cloud/storage` client this
 * is the same shape as `@hyperframes/aws-lambda`'s `s3Transport.ts`.
 */

import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Storage } from "@google-cloud/storage";
import * as tar from "tar";

/** Parsed `gs://bucket/key` URI. */
export interface GcsLocation {
  bucket: string;
  key: string;
}

/** Parse `gs://bucket/key/path` → `{ bucket, key }`. Throws on malformed input. */
// fallow-ignore-next-line complexity
export function parseGcsUri(uri: string): GcsLocation {
  if (!uri.startsWith("gs://")) {
    throw new Error(`[gcsTransport] expected gs:// URI, got: ${JSON.stringify(uri)}`);
  }
  const rest = uri.slice("gs://".length);
  const slash = rest.indexOf("/");
  if (slash === -1) {
    throw new Error(`[gcsTransport] missing key in gs URI: ${JSON.stringify(uri)}`);
  }
  const bucket = rest.slice(0, slash);
  const key = rest.slice(slash + 1);
  if (!bucket || !key) {
    throw new Error(`[gcsTransport] empty bucket or key in gs URI: ${JSON.stringify(uri)}`);
  }
  return { bucket, key };
}

/** Build `gs://bucket/key` from a location. */
export function formatGcsUri(loc: GcsLocation): string {
  return `gs://${loc.bucket}/${loc.key}`;
}

/** Stream a GCS object to a local file path. */
export async function downloadGcsObjectToFile(
  storage: Storage,
  uri: string,
  destPath: string,
): Promise<void> {
  const { bucket, key } = parseGcsUri(uri);
  mkdirSync(dirname(destPath), { recursive: true });
  const file = storage.bucket(bucket).file(key);
  // `createReadStream` streams the object body; piping into a write stream
  // keeps memory flat for large plan tarballs / chunk files rather than
  // buffering the whole object the way `file.download()` would.
  await pipeline(file.createReadStream(), createWriteStream(destPath));
}

/** Download and verify an immutable plan-v2 artifact before materialization. */
export async function downloadGcsObjectToFileVerified(
  storage: Storage,
  uri: string,
  destPath: string,
  expectedSha256: string,
): Promise<void> {
  assertSha256(expectedSha256);
  await downloadGcsObjectToFile(storage, uri, destPath);
  const actual = await sha256File(destPath);
  if (actual !== expectedSha256) {
    rmSync(destPath, { force: true });
    const error = new Error(
      `[gcsTransport] PLAN_ARTIFACT_DIGEST_MISMATCH: ${uri} expected ${expectedSha256}, got ${actual}`,
    );
    error.name = "PLAN_ARTIFACT_DIGEST_MISMATCH";
    throw error;
  }
}

/**
 * Upload a local file's contents to a GCS URI using a resumable upload.
 * GCS objects have no practical size ceiling for the artifacts this adapter
 * handles (plan tarballs ≤ 2 GB, chunks ≤ a few hundred MB), so a single
 * upload call works for every case.
 */
export async function uploadFileToGcs(
  storage: Storage,
  localPath: string,
  uri: string,
  contentType?: string,
): Promise<void> {
  if (!existsSync(localPath)) {
    throw new Error(`[gcsTransport] upload source missing: ${localPath}`);
  }
  const { bucket, key } = parseGcsUri(uri);
  await storage.bucket(bucket).upload(localPath, {
    destination: key,
    // `resumable: false` (simple upload) is faster for the small-to-medium
    // objects this adapter moves and avoids the extra round-trip a resumable
    // session start costs; GCS recommends resumable only past ~8 MB but our
    // chunks are reliably above that, so let the client pick by default.
    contentType,
  });
}

/**
 * Upload one content-addressed plan-v2 artifact exactly once.
 *
 * The zero-generation precondition makes creation atomic. Existing objects
 * are reused only when their immutable digest metadata and byte length agree;
 * a conflict is never overwritten because another render may already consume
 * that object.
 */
export async function uploadContentAddressedFileToGcs(
  storage: Storage,
  localPath: string,
  uri: string,
  expectedSha256: string,
  contentType?: string,
): Promise<"uploaded" | "reused"> {
  assertSha256(expectedSha256);
  if (!existsSync(localPath)) {
    throw new Error(`[gcsTransport] upload source missing: ${localPath}`);
  }
  const actualSha256 = await sha256File(localPath);
  if (actualSha256 !== expectedSha256) {
    throwDigestMismatch(
      `local artifact ${localPath} expected ${expectedSha256}, got ${actualSha256}`,
    );
  }

  const { bucket, key } = parseGcsUri(uri);
  const bucketHandle = storage.bucket(bucket);
  const file = bucketHandle.file(key);
  const size = statSync(localPath).size;
  if (await isReusableContentAddressedObject(file, uri, size, expectedSha256)) {
    return "reused";
  }

  try {
    await bucketHandle.upload(localPath, {
      destination: key,
      contentType,
      metadata: { metadata: { sha256: expectedSha256 } },
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    return "uploaded";
  } catch (error) {
    // A concurrent planner may win the create-only race. Reuse only after
    // verifying that the winning object is exactly the immutable CAS value.
    if (
      isGcsPreconditionFailed(error) &&
      (await isReusableContentAddressedObject(file, uri, size, expectedSha256))
    ) {
      return "reused";
    }
    throw error;
  }
}

interface GcsFileLike {
  exists(): Promise<[boolean, ...unknown[]]>;
  getMetadata(): Promise<
    [
      {
        size?: string | number;
        metadata?: Record<string, string | number | boolean | null>;
      },
      ...unknown[],
    ]
  >;
}

async function isReusableContentAddressedObject(
  file: GcsFileLike,
  uri: string,
  expectedSize: number,
  expectedSha256: string,
): Promise<boolean> {
  const [exists] = await file.exists();
  if (!exists) return false;
  const [metadata] = await file.getMetadata();
  if (Number(metadata.size) === expectedSize && metadata.metadata?.sha256 === expectedSha256) {
    return true;
  }
  throwDigestMismatch(
    `immutable object ${uri} already exists with different digest metadata or size`,
  );
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function assertSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(
      `[gcsTransport] expected lowercase SHA-256 digest, got ${JSON.stringify(value)}`,
    );
  }
}

function throwDigestMismatch(detail: string): never {
  const error = new Error(`[gcsTransport] PLAN_ARTIFACT_DIGEST_MISMATCH: ${detail}`);
  error.name = "PLAN_ARTIFACT_DIGEST_MISMATCH";
  throw error;
}

function isGcsPreconditionFailed(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: unknown }).code === 412;
}

/**
 * Pack a directory into a `.tar.gz` at `destTarball`. Uses the `tar` npm
 * package (pure JS over `node:zlib`) rather than spawning a system tar
 * binary so the archive format is independent of the container's userland.
 */
export async function tarDirectory(sourceDir: string, destTarball: string): Promise<void> {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new Error(`[gcsTransport] tar source must be an existing directory: ${sourceDir}`);
  }
  mkdirSync(dirname(destTarball), { recursive: true });
  await tar.create({ gzip: true, file: destTarball, cwd: sourceDir }, ["."]);
}

/**
 * Extract a `.tar.gz` produced by {@link tarDirectory} into `destDir`.
 * The directory is created (or cleared) before extraction so a retried
 * request doesn't observe stale files from a prior run on the same warm
 * container instance.
 */
export async function untarDirectory(tarballPath: string, destDir: string): Promise<void> {
  if (!existsSync(tarballPath)) {
    throw new Error(`[gcsTransport] tarball missing: ${tarballPath}`);
  }
  // Wipe target so a warm container instance's prior planDir doesn't bleed
  // into the new request. Cloud Run re-uses the instance filesystem across
  // requests served by the same instance.
  if (existsSync(destDir)) {
    rmSync(destDir, { recursive: true, force: true });
  }
  mkdirSync(destDir, { recursive: true });
  await tar.extract({ file: tarballPath, cwd: destDir });
}
