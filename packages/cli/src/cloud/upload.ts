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
import { type ClientRequest, type IncomingMessage, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
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

/** A failed or stalled PUT is sent again to the same presigned URL (it stays valid and a PUT replaces the object). */
export const putTimings = { stallMs: 60_000, retries: 3, backoffMs: 1000, progressMs: 10_000 };

/** What one try of the PUT got through, read by the retry loop and the progress lines. */
interface PutTry {
  attempt: number;
  startedAt: number;
  sent: number;
}

const CUT_CODES = new Set(["ECONNRESET", "EPIPE", "ECONNABORTED"]);

function isConnectionCut(err: unknown): boolean {
  const code = (err as { code?: unknown }).code;
  return (typeof code === "string" && CUT_CODES.has(code)) || /socket hang up/.test(String(err));
}

/** The same cut twice: a connection that dies at the same age with the same bytes sent dies the same way again. */
function isSameCut(before: PutTry & { ageMs: number }, now: PutTry & { ageMs: number }): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.2 * Math.max(a, b);
  return before.sent > 0 && near(before.ageMs, now.ageMs) && near(before.sent, now.sent);
}

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)} s`;
}

function exhausted(err: unknown, tries: number, last: PutTry & { ageMs: number }, total: number) {
  const base = err instanceof Error ? err.message : String(err);
  const percent = total > 0 ? Math.floor((100 * last.sent) / total) : 0;
  return Object.assign(
    new Error(
      `${base} (${tries} tries, each from the first byte; the last got ${percent}% of the file through in ${seconds(last.ageMs)})`,
      { cause: err },
    ),
    { code: (err as { code?: unknown }).code },
  );
}

/** S3's answer to a PUT it refused; a refusal below 500 is final (an expired signature stays expired). */
class PutRefusedError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** An error no second try can change: a refusal below 500, or a file that is missing or unreadable. */
function isFinal(err: unknown): boolean {
  const code = (err as { code?: unknown }).code;
  return (
    (err instanceof PutRefusedError && err.status < 500) || code === "ENOENT" || code === "EACCES"
  );
}

async function putWithRetry(
  attempt: (tried: PutTry) => Promise<void>,
  total: number,
  signal?: AbortSignal,
): Promise<void> {
  let before: (PutTry & { ageMs: number }) | undefined;
  let cutBefore = false;
  for (let tried = 0; ; tried++) {
    const current: PutTry = { attempt: tried + 1, startedAt: Date.now(), sent: 0 };
    try {
      return await attempt(current);
    } catch (err) {
      if (isFinal(err) || signal?.aborted) throw err;
      const now = { ...current, ageMs: Date.now() - current.startedAt };
      const cut = isConnectionCut(err);
      if (cut && cutBefore && before && isSameCut(before, now)) {
        throw Object.assign(
          new Error(
            `The connection was cut at ${seconds(now.ageMs)} on two tries in a row, after ${Math.floor((100 * now.sent) / total)}% of the file was sent (${(err as { code?: string }).code ?? "connection reset"}). Every try restarts the file, so this link cannot finish it before the cut: use a faster connection or send less media.`,
            { cause: err },
          ),
          { code: (err as { code?: unknown }).code },
        );
      }
      if (tried >= putTimings.retries) throw exhausted(err, tried + 1, now, total);
      [before, cutBefore] = [now, cut];
      await sleep(putTimings.backoffMs * 2 ** tried, signal);
    }
  }
}

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

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
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

// fetch holds a streamed request body in memory whole, so a file is piped through node:http(s). A buffer goes the
// same way, in slices, so a stalled link ends its try the same way (a plain fetch has no progress to watch).
const SLICE_BYTES = 64 * 1024;

function bodyStream(body: Uint8Array | UploadFileSource): Readable {
  if (!(body instanceof Uint8Array)) return createReadStream(body.path);
  return Readable.from(
    (function* () {
      for (let at = 0; at < body.byteLength; at += SLICE_BYTES)
        yield body.subarray(at, at + SLICE_BYTES);
    })(),
  );
}

/** Ends `req` when no byte has been accepted by its socket for stallMs (its buffer is full and the link drains
 * nothing). Returns the function that stops the watch. */
function watchStall(req: ClientRequest, onSample: (written: number) => void): () => void {
  let written = -1;
  let movedAt = Date.now();
  const watch = setInterval(
    () => {
      const now = req.socket?.bytesWritten ?? 0;
      onSample(now);
      if (now !== written) [written, movedAt] = [now, Date.now()];
      else if (Date.now() - movedAt >= putTimings.stallMs)
        req.destroy(new Error(`Upload stalled: no data sent for ${putTimings.stallMs / 1000} s`));
    },
    Math.min(1000, putTimings.stallMs / 3),
  );
  return () => clearInterval(watch);
}

async function putStreamToPresignedUrl(
  uploadUrl: string,
  headers: Record<string, string>,
  body: Uint8Array | UploadFileSource,
  signal: AbortSignal | undefined,
  onSample: (written: number) => void,
): Promise<void> {
  const size = body instanceof Uint8Array ? body.byteLength : body.size;
  const send = new URL(uploadUrl).protocol === "https:" ? httpsRequest : httpRequest;
  const req = send(uploadUrl, {
    method: "PUT",
    signal,
    headers: { ...headers, "content-length": String(size) },
  });
  const response = new Promise<IncomingMessage>((resolve, reject) => {
    req.once("response", resolve).once("error", reject);
  });
  const stopWatching = watchStall(req, onSample);
  const source = bodyStream(body);
  const sent = pipeline(source, req);
  let res: IncomingMessage;
  try {
    res = await response;
  } catch (err) {
    await sent.catch(() => undefined);
    throw err;
  } finally {
    stopWatching();
  }
  await settle(res, sent);
}

/** Reads S3's answer: a refusal is thrown with its words; a refused upload can close the connection mid-body, so the
 * write error is the status's to explain. */
async function settle(res: IncomingMessage, sent: Promise<void>): Promise<void> {
  const status = res.statusCode ?? 0;
  const ok = status >= 200 && status < 300;
  await sent.catch((err: unknown) => {
    if (ok) throw err;
  });
  let detail = "";
  for await (const chunk of res) detail += String(chunk);
  if (!ok) {
    throw new PutRefusedError(
      status,
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
