import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { utimes } from "node:fs/promises";
import os, { availableParallelism, totalmem } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { hdrToSdrToneMapFilter, type PreviewProxyBox } from "@hyperframes/core";
import { previewToken } from "@hyperframes/core/preview-proof";
import {
  concatListInputArgs,
  concatListText,
  findFfBinary,
  followFfmpegProgress,
  localContainerInputArgs,
} from "@hyperframes/parsers/ff-binaries";
import { alphaDecoderFor } from "@hyperframes/parsers/media-alpha";
import { ffmpegHasHdrFilters } from "./hdrFilters.js";
import { mediaInputArgs, NOT_MEDIA } from "./mediaExtensions.js";
import { type MediaMetadata, probeFirstFrameColour, probeMediaMetadata } from "./mediaMetadata.js";
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
import { acquireCopyLock, CopyLockStalledError } from "./proxyLock.js";
import { PROXY_STILL_EXTENSION, PROXY_VARIANT_CONFIG, type ProxyVariant } from "./mediaCodecMap.js";
import {
  isProjectCacheFile,
  isProjectCacheFileAsync,
  mkdirWithinProject,
  realpathOff,
  realProjectRootAsync,
} from "./safePath.js";

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
const STILL_ENCODING = "jpeg-matrix";

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
const BACKGROUND_NICENESS = 19;
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
// Without a preview token, pieces are reused only within this process.
const UNSIGNED_PIECE_SECRET = randomBytes(32).toString("hex");
let warnedNoPieceToken = false;

function pieceSecret(): string {
  const token = previewToken();
  if (token) return token;
  if (!warnedNoPieceToken) {
    warnedNoPieceToken = true;
    console.warn(
      "[media-proxy] no preview token could be read, so a stopped copy restarts from its first piece after Studio restarts",
    );
  }
  return UNSIGNED_PIECE_SECRET;
}

function unguessablePiecePrefix(cacheDir: string, stem: string): string {
  const tag = createHmac("sha256", pieceSecret())
    .update(`proxy-picture-piece\n${stem}`)
    .digest("hex")
    .slice(0, 32);
  return join(cacheDir, `${CHUNK_PREFIX}${stem}-${tag}-`);
}

const CONCAT_TIMEOUT_MS = 2 * 60 * 1000;
// On POSIX a folder name can hold a line break that would start a new list line; on Windows the working folder is part of the DLL search, so the cwd stays default there.
const JOIN_FROM_CACHE_FOLDER = process.platform !== "win32";
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

export class StillPastEndError extends ProxyTranscodeError {
  constructor() {
    super("media still is past the end of the source", null, "");
    this.name = "StillPastEndError";
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

async function canonicalizeProxySource(
  projectDir: string,
  absoluteSourcePath: string,
): Promise<CanonicalProxySource> {
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
  const [real, sourcePath] = await Promise.all([
    realProjectRootAsync(projectDir),
    realpathOff(absoluteSourcePath),
  ]);
  return { projectDir: real, sourcePath };
}

/** The copy for this source: the one at its fast name, the one its fast index names, or where a new one goes. */
async function getCanonicalProxyCachePath(
  source: CanonicalProxySource,
  variant: ProxyVariant,
  box?: PreviewProxyBox,
  limitSeconds?: number,
): Promise<string> {
  const key = await fastCopyKey(
    source.sourcePath,
    PROXY_PARAMS_VERSION,
    keyVariant(variant, limitSeconds),
    box,
  );
  const made = join(
    source.projectDir,
    CACHE_DIR_NAME,
    `${key}${PROXY_VARIANT_CONFIG[variant].extension}`,
  );
  return (await isProjectCacheFileAsync(source.projectDir, made))
    ? made
    : ((await readCopyIndex(source.projectDir, fastIndexPath(made))) ?? made);
}

/**
 * Computes the absolute path a proxy for this source would live at, without
 * transcoding anything, so a host can check cache state. Pass the request's
 * preview box (`hf-proxy-box`) to name a boxed copy.
 */
export async function getProxyCachePath(
  projectDir: string,
  absoluteSourcePath: string,
  variant: ProxyVariant = "h264",
  box?: PreviewProxyBox,
  limitSeconds?: number,
): Promise<string> {
  return getCanonicalProxyCachePath(
    await canonicalizeProxySource(projectDir, absoluteSourcePath),
    variant,
    box,
    limitSeconds,
  );
}

function copiedSeconds(duration: number | undefined, limitSeconds: number | undefined) {
  return limitSeconds === undefined ? duration : Math.min(limitSeconds, duration ?? limitSeconds);
}

function lengthArgs(seconds: number | undefined): string[] {
  return seconds === undefined ? [] : ["-t", String(seconds)];
}

function keyVariant(variant: ProxyVariant, limitSeconds: number | undefined): string {
  return limitSeconds === undefined ? variant : `${variant}@${limitSeconds}s`;
}

export async function proxyWindowSeconds(
  absoluteSourcePath: string,
  neededSeconds: number,
): Promise<number | undefined> {
  const { durationSeconds } = await probeMediaMetadata(absoluteSourcePath);
  const window = Math.ceil((neededSeconds + 1) / PROXY_CHUNK_SECONDS) * PROXY_CHUNK_SECONDS;
  return durationSeconds && window + PROXY_CHUNK_SECONDS <= durationSeconds ? window : undefined;
}

// --- global concurrency limiter -------------------------------------------
// ponytail: counters + one wait queue are the whole semaphore. Priority copies (the one a viewer waits on) queue
// ahead and are never refused; while none runs, one starts past the cap, so other copies cannot starve it.

/** One copy per cache key, shared by every caller asking for it. */
interface ProxyJob {
  cachePath: string;
  priority: boolean;
  background: boolean;
  /** Callers still waiting; one without a signal never leaves, so its copy is always made. */
  callers: number;
  /** Set while the job waits for a slot. */
  queued?: { start: () => void; drop: () => void };
  holdsPrioritySlot?: boolean;
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
let activePriority = 0;
const waitQueue: ProxyJob[] = [];

const hasRoom = (job: ProxyJob) =>
  activeTranscodes < MAX_CONCURRENT_TRANSCODES || (job.priority && activePriority === 0);

function takeSlot(job: ProxyJob): void {
  activeTranscodes++;
  job.holdsPrioritySlot = job.priority;
  if (job.priority) activePriority++;
}

function startWaiting(): void {
  while (waitQueue[0] && hasRoom(waitQueue[0])) waitQueue.shift()?.queued?.start();
}

function enqueue(job: ProxyJob): void {
  if (job.priority) waitQueue.unshift(job);
  else waitQueue.push(job);
}

function dequeue(job: ProxyJob): void {
  const index = waitQueue.indexOf(job);
  if (index !== -1) waitQueue.splice(index, 1);
}

function acquireSlot(job: ProxyJob): Promise<void> {
  if (hasRoom(job)) {
    takeSlot(job);
    return Promise.resolve();
  }
  return new Promise((resolveSlot, reject) => {
    job.queued = {
      start: () => {
        job.queued = undefined;
        takeSlot(job);
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

function releaseSlot(job: ProxyJob): void {
  activeTranscodes--;
  if (job.holdsPrioritySlot) activePriority--;
  startWaiting();
}

function prioritize(job: ProxyJob): void {
  job.priority = true;
  if (!job.queued) return;
  dequeue(job);
  enqueue(job);
  startWaiting();
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

function maintainProxyCache(cacheDir: string, staleTempMs?: number, justServed?: string): void {
  const protectedPaths = new Set([...inFlight.keys(), ...stillsInFlight.keys()]);
  if (justServed) protectedPaths.add(justServed);
  try {
    cleanupProxyCache(cacheDir, { protectedPaths, staleTempMs });
  } catch (error) {
    // Cache maintenance must never turn a playable preview into an error.
    console.warn(
      `[media-proxy] cache cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function servedFromCache(cachePath: string): string {
  const now = new Date();
  // expected: a concurrent cleanup may have removed the entry; the next request's miss path recreates it
  void utimes(cachePath, now, now).catch(() => undefined);
  maintainProxyCache(dirname(cachePath), undefined, cachePath);
  return cachePath;
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

type ChunkFiles = { projectDir: string; prefix: string };

/** Copies a long source in pieces that stay in the cache, so a stopped copy continues from the first missing one. */
async function encodeInChunks(
  ranges: ChunkRange[],
  chunks: ChunkFiles,
  tempPath: string,
  encode: EncodeFn,
  concat: (listPath: string, target: string) => Promise<void>,
  signal: AbortSignal,
  gate: PieceGate,
  isWhole: (piece: string, range: ChunkRange) => Promise<boolean>,
  onDone: (doneSeconds: number) => void = () => {},
): Promise<void> {
  const extension = extname(tempPath);
  const pieces = ranges.map((_, index) => `${chunks.prefix}${index}${extension}`);
  const madeAsPlainFile = (piece: string) => isProjectCacheFile(chunks.projectDir, piece);
  const kept = await keptPieces(pieces, ranges, signal, (piece, range) =>
    madeAsPlainFile(piece) ? isWhole(piece, range) : Promise.resolve(false),
  );
  const pending = ranges.flatMap((_, index) => (kept[index] ? [] : [index]));
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
  const listPath = join(dirname(tempPath), `${basename(tempPath, extension)}.txt`);
  try {
    writeFileSync(
      listPath,
      concatListText(
        pieces.map((piece, index) => ({
          path: JOIN_FROM_CACHE_FOLDER ? basename(piece) : piece.replace(/\\/g, "/"),
          durationSeconds: ranges[index]!.lengthSeconds,
        })),
      ),
    );
    await concat(listPath, tempPath);
  } catch (error) {
    if (signal.aborted) throw error;
    removeAll(pieces);
    if (pending.length === ranges.length) throw error;
    return await encodeInChunks(
      ranges,
      chunks,
      tempPath,
      encode,
      concat,
      signal,
      gate,
      isWhole,
      onDone,
    );
  } finally {
    rmSync(listPath, { force: true });
  }
  removeAll(pieces);
}

// A piece left by an earlier run is made again if it runs short; if the join refuses one, all are.
async function stillWhole(
  piece: string,
  range: ChunkRange,
  frameRate: number | undefined,
  signal: AbortSignal,
): Promise<boolean> {
  const seconds = (await probeMediaMetadata(piece, undefined, signal)).durationSeconds;
  const halfFrame = frameRate ? 0.5 / frameRate : 0;
  return seconds !== undefined && seconds >= range.lengthSeconds - halfFrame;
}

async function keptPieces(
  pieces: string[],
  ranges: ChunkRange[],
  signal: AbortSignal,
  keep: (piece: string, range: ChunkRange) => Promise<boolean>,
): Promise<boolean[]> {
  const kept: boolean[] = [];
  for (const [index, range] of ranges.entries()) {
    signal.throwIfAborted();
    kept.push(await keep(pieces[index]!, range));
  }
  signal.throwIfAborted();
  return kept;
}

const removeAll = (paths: string[]) => {
  for (const path of paths) if (existsSync(path)) unlinkSync(path);
};

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
  const firstFrame = toneMap
    ? await probeFirstFrameColour(sourcePath, metadata.color.codecName)
    : {};
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
  chunks: ChunkFiles,
  variant: ProxyVariant,
  box: PreviewProxyBox | undefined,
  limitSeconds: number | undefined,
  signal: AbortSignal,
  onProgress: (progress: ProxyProgress) => void,
  isBackground: () => boolean = () => false,
): Promise<void> {
  const metadata = await probeMediaMetadata(sourcePath);
  if (metadata.probeError === NOT_MEDIA) throw new ProxyTranscodeError(NOT_MEDIA, null, "");
  const ffmpegPath = findFfBinary("ffmpeg", { configuredMustExist: true });
  if (!ffmpegPath) {
    throw new FfmpegUnavailableError();
  }
  const keepsAlpha = variant === "vp8";
  const videoFilter = await buildVideoFilter(ffmpegPath, sourcePath, metadata, keepsAlpha, box);
  const alphaDecoder = keepsAlpha ? alphaDecoderFor(metadata.color.codecName) : null;
  const decoderArgs = alphaDecoder ? ["-c:v", alphaDecoder] : [];
  const soundMap =
    metadata.audioStream === undefined ? [] : ["-map", `0:a:${metadata.audioStream}`];
  const totalSeconds = copiedSeconds(metadata.durationSeconds, limitSeconds);
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
        ...mediaInputArgs(sourcePath),
        "-i",
        sourcePath,
        ...["-map", "0:V:0"],
        ...(range ? [] : soundMap),
        ...lengthArgs(range?.lengthSeconds ?? limitSeconds),
        "-vf",
        videoFilter,
        ...KEYFRAME_EVERY_SECOND_ARGS,
        ...(keepsAlpha ? [...VP8_ARGS, ...vp8Threads(range ? gate.size : 1)] : H264_ARGS),
        target,
      ],
      TRANSCODE_STALL_MS,
      pieceSignal,
      onEncoded,
      isBackground(),
    );
  const ranges = chunkRanges(totalSeconds);
  try {
    if (!ranges) {
      return await encode(outputPath, undefined, signal, (encodedSeconds) =>
        onProgress({ doneSeconds: encodedSeconds, totalSeconds }),
      );
    }
    await copyInPieces(ranges, outputPath, {
      ffmpegPath,
      sourcePath,
      soundMap,
      variant,
      limitSeconds,
      signal,
      gate,
      chunks,
      encode,
      source: metadata.source,
      onDone: (doneSeconds) => onProgress({ doneSeconds, totalSeconds }),
    });
  } catch (err) {
    throw withSource(err, () => describeSource(sourcePath, metadata));
  }
}

function besideAsTemp(path: string, extension = extname(path)): string {
  const copyName = basename(path, extname(path)).replace(/^\.tmp-[0-9a-f-]{36}-/, "");
  return join(dirname(path), `.tmp-${randomUUID()}-${copyName}${extension}`);
}

type PieceCopy = {
  ffmpegPath: string;
  sourcePath: string;
  soundMap: string[];
  variant: ProxyVariant;
  limitSeconds: number | undefined;
  signal: AbortSignal;
  gate: PieceGate;
  chunks: ChunkFiles;
  encode: EncodeFn;
  source: MediaMetadata["source"];
  onDone: (doneSeconds: number) => void;
};

async function copyInPieces(ranges: ChunkRange[], outputPath: string, copy: PieceCopy) {
  const withSound = copy.soundMap.length > 0;
  const picturePath = withSound ? besideAsTemp(outputPath) : outputPath;
  try {
    await encodeInChunks(
      ranges,
      copy.chunks,
      picturePath,
      copy.encode,
      (listPath, target) => {
        // ffmpeg resolves relative list entries against the list path, which breaks on '#' or '?' in a folder name.
        const cwd = JOIN_FROM_CACHE_FOLDER ? dirname(listPath) : undefined;
        return spawnFfmpeg(
          copy.ffmpegPath,
          concatArgs(cwd ? basename(listPath) : listPath, target, copy.variant),
          CONCAT_TIMEOUT_MS,
          copy.signal,
          undefined,
          false,
          cwd,
        );
      },
      copy.signal,
      copy.gate,
      (piece, range) => stillWhole(piece, range, copy.source?.frameRate, copy.signal),
      copy.onDone,
    );
    if (withSound) await addSoundFromSource(copy, picturePath, outputPath);
  } finally {
    if (withSound) rmSync(picturePath, { force: true });
  }
}

async function addSoundFromSource(
  { ffmpegPath, sourcePath, soundMap, variant, limitSeconds, signal }: PieceCopy,
  picturePath: string,
  outputPath: string,
): Promise<void> {
  const keepsAlpha = variant === "vp8";
  const soundPath = besideAsTemp(outputPath, keepsAlpha ? ".webm" : ".m4a");
  const container = keepsAlpha ? "matroska" : "mov";
  try {
    await spawnFfmpeg(
      ffmpegPath,
      [
        ...["-y", "-progress", "pipe:1", "-nostats"],
        ...mediaInputArgs(sourcePath),
        ...["-i", sourcePath, ...soundMap],
        ...lengthArgs(limitSeconds),
        ...(keepsAlpha ? ["-ac", "2", "-c:a", "libopus"] : ["-c:a", "aac"]),
        soundPath,
      ],
      TRANSCODE_STALL_MS,
      signal,
    );
    await spawnFfmpeg(
      ffmpegPath,
      [
        ...["-y", "-copyts"],
        ...[...localContainerInputArgs(container), "-i", picturePath],
        ...[...localContainerInputArgs(container), "-i", soundPath],
        ...["-map", "0:v:0", "-map", "1:a:0", "-c", "copy"],
        ...(keepsAlpha ? [] : ["-movflags", "+faststart"]),
        outputPath,
      ],
      CONCAT_TIMEOUT_MS,
      signal,
    );
  } finally {
    rmSync(soundPath, { force: true });
  }
}

function concatArgs(listPath: string, target: string, variant: ProxyVariant): string[] {
  return [
    "-y",
    "-copyts",
    ...concatListInputArgs(listPath),
    "-c",
    "copy",
    ...(variant === "h264" ? ["-movflags", "+faststart"] : []),
    target,
  ];
}

/** Runs ffmpeg and ends it when it makes no progress for `stallMs`; a slow encode that moves on is left to finish.
 * `onProgress` hears the seconds of output made so far (from `-progress pipe:1`). */
function lowerPriorityUnlessExited(pid: number): void {
  try {
    os.setPriority(pid, BACKGROUND_NICENESS);
  } catch {
    return;
  }
}

function spawnFfmpeg(
  ffmpegPath: string,
  args: string[],
  stallMs: number,
  signal: AbortSignal,
  onProgress?: (encodedSeconds: number) => void,
  background = false,
  cwd?: string,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    signal.throwIfAborted();
    const proc = spawn(ffmpegPath, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      killSignal: "SIGKILL",
      signal,
      windowsHide: true,
    });
    if (background && proc.pid !== undefined) lowerPriorityUnlessExited(proc.pid);
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
    if (proc.stdout) {
      followFfmpegProgress(proc.stdout, (seconds) => {
        armStall();
        onProgress?.(seconds);
      });
    }
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
  limitSeconds: number | undefined,
): Promise<string> {
  await acquireSlot(job);
  try {
    // Another caller may have finished (or a pre-warm beat us) while queued.
    if (isProjectCacheFile(projectDir, cachePath)) return cachePath;

    const cacheDir = dirname(cachePath);
    mkdirWithinProject(projectDir, cacheDir);
    const contentIndex = contentIndexPath(
      cacheDir,
      await contentCopyKey(
        absoluteSourcePath,
        PROXY_PARAMS_VERSION,
        keyVariant(variant, limitSeconds),
        box,
        job.abandoned.signal,
      ),
    );
    const sameContent = await readCopyIndex(projectDir, contentIndex);
    if (sameContent) {
      writeCopyIndex(fastIndexPath(cachePath), sameContent);
      return sameContent;
    }
    const copyMade = (path: string) => isProjectCacheFile(projectDir, path);
    const chunks = {
      projectDir,
      prefix: unguessablePiecePrefix(cacheDir, basename(cachePath, extname(cachePath))),
    };
    const release = await acquireCopyLock(
      cachePath,
      copyMade,
      job.abandoned.signal,
      TRANSCODE_STALL_MS,
      basename(chunks.prefix),
    ).catch((error: unknown) => {
      throw error instanceof CopyLockStalledError
        ? new ProxyTranscodeError(error.message, null, "")
        : error;
    });
    if (!release) {
      if (copyMade(cachePath)) return cachePath;
      throw new ProxyTranscodeError("the copy is not a plain file in the cache", null, "");
    }
    const tempPath = join(cacheDir, `.tmp-${randomUUID()}-${basename(cachePath)}`);
    try {
      await runFfmpeg(
        absoluteSourcePath,
        tempPath,
        chunks,
        variant,
        box,
        limitSeconds,
        job.abandoned.signal,
        (progress) => reportProgress(job, progress),
        () => job.background && !job.priority,
      );
      renameSync(tempPath, cachePath);
      writeCopyIndex(contentIndex, cachePath);
      maintainProxyCache(cacheDir);
      return cachePath;
    } finally {
      // No partial files: if anything above threw, remove what ffmpeg wrote under the temp name.
      if (existsSync(tempPath)) unlinkSync(tempPath);
      release();
    }
  } finally {
    releaseSlot(job);
  }
}

export async function proxyCopyProgress(
  projectDir: string,
  absoluteSourcePath: string,
  variant: ProxyVariant,
  box?: PreviewProxyBox,
): Promise<number | undefined> {
  const source = await canonicalizeProxySource(projectDir, absoluteSourcePath);
  const progress = inFlight.get(await getCanonicalProxyCachePath(source, variant, box))?.job
    .lastProgress;
  return progress?.totalSeconds
    ? Math.min(1, progress.doneSeconds / progress.totalSeconds)
    : undefined;
}

export async function retryProxyCopy(
  projectDir: string,
  absoluteSourcePath: string,
  variant: ProxyVariant,
  box?: PreviewProxyBox,
): Promise<void> {
  const source = await canonicalizeProxySource(projectDir, absoluteSourcePath);
  failedTranscodes.delete(await getCanonicalProxyCachePath(source, variant, box));
}

let proxyActivity = 0;

/** Null while this project has a copy in progress; otherwise a mark that moves when any copy finishes or is refused. */
export async function proxyActivityMark(projectDir: string): Promise<string | null> {
  const real = await realpathOff(projectDir).catch(() => null);
  if (real === null) return String(proxyActivity);
  const cacheDir = join(real, CACHE_DIR_NAME) + sep;
  for (const cachePath of inFlight.keys()) if (cachePath.startsWith(cacheDir)) return null;
  return String(proxyActivity);
}

async function lookUpCopy(
  projectDir: string,
  absoluteSourcePath: string,
  variant: ProxyVariant,
  box: PreviewProxyBox | undefined,
  limitSeconds: number | undefined,
) {
  const source = await canonicalizeProxySource(projectDir, absoluteSourcePath);
  const cachePath = await getCanonicalProxyCachePath(source, variant, box, limitSeconds);
  return { source, cachePath, cached: await isProjectCacheFileAsync(source.projectDir, cachePath) };
}

const askOrder = new Map<string, Promise<unknown>>();

function reachQueueInAskOrder<T>(projectDir: string, looked: Promise<T>): Promise<T> {
  // A lookup can fail while an earlier one holds the turn; its caller still gets the error from `turn`.
  void looked.catch(() => undefined);
  const turn = (askOrder.get(projectDir) ?? Promise.resolve()).then(() => looked);
  const passed = turn.then(
    () => undefined,
    () => undefined,
  );
  askOrder.set(projectDir, passed);
  void passed.then(() => {
    if (askOrder.get(projectDir) === passed) askOrder.delete(projectDir);
  });
  return turn;
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
  const { source, cachePath, cached } = await reachQueueInAskOrder(
    projectDir,
    lookUpCopy(projectDir, absoluteSourcePath, variant, box, options.limitSeconds),
  );
  options.signal?.throwIfAborted();
  if (cached) {
    return servedFromCache(cachePath);
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
      background: options.background === true,
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
      options.limitSeconds,
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
  return options.waitMs === undefined ? joined : waitForProxy(joined, options.waitMs);
}

/** Batch resolve for check and publish: at most MAX_CONCURRENT_TRANSCODES of its own requests in
 * flight (other callers can still fill the queue). A copy is ended only when it stops making
 * progress (TRANSCODE_STALL_MS), so a long source that keeps moving is never cut by a clock. */
export async function resolveProxies(
  projectDir: string,
  sources: ReadonlyArray<{
    sourcePath: string;
    variant: ProxyVariant;
    box?: PreviewProxyBox;
    limitSeconds?: number;
  }>,
  onSettled: (index: number) => void = () => {},
  onProgress: (index: number, progress: ProxyProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<PromiseSettledResult<string>[]> {
  const first = sources[0];
  if (first) {
    maintainProxyCache(
      dirname(await getProxyCachePath(projectDir, first.sourcePath, first.variant)),
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
      const { sourcePath, variant, box, limitSeconds } = sources[index]!;
      results[index] = await resolveProxy(projectDir, sourcePath, variant, box, {
        limitSeconds,
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

interface StillJob {
  made: Promise<string>;
  /** Requests still waiting; one without a signal never leaves, so its still is always made. */
  waiters: number;
  abandoned: AbortController;
}

const stillsInFlight = new Map<string, StillJob>();

/** One JPEG of the source at a time (to a tenth of a second), sized like the copy's box. A
 * caller's `signal` detaches that caller; once no caller is left, the still's ffmpeg is ended. */
export async function resolveStill(
  projectDir: string,
  absoluteSourcePath: string,
  atSeconds: number,
  box?: PreviewProxyBox,
  startUncachedStill: (make: () => Promise<string>) => Promise<string> = (make) => make(),
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const source = await canonicalizeProxySource(projectDir, absoluteSourcePath);
  const at = Math.max(0, Math.floor(atSeconds * 10 + 1e-6) / 10);
  const key = await fastCopyKey(
    source.sourcePath,
    PROXY_PARAMS_VERSION,
    `still-${STILL_ENCODING}@${at}`,
    box,
  );
  const cachePath = join(source.projectDir, CACHE_DIR_NAME, `${key}${PROXY_STILL_EXTENSION}`);
  if (await isProjectCacheFileAsync(source.projectDir, cachePath)) {
    return servedFromCache(cachePath);
  }
  signal?.throwIfAborted();
  let job = stillsInFlight.get(cachePath);
  if (!job) {
    const abandoned = new AbortController();
    const made = startUncachedStill(() =>
      makeStill(source, at, box, cachePath, abandoned.signal),
    ).finally(() => forgetStill(cachePath, started));
    const started: StillJob = { made, waiters: 0, abandoned };
    stillsInFlight.set(cachePath, started);
    job = started;
  }
  return waitForStill(job, cachePath, signal);
}

function forgetStill(cachePath: string, job: StillJob): void {
  if (stillsInFlight.get(cachePath) === job) stillsInFlight.delete(cachePath);
}

function waitForStill(job: StillJob, cachePath: string, signal?: AbortSignal): Promise<string> {
  job.waiters++;
  if (!signal) return job.made;
  return new Promise((resolveWait, rejectWait) => {
    const leave = (): void => {
      rejectWait(signal.reason);
      if (--job.waiters > 0) return;
      forgetStill(cachePath, job);
      job.abandoned.abort();
    };
    signal.addEventListener("abort", leave, { once: true });
    job.made
      .finally(() => signal.removeEventListener("abort", leave))
      .then(resolveWait, rejectWait);
  });
}

const SD_MATRICES = new Set(["bt470bg", "smpte170m"]);
const browserMatrixOf = (colorSpace: string | undefined) =>
  SD_MATRICES.has(colorSpace ?? "") ? "bt470bg" : "bt709";

async function makeStill(
  source: CanonicalProxySource,
  at: number,
  box: PreviewProxyBox | undefined,
  cachePath: string,
  signal: AbortSignal,
): Promise<string> {
  const ffmpegPath = findFfBinary("ffmpeg", { configuredMustExist: true });
  if (!ffmpegPath) throw new FfmpegUnavailableError();
  const metadata = await probeMediaMetadata(source.sourcePath);
  if (metadata.probeError === NOT_MEDIA) throw new ProxyTranscodeError(NOT_MEDIA, null, "");
  if (metadata.durationSeconds !== undefined && at > metadata.durationSeconds) {
    throw new StillPastEndError();
  }
  const toJpegMatrix = `colorspace=all=bt709:iall=bt709:ispace=${browserMatrixOf(metadata.color.colorSpace)}:space=bt470bg`;
  const filter = `${await buildVideoFilter(ffmpegPath, source.sourcePath, metadata, false, box)},${toJpegMatrix}`;
  mkdirWithinProject(source.projectDir, dirname(cachePath));
  const tempPath = join(dirname(cachePath), `.tmp-${randomUUID()}-${basename(cachePath)}`);
  try {
    const args = [
      "-y",
      "-ss",
      String(at),
      ...mediaInputArgs(source.sourcePath),
      "-i",
      source.sourcePath,
      "-map",
      "0:V:0",
    ];
    args.push("-frames:v", "1", "-vf", filter, "-pix_fmt", "yuvj420p", "-q:v", "3", tempPath);
    await spawnFfmpeg(ffmpegPath, args, TRANSCODE_STALL_MS, signal);
    renameSync(tempPath, cachePath);
  } finally {
    rmSync(tempPath, { force: true });
  }
  maintainProxyCache(dirname(cachePath), undefined, cachePath);
  return cachePath;
}

export interface ResolveProxyOptions {
  limitSeconds?: number;
  /** How long this caller waits for a copy still being made (never for the lookup); then `ProxyWaitTimeoutError`. */
  waitMs?: number;
  priority?: boolean;
  background?: boolean;
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
