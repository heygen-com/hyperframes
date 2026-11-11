/** The PUT primitives of a direct upload: one try with a stall watch, and the retry loop around it. */

import { createReadStream } from "node:fs";
import { type ClientRequest, type IncomingMessage, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** A file on disk, hashed and uploaded as a stream so it is never held in memory. */
export interface UploadFileSource {
  path: string;
  size: number;
}

/** A failed or stalled PUT is sent again to the same presigned URL (it stays valid and a PUT replaces the object). */
export const putTimings = {
  stallMs: 60_000,
  retries: 3,
  backoffMs: 1000,
  progressMs: 10_000,
  sampleMs: 1000,
};

/** What one try of the PUT got through, read by the retry loop and the progress lines. */
export interface PutTry {
  attempt: number;
  startedAt: number;
  sent: number;
}

const CUT_CODES = new Set(["ECONNRESET", "EPIPE", "ECONNABORTED"]);

function isConnectionCut(err: unknown): boolean {
  const code = (err as { code?: unknown }).code;
  return (typeof code === "string" && CUT_CODES.has(code)) || /socket hang up/.test(String(err));
}

/** The same cut twice: a connection that dies at the same age dies there again, whatever it got through. */
function isSameCut(before: EndedTry, now: EndedTry): boolean {
  return (
    before.sent > 0 &&
    now.sent > 0 &&
    Math.abs(before.ageMs - now.ageMs) <= 0.2 * Math.max(before.ageMs, now.ageMs)
  );
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
export class PutRefusedError extends Error {
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

type EndedTry = PutTry & { ageMs: number; cut: boolean };

function repeatedCut(before: EndedTry | undefined, now: EndedTry, err: unknown, total: number) {
  if (!before?.cut || !now.cut || !isSameCut(before, now)) return undefined;
  const code = (err as { code?: string }).code;
  return Object.assign(
    new Error(
      `The connection was cut at ${seconds(now.ageMs)} on two tries in a row, after ${Math.floor((100 * now.sent) / total)}% of the file was sent (${code ?? "connection reset"}). Every try restarts the file, so this link cannot finish it before the cut: use a faster connection or send less media.`,
      { cause: err },
    ),
    { code },
  );
}

export async function putWithRetry<T>(
  attempt: (tried: PutTry) => Promise<T>,
  total: number,
  signal?: AbortSignal,
): Promise<T> {
  let before: EndedTry | undefined;
  for (let tried = 0; ; tried++) {
    const current: PutTry = { attempt: tried + 1, startedAt: Date.now(), sent: 0 };
    try {
      return await attempt(current);
    } catch (err) {
      if (isFinal(err) || signal?.aborted) throw err;
      const now = { ...current, ageMs: Date.now() - current.startedAt, cut: isConnectionCut(err) };
      const futile = repeatedCut(before, now, err, total);
      if (futile) throw futile;
      if (tried >= putTimings.retries) throw exhausted(err, tried + 1, now, total);
      before = now;
      await sleep(putTimings.backoffMs * 2 ** tried, signal);
    }
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
}

// fetch holds a streamed request body in memory whole, so a file is piped through node:http(s). A buffer goes the
// same way, in slices, so a stalled link ends its try the same way (a plain fetch has no progress to watch).
const SLICE_BYTES = 64 * 1024;

export interface ByteRange {
  start: number;
  length: number;
}

function bodyStream(body: Uint8Array | UploadFileSource, range?: ByteRange): Readable {
  if (!(body instanceof Uint8Array))
    return createReadStream(
      body.path,
      range && { start: range.start, end: range.start + range.length - 1 },
    );
  const from = range?.start ?? 0;
  const to = from + (range?.length ?? body.byteLength);
  return Readable.from(
    (function* () {
      for (let at = from; at < to; at += SLICE_BYTES)
        yield body.subarray(at, Math.min(at + SLICE_BYTES, to));
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
    Math.min(putTimings.sampleMs, putTimings.stallMs / 3),
  );
  return () => clearInterval(watch);
}

export async function putStreamToPresignedUrl(
  uploadUrl: string,
  headers: Record<string, string>,
  body: Uint8Array | UploadFileSource,
  signal: AbortSignal | undefined,
  onSample: (written: number) => void,
  range?: ByteRange,
): Promise<string | undefined> {
  const size = range?.length ?? (body instanceof Uint8Array ? body.byteLength : body.size);
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
  const source = bodyStream(body, range);
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
  return String(res.headers.etag ?? "") || undefined;
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
