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
import type {
  CompleteAssetUploadRequest,
  CreateAssetUploadResponse,
  MultipartUploadPlan,
} from "./_gen/types.js";
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
import {
  forgetSaved,
  PARTS_ABOVE_BYTES,
  resumable,
  saveUpload,
  savedUploadFile,
  uploadParts,
} from "./uploadParts.js";

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
    async (tried) => {
      if (tried.attempt > 1)
        onProgress?.({
          phase: "upload",
          percent: 0,
          sentBytes: 0,
          totalBytes: total,
          attempt: tried.attempt,
        });
      await (fetchImpl && body instanceof Uint8Array
        ? putBytesOnce(fetchImpl, uploadUrl, headers, body, signal)
        : putStreamToPresignedUrl(uploadUrl, headers, body, signal, (written) => {
            tried.sent = written;
            report(tried);
          }));
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
  inParts: CompleteParts = {},
): Promise<{ asset_id: string; url: string }> {
  const budget = completeBudgetMs(sizeBytes);
  const startedAt = Date.now();
  let poll = completeWait.firstPollMs;
  for (;;) {
    try {
      return await client.completeAssetUpload({ asset_id, body: { checksum_sha256, ...inParts } });
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

const STATUSES_NOT_ABOUT_THE_FILE = new Set([401, 403, 408, 409, 429]);

function refusesTheFile(err: unknown): boolean {
  return (
    err instanceof HyperframesApiError &&
    err.status >= 400 &&
    err.status < 500 &&
    !STATUSES_NOT_ABOUT_THE_FILE.has(err.status)
  );
}

function nameRefusedFile(err: unknown, filename: string, contentType: string): unknown {
  if (!(err instanceof HyperframesApiError) || err.code !== "invalid_parameter") return err;
  const kind = contentType.split("/")[0];
  const noun = kind === "audio" || kind === "video" || kind === "image" ? `${kind} file` : "file";
  const lead = TYPE_REFUSAL.test(err.message)
    ? `The cloud couldn't read this ${noun}'s type: ${filename}. It said:`
    : `The cloud refused ${filename}:`;
  return new HyperframesApiError({ ...err, message: `${lead} ${err.message}` });
}

type CompleteParts = Pick<CompleteAssetUploadRequest, "multipart_upload_id" | "parts">;

/** Asks for parts on a big file; a server that does not know them answers with the single PUT. */
async function createUpload(
  client: HyperframesCloudClient,
  o: {
    filename: string;
    contentType: string;
    size_bytes: number;
    checksum_sha256: string;
    inParts: boolean;
    idempotencyKey?: string;
  },
): Promise<CreateAssetUploadResponse> {
  const body = {
    filename: o.filename,
    content_type: o.contentType,
    size_bytes: o.size_bytes,
    checksum_sha256: o.checksum_sha256,
  };
  try {
    return await client.createAssetUpload({
      body: o.inParts ? { ...body, multipart: true } : body,
      idempotencyKey: o.idempotencyKey,
    });
  } catch (err) {
    const unknownField =
      err instanceof HyperframesApiError && (err.status === 400 || err.status === 422);
    if (!o.inParts || !unknownField) throw err;
    return await client.createAssetUpload({ body, idempotencyKey: o.idempotencyKey });
  }
}

type DirectUploadOptions = Omit<UploadZipViaDirectOptions, "bytes"> & { contentType: string };

/** Sends the file (in parts above PARTS_ABOVE_BYTES, resuming a saved upload) and says what `complete` must be told. */
async function sendInParts(
  opts: DirectUploadOptions,
  body: Uint8Array | UploadFileSource,
  size_bytes: number,
  asset_id: string,
  plan: MultipartUploadPlan,
  saved: string | undefined,
): Promise<{ asset_id: string; inParts: CompleteParts; forget?: () => void }> {
  if (saved) saveUpload(saved, { asset_id, plan });
  const parts = await uploadParts({
    client: opts.client,
    asset_id,
    plan,
    body,
    total: size_bytes,
    onProgress: opts.onProgress,
    signal: opts.signal,
  });
  return {
    asset_id,
    inParts: { multipart_upload_id: plan.multipart_upload_id, parts },
    forget: saved ? () => forgetSaved(saved) : undefined,
  };
}

async function sendFile(
  opts: DirectUploadOptions,
  body: Uint8Array | UploadFileSource,
  size_bytes: number,
  checksum_sha256: string,
): Promise<{ asset_id: string; inParts: CompleteParts; forget?: () => void }> {
  const wantParts = size_bytes > PARTS_ABOVE_BYTES;
  const saved = wantParts ? savedUploadFile(checksum_sha256, size_bytes) : undefined;
  const resumed = saved ? await resumable(opts.client, saved) : undefined;
  if (resumed) {
    opts.onProgress?.({ phase: "upload", percent: 0 });
    return sendInParts(opts, body, size_bytes, resumed.asset_id, resumed.plan, saved);
  }
  const created = await createUpload(opts.client, {
    filename: opts.filename,
    contentType: opts.contentType,
    size_bytes,
    checksum_sha256,
    inParts: wantParts,
    idempotencyKey: opts.idempotencyKey,
  });

  opts.onProgress?.({ phase: "upload", percent: 0 });
  if (created.multipart) {
    return sendInParts(opts, body, size_bytes, created.asset_id, created.multipart, saved);
  }
  await putBytesToPresignedUrl(
    opts.fetchImpl,
    created.upload_url,
    created.upload_headers,
    body,
    opts.contentType,
    opts.signal,
    opts.onProgress,
  );
  return { asset_id: created.asset_id, inParts: {} };
}

export async function uploadAssetViaDirectUpload(
  opts: DirectUploadOptions & ({ bytes: Uint8Array } | UploadFileSource),
): Promise<UploadZipViaDirectResult> {
  const start = Date.now();
  const body = "bytes" in opts ? opts.bytes : { path: opts.path, size: opts.size };
  const size_bytes = body instanceof Uint8Array ? body.byteLength : body.size;
  const checksum_sha256 =
    body instanceof Uint8Array ? sha256Hex(body) : await sha256OfFile(body.path);

  opts.onProgress?.({ phase: "initialize" });
  const sent = await sendFile(opts, body, size_bytes, checksum_sha256);
  opts.onProgress?.({ phase: "upload", percent: 100 });

  opts.onProgress?.({ phase: "complete" });
  const completed = await completeWithRetry(
    opts.client,
    sent.asset_id,
    checksum_sha256,
    size_bytes,
    opts.signal,
    sent.inParts,
  ).catch((err: unknown) => {
    if (refusesTheFile(err)) sent.forget?.();
    throw nameRefusedFile(err, opts.filename, opts.contentType);
  });
  sent.forget?.();
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
