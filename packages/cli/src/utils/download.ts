import {
  closeSync,
  createWriteStream,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { get as httpsGet } from "node:https";
import { once } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import { Transform } from "node:stream";
import { basename, dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;
const LOCK_POLL_MS = 500;

export interface DownloadOptions {
  /** Abort after this many milliseconds without network activity. */
  timeoutMs?: number;
  /** Reject before writing more than this many response bytes. */
  maxBytes?: number;
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
  /** Aborting it destroys the request and removes the partial file. */
  signal?: AbortSignal;
  /** Checks the finished file before it replaces `dest`; a throw discards it. */
  verify?: (path: string) => Promise<void>;
}

/** Every redirect a host may reasonably answer with, not just the two we saw first. */
export const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * Where a redirect actually points.
 *
 * Split out because this is the part that was wrong, and it is the part that
 * can be checked without a socket: hosts answer with relative locations
 * (`/api/resolve-cache/...`) far more often than the original code assumed, and
 * handing that string back as a request target fails.
 */
export function redirectTarget(location: string, from: string): string {
  return new URL(location, from).toString();
}

/** Enough hops for a CDN handoff, few enough that a redirect loop still ends. */
const MAX_REDIRECTS = 10;

function removePartialFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Missing/locked partial files are handled by the next atomic download.
  }
}

function measureDownload(options: DownloadOptions, startBytes: number, totalBytes: number | null) {
  let receivedBytes = startBytes;
  let reportedAt = Date.now();
  options.onProgress?.(receivedBytes, totalBytes);
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.byteLength;
      if (options.maxBytes !== undefined && receivedBytes > options.maxBytes) {
        callback(new Error(`Download exceeded ${options.maxBytes} bytes`));
        return;
      }
      const now = Date.now();
      if (now - reportedAt >= 100) {
        options.onProgress?.(receivedBytes, totalBytes);
        reportedAt = now;
      }
      callback(null, chunk);
    },
  });
  return {
    stream,
    received: () => receivedBytes,
    complete: () => options.onProgress?.(receivedBytes, totalBytes),
  };
}

function getUrl(
  url: string,
  signal: AbortSignal | undefined,
  offset: number,
  etag: string | null,
  onResponse: (res: IncomingMessage) => void,
): ClientRequest {
  const headers =
    offset > 0 ? { Range: `bytes=${offset}-`, ...(etag ? { "If-Range": etag } : {}) } : undefined;
  if (!signal && !headers) return httpsGet(url, onResponse);
  return httpsGet(
    url,
    { ...(signal ? { signal } : {}), ...(headers ? { headers } : {}) },
    onResponse,
  );
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function byteCount(value: string | undefined): number | null {
  const n = Number(value);
  return value !== undefined && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** Where a 206 body starts and the whole file's size, from `Content-Range: bytes start-end/total`. */
function contentRange(header: string | undefined): { start: number; total: number | null } | null {
  const match = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(header ?? "");
  return match
    ? { start: Number(match[1]), total: match[2] === "*" ? null : Number(match[2]) }
    : null;
}

interface DownloadState {
  received: number;
  total: number | null;
  etag: string | null;
  onFreshBody?: (etag: string | null) => void;
}

type ResponsePlan =
  | { kind: "redirect"; location: string }
  | { kind: "body"; start: number; total: number | null; append: boolean }
  | { kind: "refuse"; status: number | undefined };

/** What to do with a response to a request for the bytes from `offset` on. */
function planResponse(res: IncomingMessage, offset: number): ResponsePlan {
  const status = res.statusCode;
  const location = res.headers.location;
  if (status && REDIRECT_CODES.has(status) && location) return { kind: "redirect", location };
  const range = status === 206 ? contentRange(res.headers["content-range"]) : null;
  if (offset > 0 && range?.start === offset) {
    return { kind: "body", start: offset, total: range.total, append: true };
  }
  // A 200, including one to a range request, is the whole file from byte 0.
  if (status === 200) {
    return {
      kind: "body",
      start: 0,
      total: byteCount(res.headers["content-length"]),
      append: false,
    };
  }
  return { kind: "refuse", status };
}

/** Writes a response body to `tmp`, leaving `state.received` at the bytes that reached disk. */
async function writeBody(
  res: IncomingMessage,
  tmp: string,
  plan: Extract<ResponsePlan, { kind: "body" }>,
  state: DownloadState,
  options: DownloadOptions,
): Promise<void> {
  state.received = plan.start;
  state.total = plan.total;
  if (!plan.append) {
    const etag = res.headers.etag;
    state.etag = typeof etag === "string" ? etag : null;
    state.onFreshBody?.(state.etag);
  }
  const meter = measureDownload(options, plan.start, plan.total);
  const file = createWriteStream(tmp, { flags: plan.append ? "a" : "w" });
  try {
    await pipeline(res, meter.stream, file);
  } catch (error) {
    // Chunks still buffered in the destroyed file stream never reach disk.
    if (!file.closed) await once(file, "close").catch(() => {});
    state.received = fileSize(tmp);
    throw error;
  }
  state.received = meter.received();
  meter.complete();
}

/** One request chain; `state.received` holds the bytes in `tmp` even when it rejects. */
function downloadAttempt(
  url: string,
  tmp: string,
  state: DownloadState,
  options: DownloadOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const offset = state.received;
  return new Promise((resolve, reject) => {
    const follow = (u: string, hops = 0) => {
      let activeResponse: IncomingMessage | undefined;
      let responseDiscarded = false;
      let responsePipelineStarted = false;
      let requestError: Error | undefined;
      const discard = (res: IncomingMessage) => {
        responseDiscarded = true;
        res.destroy();
      };
      const onResponse = (res: IncomingMessage) => {
        activeResponse = res;
        const plan = planResponse(res, offset);
        if (plan.kind === "refuse") {
          discard(res);
          reject(new Error(`Download failed: HTTP ${plan.status}`));
        } else if (plan.kind === "redirect") {
          discard(res);
          if (hops >= MAX_REDIRECTS) {
            reject(
              new Error(
                `Download failed: more than ${MAX_REDIRECTS} redirects from ${url.split("?")[0]}`,
              ),
            );
          } else {
            try {
              follow(redirectTarget(plan.location, u), hops + 1);
            } catch (error) {
              reject(error);
            }
          }
        } else {
          responsePipelineStarted = true;
          writeBody(res, tmp, plan, state, options).then(resolve, (err) =>
            reject(requestError ?? err),
          );
        }
      };
      let request: ClientRequest;
      try {
        request = getUrl(u, options.signal, offset, state.etag, onResponse);
      } catch (error) {
        reject(error);
        return;
      }
      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error(`Download timed out after ${timeoutMs}ms`));
      });
      request.on("error", (err) => {
        if (responseDiscarded) return;
        if (responsePipelineStarted) {
          requestError = err;
          activeResponse?.destroy(err);
          return;
        }
        reject(err);
      });
    };
    follow(url);
  });
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// A lock names `<pid> <token>`; a token not held here means a past run that had this process's pid.
const heldLocks = new Set<string>();

function readLock(lock: string): string {
  try {
    return readFileSync(lock, "utf8");
  } catch {
    return "";
  }
}

function lockIsStale(owner: string): boolean {
  const pid = Number(owner.split(" ")[0]);
  if (!(pid > 0)) return false;
  return pid === process.pid ? !heldLocks.has(owner) : !processAlive(pid);
}

/** Takes `dest`'s download lock, waiting while another live process holds it. */
async function acquireLock(
  lock: string,
  signal: AbortSignal | undefined,
): Promise<{ owner: string; waited: boolean }> {
  const owner = `${process.pid} ${randomUUID()}`;
  let waited = false;
  for (;;) {
    try {
      const fd = openSync(lock, "wx");
      writeSync(fd, owner);
      closeSync(fd);
      heldLocks.add(owner);
      return { owner, waited };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const seen = readLock(lock);
    // Re-read before removing, so a waiter never removes the lock another waiter just took over.
    if (lockIsStale(seen) && readLock(lock) === seen) {
      removePartialFile(lock);
      continue;
    }
    signal?.throwIfAborted();
    waited = true;
    await sleep(LOCK_POLL_MS);
  }
}

/** Partial files from runs that named them by process (`<file>.<pid>.<uuid>.tmp`) and were stopped. */
function removeStrayPartials(dest: string): void {
  const prefix = `${basename(dest)}.`;
  let names: string[] = [];
  try {
    names = readdirSync(dirname(dest));
  } catch {
    return;
  }
  for (const name of names) {
    const pid =
      name.startsWith(prefix) && name.endsWith(".tmp")
        ? Number(name.slice(prefix.length).split(".")[0])
        : 0;
    if (pid > 0 && !processAlive(pid)) removePartialFile(join(dirname(dest), name));
  }
}

function resumableEtag(meta: string, url: string): string | null {
  try {
    const recorded = JSON.parse(readFileSync(meta, "utf8")) as { url?: unknown; etag?: unknown };
    return recorded.url === url && typeof recorded.etag === "string" ? recorded.etag : null;
  } catch {
    return null;
  }
}

type FailureStep = "continue" | "restart" | "discard" | "keep";

interface Attempt {
  aborted: boolean;
  progressed: boolean;
  resumed: boolean;
  resumable: boolean;
}

/** What a failed attempt means for the partial file. */
function afterFailure(error: unknown, attempt: Attempt): FailureStep {
  const message = error instanceof Error ? error.message : "";
  if (attempt.aborted || message.startsWith("Download exceeded")) return "discard";
  if (attempt.progressed) return "continue";
  // The server refused the resume (a stale or already complete part): start over once.
  if (attempt.resumed && message.startsWith("Download failed: HTTP")) return "restart";
  return attempt.resumable ? "keep" : "discard";
}

function discardPart(part: string): void {
  removePartialFile(part);
  removePartialFile(`${part}.json`);
}

function openPart(url: string, dest: string): DownloadState {
  const part = `${dest}.part`;
  removeStrayPartials(dest);
  const etag = resumableEtag(`${part}.json`, url);
  if (!etag) removePartialFile(part);
  return {
    received: etag ? fileSize(part) : 0,
    total: null,
    etag,
    onFreshBody: (fresh) => {
      if (fresh) writeFileSync(`${part}.json`, JSON.stringify({ url, etag: fresh }));
      else removePartialFile(`${part}.json`);
    },
  };
}

function assertComplete(part: string, state: DownloadState): void {
  const size = fileSize(part);
  if (state.total !== null && size !== state.total) {
    state.received = size;
    throw new Error(`Download incomplete: ${size} of ${state.total} bytes`);
  }
}

async function publishPart(part: string, dest: string, options: DownloadOptions): Promise<void> {
  try {
    await options.verify?.(part);
  } catch (error) {
    discardPart(part);
    throw error;
  }
  renameSync(part, dest);
  removePartialFile(`${part}.json`);
}

async function downloadToPart(url: string, dest: string, options: DownloadOptions): Promise<void> {
  const part = `${dest}.part`;
  const state = openPart(url, dest);
  for (;;) {
    const before = state.received;
    try {
      await downloadAttempt(url, part, state, options);
      assertComplete(part, state);
      break;
    } catch (error) {
      const step = afterFailure(error, {
        aborted: options.signal?.aborted === true,
        progressed: state.received > before,
        resumed: before > 0,
        resumable: state.etag !== null && state.received > 0,
      });
      if (step === "continue") continue;
      if (step !== "keep") discardPart(part);
      if (step !== "restart") throw error;
      state.received = 0;
      state.etag = null;
    }
  }
  await publishPart(part, dest, options);
}

/**
 * Some networks drop every connection at the same byte, so a retry resumes from the partial file.
 * The partial file and its validator survive a stopped run, so the next run resumes it too.
 */
export async function downloadFile(
  url: string,
  dest: string,
  options: DownloadOptions = {},
): Promise<void> {
  const lock = `${dest}.lock`;
  const { owner, waited } = await acquireLock(lock, options.signal);
  try {
    if (!(waited && existsSync(dest))) await downloadToPart(url, dest, options);
  } finally {
    heldLocks.delete(owner);
    if (readLock(lock) === owner) removePartialFile(lock);
  }
}
