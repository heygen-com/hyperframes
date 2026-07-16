import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { probeMediaMetadata } from "./mediaMetadata.js";
import { cleanupProxyCache } from "./proxyCache.js";

/**
 * Transcodes browser-hostile local video sources (HEVC, ProRes, ...) into a
 * cached, seekable H.264 authoring proxy. Consumed by the preview/play/static
 * project routes (U3/U4) to serve a `?hf-proxy=h264` request; never used on
 * the render path (render always sees the original file).
 *
 * IMPORTANT — request-lifecycle detachment: nothing here accepts or wires an
 * AbortSignal. `resolveProxy` returns a promise shared by every concurrent
 * caller for the same cache key (in-flight dedupe below); if a route handler
 * killed the ffmpeg child on client abort (page reload, HMR), every other
 * caller waiting on that same promise would fail too, and the next request
 * would restart a transcode that may have been minutes into a long asset.
 * Callers MUST let the child run to completion regardless of request
 * cancellation and simply let the held response also abort — the cache
 * entry still lands for the next request.
 */

export const PROXY_PARAMS_VERSION = "v2";

const CACHE_DIR_NAME = ".transcode-cache";

function boundedEnvInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

// ffmpeg is internally multithreaded, so two concurrent proxy encodes already
// saturate a typical laptop. Operators of shared/large machines may tune the
// bounded values without patching the package; invalid values fail safe.
const MAX_CONCURRENT_TRANSCODES = boundedEnvInteger("HYPERFRAMES_PROXY_MAX_CONCURRENCY", 2, 1, 16);
const MAX_QUEUED_TRANSCODES = boundedEnvInteger("HYPERFRAMES_PROXY_MAX_QUEUE", 8, 0, 256);

const STDERR_TAIL_MAX_CHARS = 4000;
export const TRANSCODE_TIMEOUT_MS = 15 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 60 * 1000;
const MAX_FAILURE_CACHE_ENTRIES = 128;
export const DEFAULT_PROXY_WAIT_TIMEOUT_MS = 2 * 60 * 1000;

export class ProxyTranscodeError extends Error {
  readonly exitCode: number | null;
  readonly stderrTail: string;

  constructor(message: string, exitCode: number | null, stderrTail: string) {
    super(message);
    this.name = "ProxyTranscodeError";
    this.exitCode = exitCode;
    this.stderrTail = stderrTail;
  }
}

/** "ffmpeg isn't installed" — an environment condition, not a per-source
 * failure, so it is deliberately NOT remembered by the negative cache below
 * (installing ffmpeg mid-session must recover without a server restart). */
class FfmpegUnavailableError extends ProxyTranscodeError {
  constructor() {
    super("ffmpeg binary not found", null, "");
  }
}

export class FfmpegMissingFilterError extends ProxyTranscodeError {
  constructor() {
    super(
      "HDR proxying requires ffmpeg zscale/tonemap filters (libzimg); install an ffmpeg build with libzimg support",
      null,
      "",
    );
    this.name = "FfmpegMissingFilterError";
  }
}

export class ProxyCapacityError extends ProxyTranscodeError {
  constructor() {
    super("media proxy queue is full; retry shortly", null, "");
    this.name = "ProxyCapacityError";
  }
}

export class ProxySourceOutsideProjectError extends ProxyTranscodeError {
  constructor() {
    super("media proxy source must be inside the project", null, "");
    this.name = "ProxySourceOutsideProjectError";
  }
}

export class ProxyWaitTimeoutError extends ProxyTranscodeError {
  constructor(timeoutMs: number) {
    super(`media proxy did not become ready within ${timeoutMs}ms`, null, "");
    this.name = "ProxyWaitTimeoutError";
  }
}

/** Bounds one caller's wait without cancelling the shared in-flight ffmpeg
 * job. Other preview/publish callers still receive the completed cache entry. */
export async function waitForProxy<T>(
  promise: Promise<T>,
  timeoutMs = DEFAULT_PROXY_WAIT_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ProxyWaitTimeoutError(timeoutMs)), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Cache key inputs per the plan: source path relative to the project (so the
 * cache is portable across checkouts at different absolute locations), mtime
 * and file size (mtime alone can collide on same-second re-exports on
 * coarse-timestamp filesystems; size catches nearly all such cases at zero
 * cost), and a params version token so changing the ffmpeg recipe below
 * invalidates every cached proxy cleanly.
 */
type CanonicalProxySource = {
  projectDir: string;
  sourcePath: string;
  relativePath: string;
};

function canonicalizeProxySource(
  projectDir: string,
  absoluteSourcePath: string,
): CanonicalProxySource {
  const canonicalProjectDir = realpathSync(projectDir);
  const canonicalSourcePath = realpathSync(absoluteSourcePath);
  const relPath = relative(canonicalProjectDir, canonicalSourcePath);
  if (relPath === ".." || relPath.startsWith(`..${sep}`) || isAbsolute(relPath)) {
    throw new ProxySourceOutsideProjectError();
  }
  return {
    projectDir: canonicalProjectDir,
    sourcePath: canonicalSourcePath,
    relativePath: relPath.normalize("NFC"),
  };
}

function buildProxyCacheKey(source: CanonicalProxySource): string {
  const stat = statSync(source.sourcePath);
  return createHash("sha256")
    .update(`${source.relativePath}\0${stat.mtimeMs}\0${stat.size}\0${PROXY_PARAMS_VERSION}`)
    .digest("hex");
}

function getCanonicalProxyCachePath(source: CanonicalProxySource): string {
  const key = buildProxyCacheKey(source);
  return join(source.projectDir, CACHE_DIR_NAME, `${key}.mp4`);
}

/**
 * Computes the absolute path a proxy for this source would live at, without
 * transcoding anything. Route handlers use this to check cache state (e.g.
 * for ETag/If-None-Match) before deciding whether to await a transcode.
 */
export function getProxyCachePath(projectDir: string, absoluteSourcePath: string): string {
  return getCanonicalProxyCachePath(canonicalizeProxySource(projectDir, absoluteSourcePath));
}

// --- global concurrency limiter -------------------------------------------
// ponytail: a bare counter + FIFO wait queue is the whole semaphore; no
// dependency pulled in for this. Both element-triggered and pre-warm calls
// go through the same `resolveProxy` entry point, so both queue here.

let activeTranscodes = 0;
const waitQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  return new Promise((resolveSlot, reject) => {
    const tryAcquire = (): void => {
      if (activeTranscodes < MAX_CONCURRENT_TRANSCODES) {
        activeTranscodes++;
        resolveSlot();
      } else {
        if (waitQueue.length >= MAX_QUEUED_TRANSCODES) {
          reject(new ProxyCapacityError());
          return;
        }
        waitQueue.push(tryAcquire);
      }
    };
    tryAcquire();
  });
}

function releaseSlot(): void {
  activeTranscodes--;
  const next = waitQueue.shift();
  if (next) next();
}

// --- per-key in-flight dedupe ----------------------------------------------

const inFlight = new Map<string, Promise<string>>();

function maintainProxyCache(cacheDir: string): void {
  try {
    cleanupProxyCache(cacheDir, { protectedPaths: new Set(inFlight.keys()) });
  } catch (error) {
    // Cache maintenance must never turn a playable preview into an error.
    console.warn(
      `[media-proxy] cache cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function markCacheEntryUsed(cachePath: string): void {
  try {
    const now = new Date();
    utimesSync(cachePath, now, now);
  } catch {
    // A concurrent cleanup may have removed a stale entry after existsSync;
    // the normal miss path below will recreate it on the next request.
  }
}

// --- negative cache ---------------------------------------------------------
// A source that failed to transcode fails again identically until the file
// changes (the cache key embeds mtime+size, so a re-export invalidates this
// naturally). Remembering the failure per key means repeated `?hf-proxy=`
// requests for a broken asset rethrow instantly instead of respawning ffmpeg
// on every retry the browser makes.
interface RememberedFailure {
  error: ProxyTranscodeError;
  expiresAt: number;
}

const failedTranscodes = new Map<string, RememberedFailure>();

let hdrFilterCheck: { ffmpegPath: string; promise: Promise<void> } | undefined;

function ensureHdrFilters(ffmpegPath: string): Promise<void> {
  if (hdrFilterCheck?.ffmpegPath === ffmpegPath) return hdrFilterCheck.promise;
  const promise = new Promise<void>((resolveCheck, rejectCheck) => {
    const proc = spawn(ffmpegPath, ["-hide_banner", "-filters"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.on("error", () => rejectCheck(new FfmpegMissingFilterError()));
    proc.on("close", (code) => {
      if (code !== 0 || !/\bzscale\b/.test(stdout) || !/\btonemap\b/.test(stdout)) {
        rejectCheck(new FfmpegMissingFilterError());
      } else {
        resolveCheck();
      }
    });
  });
  hdrFilterCheck = { ffmpegPath, promise };
  return promise;
}

function rememberFailure(cachePath: string, error: ProxyTranscodeError): void {
  failedTranscodes.delete(cachePath);
  failedTranscodes.set(cachePath, { error, expiresAt: Date.now() + FAILURE_CACHE_TTL_MS });
  while (failedTranscodes.size > MAX_FAILURE_CACHE_ENTRIES) {
    const oldest = failedTranscodes.keys().next().value;
    if (oldest === undefined) break;
    failedTranscodes.delete(oldest);
  }
}

/** Test hook: forget remembered transcode failures (module state persists
 * across tests that don't reload the module). */
export function clearFailedTranscodesForTest(): void {
  failedTranscodes.clear();
}

async function runFfmpeg(sourcePath: string, outputPath: string): Promise<void> {
  const metadata = await probeMediaMetadata(sourcePath);
  const ffmpegPath = findFfBinary("ffmpeg", { configuredMustExist: true });
  if (!ffmpegPath) {
    throw new FfmpegUnavailableError();
  }
  if (metadata.color.isHdr) await ensureHdrFilters(ffmpegPath);
  const evenScale = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
  const videoFilter = metadata.color.isHdr
    ? [
        "zscale=t=linear:npl=100",
        "tonemap=hable:desat=0",
        "zscale=p=bt709:t=bt709:m=bt709:r=tv",
        evenScale,
        "format=yuv420p",
      ].join(",")
    : [evenScale, "format=yuv420p"].join(",");

  return new Promise((resolvePromise, reject) => {
    const args = [
      "-y",
      "-i",
      sourcePath,
      "-vf",
      videoFilter,
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      "-colorspace",
      "bt709",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-crf",
      "18",
      "-preset",
      "veryfast",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputPath,
    ];

    // Hard ceiling so a hung ffmpeg can never permanently occupy one of the
    // global transcode slots: the child is killed and the slot released via
    // the caller's finally. Generous because long assets transcode at
    // roughly real time; a healthy encode of any authoring asset fits.
    const proc = spawn(ffmpegPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: TRANSCODE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    let stderrTail = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_MAX_CHARS);
    });
    proc.on("error", (err) => {
      reject(new ProxyTranscodeError(`failed to spawn ffmpeg: ${err.message}`, null, stderrTail));
    });
    proc.on("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
      } else if (signal) {
        reject(
          new ProxyTranscodeError(
            `ffmpeg killed by ${signal} (timeout ${TRANSCODE_TIMEOUT_MS}ms or external kill)`,
            null,
            stderrTail,
          ),
        );
      } else {
        reject(new ProxyTranscodeError(`ffmpeg exited with code ${code}`, code, stderrTail));
      }
    });
  });
}

async function transcodeToCache(absoluteSourcePath: string, cachePath: string): Promise<string> {
  await acquireSlot();
  try {
    // Another caller may have finished (or a pre-warm beat us) while queued.
    if (existsSync(cachePath)) return cachePath;

    const cacheDir = dirname(cachePath);
    mkdirSync(cacheDir, { recursive: true });
    const tempPath = join(cacheDir, `.tmp-${randomUUID()}-${basename(cachePath)}`);
    try {
      await runFfmpeg(absoluteSourcePath, tempPath);
      renameSync(tempPath, cachePath);
      maintainProxyCache(cacheDir);
      return cachePath;
    } finally {
      // No partial files: if anything above threw, remove whatever ffmpeg
      // may have partially written under the temp name.
      if (existsSync(tempPath)) unlinkSync(tempPath);
    }
  } finally {
    releaseSlot();
  }
}

/**
 * Resolves the cached H.264 proxy for `absoluteSourcePath`, transcoding it at
 * most once per cache key. Concurrent calls for the same key (including a
 * pre-warm call racing an element-triggered one) share one ffmpeg child and
 * one promise; calls for different keys queue through the global concurrency
 * limiter above. Throws `ProxyTranscodeError` on failure (missing ffmpeg or a
 * nonzero exit) — callers (route handlers) decide how to surface that (502).
 */
export async function resolveProxy(
  projectDir: string,
  absoluteSourcePath: string,
): Promise<string> {
  const source = canonicalizeProxySource(projectDir, absoluteSourcePath);
  const cachePath = getCanonicalProxyCachePath(source);
  if (existsSync(cachePath)) {
    markCacheEntryUsed(cachePath);
    maintainProxyCache(dirname(cachePath));
    return cachePath;
  }

  const rememberedFailure = failedTranscodes.get(cachePath);
  if (rememberedFailure) {
    if (rememberedFailure.expiresAt > Date.now()) throw rememberedFailure.error;
    failedTranscodes.delete(cachePath);
  }

  const existing = inFlight.get(cachePath);
  if (existing) return existing;

  const promise = transcodeToCache(source.sourcePath, cachePath)
    .catch((err: unknown) => {
      if (
        err instanceof ProxyTranscodeError &&
        !(err instanceof FfmpegUnavailableError) &&
        !(err instanceof FfmpegMissingFilterError) &&
        !(err instanceof ProxyCapacityError) &&
        !(err instanceof ProxySourceOutsideProjectError)
      ) {
        rememberFailure(cachePath, err);
      }
      throw err;
    })
    .finally(() => {
      inFlight.delete(cachePath);
    });
  inFlight.set(cachePath, promise);
  return promise;
}
