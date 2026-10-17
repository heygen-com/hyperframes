import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, renameSync, statSync, unlinkSync, utimesSync } from "node:fs";
import { constants as osConstants, setPriority } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  formatPreviewProxyBox,
  hdrToSdrToneMapFilter,
  type PreviewProxyBox,
} from "@hyperframes/core";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
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
 * A started ffmpeg child is never killed for one caller: every caller of a cache
 * key shares it. A caller's `signal` only detaches it; a larger box for the same
 * source stops a smaller copy outright (one copy per source, below).
 */

export const PROXY_PARAMS_VERSION = "v6";

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
const FAILURE_CACHE_TTL_MS = 60 * 1000;
export const PROXY_PENDING_RETRY_AFTER_SECONDS = 2;
const ENVIRONMENT_FAILURE_TTL_MS = 5 * PROXY_PENDING_RETRY_AFTER_SECONDS * 1000;
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

/** Names every copy of one source version and variant; a boxed copy adds `-WxH`. */
function buildProxySourceKey(source: CanonicalProxySource, variant: ProxyVariant): string {
  const stat = statSync(source.sourcePath);
  return createHash("sha256")
    .update(
      `${source.relativePath}\0${source.cacheIdentity}\0${stat.mtimeMs}\0${stat.size}\0${PROXY_PARAMS_VERSION}\0${variant}`,
    )
    .digest("hex");
}

function getCanonicalProxyCachePath(
  source: CanonicalProxySource,
  variant: ProxyVariant,
  box?: PreviewProxyBox,
): string {
  const key = buildProxySourceKey(source, variant);
  const size = box ? `-${formatPreviewProxyBox(box)}` : "";
  return join(
    source.projectDir,
    CACHE_DIR_NAME,
    `${key}${size}${PROXY_VARIANT_CONFIG[variant].extension}`,
  );
}

const covers = (a: PreviewProxyBox, b: PreviewProxyBox): boolean =>
  a.width >= b.width && a.height >= b.height;

const largerOf = (a: PreviewProxyBox, b: PreviewProxyBox): PreviewProxyBox => ({
  width: Math.max(a.width, b.width),
  height: Math.max(a.height, b.height),
});

/** This source's finished boxed copies, read from their names. */
function boxedCopies(
  source: CanonicalProxySource,
  variant: ProxyVariant,
): Array<{ path: string; box: PreviewProxyBox }> {
  const dir = join(source.projectDir, CACHE_DIR_NAME);
  const name = new RegExp(
    `^${buildProxySourceKey(source, variant)}-(\\d+)x(\\d+)\\${PROXY_VARIANT_CONFIG[variant].extension}$`,
  );
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const match = name.exec(entry);
    return match
      ? [{ path: join(dir, entry), box: { width: +match[1]!, height: +match[2]! } }]
      : [];
  });
}

/** The finished copy a request is served from: its own, else this source's larger copy. */
function finishedCopyFor(
  source: CanonicalProxySource,
  variant: ProxyVariant,
  box: PreviewProxyBox | undefined,
): string | null {
  const exact = getCanonicalProxyCachePath(source, variant, box);
  if (existsSync(exact)) return exact;
  if (!box) return null;
  return boxedCopies(source, variant).find((copy) => covers(copy.box, box))?.path ?? null;
}

/** This source's largest finished copy, whatever its size, or null while there is none. */
export function finishedProxyPath(
  projectDir: string,
  absoluteSourcePath: string,
  variant: ProxyVariant,
): string | null {
  const source = canonicalizeProxySource(projectDir, absoluteSourcePath);
  const sourceSize = getCanonicalProxyCachePath(source, variant);
  if (existsSync(sourceSize)) return sourceSize;
  const area = ({ box }: { box: PreviewProxyBox }) => box.width * box.height;
  return boxedCopies(source, variant).sort((a, b) => area(b) - area(a))[0]?.path ?? null;
}

/** The file name a request is served from, so a validator changes when the file does. */
export function servedProxyName(
  projectDir: string,
  absoluteSourcePath: string,
  variant: ProxyVariant,
  box?: PreviewProxyBox,
): string {
  const source = canonicalizeProxySource(projectDir, absoluteSourcePath);
  return basename(
    finishedCopyFor(source, variant, box) ?? getCanonicalProxyCachePath(source, variant, box),
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
  background: boolean;
  /** The source's name in the cache and the box being made, for one copy per source. */
  sourceKey: string;
  box?: PreviewProxyBox;
  /** Set while its ffmpeg runs; replaced copies are stopped through it. */
  stop?: () => void;
  replaced?: boolean;
  /** Callers still waiting; one without a signal never leaves, so its copy is always made. */
  callers: number;
  /** Set while the job waits for a slot. */
  queued?: { start: () => void; drop: () => void };
}

class ProxyDroppedError extends ProxyTranscodeError {
  constructor() {
    super("media proxy copy dropped: every caller left before it started", null, "");
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
  if (job.callers === 0) job.queued?.drop();
}

// --- background copies yield ------------------------------------------------
// ponytail: SIGSTOP/SIGCONT, rechecked each second; Windows has none (Node would kill the child).

const PREVIEW_PLAYING_LEASE_MS = 15_000;
let previewPlayingUntil = 0;
const runningExports = new Set<{ status: string }>();
const backgroundCopies = new Map<ChildProcess, boolean>();
let holdTimer: NodeJS.Timeout | undefined;

function backgroundCopiesHeld(): boolean {
  for (const job of runningExports) if (job.status !== "rendering") runningExports.delete(job);
  return runningExports.size > 0 || Date.now() < previewPlayingUntil;
}

function applyHold(): void {
  if (process.platform === "win32") return;
  const held = backgroundCopiesHeld();
  for (const [proc, stopped] of backgroundCopies) {
    if (stopped !== held && proc.kill(held ? "SIGSTOP" : "SIGCONT"))
      backgroundCopies.set(proc, held);
  }
}

function holdWhileBusy(proc: ChildProcess): void {
  backgroundCopies.set(proc, false);
  applyHold();
  holdTimer ??= setInterval(applyHold, 1000).unref();
  proc.once("close", () => {
    backgroundCopies.delete(proc);
    if (backgroundCopies.size > 0) return;
    clearInterval(holdTimer);
    holdTimer = undefined;
  });
}

// Running encoders and their temp output. A child outlives a server that exits, so exit kills it.
const encoders = new Map<ChildProcess, string>();
let killEncodersOnExit = false;

function trackEncoder(proc: ChildProcess, tempPath: string): void {
  encoders.set(proc, tempPath);
  proc.once("close", () => encoders.delete(proc));
  if (killEncodersOnExit) return;
  killEncodersOnExit = true;
  process.once("exit", () => {
    for (const [encoder, temp] of encoders) {
      encoder.kill("SIGKILL");
      if (existsSync(temp)) unlinkSync(temp);
    }
  });
}

/** Below-normal priority, stopped on exit, and stoppable or pausable through its job. */
function superviseEncoder(proc: ChildProcess, outputPath: string, job?: ProxyJob): void {
  try {
    if (proc.pid) setPriority(proc.pid, osConstants.priority.PRIORITY_BELOW_NORMAL);
  } catch {}
  trackEncoder(proc, outputPath);
  if (!job) return;
  job.stop = () => proc.kill("SIGKILL");
  if (job.replaced) job.stop();
  if (job.background) holdWhileBusy(proc);
}

/** The preview says it is playing (repeated while it plays) or paused. */
export function notePreviewPlaying(playing: boolean): void {
  previewPlayingUntil = playing ? Date.now() + PREVIEW_PLAYING_LEASE_MS : 0;
  applyHold();
}

/** Background copies stop until this export's status leaves "rendering". */
export function holdBackgroundCopiesDuring(job: { status: string }): void {
  runningExports.add(job);
  applyHold();
}

// --- one copy per source, at the largest size it is shown -------------------

// A copy asked for this recently may be mid-play: Chrome refills a playing video by Range request.
const IN_USE_MS = 30_000;
const lastAsked = new Map<string, number>();

function pendingBoxedCopy(
  sourceKey: string,
): { promise: Promise<string>; job: ProxyJob } | undefined {
  for (const entry of inFlight.values())
    if (entry.job.sourceKey === sourceKey && entry.job.box) return entry;
  return undefined;
}

/** A larger box was asked while this copy was queued or encoding: stop it; its temp file goes. */
function replaceCopy(job: ProxyJob): void {
  job.replaced = true;
  forget(job);
  if (job.queued) job.queued.drop();
  else job.stop?.();
}

/** Drops this source's copies the new one covers, each once nothing has read it for a while. */
function dropSmallerCopies(
  source: CanonicalProxySource,
  variant: ProxyVariant,
  box: PreviewProxyBox,
): void {
  let busy = false;
  const kept = getCanonicalProxyCachePath(source, variant, box);
  for (const copy of boxedCopies(source, variant)) {
    if (copy.path === kept || !covers(box, copy.box)) continue;
    if (Date.now() - (lastAsked.get(copy.path) ?? 0) < IN_USE_MS) busy = true;
    else {
      unlinkSync(copy.path);
      lastAsked.delete(copy.path);
    }
  }
  if (busy) setTimeout(() => dropSmallerCopies(source, variant, box), IN_USE_MS).unref();
}

// --- per-key in-flight dedupe ----------------------------------------------

const inFlight = new Map<string, { promise: Promise<string>; job: ProxyJob }>();

function forget(job: ProxyJob): void {
  if (inFlight.get(job.cachePath)?.job === job) inFlight.delete(job.cachePath);
}

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

async function runFfmpeg(
  sourcePath: string,
  outputPath: string,
  variant: ProxyVariant,
  box: PreviewProxyBox | undefined,
  job?: ProxyJob,
): Promise<void> {
  const metadata = await probeMediaMetadata(sourcePath);
  const ffmpegPath = findFfBinary("ffmpeg", { configuredMustExist: true });
  if (!ffmpegPath) {
    throw new FfmpegUnavailableError();
  }
  const keepsAlpha = variant === "vp8";
  const { hdrTransfer } = metadata.color;
  const toneMap = (hdrTransfer === "pq" || hdrTransfer === "hlg") && !keepsAlpha;
  if (toneMap) await ensureHdrFilters(ffmpegPath);
  const firstFrame = toneMap ? await probeFirstFrameColour(sourcePath) : {};
  const evenScale = proxyScaleFilter(box);
  const pixelFormat = keepsAlpha ? "yuva420p" : "yuv420p";
  // The tone map ends in RGB; older ffmpeg (seen on 5.1) converts it with BT.601 unless the matrix is named.
  const videoFilter = toneMap
    ? [
        hdrToSdrToneMapFilter(metadata.color, firstFrame),
        `${evenScale}:out_color_matrix=bt709:out_range=tv`,
        `format=${pixelFormat}`,
      ].join(",")
    : [evenScale, `format=${pixelFormat}`].join(",");

  return new Promise((resolvePromise, reject) => {
    const commonArgs = ["-y", "-i", sourcePath, "-vf", videoFilter];
    const h264Args = [
      "-force_key_frames",
      "expr:gte(t,n_forced*1)",
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
    const vp8Args = [
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
    const args = [...commonArgs, ...(variant === "vp8" ? vp8Args : h264Args), outputPath];

    // Hard ceiling so a hung ffmpeg can never permanently occupy one of the
    // global transcode slots: the child is killed and the slot released via
    // the caller's finally. Generous because long assets transcode at
    // roughly real time; a healthy encode of any authoring asset fits.
    const proc = spawn(ffmpegPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: TRANSCODE_TIMEOUT_MS,
      killSignal: "SIGKILL",
      windowsHide: true,
    });
    superviseEncoder(proc, outputPath, job);
    let stderrTail = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_MAX_CHARS);
    });
    proc.on("error", (err) => {
      reject(new FfmpegUnavailableError(`failed to spawn ffmpeg: ${err.message}`, stderrTail));
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
      await runFfmpeg(absoluteSourcePath, tempPath, variant, box, job);
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
  const served = finishedCopyFor(source, variant, box);
  if (served) {
    lastAsked.set(served, Date.now());
    markCacheEntryUsed(served);
    maintainProxyCache(dirname(served));
    return served;
  }
  const sourceKey = buildProxySourceKey(source, variant);
  const pending = box ? pendingBoxedCopy(sourceKey) : undefined;
  if (box && pending?.job.box && covers(pending.job.box, box)) {
    return joinJob(pending.promise, pending.job, options.signal);
  }
  const target = box && pending?.job.box ? largerOf(box, pending.job.box) : box;
  if (pending) replaceCopy(pending.job);
  const cachePath = getCanonicalProxyCachePath(source, variant, target);

  throwIfFailedRecently(cachePath);

  let entry = inFlight.get(cachePath);
  if (!entry) {
    if (!options.priority && queueIsFull()) {
      proxyActivity += 1;
      throw new ProxyCapacityError();
    }
    const job: ProxyJob = {
      cachePath,
      priority: options.priority === true || pending?.job.priority === true,
      background: options.background === true,
      sourceKey,
      box: target,
      callers: 0,
    };
    const promise = transcodeToCache(
      job,
      source.projectDir,
      source.sourcePath,
      cachePath,
      variant,
      target,
    )
      .then((path) => {
        if (target) dropSmallerCopies(source, variant, target);
        return path;
      })
      .catch((err: unknown) => {
        if (!(err instanceof ProxyDroppedError) && !job.replaced) rememberFailure(cachePath, err);
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

function throwIfFailedRecently(cachePath: string): void {
  const remembered = failedTranscodes.get(cachePath);
  if (!remembered) return;
  if (remembered.expiresAt > Date.now()) throw remembered.error;
  failedTranscodes.delete(cachePath);
}

/** Batch resolve for check and publish: at most MAX_CONCURRENT_TRANSCODES of its own requests in
 * flight (other callers can still fill the queue); each waits at most TRANSCODE_TIMEOUT_MS. */
export async function resolveProxies(
  projectDir: string,
  sources: ReadonlyArray<{ sourcePath: string; variant: ProxyVariant }>,
): Promise<PromiseSettledResult<string>[]> {
  const results: PromiseSettledResult<string>[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < sources.length; index = next++) {
      const { sourcePath, variant } = sources[index]!;
      results[index] = await waitForProxy(
        resolveProxy(projectDir, sourcePath, variant),
        TRANSCODE_TIMEOUT_MS,
      ).then(
        (value) => ({ status: "fulfilled", value }),
        (reason: unknown) => ({ status: "rejected", reason }),
      );
    }
  };
  const workers = Math.min(MAX_CONCURRENT_TRANSCODES, sources.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

export interface ResolveProxyOptions {
  priority?: boolean;
  /** A copy nobody waits on: it stops while a preview plays or an export runs. */
  background?: boolean;
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
