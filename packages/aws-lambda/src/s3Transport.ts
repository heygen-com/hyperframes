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
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
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
