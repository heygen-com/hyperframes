import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  formatPreviewProxyBox,
  hdrToSdrToneMapFilter,
  type PreviewProxyBox,
} from "@hyperframes/core";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { alphaDecoderFor } from "@hyperframes/parsers/media-alpha";
import { probeFirstFrameColour, probeMediaMetadata } from "./mediaMetadata.js";
import { cleanupProxyCache } from "./proxyCache.js";
import { PROXY_VARIANT_CONFIG, type ProxyVariant } from "./mediaCodecMap.js";
import { mkdirWithinProject, realpath, realProjectRoot } from "./safePath.js";

/**
 * Transcodes browser-hostile local video sources (HEVC, ProRes, ...) into a
 * cached, seekable authoring proxy. Consumed by the preview/play/static
 * project routes (U3/U4) to serve a `?hf-proxy=` request; never used on
 * the render path (render always sees the original file).
 *
 * Every caller of a cache key shares one ffmpeg child (in-flight dedupe below). A
 * caller's `signal` detaches that caller; once no caller is left, the copy is
 * dropped from the queue or its ffmpeg is killed.
 */

export const PROXY_PARAMS_VERSION = "v5";

export const CACHE_DIR_NAME = ".transcode-cache";

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
/** A longer source is copied in pieces this long; a stopped copy keeps its finished pieces. */
const PROXY_CHUNK_SECONDS = 60;
const CHUNK_PREFIX = ".part-";
const CONCAT_TIMEOUT_MS = 2 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 60 * 1000;
export const PROXY_PENDING_RETRY_AFTER_SECONDS = 2;
const ENVIRONMENT_FAILURE_TTL_MS = 5 * PROXY_PENDING_RETRY_AFTER_SECONDS * 1000;
const MAX_FAILURE_CACHE_ENTRIES = 128;
export const DEFAULT_PROXY_WAIT_TIMEOUT_MS = 2 * 60 * 1000;
const UNTOUCHED_TEMP_IS_DEAD_MS = 10 * 60 * 1000;

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

/** ffmpeg is missing or cannot start — an environment condition, not a per-source
 * failure, so the negative cache below keeps it only briefly
 * (installing ffmpeg mid-session must recover without a server restart). */
export class FfmpegUnavailableError extends ProxyTranscodeError {
  constructor(message = "ffmpeg binary not found", stderrTail = "") {
    super(message, null, stderrTail);
    this.name = "FfmpegUnavailableError";
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
    super("media proxy source must be addressed through the project", null, "");
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
 * Cache key inputs per the plan: project-relative source path (portable across
 * checkouts), canonical source identity (so retargeted external symlinks do
 * not reuse a proxy), mtime and file size (mtime alone can collide on
 * same-second re-exports on coarse-timestamp filesystems; size catches nearly
 * all such cases at zero cost), and a params version token so changing the
 * ffmpeg recipe below invalidates every cached proxy cleanly.
 */
type CanonicalProxySource = {
  projectDir: string;
  sourcePath: string;
  relativePath: string;
  cacheIdentity: string;
};

function canonicalizeProxySource(
  projectDir: string,
  absoluteSourcePath: string,
): CanonicalProxySource {
  const requestedProjectDir = resolve(projectDir);
  const requestedSourcePath = resolve(absoluteSourcePath);
  const requestedRelativePath = relative(requestedProjectDir, requestedSourcePath);
  if (
    requestedRelativePath === ".." ||
    requestedRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(requestedRelativePath)
  ) {
    throw new ProxySourceOutsideProjectError();
  }

  const canonicalProjectDir = realProjectRoot(projectDir);
  const canonicalSourcePath = realpath(absoluteSourcePath);
  const canonicalRelativePath = relative(canonicalProjectDir, canonicalSourcePath);
  const sourceIsInsideCanonicalProject =
    canonicalRelativePath !== ".." &&
    !canonicalRelativePath.startsWith(`..${sep}`) &&
    !isAbsolute(canonicalRelativePath);
  return {
    projectDir: canonicalProjectDir,
    sourcePath: canonicalSourcePath,
    relativePath: requestedRelativePath.normalize("NFC"),
    // An external target needs a stable identity in addition to its project-local
    // symlink path, otherwise retargeting the link can reuse an unrelated proxy.
    cacheIdentity: (sourceIsInsideCanonicalProject
      ? canonicalRelativePath
      : canonicalSourcePath
    ).normalize("NFC"),
  };
}

function buildProxyCacheKey(
  source: CanonicalProxySource,
  variant: ProxyVariant,
  box: PreviewProxyBox | undefined,
): string {
  const stat = statSync(source.sourcePath);
  const size = box ? `\0${formatPreviewProxyBox(box)}` : "";
  return createHash("sha256")
    .update(
      `${source.relativePath}\0${source.cacheIdentity}\0${stat.mtimeMs}\0${stat.size}\0${PROXY_PARAMS_VERSION}\0${variant}${size}`,
    )
    .digest("hex");
}

function getCanonicalProxyCachePath(
  source: CanonicalProxySource,
  variant: ProxyVariant,
  box?: PreviewProxyBox,
): string {
  const key = buildProxyCacheKey(source, variant, box);
  return join(
    source.projectDir,
    CACHE_DIR_NAME,
    `${key}${PROXY_VARIANT_CONFIG[variant].extension}`,
  );
}

/**
 * Computes the absolute path a proxy for this source would live at, without
 * transcoding anything, so a host can check cache state. Pass the request's
 * preview box (`hf-proxy-box`) to name a boxed copy.
 */
export function getProxyCachePath(
  projectDir: string,
  absoluteSourcePath: string,
  variant: ProxyVariant = "h264",
  box?: PreviewProxyBox,
): string {
  return getCanonicalProxyCachePath(
    canonicalizeProxySource(projectDir, absoluteSourcePath),
    variant,
    box,
  );
}

// --- global concurrency limiter -------------------------------------------
// ponytail: a counter + one wait queue is the whole semaphore. Priority copies
// queue ahead of the rest and are never refused for a full queue, so a few
// priority asks (the copy a viewer is waiting on) can exceed the cap.

/** One copy per cache key, shared by every caller asking for it. */
interface ProxyJob {
  cachePath: string;
  priority: boolean;
  /** Callers still waiting; one without a signal never leaves, so its copy is always made. */
  callers: number;
  /** Set while the job waits for a slot. */
  queued?: { start: () => void; drop: () => void };
  abandoned: AbortController;
}

class ProxyDroppedError extends ProxyTranscodeError {
  constructor() {
    super("media proxy copy dropped: every caller left", null, "");
    this.name = "ProxyDroppedError";
  }
}

let activeTranscodes = 0;
const waitQueue: ProxyJob[] = [];

function enqueue(job: ProxyJob): void {
  const firstNormal = job.priority ? waitQueue.findIndex((queued) => !queued.priority) : -1;
  if (firstNormal === -1) waitQueue.push(job);
  else waitQueue.splice(firstNormal, 0, job);
}

function dequeue(job: ProxyJob): void {
  const index = waitQueue.indexOf(job);
  if (index !== -1) waitQueue.splice(index, 1);
}

function acquireSlot(job: ProxyJob): Promise<void> {
  if (activeTranscodes < MAX_CONCURRENT_TRANSCODES) {
    activeTranscodes++;
    return Promise.resolve();
  }
  return new Promise((resolveSlot, reject) => {
    job.queued = {
      start: () => {
        job.queued = undefined;
        activeTranscodes++;
        resolveSlot();
      },
      drop: () => {
        job.queued = undefined;
        dequeue(job);
        forget(job);
        reject(new ProxyDroppedError());
      },
    };
    enqueue(job);
  });
}

function queueIsFull(): boolean {
  return activeTranscodes >= MAX_CONCURRENT_TRANSCODES && waitQueue.length >= MAX_QUEUED_TRANSCODES;
}

function releaseSlot(): void {
  activeTranscodes--;
  waitQueue.shift()?.queued?.start();
}

function prioritize(job: ProxyJob): void {
  if (job.priority) return;
  job.priority = true;
  if (!job.queued) return;
  dequeue(job);
  enqueue(job);
}

function leave(job: ProxyJob): void {
  job.callers--;
  if (job.callers > 0) return;
  if (job.queued) {
    job.queued.drop();
    return;
  }
  forget(job);
  job.abandoned.abort();
}

// --- per-key in-flight dedupe ----------------------------------------------

const inFlight = new Map<string, { promise: Promise<string>; job: ProxyJob }>();

function forget(job: ProxyJob): void {
  if (inFlight.get(job.cachePath)?.job === job) inFlight.delete(job.cachePath);
}

function maintainProxyCache(cacheDir: string, staleTempMs?: number): void {
  try {
    cleanupProxyCache(cacheDir, { protectedPaths: new Set(inFlight.keys()), staleTempMs });
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
  error: unknown;
  expiresAt: number;
}

const failedTranscodes = new Map<string, RememberedFailure>();

let hdrFilterCheck: { ffmpegPath: string; promise: Promise<void> } | undefined;

function ensureHdrFilters(ffmpegPath: string): Promise<void> {
  if (hdrFilterCheck?.ffmpegPath === ffmpegPath) return hdrFilterCheck.promise;
  const promise = new Promise<void>((resolveCheck, rejectCheck) => {
    const proc = spawn(ffmpegPath, ["-hide_banner", "-filters"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
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

function rememberFailure(cachePath: string, error: unknown): void {
  const ttlMs =
    error instanceof FfmpegUnavailableError || error instanceof FfmpegMissingFilterError
      ? ENVIRONMENT_FAILURE_TTL_MS
      : FAILURE_CACHE_TTL_MS;
  failedTranscodes.delete(cachePath);
  failedTranscodes.set(cachePath, { error, expiresAt: Date.now() + ttlMs });
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

/** Even dimensions; with a box, the source shrinks until its tighter side fills the box, never grows. */
function proxyScaleFilter(box?: PreviewProxyBox): string {
  if (!box) return "scale=trunc(iw/2)*2:trunc(ih/2)*2";
  const factor = `min(1\\,max(${box.width}/iw\\,${box.height}/ih))`;
  const side = (d: string) => `min(trunc(${d}/2)*2\\,ceil(${d}*${factor}/2)*2)`;
  return `scale=${side("iw")}:${side("ih")}`;
}

const STDERR_ERROR_LINE = /error|invalid|denied|no space|not found|unknown/i;

/** ffmpeg ends most failures with "Conversion failed!"; the cause is the last error-looking line above it. */
function stderrReason(stderrTail: string): string {
  const lines = stderrTail
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const errorLines = lines.filter((line) => STDERR_ERROR_LINE.test(line));
  const line = errorLines.at(-1) ?? lines.at(-1);
  return line ? `: ${line.replace(/[.!]+$/, "")}` : "";
}

interface ChunkRange {
  startSeconds: number;
  lengthSeconds: number;
}

/** Null when the source is short enough (or its length unknown) for one pass. */
function chunkRanges(durationSeconds: number | undefined): ChunkRange[] | null {
  if (!durationSeconds || durationSeconds <= PROXY_CHUNK_SECONDS * 1.5) return null;
  const count = Math.floor(durationSeconds / PROXY_CHUNK_SECONDS);
  // The remainder joins the last piece, so no piece is shorter than a chunk.
  return Array.from({ length: count }, (_, index) => ({
    startSeconds: index * PROXY_CHUNK_SECONDS,
    lengthSeconds:
      index === count - 1 ? durationSeconds - index * PROXY_CHUNK_SECONDS : PROXY_CHUNK_SECONDS,
  }));
}

function ffmpegBudgetError(chunksKept: number, chunkCount: number): ProxyTranscodeError {
  return new ProxyTranscodeError(
    `ffmpeg ran out of its ${TRANSCODE_TIMEOUT_MS}ms budget with ${chunksKept}/${chunkCount} pieces done; the finished pieces are kept and the next attempt continues from them`,
    null,
    "",
  );
}

type EncodeFn = (outputPath: string, timeoutMs: number, range?: ChunkRange) => Promise<void>;

/** Copies a long source in pieces that stay in the cache, so a stopped copy continues from the first missing one. */
async function encodeInChunks(
  ranges: ChunkRange[],
  chunkPrefix: string,
  tempPath: string,
  encode: EncodeFn,
  concat: (listPath: string, target: string) => Promise<void>,
): Promise<void> {
  const extension = extname(tempPath);
  const deadline = Date.now() + TRANSCODE_TIMEOUT_MS;
  const pieces = ranges.map((_, index) => `${chunkPrefix}${index}${extension}`);
  for (const [index, range] of ranges.entries()) {
    const piece = pieces[index]!;
    if (existsSync(piece)) continue;
    const timeoutMs = deadline - Date.now();
    if (timeoutMs <= 0) throw ffmpegBudgetError(index, ranges.length);
    const pieceTemp = join(dirname(piece), `.tmp-${randomUUID()}-${basename(piece)}`);
    try {
      await encode(pieceTemp, timeoutMs, range);
      renameSync(pieceTemp, piece);
    } finally {
      if (existsSync(pieceTemp)) unlinkSync(pieceTemp);
    }
  }
  const listDir = mkdtempSync(join(tmpdir(), "hf-proxy-join-"));
  try {
    const listPath = join(listDir, "pieces.txt");
    writeFileSync(
      listPath,
      pieces
        .map((piece) => `file '${piece.replace(/\\/g, "/").replace(/'/g, "'\\''")}'\n`)
        .join(""),
    );
    await concat(listPath, tempPath);
  } finally {
    rmSync(listDir, { recursive: true, force: true });
  }
  for (const piece of pieces) if (existsSync(piece)) unlinkSync(piece);
}

// Fixed recipe; changing either array means bumping PROXY_PARAMS_VERSION.
const H264_ARGS = [
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
];
const VP8_ARGS = [
  "-c:v",
  "libvpx",
  "-b:v",
  "0",
  "-crf",
  "23",
  "-deadline",
  "good",
  "-pix_fmt",
  "yuva420p",
  "-colorspace",
  "bt709",
  "-color_primaries",
  "bt709",
  "-color_trc",
  "bt709",
  "-cpu-used",
  "4",
  "-auto-alt-ref",
  "0",
  "-metadata:s:v:0",
  "alpha_mode=1",
  "-ac",
  "2",
  "-c:a",
  "libopus",
];

async function buildVideoFilter(
  ffmpegPath: string,
  sourcePath: string,
  metadata: Awaited<ReturnType<typeof probeMediaMetadata>>,
  keepsAlpha: boolean,
  box: PreviewProxyBox | undefined,
): Promise<string> {
  const { hdrTransfer } = metadata.color;
  const toneMap = (hdrTransfer === "pq" || hdrTransfer === "hlg") && !keepsAlpha;
  if (toneMap) await ensureHdrFilters(ffmpegPath);
  const firstFrame = toneMap ? await probeFirstFrameColour(sourcePath) : {};
  const evenScale = proxyScaleFilter(box);
  const pixelFormat = keepsAlpha ? "yuva420p" : "yuv420p";
  // The tone map ends in RGB; older ffmpeg (seen on 5.1) converts it with BT.601 unless the matrix is named.
  return toneMap
    ? [
        hdrToSdrToneMapFilter(metadata.color, firstFrame),
        `${evenScale}:out_color_matrix=bt709:out_range=tv`,
        `format=${pixelFormat}`,
      ].join(",")
    : [evenScale, `format=${pixelFormat}`].join(",");
}

async function runFfmpeg(
  sourcePath: string,
  outputPath: string,
  chunkPrefix: string,
  variant: ProxyVariant,
  box: PreviewProxyBox | undefined,
  signal: AbortSignal,
): Promise<void> {
  const metadata = await probeMediaMetadata(sourcePath);
  const ffmpegPath = findFfBinary("ffmpeg", { configuredMustExist: true });
  if (!ffmpegPath) {
    throw new FfmpegUnavailableError();
  }
  const keepsAlpha = variant === "vp8";
  const videoFilter = await buildVideoFilter(ffmpegPath, sourcePath, metadata, keepsAlpha, box);
  const alphaDecoder = keepsAlpha ? alphaDecoderFor(metadata.color.codecName) : null;
  const decoderArgs = alphaDecoder ? ["-c:v", alphaDecoder] : [];
  const encode: EncodeFn = (target, timeoutMs, range) =>
    spawnFfmpeg(
      ffmpegPath,
      [
        "-y",
        ...(range ? ["-ss", String(range.startSeconds)] : []),
        ...decoderArgs,
        "-i",
        sourcePath,
        ...(range ? ["-t", String(range.lengthSeconds)] : []),
        "-vf",
        videoFilter,
        ...(variant === "vp8" ? VP8_ARGS : H264_ARGS),
        target,
      ],
      timeoutMs,
      signal,
    );
  const ranges = chunkRanges(metadata.durationSeconds);
  if (!ranges) return encode(outputPath, TRANSCODE_TIMEOUT_MS);
  await encodeInChunks(ranges, chunkPrefix, outputPath, encode, (listPath, target) =>
    spawnFfmpeg(ffmpegPath, concatArgs(listPath, target, variant), CONCAT_TIMEOUT_MS, signal),
  );
}

function concatArgs(listPath: string, target: string, variant: ProxyVariant): string[] {
  return [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    ...(variant === "h264" ? ["-movflags", "+faststart"] : []),
    target,
  ];
}

function spawnFfmpeg(
  ffmpegPath: string,
  args: string[],
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    // Hard ceiling so a hung ffmpeg can never permanently occupy one of the
    // global transcode slots: the child is killed and the slot released via
    // the caller's finally. Generous because long assets transcode at
    // roughly real time; a healthy encode of any authoring asset fits.
    signal.throwIfAborted();
    const proc = spawn(ffmpegPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      signal,
      windowsHide: true,
    });
    let stderrTail = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_MAX_CHARS);
    });
    proc.on("error", (err) => {
      if (signal.aborted) return;
      reject(new FfmpegUnavailableError(`failed to spawn ffmpeg: ${err.message}`, stderrTail));
    });
    proc.on("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
      } else if (signal) {
        reject(
          new ProxyTranscodeError(
            `ffmpeg killed by ${signal} (timeout ${timeoutMs}ms or external kill)`,
            null,
            stderrTail,
          ),
        );
      } else {
        reject(
          new ProxyTranscodeError(
            `ffmpeg exited with code ${code}${stderrReason(stderrTail)}`,
            code,
            stderrTail,
          ),
        );
      }
    });
  });
}

async function transcodeToCache(
  job: ProxyJob,
  projectDir: string,
  absoluteSourcePath: string,
  cachePath: string,
  variant: ProxyVariant,
  box: PreviewProxyBox | undefined,
): Promise<string> {
  await acquireSlot(job);
  try {
    // Another caller may have finished (or a pre-warm beat us) while queued.
    if (existsSync(cachePath)) return cachePath;

    const cacheDir = dirname(cachePath);
    mkdirWithinProject(projectDir, cacheDir);
    const tempPath = join(cacheDir, `.tmp-${randomUUID()}-${basename(cachePath)}`);
    try {
      const chunkPrefix = join(
        cacheDir,
        `${CHUNK_PREFIX}${basename(cachePath, extname(cachePath))}-`,
      );
      await runFfmpeg(
        absoluteSourcePath,
        tempPath,
        chunkPrefix,
        variant,
        box,
        job.abandoned.signal,
      );
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

let proxyActivity = 0;

/** Null while this project has a copy in progress; otherwise a mark that moves when any copy finishes or is refused. */
export function proxyActivityMark(projectDir: string): string | null {
  if (!existsSync(projectDir)) return String(proxyActivity);
  const cacheDir = join(realpath(projectDir), CACHE_DIR_NAME) + sep;
  for (const cachePath of inFlight.keys()) if (cachePath.startsWith(cacheDir)) return null;
  return String(proxyActivity);
}

/**
 * Resolves the cached proxy variant for `absoluteSourcePath`, transcoding it at
 * most once per cache key. Concurrent calls for the same key (including a
 * pre-warm call racing an element-triggered one) share one ffmpeg child and
 * one promise; calls for different keys queue through the global concurrency
 * limiter above. Throws `ProxyTranscodeError` on failure (missing ffmpeg or a
 * nonzero exit) — callers (route handlers) decide how to surface that (502).
 * A `box` makes a smaller preview-only copy with its own cache entry; without
 * one the copy keeps the source size (CLI play, static servers, publish).
 * `priority` moves the copy ahead of every normal queued copy; a `signal`
 * lets this caller leave (see the detachment note at the top of this file).
 */
export async function resolveProxy(
  projectDir: string,
  absoluteSourcePath: string,
  variant: ProxyVariant = "h264",
  box?: PreviewProxyBox,
  options: ResolveProxyOptions = {},
): Promise<string> {
  options.signal?.throwIfAborted();
  const source = canonicalizeProxySource(projectDir, absoluteSourcePath);
  const cachePath = getCanonicalProxyCachePath(source, variant, box);
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

  let entry = inFlight.get(cachePath);
  if (!entry) {
    if (!options.priority && queueIsFull()) {
      proxyActivity += 1;
      throw new ProxyCapacityError();
    }
    const job: ProxyJob = {
      cachePath,
      priority: options.priority === true,
      callers: 0,
      abandoned: new AbortController(),
    };
    const promise = transcodeToCache(
      job,
      source.projectDir,
      source.sourcePath,
      cachePath,
      variant,
      box,
    )
      .catch((err: unknown) => {
        if (!(err instanceof ProxyDroppedError) && !job.abandoned.signal.aborted) {
          rememberFailure(cachePath, err);
        }
        throw err;
      })
      .finally(() => {
        forget(job);
        proxyActivity += 1;
      });
    entry = { promise, job };
    inFlight.set(cachePath, entry);
  }
  if (options.priority) prioritize(entry.job);
  return joinJob(entry.promise, entry.job, options.signal);
}

/** Batch resolve for check and publish: at most MAX_CONCURRENT_TRANSCODES of its own requests in
 * flight (other callers can still fill the queue); each waits at most TRANSCODE_TIMEOUT_MS. */
export async function resolveProxies(
  projectDir: string,
  sources: ReadonlyArray<{ sourcePath: string; variant: ProxyVariant; box?: PreviewProxyBox }>,
  onSettled: () => void = () => {},
): Promise<PromiseSettledResult<string>[]> {
  const first = sources[0];
  if (first) {
    maintainProxyCache(
      dirname(getProxyCachePath(projectDir, first.sourcePath, first.variant)),
      Math.min(
        Number(process.env.HYPERFRAMES_PROXY_CACHE_STALE_TEMP_MS) || UNTOUCHED_TEMP_IS_DEAD_MS,
        UNTOUCHED_TEMP_IS_DEAD_MS,
      ),
    );
  }
  const results: PromiseSettledResult<string>[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < sources.length; index = next++) {
      const { sourcePath, variant, box } = sources[index]!;
      results[index] = await waitForProxy(
        resolveProxy(projectDir, sourcePath, variant, box),
        TRANSCODE_TIMEOUT_MS,
      ).then(
        (value) => ({ status: "fulfilled", value }),
        (reason: unknown) => ({ status: "rejected", reason }),
      );
      onSettled();
    }
  };
  const workers = Math.min(MAX_CONCURRENT_TRANSCODES, sources.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

export interface ResolveProxyOptions {
  priority?: boolean;
  signal?: AbortSignal;
}

function joinJob(promise: Promise<string>, job: ProxyJob, signal?: AbortSignal): Promise<string> {
  job.callers++;
  if (!signal) return promise;
  return new Promise((resolveJoin, rejectJoin) => {
    const onAbort = (): void => {
      leave(job);
      rejectJoin(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .finally(() => signal.removeEventListener("abort", onAbort))
      .then(resolveJoin, rejectJoin);
  });
}
