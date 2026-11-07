// @ts-check
// Bytes to signed storage URLs: one file or multipart range, streamed and hashed as it is sent.
// Large media costs one chunk at a time. Storage URLs carry their own signature, never an OAuth bearer.
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { trustedUploadUrl } from "../reviewUpload.mjs";

/** Why a transfer stopped. `expired`: the signed URL no longer works (ask for a new one). `exists`: a create-only PUT
 * found the object already written. `changed`: the file's bytes are not the ones captured. `unreadable`: the file
 * could not be read (a drive unplugged, a file deleted). `corrupt`: downloaded bytes do not hash to what was asked.
 * `transient`: the network or the store failed; the same request may be sent again. */
export class TransferError extends Error {
  /** @param {"expired" | "exists" | "changed" | "unreadable" | "corrupt" | "transient" | "refused"} kind
   * @param {{ status?: number, path?: string }} [about] */
  constructor(kind, about = {}) {
    super(`composition sync transfer: ${kind}${about.status ? ` (${about.status})` : ""}`);
    this.name = "TransferError";
    this.kind = kind;
    this.status = about.status ?? 0;
    this.path = about.path ?? null;
  }
}

/** @param {unknown} error */
export const isAbort = (error) =>
  error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");

/** @param {number} ms @param {AbortSignal} [signal] */
export const realWait = (ms, signal) => sleep(ms, undefined, { signal });

/** S3 answers 403 for a URL past its expiry; a 5xx or 429 is worth sending again. @param {number} status
 * @returns {TransferError} */
function refusalOf(status) {
  if (status === 403) return new TransferError("expired", { status });
  if (status === 412) return new TransferError("exists", { status });
  if (status === 429 || status >= 500) return new TransferError("transient", { status });
  return new TransferError("refused", { status });
}

/** @param {string} file */
async function openSource(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || (await realpath(dirname(file))) !== dirname(file))
      throw new TransferError("unreadable", { path: file });
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/** @param {string} file @param {number} start @param {number} length @param {(bytes: number) => void} onBytes */
async function hashedBody(file, start, length, onBytes) {
  const handle = await openSource(file);
  const hash = createHash("sha256");
  const seen = { bytes: 0, ended: false, readError: /** @type {unknown} */ (null) };
  const chunks =
    length === 0
      ? null
      : handle
          .createReadStream({ start, end: start + length - 1, autoClose: false })
          [Symbol.asyncIterator]();
  const body = new ReadableStream(
    {
      async pull(controller) {
        if (!chunks) return controller.close();
        try {
          const { value, done } = await chunks.next();
          if (done) return ((seen.ended = true), controller.close());
          hash.update(value);
          seen.bytes += value.length;
          onBytes(value.length);
          controller.enqueue(value);
        } catch (error) {
          seen.readError = error;
          controller.error(error);
        }
      },
      cancel: () => void chunks?.return?.(),
    },
    { highWaterMark: 0 },
  );
  return { body, seen, digest: () => hash.digest("hex"), close: () => handle.close() };
}

/** What the bytes taken from the file say about it once a PUT ended: unreadable, changed (shorter than captured,
 * or another hash), or null when they are the captured bytes, all of them or a prefix the network cut short.
 * @param {Awaited<ReturnType<typeof hashedBody>>} sent @param {{ length: number, sha256: string, path: string }} expected */
function fileProblem({ seen, digest }, { length, sha256, path }) {
  if (seen.readError) return new TransferError("unreadable", { path });
  const short = seen.ended && seen.bytes < length;
  if (short || (seen.bytes === length && digest() !== sha256))
    return new TransferError("changed", { path });
  return null;
}

/** PUTs bytes of `file` to a signed URL with exactly the headers the grant signed. Resolves once storage keeps them;
 * the bytes sent must hash to `sha256`, or it throws `changed` whatever storage answered.
 * @param {{ fetchImpl: typeof fetch, url: string, headers: Record<string, string>, file: string, path: string,
 *   start: number, length: number, sha256: string, signal: AbortSignal, onBytes?: (bytes: number) => void, stallMs?: number }} put */
export async function putRange(put) {
  const { fetchImpl, url, headers, file, start, length, signal } = put;
  const target = trustedUploadUrl(url);
  if (!target) throw new TransferError("refused", { path: put.path });
  signal.throwIfAborted();
  const stall = new AbortController();
  const sent = await hashedBody(file, start, length, (bytes) => {
    timer.refresh();
    put.onBytes?.(bytes);
  });
  const timer = setTimeout(() => stall.abort(), put.stallMs ?? 60_000);
  // Node's fetch needs `duplex` for a streamed body; lib.dom's RequestInit does not name it.
  const init = {
    method: "PUT",
    headers,
    body: sent.body,
    duplex: "half",
    redirect: "error",
    signal: AbortSignal.any([signal, stall.signal]),
  };
  /** @type {Response} */
  let reply;
  try {
    reply = await fetchImpl(target.href, /** @type {RequestInit} */ (init));
  } catch (error) {
    signal.throwIfAborted();
    if (!stall.signal.aborted && isAbort(error)) throw error;
    throw fileProblem(sent, put) ?? new TransferError("transient", { path: put.path });
  } finally {
    clearTimeout(timer);
    await sent.close();
  }
  await reply.body?.cancel().catch(() => {});
  const problem = fileProblem(sent, put);
  if (problem) throw problem;
  if (!reply.ok) throw refusalOf(reply.status);
}

/** Each part's SHA-256 (parts of `partBytes`, the last one shorter) and the whole file's, in one read.
 * @param {string} file @param {number} size @param {number} partBytes @param {AbortSignal} signal */
export async function partDigests(file, size, partBytes, signal) {
  const whole = createHash("sha256");
  /** @type {string[]} */
  const parts = [];
  let part = createHash("sha256");
  let inPart = 0;
  for await (const chunk of createReadStream(file, { highWaterMark: 1 << 20, signal })) {
    whole.update(chunk);
    for (let at = 0; at < chunk.length; ) {
      const take = Math.min(partBytes - inPart, chunk.length - at);
      part.update(chunk.subarray(at, at + take));
      inPart += take;
      at += take;
      if (inPart === partBytes) {
        parts.push(part.digest("hex"));
        part = createHash("sha256");
        inPart = 0;
      }
    }
  }
  if (inPart > 0 || parts.length === 0) parts.push(part.digest("hex"));
  return {
    parts,
    whole: whole.digest("hex"),
    complete: parts.length === Math.ceil(size / partBytes),
  };
}

/** Runs `work` over `items`, `limit` at a time. The first failure stops new work; the rest finish, then it throws.
 * @template T @param {readonly T[]} items @param {number} limit @param {(item: T) => Promise<void>} work */
export async function eachLimit(items, limit, work) {
  let next = 0;
  const failure = { failed: false, error: /** @type {unknown} */ (null) };
  const worker = async () => {
    while (!failure.failed && next < items.length) {
      const item = /** @type {T} */ (items[next++]);
      try {
        await work(item);
      } catch (error) {
        if (!failure.failed) Object.assign(failure, { failed: true, error });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure.failed) throw failure.error;
}

/** The wait before attempt `attempt` (from 1): doubling from `baseMs`, at most `maxMs`, or what the server asked.
 * @param {number} attempt @param {number | null} [askedMs] */
export const backoffMs = (attempt, askedMs = null, baseMs = 1_000, maxMs = 30_000) =>
  askedMs ?? Math.min(maxMs, baseMs * 2 ** (attempt - 1));
