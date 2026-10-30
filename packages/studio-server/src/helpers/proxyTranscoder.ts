import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir, totalmem } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { hdrToSdrToneMapFilter, type PreviewProxyBox } from "@hyperframes/core";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { alphaDecoderFor } from "@hyperframes/parsers/media-alpha";
import { ffmpegHasHdrFilters } from "./hdrFilters.js";
import { probeFirstFrameColour, probeMediaMetadata } from "./mediaMetadata.js";
import { cleanupProxyCache } from "./proxyCache.js";
import {
  contentCopyKey,
  contentIndexPath,
  fastCopyKey,
  fastIndexPath,
  readCopyIndex,
  sourceSizeBytes,
  writeCopyIndex,
} from "./proxyCacheKey.js";
import { acquireCopyLock } from "./proxyLock.js";
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

export const PROXY_PARAMS_VERSION = "v7";

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
/** A copy that makes no progress this long is ended: a hung encode, not a slow one. */
export const TRANSCODE_STALL_MS = boundedEnvInteger(
  "HYPERFRAMES_PROXY_STALL_MS",
  3 * 60 * 1000,
  10_000,
  60 * 60 * 1000,
);
/** A longer source is copied in pieces this long; a stopped copy keeps its finished pieces and loses at most one. */
export const PROXY_CHUNK_SECONDS = 15;
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
 * A copy is found by its source's place and time at no cost; when that misses, by the whole file's hash, once,
 * and an index file makes the next lookup free. A params version invalidates every copy when the recipe changes.
 */
type CanonicalProxySource = {
  projectDir: string;
  sourcePath: string;
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
  return { projectDir: realProjectRoot(projectDir), sourcePath: realpath(absoluteSourcePath) };
}

/** The copy for this source: the one at its fast name, the one its fast index names, or where a new one goes. */
function getCanonicalProxyCachePath(
  source: CanonicalProxySource,
  variant: ProxyVariant,
  box?: PreviewProxyBox,
): string {
  const key = fastCopyKey(source.sourcePath, PROXY_PARAMS_VERSION, variant, box);
  const made = join(
    source.projectDir,
    CACHE_DIR_NAME,
    `${key}${PROXY_VARIANT_CONFIG[variant].extension}`,
  );
  return existsSync(made) ? made : (readCopyIndex(fastIndexPath(made)) ?? made);
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
  progress: Set<(progress: ProxyProgress) => void>;
  lastProgress?: ProxyProgress;
}

/** How far a copy has got: seconds of the source done, out of its length when that is known. */
export interface ProxyProgress {
  doneSeconds: number;
  totalSeconds?: number;
}

function reportProgress(job: ProxyJob, progress: ProxyProgress): void {
  job.lastProgress = progress;
  for (const listener of job.progress) listener(progress);
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
  if (job.priority) waitQueue.unshift(job);
  else waitQueue.push(job);
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

async function ensureHdrFilters(ffmpegPath: string): Promise<void> {
  if (!(await ffmpegHasHdrFilters(ffmpegPath))) throw new FfmpegMissingFilterError();
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
function proxyScaleSize(box?: PreviewProxyBox): { width: string; height: string } {
  if (!box) return { width: "trunc(iw/2)*2", height: "trunc(ih/2)*2" };
  const factor = `min(1\\,max(${box.width}/iw\\,${box.height}/ih))`;
  const side = (d: string) => `min(trunc(${d}/2)*2\\,ceil(${d}*${factor}/2)*2)`;
  return { width: side("iw"), height: side("ih") };
}

function proxyScaleFilter(box?: PreviewProxyBox): string {
  const { width, height } = proxyScaleSize(box);
  return `scale=${width}:${height}`;
}

const STDERR_ERROR_LINE = /error|invalid|denied|no space|not found|unknown/i;

const OPEN_OUTPUT_LINE = /^Error opening output file /;
const ABSOLUTE_PATH = /(?:[A-Za-z]:)?(?:[\\/][^\\/\s'"]+){2,}/g;
const REASON_LINES = 3;

/** ffmpeg ends most failures with "Conversion failed!"; its causes are the last few error-looking lines above it,
 * and the line before "Error opening output file" names why the output could not open. Paths are dropped. */
function stderrReason(stderrTail: string, knownPaths: string[]): string {
  const lines = stderrTail
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const openedAt = lines.map((candidate) => OPEN_OUTPUT_LINE.test(candidate)).lastIndexOf(true);
  const causes = lines.filter(
    (line, index) =>
      !OPEN_OUTPUT_LINE.test(line) && (STDERR_ERROR_LINE.test(line) || index === openedAt - 1),
  );
  const shown = (causes.length ? causes : lines.slice(-1)).slice(-REASON_LINES);
  const byLength = knownPaths.filter(isAbsolute).sort((a, b) => b.length - a.length);
  const reason = shown.map((line) =>
    byLength
      .reduce((text, path) => text.split(path).join("<path>"), line)
      .replace(ABSOLUTE_PATH, "<path>")
      .replace(/[.!]+$/, ""),
  );
  return reason.length ? `: ${reason.join("; ")}` : "";
}

export type SourceFolderKind = "icloud" | "cloud-storage" | "external-volume" | "local";

const CLOUD_FOLDER = /\/(?:Library\/CloudStorage|Dropbox|OneDrive|Google Drive)(?:[ \-/]|$)/i;

/** Where a source lives, in the terms that decide whether its file can be read and written normally. */
export function sourceFolderKind(sourcePath: string): SourceFolderKind {
  const path = sourcePath.replace(/\\/g, "/");
  if (path.includes("/Library/Mobile Documents/")) return "icloud";
  if (CLOUD_FOLDER.test(path)) return "cloud-storage";
  return path.startsWith("/Volumes/") ? "external-volume" : "local";
}

/** What a failure report needs about the source, without its name or folder. */
function describeSource(
  sourcePath: string,
  metadata: Awaited<ReturnType<typeof probeMediaMetadata>>,
): string {
  const { codecName, pixelFormat, colorTransfer } = metadata.color;
  const megabytes = sourceSizeBytes(sourcePath);
  return [
    metadata.kind,
    codecName,
    pixelFormat,
    colorTransfer,
    metadata.hasAudio ? "with audio" : "no audio",
    metadata.streams?.length ? `streams ${metadata.streams.join(" ")}` : undefined,
    metadata.durationSeconds ? `${Math.round(metadata.durationSeconds)}s` : undefined,
    megabytes === undefined ? "missing" : `${Math.round(megabytes / 1e6)} MB`,
    sourceFolderKind(sourcePath),
  ]
    .filter(Boolean)
    .join(", ");
}

/** A copy's failure message ends with the source it was made from; other errors pass through. */
function withSource(err: unknown, describe: () => string): unknown {
  if (err instanceof ProxyTranscodeError && err.name === "ProxyTranscodeError") {
    return new ProxyTranscodeError(
      `${err.message} (source: ${describe()})`,
      err.exitCode,
      err.stderrTail,
    );
  }
  return err;
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

type EncodeFn = (
  outputPath: string,
  range: ChunkRange | undefined,
  signal: AbortSignal,
  onEncoded: (encodedSeconds: number) => void,
) => Promise<void>;

interface PieceGate {
  size: number;
  acquire: (signal: AbortSignal) => Promise<void>;
  release: () => void;
}

const UNGATED: PieceGate = { size: 1, acquire: async () => {}, release: () => {} };

/** Every alpha copy draws its pieces from this one pool, so two copies together stay within the cap. */
function createPieceGate(size: number): PieceGate {
  let free = size;
  const waiters: Array<() => void> = [];
  return {
    size,
    acquire: (signal) => {
      signal.throwIfAborted();
      if (free > 0) {
        free--;
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const grant = (): void => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        };
        const onAbort = (): void => {
          waiters.splice(waiters.indexOf(grant), 1);
          reject(signal.reason);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        waiters.push(grant);
      });
    },
    release: () => {
      const next = waiters.shift();
      if (next) next();
      else free++;
    },
  };
}

/** Copies a long source in pieces that stay in the cache, so a stopped copy continues from the first missing one. */
async function encodeInChunks(
  ranges: ChunkRange[],
  chunkPrefix: string,
  tempPath: string,
  encode: EncodeFn,
  concat: (listPath: string, target: string) => Promise<void>,
  signal: AbortSignal,
  gate: PieceGate,
  onDone: (doneSeconds: number) => void = () => {},
): Promise<void> {
  const extension = extname(tempPath);
  const pieces = ranges.map((_, index) => `${chunkPrefix}${index}${extension}`);
  const pending = ranges.flatMap((_, index) => (existsSync(pieces[index]!) ? [] : [index]));
  let doneSeconds = 0;
  for (const [index, range] of ranges.entries()) {
    if (!pending.includes(index)) doneSeconds += range.lengthSeconds;
  }
  if (doneSeconds) onDone(doneSeconds);
  const inFlight = new Map<number, number>();
  const stop = new AbortController();
  const pieceSignal = AbortSignal.any([signal, stop.signal]);
  let failure: unknown;
  let cursor = 0;
  const work = async (): Promise<void> => {
    for (;;) {
      await gate.acquire(pieceSignal);
      try {
        if (cursor >= pending.length) return;
        const index = pending[cursor++]!;
        const range = ranges[index]!;
        const piece = pieces[index]!;
        const pieceTemp = join(dirname(piece), `.tmp-${randomUUID()}-${basename(piece)}`);
        try {
          await encode(pieceTemp, range, pieceSignal, (encodedSeconds) => {
            inFlight.set(index, encodedSeconds);
            onDone(doneSeconds + [...inFlight.values()].reduce((sum, seconds) => sum + seconds, 0));
          });
          renameSync(pieceTemp, piece);
          inFlight.delete(index);
          doneSeconds += range.lengthSeconds;
          onDone(doneSeconds);
        } finally {
          if (existsSync(pieceTemp)) unlinkSync(pieceTemp);
        }
      } finally {
        gate.release();
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(gate.size, pending.length) }, () =>
      work().catch((error: unknown) => {
        failure ??= error;
        stop.abort();
      }),
    ),
  );
  if (failure !== undefined) throw failure;
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

const KEYFRAME_EVERY_SECOND_ARGS = ["-force_key_frames", "expr:gte(t,n_forced*1)"];
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
const CORES = availableParallelism();
const PIECE_MEMORY_BYTES = 3 * 1024 ** 3;

/** One core stays free for the editor; a 4K piece holds ~1.2 GB, so the copies stay within a third of RAM. */
const ALPHA_PIECE_GATE = createPieceGate(
  Math.max(1, Math.min(4, CORES - 1, Math.floor(totalmem() / PIECE_MEMORY_BYTES))),
);
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
        hdrToSdrToneMapFilter(metadata.color, firstFrame, box && proxyScaleSize(box)),
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
  onProgress: (progress: ProxyProgress) => void,
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
  const streamArgs = [
    ...["-map", "0:V:0"],
    ...(metadata.audioStream === undefined ? [] : ["-map", `0:a:${metadata.audioStream}`]),
  ];
  const totalSeconds = metadata.durationSeconds;
  // libvpx scales poorly across threads, so alpha pieces run side by side with the cores shared out.
  const gate = keepsAlpha ? ALPHA_PIECE_GATE : UNGATED;
  const vp8Threads = (pieces: number) => [
    "-threads",
    String(Math.min(4, Math.floor(CORES / pieces))),
  ];
  const encode: EncodeFn = (target, range, pieceSignal, onEncoded) =>
    spawnFfmpeg(
      ffmpegPath,
      [
        "-y",
        "-progress",
        "pipe:1",
        "-nostats",
        ...(range ? ["-ss", String(range.startSeconds)] : []),
        ...decoderArgs,
        "-i",
        sourcePath,
        ...streamArgs,
        ...(range ? ["-t", String(range.lengthSeconds)] : []),
        "-vf",
        videoFilter,
        ...KEYFRAME_EVERY_SECOND_ARGS,
        ...(keepsAlpha ? [...VP8_ARGS, ...vp8Threads(range ? gate.size : 1)] : H264_ARGS),
        target,
      ],
      TRANSCODE_STALL_MS,
      pieceSignal,
      onEncoded,
    );
  const ranges = chunkRanges(totalSeconds);
  try {
    if (!ranges) {
      return await encode(outputPath, undefined, signal, (encodedSeconds) =>
        onProgress({ doneSeconds: encodedSeconds, totalSeconds }),
      );
    }
    await encodeInChunks(
      ranges,
      chunkPrefix,
      outputPath,
      encode,
      (listPath, target) =>
        spawnFfmpeg(ffmpegPath, concatArgs(listPath, target, variant), CONCAT_TIMEOUT_MS, signal),
      signal,
      gate,
      (doneSeconds) => onProgress({ doneSeconds, totalSeconds }),
    );
  } catch (err) {
    throw withSource(err, () => describeSource(sourcePath, metadata));
  }
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

/** ffmpeg's `-progress` lines name the output time reached, in microseconds. */
const OUT_TIME = /^out_time_(?:us|ms)=(\d+)$/;

/** Runs ffmpeg and ends it when it makes no progress for `stallMs`; a slow encode that moves on is left to finish.
 * `onProgress` hears the seconds of output made so far (from `-progress pipe:1`). */
function spawnFfmpeg(
  ffmpegPath: string,
  args: string[],
  stallMs: number,
  signal: AbortSignal,
  onProgress?: (encodedSeconds: number) => void,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    signal.throwIfAborted();
    const proc = spawn(ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      killSignal: "SIGKILL",
      signal,
      windowsHide: true,
    });
    let stalled = false;
    let timer: NodeJS.Timeout | undefined;
    const armStall = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        proc.kill("SIGKILL");
      }, stallMs);
      timer.unref();
    };
    armStall();
    let furthest = 0;
    let lineTail = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      const lines = (lineTail + chunk.toString()).split("\n");
      lineTail = lines.pop() ?? "";
      for (const line of lines) {
        const reached = OUT_TIME.exec(line.trim());
        if (!reached) continue;
        const seconds = Number(reached[1]) / 1e6;
        if (seconds <= furthest) continue;
        furthest = seconds;
        armStall();
        onProgress?.(seconds);
      }
    });
    let stderrTail = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_MAX_CHARS);
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      if (signal.aborted) return;
      reject(new FfmpegUnavailableError(`failed to spawn ffmpeg: ${err.message}`, stderrTail));
    });
    proc.on("close", (code, killedBy) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise();
      } else if (stalled) {
        reject(
          new ProxyTranscodeError(
            `ffmpeg made no progress for ${Math.round(stallMs / 1000)}s and was ended; finished pieces are kept for the next attempt`,
            null,
            stderrTail,
          ),
        );
      } else if (killedBy) {
        reject(
          new ProxyTranscodeError(`ffmpeg killed by ${killedBy} (external kill)`, null, stderrTail),
        );
      } else {
        reject(
          new ProxyTranscodeError(
            `ffmpeg exited with code ${code}${stderrReason(stderrTail, args)}`,
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
    const contentIndex = contentIndexPath(
      cacheDir,
      await contentCopyKey(
        absoluteSourcePath,
        PROXY_PARAMS_VERSION,
        variant,
        box,
        job.abandoned.signal,
      ),
    );
    const sameContent = readCopyIndex(contentIndex);
    if (sameContent) {
      writeCopyIndex(fastIndexPath(cachePath), sameContent);
      return sameContent;
    }
    const release = await acquireCopyLock(cachePath, job.abandoned.signal);
    if (!release) return cachePath;
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
        (progress) => reportProgress(job, progress),
      );
      renameSync(tempPath, cachePath);
      writeCopyIndex(contentIndex, cachePath);
      maintainProxyCache(cacheDir);
      return cachePath;
    } finally {
      // No partial files: if anything above threw, remove whatever ffmpeg
      // may have partially written under the temp name.
      if (existsSync(tempPath)) unlinkSync(tempPath);
      release();
    }
  } finally {
    releaseSlot();
  }
}

export function proxyCopyProgress(
  projectDir: string,
  absoluteSourcePath: string,
  variant: ProxyVariant,
  box?: PreviewProxyBox,
): number | undefined {
  const source = canonicalizeProxySource(projectDir, absoluteSourcePath);
  const progress = inFlight.get(getCanonicalProxyCachePath(source, variant, box))?.job.lastProgress;
  return progress?.totalSeconds
    ? Math.min(1, progress.doneSeconds / progress.totalSeconds)
    : undefined;
}

export function retryProxyCopy(
  projectDir: string,
  absoluteSourcePath: string,
  variant: ProxyVariant,
  box?: PreviewProxyBox,
): void {
  const source = canonicalizeProxySource(projectDir, absoluteSourcePath);
  failedTranscodes.delete(getCanonicalProxyCachePath(source, variant, box));
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
      progress: new Set(),
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
  const listener = options.onProgress;
  const joined = joinJob(entry.promise, entry.job, options.signal);
  if (listener) {
    entry.job.progress.add(listener);
    if (entry.job.lastProgress) listener(entry.job.lastProgress);
    const stop = (): void => void entry.job.progress.delete(listener);
    joined.then(stop, stop);
  }
  return joined;
}

/** Batch resolve for check and publish: at most MAX_CONCURRENT_TRANSCODES of its own requests in
 * flight (other callers can still fill the queue). A copy is ended only when it stops making
 * progress (TRANSCODE_STALL_MS), so a long source that keeps moving is never cut by a clock. */
export async function resolveProxies(
  projectDir: string,
  sources: ReadonlyArray<{ sourcePath: string; variant: ProxyVariant; box?: PreviewProxyBox }>,
  onSettled: (index: number) => void = () => {},
  onProgress: (index: number, progress: ProxyProgress) => void = () => {},
  signal?: AbortSignal,
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
      results[index] = await resolveProxy(projectDir, sourcePath, variant, box, {
        onProgress: (progress) => onProgress(index, progress),
        signal,
      }).then(
        (value) => ({ status: "fulfilled", value }),
        (reason: unknown) => ({ status: "rejected", reason }),
      );
      onSettled(index);
    }
  };
  const workers = Math.min(MAX_CONCURRENT_TRANSCODES, sources.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

export interface ResolveProxyOptions {
  priority?: boolean;
  signal?: AbortSignal;
  /** Hears how far the shared copy has got, from the first caller's start to the copy's end. */
  onProgress?: (progress: ProxyProgress) => void;
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
