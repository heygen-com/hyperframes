import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { probeMediaMetadata } from "./mediaMetadata.js";

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

export const PROXY_PARAMS_VERSION = "v1";

const CACHE_DIR_NAME = ".transcode-cache";

// ponytail: fixed global bound, not configurable. ffmpeg is internally
// multithreaded so 2 concurrent authoring-proxy encodes already saturate a
// typical dev laptop; raise this constant (or make it an env override) if
// real usage shows queuing hurts.
const MAX_CONCURRENT_TRANSCODES = 2;

const STDERR_TAIL_MAX_CHARS = 4000;
const TRANSCODE_TIMEOUT_MS = 15 * 60 * 1000;

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

/**
 * Cache key inputs per the plan: source path relative to the project (so the
 * cache is portable across checkouts at different absolute locations), mtime
 * and file size (mtime alone can collide on same-second re-exports on
 * coarse-timestamp filesystems; size catches nearly all such cases at zero
 * cost), and a params version token so changing the ffmpeg recipe below
 * invalidates every cached proxy cleanly.
 */
function buildProxyCacheKey(projectDir: string, absoluteSourcePath: string): string {
  const relPath = relative(projectDir, absoluteSourcePath);
  const stat = statSync(absoluteSourcePath);
  return createHash("sha256")
    .update(`${relPath}\0${stat.mtimeMs}\0${stat.size}\0${PROXY_PARAMS_VERSION}`)
    .digest("hex");
}

/**
 * Computes the absolute path a proxy for this source would live at, without
 * transcoding anything. Route handlers use this to check cache state (e.g.
 * for ETag/If-None-Match) before deciding whether to await a transcode.
 */
export function getProxyCachePath(projectDir: string, absoluteSourcePath: string): string {
  const key = buildProxyCacheKey(projectDir, absoluteSourcePath);
  return join(projectDir, CACHE_DIR_NAME, `${key}.mp4`);
}

// --- global concurrency limiter -------------------------------------------
// ponytail: a bare counter + FIFO wait queue is the whole semaphore; no
// dependency pulled in for this. Both element-triggered and pre-warm calls
// go through the same `resolveProxy` entry point, so both queue here.

let activeTranscodes = 0;
const waitQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  return new Promise((resolveSlot) => {
    const tryAcquire = (): void => {
      if (activeTranscodes < MAX_CONCURRENT_TRANSCODES) {
        activeTranscodes++;
        resolveSlot();
      } else {
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

// --- negative cache ---------------------------------------------------------
// A source that failed to transcode fails again identically until the file
// changes (the cache key embeds mtime+size, so a re-export invalidates this
// naturally). Remembering the failure per key means repeated `?hf-proxy=`
// requests for a broken asset rethrow instantly instead of respawning ffmpeg
// on every retry the browser makes.
const failedTranscodes = new Map<string, ProxyTranscodeError>();

/** Test hook: forget remembered transcode failures (module state persists
 * across tests that don't reload the module). */
export function clearFailedTranscodesForTest(): void {
  failedTranscodes.clear();
}

async function runFfmpeg(sourcePath: string, outputPath: string): Promise<void> {
  const metadata = await probeMediaMetadata(sourcePath);
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
    const ffmpegPath = findFfBinary("ffmpeg", { configuredMustExist: true });
    if (!ffmpegPath) {
      reject(new FfmpegUnavailableError());
      return;
    }

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
  const cachePath = getProxyCachePath(projectDir, absoluteSourcePath);
  if (existsSync(cachePath)) return cachePath;

  const rememberedFailure = failedTranscodes.get(cachePath);
  if (rememberedFailure) throw rememberedFailure;

  const existing = inFlight.get(cachePath);
  if (existing) return existing;

  const promise = transcodeToCache(absoluteSourcePath, cachePath)
    .catch((err: unknown) => {
      if (err instanceof ProxyTranscodeError && !(err instanceof FfmpegUnavailableError)) {
        failedTranscodes.set(cachePath, err);
      }
      throw err;
    })
    .finally(() => {
      inFlight.delete(cachePath);
    });
  inFlight.set(cachePath, promise);
  return promise;
}
