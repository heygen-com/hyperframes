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
import type { HyperframesCloudClient } from "./_gen/client.js";
import { HyperframesApiError } from "./_gen/client.js";
import {
  PutRefusedError,
  putStreamToPresignedUrl,
  putTimings,
  putWithRetry,
  sleep,
  type PutTry,
  type UploadFileSource,
} from "./uploadPut.js";

export { putTimings, type UploadFileSource };

export interface UploadZipViaDirectResult {
  asset_id: string;
  url: string;
  size_bytes: number;
  duration_ms: number;
}

export type UploadProgressEvent =
  | { phase: "initialize" }
  | {
      phase: "upload";
      percent: number;
      /** Bytes the connection has accepted so far in this try; the very last ones may still be in flight. */
      sentBytes?: number;
      totalBytes?: number;
      /** 1 for the first try; a higher number means the file restarted from its first byte. */
      attempt?: number;
    }
  | { phase: "complete" };

export interface UploadZipViaDirectOptions {
  client: HyperframesCloudClient;
  bytes: Uint8Array;
  filename: string;
  idempotencyKey?: string;
  fetchImpl?: typeof fetch;
  onProgress?: (event: UploadProgressEvent) => void;
  signal?: AbortSignal;
}

const CONTENT_TYPE_ZIP = "application/zip";

/** Reports the bytes a try has sent at most every progressMs, or when it gains 5 points. */
function progressReporter(
  total: number,
  emit: ((event: UploadProgressEvent) => void) | undefined,
): (tried: PutTry) => void {
  let lastAt = Date.now();
  let lastPercent = 0;
  return (tried) => {
    const percent = total > 0 ? Math.min(99, Math.floor((100 * tried.sent) / total)) : 0;
    const now = Date.now();
    if (now - lastAt < putTimings.progressMs && percent < lastPercent + 5) return;
    [lastAt, lastPercent] = [now, percent];
    emit?.({
      phase: "upload",
      percent,
      sentBytes: Math.min(tried.sent, total),
      totalBytes: total,
      attempt: tried.attempt,
    });
  };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
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
  fetchImpl: typeof fetch | undefined,
  uploadUrl: string,
  uploadHeaders: Record<string, unknown>,
  body: Uint8Array | UploadFileSource,
  contentType: string,
  signal?: AbortSignal,
  onProgress?: (event: UploadProgressEvent) => void,
): Promise<void> {
  const total = body instanceof Uint8Array ? body.byteLength : body.size;
  const report = progressReporter(total, onProgress);
  const headers: Record<string, string> = {
    "content-type": contentType,
    ...normalizeUploadHeaders(uploadHeaders),
  };
  return putWithRetry(
    (tried) => {
      if (tried.attempt > 1)
        onProgress?.({
          phase: "upload",
          percent: 0,
          sentBytes: 0,
          totalBytes: total,
          attempt: tried.attempt,
        });
      return fetchImpl && body instanceof Uint8Array
        ? putBytesOnce(fetchImpl, uploadUrl, headers, body, signal)
        : putStreamToPresignedUrl(uploadUrl, headers, body, signal, (written) => {
            tried.sent = written;
            report(tried);
          });
    },
    total,
    signal,
  );
}

async function putBytesOnce(
  fetchImpl: typeof fetch,
  uploadUrl: string,
  headers: Record<string, string>,
  body: Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
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
    throw new PutRefusedError(
      res.status,
      `Direct upload PUT failed: ${res.status} ${res.statusText}${
        detail ? ` — ${detail.slice(0, 300)}` : ""
      }`,
    );
  }
}

/** A 409 on complete means the cloud is still checking the file. The wait is baseMs plus perMiBMs per MiB, up to maxMs;
 * polls slow from firstPollMs to maxPollMs. */
const completeWait = {
  baseMs: 30_000,
  perMiBMs: 500,
  maxMs: 600_000,
  firstPollMs: 500,
  maxPollMs: 5_000,
};

export function completeBudgetMs(sizeBytes: number): number {
  const scaled = completeWait.baseMs + (sizeBytes / (1024 * 1024)) * completeWait.perMiBMs;
  return Math.min(completeWait.maxMs, scaled);
}

// Retry ONLY on the 409 "still checking / PUT not visible yet"; any other error surfaces immediately.
// `completeAssetUpload` itself is idempotent, so retrying an already-succeeded call is safe.
export async function completeWithRetry(
  client: HyperframesCloudClient,
  asset_id: string,
  checksum_sha256: string,
  sizeBytes: number,
  signal?: AbortSignal,
): Promise<{ asset_id: string; url: string }> {
  const budget = completeBudgetMs(sizeBytes);
  const startedAt = Date.now();
  let poll = completeWait.firstPollMs;
  for (;;) {
    try {
      return await client.completeAssetUpload({ asset_id, body: { checksum_sha256 } });
    } catch (err) {
      if (!(err instanceof HyperframesApiError && err.status === 409)) throw err;
      const left = startedAt + budget - Date.now();
      if (left <= 0) {
        throw new Error(
          `The file was uploaded, but the cloud had not finished checking it after ${Math.round(budget / 1000)} s. Try again in a few minutes.`,
          { cause: err },
        );
      }
      await sleep(Math.min(poll, left), signal);
      if (signal?.aborted)
        throw new Error("Stopped waiting for the cloud to finish checking the uploaded file.", {
          cause: signal.reason,
        });
      poll = Math.min(poll * 2, completeWait.maxPollMs);
    }
  }
}

// complete answers invalid_parameter for type, size, checksum and expiry; only type refusals blame the type.
const TYPE_REFUSAL = /^(Stored file type|content_type not allowed|Stored file does not have a ZIP)/;

function nameRefusedFile(err: unknown, filename: string, contentType: string): unknown {
  if (!(err instanceof HyperframesApiError) || err.code !== "invalid_parameter") return err;
  const kind = contentType.split("/")[0];
  const noun = kind === "audio" || kind === "video" || kind === "image" ? `${kind} file` : "file";
  const lead = TYPE_REFUSAL.test(err.message)
    ? `The cloud couldn't read this ${noun}'s type: ${filename}. It said:`
    : `The cloud refused ${filename}:`;
  return new HyperframesApiError({ ...err, message: `${lead} ${err.message}` });
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
  const fetchImpl = opts.fetchImpl;

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
    opts.onProgress,
  );
  opts.onProgress?.({ phase: "upload", percent: 100 });

  opts.onProgress?.({ phase: "complete" });
  const completed = await completeWithRetry(
    opts.client,
    initialize.asset_id,
    checksum_sha256,
    size_bytes,
    opts.signal,
  ).catch((err: unknown) => {
    throw nameRefusedFile(err, filename, opts.contentType);
  });
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
