/**
 * Direct-upload flow for `hyperframes cloud render` project asset uploads.
 *
 * The legacy `POST /v3/assets` path proxies bytes through the API and is
 * capped at 32 MB in-memory. This module implements the three-step
 * direct-to-S3 flow the CLI now uses instead, lifting the practical
 * per-project ceiling to 200 MB (the direct-upload cap enforced by the
 * signed presigned URL):
 *
 *   1. `client.createAssetUpload({filename, content_type, size_bytes,
 *      checksum_sha256})` → returns `{asset_id, upload_url,
 *      upload_headers, expires_in_seconds, max_bytes}`.
 *   2. Raw `PUT` to `upload_url` with the zip bytes + `upload_headers`
 *      verbatim. No CLI auth headers on this call — the presigned URL
 *      signature carries authorization.
 *   3. `client.completeAssetUpload({asset_id, body: {checksum_sha256}})`
 *      to finalize. Docs explicitly note a 409 "Uploaded object not
 *      found yet" is possible if the PUT hasn't been fully committed
 *      server-side; a small retry loop absorbs that.
 *
 * The returned `asset_id` is the same id namespace the legacy path
 * produced, so `createRender({project: {type: "asset_id", asset_id}})`
 * on the render side is a drop-in swap.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { type IncomingMessage, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { pipeline } from "node:stream/promises";
import type { HyperframesCloudClient } from "./_gen/client.js";
import { HyperframesApiError } from "./_gen/client.js";

export interface UploadZipViaDirectResult {
  asset_id: string;
  url: string;
  size_bytes: number;
  duration_ms: number;
}

export type UploadProgressEvent =
  | { phase: "initialize" }
  | { phase: "upload"; percent: number }
  | { phase: "complete" };

/** A file on disk, hashed and uploaded as a stream so it is never held in memory. */
export interface UploadFileSource {
  path: string;
  size: number;
}

export interface UploadZipViaDirectOptions {
  client: HyperframesCloudClient;
  bytes: Uint8Array;
  filename: string;
  idempotencyKey?: string;
  fetchImpl?: typeof fetch;
  onProgress?: (event: UploadProgressEvent) => void;
  signal?: AbortSignal;
}

// Per api-docs: completeAssetUpload can return 409 "Uploaded object not found
// yet" if the S3 PUT's write hasn't propagated to the read plane by the time
// complete runs. Small backoff loop absorbs it.
const COMPLETE_MAX_RETRIES = 5;
const COMPLETE_RETRY_BASE_MS = 500;
const CONTENT_TYPE_ZIP = "application/zip";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// upload_headers is generated as `Record<string, unknown>` from the
// OpenAPI spec, but the values are always strings at runtime (HTTP header
// values). Coerce defensively so a spec quirk can't slip a non-string in.
function normalizeUploadHeaders(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
    // Skip anything else — better to omit than send `[object Object]`.
  }
  return out;
}

// PUT bytes to the presigned URL. Do NOT attach CLI auth headers; the
// presigned URL signature carries authorization and the signature is
// bound to the *headers signed at presign time* — extra headers invalidate
// the signature (S3 returns 403). Content-Type must match the declared
// content_type from step 1 (also signed).
async function putBytesToPresignedUrl(
  fetchImpl: typeof fetch,
  uploadUrl: string,
  uploadHeaders: Record<string, unknown>,
  body: Uint8Array | UploadFileSource,
  contentType: string,
  signal?: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = {
    "content-type": contentType,
    ...normalizeUploadHeaders(uploadHeaders),
  };
  if (!(body instanceof Uint8Array)) return putFileToPresignedUrl(uploadUrl, headers, body, signal);
  // `Uint8Array<ArrayBufferLike>` is a valid `BodyInit` at runtime but
  // not strictly assignable per lib.dom.d.ts — cast rather than copy,
  // since a 200MB buffer copy would be wasteful.
  const res = await fetchImpl(uploadUrl, {
    method: "PUT",
    signal,
    headers,
    body: body as unknown as BodyInit,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Direct upload PUT failed: ${res.status} ${res.statusText}${
        detail ? ` — ${detail.slice(0, 300)}` : ""
      }`,
    );
  }
}

// fetch holds a streamed request body in memory whole, so a file is piped through node:http(s).
async function putFileToPresignedUrl(
  uploadUrl: string,
  headers: Record<string, string>,
  file: UploadFileSource,
  signal?: AbortSignal,
): Promise<void> {
  const send = new URL(uploadUrl).protocol === "https:" ? httpsRequest : httpRequest;
  const req = send(uploadUrl, {
    method: "PUT",
    signal,
    headers: { ...headers, "content-length": String(file.size) },
  });
  const response = new Promise<IncomingMessage>((resolve, reject) => {
    req.once("response", resolve).once("error", reject);
  });
  const sent = pipeline(createReadStream(file.path), req);
  let res: IncomingMessage;
  try {
    res = await response;
  } catch (err) {
    await sent.catch(() => undefined);
    throw err;
  }
  const status = res.statusCode ?? 0;
  const ok = status >= 200 && status < 300;
  // A refused upload can close the connection mid-body; its status explains that write error.
  await sent.catch((err: unknown) => {
    if (ok) throw err;
  });
  let detail = "";
  for await (const chunk of res) detail += String(chunk);
  if (!ok) {
    throw new Error(
      `Direct upload PUT failed: ${status} ${res.statusMessage ?? ""}${
        detail ? ` — ${detail.slice(0, 300)}` : ""
      }`,
    );
  }
}

// Complete with retry-on-409. Retry ONLY on the documented "PUT not
// visible yet" race between S3 write consistency and finalize; any other
// error surfaces immediately. `completeAssetUpload` itself is idempotent,
// so retrying an already-succeeded call is safe.
async function completeWithRetry(
  client: HyperframesCloudClient,
  asset_id: string,
  checksum_sha256: string,
): Promise<{ asset_id: string; url: string }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < COMPLETE_MAX_RETRIES; attempt++) {
    try {
      return await client.completeAssetUpload({
        asset_id,
        body: { checksum_sha256 },
      });
    } catch (err) {
      const retryable = err instanceof HyperframesApiError && err.status === 409;
      if (!retryable || attempt === COMPLETE_MAX_RETRIES - 1) {
        throw err;
      }
      lastErr = err;
      await sleep(COMPLETE_RETRY_BASE_MS * (attempt + 1));
    }
  }
  throw lastErr ?? new Error("completeAssetUpload retries exhausted");
}

export async function uploadAssetViaDirectUpload(
  opts: Omit<UploadZipViaDirectOptions, "bytes"> & { contentType: string } & (
      | { bytes: Uint8Array }
      | UploadFileSource
    ),
): Promise<UploadZipViaDirectResult> {
  const start = Date.now();
  const { filename, idempotencyKey } = opts;
  const body = "bytes" in opts ? opts.bytes : { path: opts.path, size: opts.size };
  const size_bytes = body instanceof Uint8Array ? body.byteLength : body.size;
  const checksum_sha256 =
    body instanceof Uint8Array ? sha256Hex(body) : await sha256OfFile(body.path);
  const fetchImpl = opts.fetchImpl ?? fetch;

  opts.onProgress?.({ phase: "initialize" });
  const initialize = await opts.client.createAssetUpload({
    body: { filename, content_type: opts.contentType, size_bytes, checksum_sha256 },
    idempotencyKey,
  });

  opts.onProgress?.({ phase: "upload", percent: 0 });
  await putBytesToPresignedUrl(
    fetchImpl,
    initialize.upload_url,
    initialize.upload_headers,
    body,
    opts.contentType,
    opts.signal,
  );
  opts.onProgress?.({ phase: "upload", percent: 100 });

  opts.onProgress?.({ phase: "complete" });
  const completed = await completeWithRetry(opts.client, initialize.asset_id, checksum_sha256);
  return {
    asset_id: completed.asset_id,
    url: completed.url,
    size_bytes,
    duration_ms: Date.now() - start,
  };
}

export function uploadZipViaDirectUpload(
  opts: UploadZipViaDirectOptions,
): Promise<UploadZipViaDirectResult> {
  return uploadAssetViaDirectUpload({ ...opts, contentType: CONTENT_TYPE_ZIP });
}
