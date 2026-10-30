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
  type ReadStream,
  rmSync,
  statSync,
} from "node:fs";
import { createHash, type Hash } from "node:crypto";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  type CompletedPart,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  type CreateMultipartUploadCommandInput,
  GetObjectCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
  type S3Client,
  UploadPartCommand,
  UploadPartCopyCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import * as tar from "tar";
import {
  CONTENT_STORE_REFRESH_AFTER_DAYS,
  audioSidecarUri,
  probeFactsUri,
  contentStoreUri,
} from "./contentStore.js";

/** S3's largest PutObject or CopyObject; bigger objects go multipart. */
export const MAX_SINGLE_PUT_BYTES = 5 * 1024 ** 3;
const MAX_PARTS = 10_000;
const MIN_FILE_PART_BYTES = 64 * 1024 * 1024;
const FILE_PARTS_IN_FLIGHT = 8;
const UPLOAD_ATTEMPTS = 3;

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
 * Pre-sign a GET for a plan-v2 artifact, after S3 attests the object's stored
 * SHA-256 and size are the ones the manifest pins.
 */
export async function presignVerifiedS3GetUrl(
  client: S3Client,
  uri: string,
  expectedSha256: string,
  expectedSize: number,
  expiresInSeconds: number,
): Promise<string> {
  assertSha256(expectedSha256);
  const { bucket, key } = parseS3Uri(uri);
  const head = await client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: "ENABLED" }),
  );
  const expectedChecksum = Buffer.from(expectedSha256, "hex").toString("base64");
  const attested =
    head.ChecksumSHA256 === expectedChecksum || isDigestCheckedMultipart(head, expectedSha256);
  if (!attested || head.ContentLength !== expectedSize) {
    const error = new Error(
      `[s3Transport] PLAN_ARTIFACT_DIGEST_MISMATCH: ${uri} expected ${expectedSha256} (${expectedSize} bytes), S3 holds checksum ${String(head.ChecksumSHA256)} (${String(head.ContentLength)} bytes)`,
    );
    error.name = "PLAN_ARTIFACT_DIGEST_MISMATCH";
    throw error;
  }
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: expiresInSeconds,
  });
}

// S3 keeps only a checksum of part checksums for a multipart object; its uploader
// checked the whole-file digest it records before completing (uploadFileInParts).
function isDigestCheckedMultipart(head: HeadObjectCommandOutput, expectedSha256: string): boolean {
  return (
    head.ChecksumType === "COMPOSITE" &&
    (head.ContentLength ?? 0) > MAX_SINGLE_PUT_BYTES &&
    head.Metadata?.sha256 === expectedSha256
  );
}

/** Upload a local file to an S3 URI, streamed: one PutObject up to S3's 5 GB cap, multipart above. */
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
  if (size > MAX_SINGLE_PUT_BYTES) {
    await uploadFileInParts(client, localPath, size, {
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });
    return;
  }
  await sendFileBody(localPath, undefined, (body) =>
    client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: size,
      }),
    ),
  );
}

/**
 * Upload one content-addressed plan-v2 artifact exactly once; S3 verifies the bytes against
 * `ChecksumSHA256`. An existing object is reused only when its digest metadata and length agree,
 * and a conflicting one is never overwritten, since a chunk may already be reading that plan.
 */
export async function uploadContentAddressedFileToS3(
  client: S3Client,
  localPath: string,
  uri: string,
  expectedSha256: string,
  contentType?: string,
): Promise<"uploaded" | "reused"> {
  return (await putImmutableFile(client, localPath, uri, expectedSha256, contentType)).outcome;
}

async function putImmutableFile(
  client: S3Client,
  localPath: string,
  uri: string,
  expectedSha256: string,
  contentType?: string,
): Promise<{ outcome: "uploaded" | "reused"; lastModified?: Date; size?: number }> {
  assertSha256(expectedSha256);
  if (!existsSync(localPath)) {
    throw new Error(`[s3Transport] upload source missing: ${localPath}`);
  }
  const { bucket, key } = parseS3Uri(uri);
  const size = statSync(localPath).size;
  const existing = await inspectContentAddressedObject(client, bucket, key, size, expectedSha256);
  if (existing.state === "matching")
    return { outcome: "reused", lastModified: existing.lastModified, size };
  if (existing.state === "conflict") throwImmutableObjectConflict(uri);

  // HEAD followed by an unconditional PUT can overwrite a conflicting object published by a
  // concurrent planner. Conditional create (IfNoneMatch) makes immutable CAS and fixed-key
  // manifest publication race-safe.
  try {
    if (size > MAX_SINGLE_PUT_BYTES) {
      const create = { Bucket: bucket, Key: key, ContentType: contentType };
      await uploadFileInParts(client, localPath, size, create, expectedSha256);
    } else {
      await putImmutableBody(client, localPath, bucket, key, size, expectedSha256, contentType);
    }
    return { outcome: "uploaded" };
  } catch (error) {
    if (!isS3PreconditionFailed(error)) throw error;
    const raced = await inspectContentAddressedObject(client, bucket, key, size, expectedSha256);
    if (raced.state === "matching") return { outcome: "reused" };
    if (raced.state === "conflict") throwImmutableObjectConflict(uri);
    // No winner left to verify: rethrow the service error so the orchestrator may retry.
    throw error;
  }
}

async function putImmutableBody(
  client: S3Client,
  localPath: string,
  bucket: string,
  key: string,
  size: number,
  expectedSha256: string,
  contentType?: string,
): Promise<void> {
  await sendFileBody(localPath, undefined, (body) =>
    client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: size,
        Metadata: { sha256: expectedSha256 },
        ChecksumSHA256: Buffer.from(expectedSha256, "hex").toString("base64"),
        IfNoneMatch: "*",
      }),
    ),
  );
}

export type MultipartTarget = { Bucket: string; Key: string; UploadId: string };

/**
 * Creates a multipart upload, lets `sendParts` fill it, then completes it. A failure aborts the
 * upload so no parts linger; `sendParts` must settle every part before it rejects.
 */
export async function multipartUpload(
  client: S3Client,
  create: CreateMultipartUploadCommandInput & { Bucket: string; Key: string },
  sendParts: (target: MultipartTarget) => Promise<CompletedPart[]>,
  complete: { ifNoneMatch?: "*"; objectSize?: number } = {},
): Promise<void> {
  const created = await client.send(new CreateMultipartUploadCommand(create));
  const uri = formatS3Uri({ bucket: create.Bucket, key: create.Key });
  if (!created.UploadId) throw new Error(`[s3Transport] no multipart upload id for ${uri}`);
  const target = { Bucket: create.Bucket, Key: create.Key, UploadId: created.UploadId };
  try {
    const parts = await sendParts(target);
    await client.send(
      new CompleteMultipartUploadCommand({
        ...target,
        MultipartUpload: { Parts: parts },
        IfNoneMatch: complete.ifNoneMatch,
        MpuObjectSize: complete.objectSize,
      }),
    );
  } catch (error) {
    await client.send(new AbortMultipartUploadCommand(target)).catch((abortError: unknown) => {
      console.error(
        `[s3Transport] abort failed for ${uri}; parts remain until a lifecycle rule removes them`,
        abortError,
      );
    });
    throw error;
  }
}

// Hashes each part from disk in order, then streams it from disk, so memory stays flat; S3 checks
// each part's SHA-256. With
// `expectedSha256`, the object exists only if the whole file matches it and the key is free.
async function uploadFileInParts(
  client: S3Client,
  localPath: string,
  size: number,
  create: CreateMultipartUploadCommandInput & { Bucket: string; Key: string },
  expectedSha256?: string,
): Promise<void> {
  const partBytes = Math.max(MIN_FILE_PART_BYTES, Math.ceil(size / MAX_PARTS));
  const sendParts = async (target: MultipartTarget): Promise<CompletedPart[]> => {
    const whole = createHash("sha256");
    const parts: Promise<CompletedPart>[] = [];
    const inFlight = new Set<Promise<void>>();
    let failure: { error: unknown } | undefined;
    try {
      for (let start = 0; start < size && !failure; start += partBytes) {
        if (inFlight.size >= FILE_PARTS_IN_FLIGHT) await Promise.race(inFlight);
        const range = { start, end: Math.min(start + partBytes, size) };
        const checksum = await hashRange(localPath, range, whole);
        const sent = sendFilePart(client, target, parts.length + 1, localPath, range, checksum);
        parts.push(sent);
        const slot: Promise<void> = sent.then(
          () => void inFlight.delete(slot),
          (error: unknown) => {
            failure ??= { error };
            inFlight.delete(slot);
          },
        );
        inFlight.add(slot);
      }
    } finally {
      await Promise.all(inFlight);
    }
    if (failure) throw failure.error;
    const actual = whole.digest("hex");
    if (expectedSha256 && actual !== expectedSha256) {
      const error = new Error(
        `[s3Transport] PLAN_ARTIFACT_DIGEST_MISMATCH: ${localPath} changed: expected ${expectedSha256}, read ${actual}`,
      );
      error.name = "PLAN_ARTIFACT_DIGEST_MISMATCH";
      throw error;
    }
    return Promise.all(parts);
  };
  await multipartUpload(
    client,
    {
      ...create,
      Metadata: expectedSha256 ? { sha256: expectedSha256 } : undefined,
      ChecksumAlgorithm: "SHA256",
    },
    sendParts,
    { ifNoneMatch: expectedSha256 ? "*" : undefined, objectSize: size },
  );
}

type ByteRange = { start: number; end: number };

/** SHA-256 (base64) of `[start, end)` of the file, also fed to `whole`. */
async function hashRange(path: string, { start, end }: ByteRange, whole: Hash): Promise<string> {
  const part = createHash("sha256");
  let read = 0;
  for await (const chunk of createReadStream(path, { start, end: end - 1 })) {
    whole.update(chunk as Buffer);
    part.update(chunk as Buffer);
    read += (chunk as Buffer).length;
  }
  if (read !== end - start) throw new Error(`[s3Transport] ${path} shrank while uploading`);
  return part.digest("base64");
}

async function sendFilePart(
  client: S3Client,
  target: MultipartTarget,
  partNumber: number,
  path: string,
  { start, end }: ByteRange,
  checksum: string,
): Promise<CompletedPart> {
  const result = await sendFileBody(path, { start, end }, (body) =>
    client.send(
      new UploadPartCommand({
        ...target,
        PartNumber: partNumber,
        Body: body,
        ContentLength: end - start,
        ChecksumSHA256: checksum,
      }),
    ),
  );
  if (!result.ETag) throw new Error(`[s3Transport] part ${partNumber} returned no ETag`);
  return { ETag: result.ETag, PartNumber: partNumber, ChecksumSHA256: checksum };
}

// The SDK never retries a streamed body, so each attempt opens a fresh stream. Only a transient
// failure is retried: any other S3 answer (412, BadDigest) would repeat.
async function sendFileBody<T>(
  path: string,
  range: ByteRange | undefined,
  send: (body: ReadStream) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const body = createReadStream(path, range && { start: range.start, end: range.end - 1 });
    try {
      return await send(body);
    } catch (error) {
      if (attempt >= UPLOAD_ATTEMPTS || !isTransientS3Error(error)) throw error;
    } finally {
      body.destroy();
    }
  }
}

export async function mapConcurrent<T>(
  values: readonly T[],
  concurrency: number,
  fn: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++;
      await fn(values[index]!);
    }
  }
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  // Do not reject while sibling workers may still be writing into invocation
  // scratch. The caller removes that directory in `finally`; draining the pool
  // first prevents late S3 streams from racing cleanup after another GET fails.
  if (failure) throw failure.reason;
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

type ContentAddressedObjectState =
  | { state: "missing" | "conflict" }
  | { state: "matching"; lastModified?: Date };

async function inspectContentAddressedObject(
  client: S3Client,
  bucket: string,
  key: string,
  expectedSize: number,
  expectedSha256: string,
): Promise<ContentAddressedObjectState> {
  try {
    const existing = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: "ENABLED" }),
    );
    return existing.ContentLength === expectedSize && existing.Metadata?.sha256 === expectedSha256
      ? { state: "matching", lastModified: existing.LastModified }
      : { state: "conflict" };
  } catch (error) {
    if (isS3NotFound(error)) return { state: "missing" };
    throw error;
  }
}

/** Put a file into the shared content store once; reusing an aging object restarts its expiry. */
export async function putContentStoreFile(
  client: S3Client,
  localPath: string,
  bucket: string,
  sha256: string,
): Promise<"uploaded" | "reused"> {
  const uri = contentStoreUri(bucket, sha256);
  const { outcome, lastModified, size } = await putImmutableFile(client, localPath, uri, sha256);
  if (lastModified) await refreshAgingObject(client, uri, sha256, lastModified, size ?? 0);
  return outcome;
}

export async function putAudioSidecar(
  client: S3Client,
  localPath: string,
  bucket: string,
  sha256: string,
): Promise<"uploaded" | "reused"> {
  const uri = audioSidecarUri(bucket, sha256);
  if (await s3ObjectExists(client, uri)) return "reused";
  const { key } = parseS3Uri(uri);
  const size = statSync(localPath).size;
  const own = await sha256File(localPath);
  try {
    if (size > MAX_SINGLE_PUT_BYTES) {
      await uploadFileInParts(client, localPath, size, { Bucket: bucket, Key: key }, own);
    } else {
      await putImmutableBody(client, localPath, bucket, key, size, own, "audio/mp4");
    }
  } catch (error) {
    if (!isS3PreconditionFailed(error)) throw error;
    return "reused";
  }
  return "uploaded";
}

/** Confirm an object the caller never uploaded is in the content store, restarting an aging one. */
export async function ensureContentStoreObject(
  client: S3Client,
  bucket: string,
  sha256: string,
  sizeBytes: number,
): Promise<void> {
  const uri = contentStoreUri(bucket, sha256);
  const { key } = parseS3Uri(uri);
  const existing = await inspectContentAddressedObject(client, bucket, key, sizeBytes, sha256);
  if (existing.state === "matching") {
    if (existing.lastModified) {
      await refreshAgingObject(client, uri, sha256, existing.lastModified, sizeBytes);
    }
    return;
  }
  if (existing.state === "conflict") throwImmutableObjectConflict(uri);
  const error = new Error(
    `[s3Transport] PLAN_ARTIFACT_MISSING: ${uri} is not in the content store`,
  );
  error.name = "PLAN_ARTIFACT_MISSING";
  throw error;
}

export async function presignS3GetUrl(
  client: S3Client,
  uri: string,
  expiresInSeconds: number,
): Promise<string> {
  const { bucket, key } = parseS3Uri(uri);
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: expiresInSeconds,
  });
}

// S3 lifecycle expiry counts from the last write, not the last read, so reuse has to write.
async function refreshAgingObject(
  client: S3Client,
  uri: string,
  sha256: string,
  lastModified: Date,
  size: number,
): Promise<void> {
  const { bucket, key } = parseS3Uri(uri);
  const ageMs = Date.now() - lastModified.getTime();
  if (ageMs < CONTENT_STORE_REFRESH_AFTER_DAYS * 86_400_000) return;
  if (size > MAX_SINGLE_PUT_BYTES) {
    const create = {
      Bucket: bucket,
      Key: key,
      Metadata: { sha256 },
      ChecksumAlgorithm: "SHA256" as const,
    };
    await multipartUpload(client, create, async (target) => {
      // ponytail: serial copies (a 6 GB object is two parts); parallel if refresh time matters.
      const parts: CompletedPart[] = [];
      for (let start = 0; start < size; start += MAX_SINGLE_PUT_BYTES) {
        const end = Math.min(start + MAX_SINGLE_PUT_BYTES, size);
        const PartNumber = parts.length + 1;
        const { CopyPartResult } = await client.send(
          new UploadPartCopyCommand({
            ...target,
            PartNumber,
            CopySource: `${bucket}/${key}`,
            CopySourceRange: `bytes=${start}-${end - 1}`,
          }),
        );
        if (!CopyPartResult?.ETag)
          throw new Error(`[s3Transport] copy part ${PartNumber} of ${uri} returned no ETag`);
        parts.push({
          ETag: CopyPartResult.ETag,
          PartNumber,
          ChecksumSHA256: CopyPartResult.ChecksumSHA256,
        });
      }
      return parts;
    });
    return;
  }
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: key,
      CopySource: `${bucket}/${key}`,
      MetadataDirective: "REPLACE",
      Metadata: { sha256 },
      ChecksumAlgorithm: "SHA256",
    }),
  );
}

function throwImmutableObjectConflict(uri: string): never {
  const error = new Error(
    `[s3Transport] PLAN_ARTIFACT_DIGEST_MISMATCH: immutable object ${uri} already exists with different digest metadata or size`,
  );
  error.name = "PLAN_ARTIFACT_DIGEST_MISMATCH";
  throw error;
}

export async function s3ObjectExists(client: S3Client, uri: string): Promise<boolean> {
  const { bucket, key } = parseS3Uri(uri);
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (isS3NotFound(error)) return false;
    throw error;
  }
}

export function isS3NotFound(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const metadata = isRecord(error.$metadata) ? error.$metadata : undefined;
  return (
    error.name === "NotFound" || error.name === "NoSuchKey" || metadata?.httpStatusCode === 404
  );
}

function isS3PreconditionFailed(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const metadata = isRecord(error.$metadata) ? error.$metadata : undefined;
  return error.name === "PreconditionFailed" || metadata?.httpStatusCode === 412;
}

// The AWS SDK's own transient codes; S3 sends RequestTimeout as HTTP 400.
const TRANSIENT_S3_ERRORS = new Set(["TimeoutError", "RequestTimeout", "RequestTimeoutException"]);

/** A dropped connection (no HTTP status), a timeout, throttling (429) or a 5xx. */
function isTransientS3Error(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (typeof error.name === "string" && TRANSIENT_S3_ERRORS.has(error.name)) return true;
  const status = isRecord(error.$metadata) ? error.$metadata.httpStatusCode : undefined;
  return typeof status !== "number" || status === 429 || status >= 500;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Pack a directory into a `.tar.gz` at `destTarball`. Uses the `tar` npm
 * package (pure JS over `node:zlib`) rather than spawning a system tar
 * binary — the AWS Lambda Node 22 base image ships a minimal set of
 * userland tools and does NOT include `tar` in `/usr/bin`.
 */
export async function tarDirectory(
  sourceDir: string,
  destTarball: string,
  files?: string[],
): Promise<void> {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new Error(`[s3Transport] tar source must be an existing directory: ${sourceDir}`);
  }
  mkdirSync(dirname(destTarball), { recursive: true });
  // `files` (relative to `sourceDir`) packs exactly those paths, with symlinks followed.
  await tar.create(
    { gzip: true, file: destTarball, cwd: sourceDir, follow: files !== undefined },
    files ?? ["."],
  );
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

export async function putProbeFacts(
  client: S3Client,
  localPath: string,
  bucket: string,
  sha256: string,
): Promise<"uploaded" | "reused"> {
  const uri = probeFactsUri(bucket, sha256);
  if (await s3ObjectExists(client, uri)) return "reused";
  const { key } = parseS3Uri(uri);
  const size = statSync(localPath).size;
  try {
    await putImmutableBody(
      client,
      localPath,
      bucket,
      key,
      size,
      await sha256File(localPath),
      "application/json",
    );
  } catch (error) {
    if (!isS3PreconditionFailed(error)) throw error;
    return "reused";
  }
  return "uploaded";
}
