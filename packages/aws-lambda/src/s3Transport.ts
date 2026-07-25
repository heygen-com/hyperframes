/**
 * Thin S3 transport for the Lambda handler.
 *
 * The OSS distributed primitives are pure functions over local file paths;
 * the Lambda handler bridges S3 ↔ Lambda's `/tmp` filesystem on each
 * invocation. Functions here are intentionally narrow: parse a URI, download
 * an object to a local path, upload a path/directory, tar-extract a planDir,
 * tar-pack a planDir back out.
 *
 * Tar (not zip) for planDir transit:
 *   - planDirs contain symlinks (extract stage materializes them but the
 *     compiled/ subtree may include linked assets); tar preserves them, zip
 *     does not.
 *   - We use the `tar` npm package (pure JS over `node:zlib`) — AWS
 *     Lambda's `nodejs:22` base image ships neither `tar` nor `unzip` in
 *     `/usr/bin`, so a system-binary tar would ENOENT in the actual
 *     deployment.
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
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import * as tar from "tar";

/** Parsed `s3://bucket/key` URI. */
export interface S3Location {
  bucket: string;
  key: string;
}

/** Parse `s3://bucket/key/path` → `{ bucket, key }`. Throws on malformed input. */
export function parseS3Uri(uri: string): S3Location {
  if (!uri.startsWith("s3://")) {
    throw new Error(`[s3Transport] expected s3:// URI, got: ${JSON.stringify(uri)}`);
  }
  const rest = uri.slice("s3://".length);
  const slash = rest.indexOf("/");
  if (slash === -1) {
    throw new Error(`[s3Transport] missing key in s3 URI: ${JSON.stringify(uri)}`);
  }
  const bucket = rest.slice(0, slash);
  const key = rest.slice(slash + 1);
  if (!bucket || !key) {
    throw new Error(`[s3Transport] empty bucket or key in s3 URI: ${JSON.stringify(uri)}`);
  }
  return { bucket, key };
}

/** Build `s3://bucket/key` from a location. */
export function formatS3Uri(loc: S3Location): string {
  return `s3://${loc.bucket}/${loc.key}`;
}

/** Stream an S3 object to a local file path. Throws if the body is missing. */
export async function downloadS3ObjectToFile(
  client: S3Client,
  uri: string,
  destPath: string,
): Promise<void> {
  const { bucket, key } = parseS3Uri(uri);
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = response.Body as NodeJS.ReadableStream | undefined;
  if (!body) {
    throw new Error(`[s3Transport] s3 GetObject returned empty body for ${uri}`);
  }
  mkdirSync(dirname(destPath), { recursive: true });
  await pipeline(body, createWriteStream(destPath));
}

/** Download and verify an immutable plan-v2 artifact before materialization. */
export async function downloadS3ObjectToFileVerified(
  client: S3Client,
  uri: string,
  destPath: string,
  expectedSha256: string,
): Promise<void> {
  assertSha256(expectedSha256);
  await downloadS3ObjectToFile(client, uri, destPath);
  const actual = await sha256File(destPath);
  if (actual !== expectedSha256) {
    rmSync(destPath, { force: true });
    const error = new Error(
      `[s3Transport] PLAN_ARTIFACT_DIGEST_MISMATCH: ${uri} expected ${expectedSha256}, got ${actual}`,
    );
    error.name = "PLAN_ARTIFACT_DIGEST_MISMATCH";
    throw error;
  }
}

/**
 * Upload a local file's contents to an S3 URI using a streaming
 * `PutObjectCommand`. PutObject's 5 GB cap comfortably exceeds the
 * distributed pipeline's 2 GB planDir limit and the typical
 * chunk size (≤ 200 MB), so a single PUT works for every artifact this
 * adapter handles.
 */
export async function uploadFileToS3(
  client: S3Client,
  localPath: string,
  uri: string,
  contentType?: string,
): Promise<void> {
  if (!existsSync(localPath)) {
    throw new Error(`[s3Transport] upload source missing: ${localPath}`);
  }
  const { bucket, key } = parseS3Uri(uri);
  const size = statSync(localPath).size;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(localPath),
      ContentType: contentType,
      ContentLength: size,
    }),
  );
}

/**
 * Upload one content-addressed plan-v2 artifact exactly once.
 *
 * Existing objects are reused only when their immutable digest metadata and
 * byte length agree. A conflicting object is never overwritten: doing so
 * could change a plan already being consumed by another chunk invocation.
 */
export async function uploadContentAddressedFileToS3(
  client: S3Client,
  localPath: string,
  uri: string,
  expectedSha256: string,
  contentType?: string,
): Promise<"uploaded" | "reused"> {
  assertSha256(expectedSha256);
  if (!existsSync(localPath)) {
    throw new Error(`[s3Transport] upload source missing: ${localPath}`);
  }
  const actualSha256 = await sha256File(localPath);
  if (actualSha256 !== expectedSha256) {
    const error = new Error(
      `[s3Transport] PLAN_ARTIFACT_DIGEST_MISMATCH: local artifact ${localPath} expected ${expectedSha256}, got ${actualSha256}`,
    );
    error.name = "PLAN_ARTIFACT_DIGEST_MISMATCH";
    throw error;
  }

  const { bucket, key } = parseS3Uri(uri);
  const size = statSync(localPath).size;
  try {
    const existing = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: "ENABLED" }),
    );
    if (existing.ContentLength === size && existing.Metadata?.sha256 === expectedSha256) {
      return "reused";
    }
    const error = new Error(
      `[s3Transport] PLAN_ARTIFACT_DIGEST_MISMATCH: immutable object ${uri} already exists with different digest metadata or size`,
    );
    error.name = "PLAN_ARTIFACT_DIGEST_MISMATCH";
    throw error;
  } catch (error) {
    if (!isS3NotFound(error)) throw error;
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(localPath),
      ContentType: contentType,
      ContentLength: size,
      Metadata: { sha256: expectedSha256 },
      ChecksumSHA256: Buffer.from(expectedSha256, "hex").toString("base64"),
    }),
  );
  return "uploaded";
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
      `[s3Transport] expected lowercase SHA-256 digest, got ${JSON.stringify(value)}`,
    );
  }
}

function isS3NotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === "NotFound" ||
    candidate.name === "NoSuchKey" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

/**
 * Pack a directory into a `.tar.gz` at `destTarball`. Uses the `tar` npm
 * package (pure JS over `node:zlib`) rather than spawning a system tar
 * binary — the AWS Lambda Node 22 base image ships a minimal set of
 * userland tools and does NOT include `tar` in `/usr/bin`.
 */
export async function tarDirectory(sourceDir: string, destTarball: string): Promise<void> {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new Error(`[s3Transport] tar source must be an existing directory: ${sourceDir}`);
  }
  mkdirSync(dirname(destTarball), { recursive: true });
  await tar.create({ gzip: true, file: destTarball, cwd: sourceDir }, ["."]);
}

/**
 * Extract a `.tar.gz` produced by {@link tarDirectory} into `destDir`.
 * The directory is created (or cleared) before extraction so a retried
 * invocation doesn't observe stale files from a prior run on the same
 * warm Lambda container.
 */
export async function untarDirectory(tarballPath: string, destDir: string): Promise<void> {
  if (!existsSync(tarballPath)) {
    throw new Error(`[s3Transport] tarball missing: ${tarballPath}`);
  }
  // Wipe target so the warm container's prior planDir doesn't bleed into
  // the new invocation. Lambda re-uses /tmp across invocations on the same
  // container.
  if (existsSync(destDir)) {
    rmSync(destDir, { recursive: true, force: true });
  }
  mkdirSync(destDir, { recursive: true });
  await tar.extract({ file: tarballPath, cwd: destDir });
}
