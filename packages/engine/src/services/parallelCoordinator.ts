/**
 * Parallel Coordinator Service
 *
 * Coordinates parallel frame capture across multiple Puppeteer sessions.
 * Auto-detects optimal worker count based on CPU/memory.
 */

import { cpus, freemem } from "os";
import { existsSync, mkdirSync, readdirSync } from "fs";
import { copyFile, readFile, rename } from "fs/promises";
import { join } from "path";
import { getHeapStatistics } from "v8";

import {
  createCaptureSession,
  initializeSession,
  closeCaptureSession,
  captureFrame,
  captureFrameToBufferPipelined,
  captureFrameToBuffer,
  getCapturePerfSummary,
  DrawElementVerificationError,
  type CaptureSession,
  type CaptureOptions,
  type CapturePerfSummary,
  type BeforeCaptureHook,
} from "./frameCapture.js";
import { psnrDb, resolveDeVerifyMinDb } from "../utils/psnr.js";
import { DEFAULT_CONFIG, type EngineConfig } from "../config.js";
import { assertSwiftShader } from "../utils/assertSwiftShader.js";
import { readWebGlVendorInfoFromCanvas } from "../utils/readWebGlVendorInfoFromCanvas.js";
import { resolveHeadlessShellPath } from "./browserManager.js";
import { getSystemTotalMb } from "./systemMemory.js";
import {
  CaptureFailure,
  classifyCaptureFailure,
  isFatalCaptureFailure,
  type CaptureWorkerDiagnostic,
} from "./captureFailure.js";

export interface WorkerTask {
  workerId: number;
  startFrame: number;
  endFrame: number;
  outputDir: string;
  /**
   * Offset subtracted from the absolute frame index when naming the captured
   * file (`frame_<i - outputFrameOffset>.{ext}`). Default 0. Distributed
   * chunks set this to the chunk's absolute startFrame so file names land
   * 0-indexed within the chunk's range — the encoder reads frames
   * sequentially without an `-start_number` override. The per-frame TIME
   * calculation still uses the absolute frame index.
   */
  outputFrameOffset?: number;
  /**
   * Frame stride for interleaved distribution (HF_DE_PARALLEL_STREAM spike):
   * the worker captures startFrame, startFrame+stride, … < endFrame. Default 1
   * (contiguous range). Interleaving keeps the ordered streaming writer's
   * reorder window at O(workerCount) frames instead of O(totalFrames/N).
   */
  frameStride?: number;
}

export interface WorkerResult {
  workerId: number;
  framesCaptured: number;
  startFrame: number;
  endFrame: number;
  /**
   * Mirrors the originating `WorkerTask.frameStride` (default 1). Required by
   * `expectedFramesForTask` — without it, every interleaved (stride > 1)
   * worker's expected count is computed as the full contiguous range instead
   * of range/stride, so a fully-successful worker looks like it under-captured
   * and gets misclassified as a silent death (see `synthesizeSilentWorkerExitError`).
   */
  frameStride?: number;
  durationMs: number;
  perf?: CapturePerfSummary;
  error?: string;
  diagnostics?: string[];
  failure?: CaptureFailure;
}

export interface ParallelProgress {
  totalFrames: number;
  capturedFrames: number;
  activeWorkers: number;
  workerProgress: Map<number, number>;
}

export interface WorkerSizingConfig extends Partial<
  Pick<
    EngineConfig,
    "concurrency" | "coresPerWorker" | "minParallelFrames" | "largeRenderThreshold"
  >
> {
  /**
   * Relative per-frame capture cost for auto worker sizing. Values above 1
   * represent compositions that put more CPU pressure on each Chrome worker
   * than a plain DOM screenshot. Explicit --workers requests ignore this hint.
   */
  captureCostMultiplier?: number;
}

type WorkerBrowserPoolDecision = {
  parallel?: boolean;
  platform: NodeJS.Platform;
  // Deliberately accepted but not used: forceScreenshot is not an exclusion.
  forceScreenshot?: boolean;
  deviceScaleFactor?: number;
  headlessShellPath?: string;
};

// System-memory budget per parallel worker. Each worker is a full Chrome
// process (SwiftShader compositor + raster threads) plus its share of parent-
// process frame buffering — the old 256MB figure was ~6× under a measured
// Chrome-under-capture RSS and let memory-constrained hosts overcommit (wild
// 16GB black-slab report; 0.7.66 heap-OOM report on 24GB with 6 auto workers).
const MEMORY_PER_WORKER_MB = 1536;
// Parent-process V8 heap the coordinator itself needs regardless of worker
// count (compile artifacts, puppeteer sessions, encoder state).
const HEAP_RESERVED_MB = 1024;
// Parent-process V8 heap consumed per worker (protocol buffers + in-flight
// frame buffers). Derived from the field OOM: 6 workers exhausted a ~4GB
// default heap ⇒ >~500MB/worker + base. ponytail: advisory-only until the
// workers_heap_* telemetry added alongside this constant validates the figure
// — enforcing a guessed budget could silently cut worker counts fleet-wide.
// TODO(PRINFRA-341): decide enforcement after ~2 weeks of fleet soak.
const HEAP_PER_WORKER_MB = 640;
const MIN_WORKERS = 1;
const MAX_WORKER_DIAGNOSTIC_LINES = 8;
// Hard ceiling on explicit `--workers N` requests. Above this, the cost of
// CDP-protocol dispatch through Node's main event loop and OS scheduling
// noise overwhelms any further parallelism. Bumped from 10 → 24 in hf#732
// follow-up so high-core hosts (32-96+ cores) can actually surface the
// hardware to renders that are CPU-bound on DOM capture.
const ABSOLUTE_MAX_WORKERS = 24;
// `auto` concurrency picks this many workers as the upper bound. Bumped
// from a hardcoded 6 → CPU-scaled value (floor(cpuCount/8), floor at 6,
// ceiling at 16) in hf#732 follow-up. Rationale: the prior fixed cap of 6
// left ~90 cores idle on the validation host and forced users to pass
// `--workers N` to opt in. Now `auto` matches what a thoughtful operator
// would pick by hand. The /8 divisor leaves headroom for each Chrome
// worker's SwiftShader compositor + the shader-blend thread pool, both of
// which are themselves CPU-heavy.
function defaultSafeMaxWorkers(): number {
  return Math.max(6, Math.min(16, Math.floor(cpus().length / 8)));
}
const MIN_FRAMES_PER_WORKER = 30;

// Linux/headless parallel workers need isolated browser processes: BeginFrame
// crashes when shared, while forceScreenshot is safe but serializes
// Page.captureScreenshot per browser. Supersampling keeps the existing path
// until browser-pool compatibility is keyed by DPR.
export function shouldDisableBrowserPoolForParallelWorker({
  parallel,
  platform,
  deviceScaleFactor,
  headlessShellPath,
}: WorkerBrowserPoolDecision): boolean {
  return Boolean(
    parallel && platform === "linux" && headlessShellPath && (deviceScaleFactor ?? 1) <= 1,
  );
}

export function selectWorkerDiagnostics(
  lines: readonly string[],
  maxLines: number = MAX_WORKER_DIAGNOSTIC_LINES,
): string[] {
  return lines
    .filter((line) =>
      /\[(FrameCapture:ERROR|Browser:ERROR|Browser:PAGEERROR|Browser:REQUESTFAILED|Browser:HTTP\d{3})\]/.test(
        line,
      ),
    )
    .slice(-maxLines);
}

function compactDiagnosticLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

/**
 * Expected frame count for a worker task, honoring its stride. Contiguous
 * tasks (stride 1) expect `endFrame - startFrame`; interleaved tasks
 * (stride > 1) expect `ceil((endFrame - startFrame) / stride)`, matching
 * the loop shape in `captureFrameRange`.
 */
export function expectedFramesForTask(task: {
  startFrame: number;
  endFrame: number;
  frameStride?: number;
}): number {
  const stride = task.frameStride ?? 1;
  return Math.max(0, Math.ceil((task.endFrame - task.startFrame) / stride));
}

/**
 * Synthetic terminal-error message for a worker whose exit didn't produce
 * an explicit error string but under-captured its expected frame range.
 * Field signal ts=1784042064: a 1292s Windows render hard-exited during
 * capture with no final error string, leaving the operator with no
 * actionable trace. This message surfaces the shortfall + reruns hint
 * so downstream telemetry (and operators grepping logs) can classify the
 * failure instead of it disappearing silently.
 */
export function synthesizeSilentWorkerExitError(
  result: Pick<WorkerResult, "workerId" | "framesCaptured" | "startFrame" | "endFrame">,
  expectedFrames: number,
): string {
  return (
    `worker ${result.workerId} exited without terminal error string ` +
    `(framesCaptured=${result.framesCaptured}, expected=${expectedFrames}, ` +
    `range=[${result.startFrame}, ${result.endFrame})). ` +
    `Field signal ts=1784042064 — this class of failure has been reported; ` +
    `consider re-run with --workers=1 to isolate.`
  );
}

/**
 * A worker may return without an error string yet with `framesCaptured`
 * below its task's expected count — the silent-exit shape field signal
 * ts=1784042064 called out. Synthesize a terminal error string in-place so
 * the caller's failure filter treats it as a failure (and so the caller's
 * failure message actually names what went wrong). Requires each result to
 * carry `frameStride` (see `WorkerResult`) — without it, an interleaved
 * worker's true `framesCaptured` (range/stride) is compared against the full
 * contiguous range and every successful interleaved worker false-positives.
 */
export function flagSilentWorkerExits(results: WorkerResult[]): void {
  for (const r of results) {
    if (!r.error && r.framesCaptured < expectedFramesForTask(r)) {
      r.error = synthesizeSilentWorkerExitError(r, expectedFramesForTask(r));
    }
  }
}

export function formatWorkerFailure(result: WorkerResult): string {
  const errorText =
    result.error && result.error.length > 0
      ? result.error
      : synthesizeSilentWorkerExitError(result, expectedFramesForTask(result));
  const base = `Worker ${result.workerId}: ${errorText}`;
  if (!result.diagnostics || result.diagnostics.length === 0) return base;

  const diagnostics = result.diagnostics.map(compactDiagnosticLine).join(" | ");
  return `${base}; diagnostics: ${diagnostics}`;
}

/** Which constraint produced the final auto-sized worker count. */
export type WorkerSizingBound =
  | "explicit"
  | "too_few_frames"
  | "cpu"
  | "memory"
  | "frames"
  | "max_workers"
  | "min_parallel_floor"
  | "contention";

/**
 * Full provenance of a worker-sizing decision. Threaded into render
 * observability/telemetry so fleet data can answer "why N workers?" and
 * "would the heap budget have prevented this OOM?" without a repro.
 */
export interface WorkerSizing {
  workers: number;
  boundBy: WorkerSizingBound;
  cpuBasedWorkers: number;
  memoryBasedWorkers: number;
  frameBasedWorkers: number;
  effectiveMaxWorkers: number;
  /**
   * ADVISORY, not enforced (see HEAP_PER_WORKER_MB): how many workers the
   * parent process's V8 heap could feed. Compare against `workers` in
   * telemetry to validate the budget before enforcement.
   */
  heapBasedWorkers: number;
  /** V8 `heap_size_limit` for the parent process, MB. */
  heapLimitMb: number;
  totalMemoryMb: number;
  cpuCount: number;
  captureCostMultiplier: number;
  /** true when the chosen count exceeds the advisory heap budget. */
  exceedsHeapAdvisory: boolean;
}

/**
 * Compute the auto worker count together with the full sizing provenance.
 * `calculateOptimalWorkers` is the thin legacy wrapper returning `.workers`.
 */
// The branch count is the decision provenance itself — each if records WHICH
// constraint bound, which is the entire point of the function.
// fallow-ignore-next-line complexity
export function computeWorkerSizing(
  totalFrames: number,
  requested?: number,
  config?: WorkerSizingConfig,
): WorkerSizing {
  const cpuCount = cpus().length;
  // Use total memory instead of free memory — macOS reports misleadingly low
  // freemem() because it aggressively caches files in "inactive" memory that
  // is immediately reclaimable.
  const totalMemoryMb = getSystemTotalMb();
  const heapLimitMb = Math.round(getHeapStatistics().heap_size_limit / (1024 * 1024));
  const heapBasedWorkers = Math.max(
    1,
    Math.floor((heapLimitMb - HEAP_RESERVED_MB) / HEAP_PER_WORKER_MB),
  );
  const cpuBasedWorkers = Math.max(1, cpuCount - 2);
  const memoryBasedWorkers = Math.max(1, Math.floor((totalMemoryMb * 0.5) / MEMORY_PER_WORKER_MB));
  const frameBasedWorkers = Math.floor(totalFrames / MIN_FRAMES_PER_WORKER);
  const captureCostMultiplier = Math.max(1, config?.captureCostMultiplier ?? 1);

  const base = {
    cpuBasedWorkers,
    memoryBasedWorkers,
    frameBasedWorkers,
    heapBasedWorkers,
    heapLimitMb,
    totalMemoryMb,
    cpuCount,
    captureCostMultiplier,
  };
  const finish = (workers: number, boundBy: WorkerSizingBound, effectiveMaxWorkers: number) => ({
    workers,
    boundBy,
    effectiveMaxWorkers,
    ...base,
    exceedsHeapAdvisory: workers > heapBasedWorkers,
  });

  if (requested !== undefined) {
    return finish(
      Math.max(MIN_WORKERS, Math.min(ABSOLUTE_MAX_WORKERS, requested)),
      "explicit",
      ABSOLUTE_MAX_WORKERS,
    );
  }

  // Resolve effective values: config overrides → DEFAULT_CONFIG fallback.
  const effectiveMaxWorkers = (() => {
    const concurrency = config?.concurrency ?? DEFAULT_CONFIG.concurrency;
    if (concurrency !== "auto") {
      return Math.max(MIN_WORKERS, Math.min(ABSOLUTE_MAX_WORKERS, Math.floor(concurrency)));
    }
    return defaultSafeMaxWorkers();
  })();
  const effectiveCoresPerWorker = config?.coresPerWorker ?? DEFAULT_CONFIG.coresPerWorker;
  const effectiveMinParallelFrames = config?.minParallelFrames ?? DEFAULT_CONFIG.minParallelFrames;
  const effectiveLargeRenderThreshold =
    config?.largeRenderThreshold ?? DEFAULT_CONFIG.largeRenderThreshold;

  if (totalFrames < MIN_FRAMES_PER_WORKER * 2) {
    return finish(1, "too_few_frames", effectiveMaxWorkers);
  }

  const optimal = Math.min(cpuBasedWorkers, memoryBasedWorkers, frameBasedWorkers);
  const optimalBound: WorkerSizingBound =
    optimal === cpuBasedWorkers ? "cpu" : optimal === memoryBasedWorkers ? "memory" : "frames";
  const minWorkersForJob = totalFrames >= effectiveMinParallelFrames ? 2 : MIN_WORKERS;
  let finalWorkers = Math.max(minWorkersForJob, Math.min(effectiveMaxWorkers, optimal));
  let boundBy: WorkerSizingBound =
    finalWorkers === optimal
      ? optimalBound
      : finalWorkers === effectiveMaxWorkers && effectiveMaxWorkers < optimal
        ? "max_workers"
        : "min_parallel_floor";

  // Adaptive scaling: cap workers for large or expensive renders to prevent
  // CPU contention. Each Chrome process (with SwiftShader) is CPU-heavy; too
  // many concurrent captures can starve the compositor and surface as CDP
  // protocol timeouts. Scale proportionally to CPU count and composition cost:
  // 8 cores → 2 workers, 16 cores → 5 workers, 32 cores → 10 workers.
  const weightedFrames = totalFrames * captureCostMultiplier;
  const contentionThreshold = Math.max(
    effectiveMinParallelFrames,
    Math.floor(effectiveLargeRenderThreshold / 3),
  );
  if (totalFrames >= effectiveLargeRenderThreshold || weightedFrames >= contentionThreshold) {
    const weightedCoresPerWorker = effectiveCoresPerWorker * captureCostMultiplier;
    const cpuScaledMax = Math.max(MIN_WORKERS, Math.floor(cpuCount / weightedCoresPerWorker));
    if (finalWorkers > cpuScaledMax) {
      finalWorkers = cpuScaledMax;
      boundBy = "contention";
    }
  }

  return finish(finalWorkers, boundBy, effectiveMaxWorkers);
}

export function calculateOptimalWorkers(
  totalFrames: number,
  requested?: number,
  config?: WorkerSizingConfig,
): number {
  return computeWorkerSizing(totalFrames, requested, config).workers;
}

export function distributeFrames(
  totalFrames: number,
  workerCount: number,
  workDir: string,
  rangeStart: number = 0,
): WorkerTask[] {
  const tasks: WorkerTask[] = [];
  const framesPerWorker = Math.ceil(totalFrames / workerCount);

  for (let i = 0; i < workerCount; i++) {
    const startFrame = rangeStart + i * framesPerWorker;
    const endFrame = Math.min(rangeStart + (i + 1) * framesPerWorker, rangeStart + totalFrames);
    if (startFrame >= rangeStart + totalFrames) break;

    tasks.push({
      workerId: i,
      startFrame,
      endFrame,
      outputDir: join(workDir, `worker-${i}`),
      outputFrameOffset: rangeStart,
    });
  }

  return tasks;
}

/**
 * Interleaved (round-robin) distribution: worker i captures frames
 * i, i+N, i+2N, …. Seek-based capture makes stride access free (every frame
 * is an absolute seek), and the streaming reorder window shrinks from
 * totalFrames/N to N — contiguous chunks serialize workers behind the
 * ordered writer (worker 1's first frame waits for ALL of worker 0's).
 * HF_DE_PARALLEL_STREAM spike; disk-path capture keeps contiguous chunks.
 */
export function distributeFramesInterleaved(
  totalFrames: number,
  workerCount: number,
  workDir: string,
  rangeStart: number = 0,
): WorkerTask[] {
  const tasks: WorkerTask[] = [];
  for (let i = 0; i < workerCount && i < totalFrames; i++) {
    tasks.push({
      workerId: i,
      startFrame: rangeStart + i,
      endFrame: rangeStart + totalFrames,
      frameStride: workerCount,
      outputDir: join(workDir, `worker-${i}`),
      outputFrameOffset: rangeStart,
    });
  }
  return tasks;
}

/**
 * Decide whether a parallel worker should run the per-worker SwiftShader
 * assertion. Gated to worker 0 only: workers within a chunk share the same
 * Chrome binary, flags, and OS/driver state, so one verification per chunk
 * is sufficient. See `heygen-com/hyperframes#955`.
 */
export function shouldVerifyWorkerGpu(workerId: number, config?: Partial<EngineConfig>): boolean {
  return config?.browserGpuMode === "software" && workerId === 0;
}

// fallow-ignore-next-line complexity
async function captureFrameRange(
  session: CaptureSession,
  task: WorkerTask,
  captureOptions: CaptureOptions,
  signal: AbortSignal | undefined,
  onFrameCaptured: ((workerId: number, frameIndex: number) => void) | undefined,
  onFrameBuffer:
    | ((frameIndex: number, buffer: Buffer, session: CaptureSession) => Promise<void>)
    | undefined,
): Promise<number> {
  let framesCaptured = 0;
  const outputOffset = task.outputFrameOffset ?? 0;
  const stride = task.frameStride ?? 1;
  // Depth-2 pipelined drawElement produce (HF_DE_PARALLEL_STREAM spike): frame
  // k's in-page worker encode overlaps frame k+stride's produce phase — the
  // same shape as the sequential worker-encode loop. Only engaged when the
  // session's encode worker initialized (drawElement mode) and frames stream
  // back via onFrameBuffer; the ordered writer's waitForFrame provides the
  // cross-worker backpressure (each worker runs at most `stride` frames ahead).
  // NOTE: this branch fires for any stride, but production only ever reaches
  // it via HF_DE_PARALLEL_STREAM, which always uses interleaved distribution
  // (stride = workerCount). The stride=1 (contiguous) path through here is
  // validation-only — exercised by tests wiring onFrameBuffer with a
  // contiguous multi-worker task, not a shape real renders take. Don't
  // "simplify" the flag checks around this without accounting for that.
  if (onFrameBuffer && session.workerEncodeEnabled) {
    const dbg = process.env.HF_DE_PAR_DEBUG === "1";
    const dbgT0 = Date.now();
    const dbgWin = 40 * stride;
    let prev: { idx: number; encodeResult: Promise<Buffer> } | null = null;
    for (let i = task.startFrame; i < task.endFrame; i += stride) {
      if (signal?.aborted) throw new Error("Parallel worker cancelled");
      const time = (i * captureOptions.fps.den) / captureOptions.fps.num;
      if (dbg && i < task.startFrame + dbgWin) {
        console.log(`[par:w${task.workerId}] +${Date.now() - dbgT0}ms produce ${i} start`);
      }
      const { encodeResult } = await captureFrameToBufferPipelined(session, i - outputOffset, time);
      // Marks the promise "handled" for Node's unhandled-rejection detector
      // without affecting the real `await prev.encodeResult` below — if a
      // later iteration throws (abort, downstream writeFrame failure) before
      // this frame's encode is drained, it's abandoned rather than awaited,
      // and would otherwise surface as an unhandled rejection during teardown.
      encodeResult.catch(() => {});
      if (dbg && i < task.startFrame + dbgWin) {
        console.log(`[par:w${task.workerId}] +${Date.now() - dbgT0}ms produce ${i} kicked`);
      }
      if (prev) {
        if (dbg && prev.idx < task.startFrame + dbgWin) {
          console.log(
            `[par:w${task.workerId}] +${Date.now() - dbgT0}ms drain ${prev.idx} await-encode`,
          );
        }
        const buf = await prev.encodeResult;
        if (dbg && prev.idx < task.startFrame + dbgWin) {
          console.log(
            `[par:w${task.workerId}] +${Date.now() - dbgT0}ms drain ${prev.idx} encoded ${buf.length}B`,
          );
        }
        await onFrameBuffer(prev.idx, buf, session);
        if (dbg && prev.idx < task.startFrame + dbgWin) {
          console.log(`[par:w${task.workerId}] +${Date.now() - dbgT0}ms drain ${prev.idx} written`);
        }
        framesCaptured++;
        if (onFrameCaptured) onFrameCaptured(task.workerId, prev.idx);
      }
      prev = { idx: i, encodeResult };
    }
    if (prev) {
      await onFrameBuffer(prev.idx, await prev.encodeResult, session);
      framesCaptured++;
      if (onFrameCaptured) onFrameCaptured(task.workerId, prev.idx);
    }
    return framesCaptured;
  }
  for (let i = task.startFrame; i < task.endFrame; i += stride) {
    if (signal?.aborted) throw new Error("Parallel worker cancelled");
    const time = (i * captureOptions.fps.den) / captureOptions.fps.num;
    const fileFrameIdx = i - outputOffset;

    if (onFrameBuffer) {
      const { buffer } = await captureFrameToBuffer(session, fileFrameIdx, time);
      await onFrameBuffer(i, buffer, session);
    } else {
      await captureFrame(session, fileFrameIdx, time);
    }
    framesCaptured++;
    if (onFrameCaptured) onFrameCaptured(task.workerId, i);
  }
  return framesCaptured;
}

/**
 * The armed self-verify sample indices this task actually captured: inside
 * `[startFrame, endFrame)` and on the task's stride lattice. Mirrors the
 * capture loop in `captureFrameRange` (`i += stride` from `startFrame`).
 */
export function selectVerifySampleIndicesForTask(
  sampleIndices: Iterable<number>,
  task: Pick<WorkerTask, "startFrame" | "endFrame" | "frameStride">,
): number[] {
  const stride = task.frameStride ?? 1;
  const selected: number[] = [];
  for (const idx of sampleIndices) {
    if (idx < task.startFrame || idx >= task.endFrame) continue;
    if ((idx - task.startFrame) % stride !== 0) continue;
    selected.push(idx);
  }
  return selected.sort((a, b) => a - b);
}

/**
 * Disk-path drawElement self-verification (PRINFRA-352). Parallel DISK
 * workers arm the same pre-injection ground-truth samples as the streaming
 * path (`resolveParallelDeVerifySamples` even raises the density for
 * multi-worker capture) — but only the streaming drain ever CHECKED them,
 * so an explicit `--experimental-fast-capture --workers N` render shipped
 * unverified drawElement frames. On a 16GB host, two concurrent
 * hardware-GPU Chrome instances hit the documented compositor-tile-eviction
 * damage class (frames displaced into vertical strips for one worker's
 * whole range — reads as "corruption from the exact worker boundary").
 *
 * After a worker's range completes, re-read its captured files for the
 * sampled indices and PSNR-compare against the session's ground truth.
 * A breach throws `DrawElementVerificationError`, which the orchestrator's
 * existing pinned-fallback retry converts into a screenshot re-render —
 * the same recovery the streaming drain gets.
 */
/** HF_DE_PAR_DEBUG=1 gated per-worker trace line (message built lazily). */
function logParDebug(message: () => string): void {
  if (process.env.HF_DE_PAR_DEBUG === "1") console.log(message());
}

/**
 * Throw the verification error for a sample below the PSNR floor; log the
 * pass otherwise. Split from the sampling loop for the complexity gate.
 */
function assertDiskSampleAboveFloor(
  db: number,
  verifyMinDb: number,
  idx: number,
  workerId: number,
): void {
  if (db < verifyMinDb) {
    // Message keeps the contiguous "drawElement self-verify" phrase —
    // captureFailure's VERIFICATION_ERROR_PATTERNS classifies on it.
    throw new DrawElementVerificationError(
      `drawElement self-verify failed at frame ${idx} (disk path, worker ${workerId}): ` +
        `${db.toFixed(1)}dB < ${verifyMinDb}dB vs pre-injection screenshot`,
      { kind: "psnr", frameIndex: idx, failedDb: db, verifyThresholdDb: verifyMinDb },
    );
  }
  console.log(
    `[Parallel] drawElement disk self-verify passed (worker ${workerId}, frame ${idx}, ` +
      `${db === Infinity ? "inf" : db.toFixed(1)}dB)`,
  );
}

/**
 * Compare one captured frame file against its ground truth. Returns the
 * PSNR, or null on infrastructure failure (missing file already surfaces
 * via the frame completeness check; ffmpeg spawn/tmpdir here) — a skipped
 * sample is not damage evidence and must not fail the capture.
 */
async function psnrForDiskSample(
  framePath: string,
  truth: Buffer,
  workerId: number,
  idx: number,
): Promise<number | null> {
  try {
    return await psnrDb(await readFile(framePath), truth);
  } catch (err) {
    console.warn(
      `[Parallel] drawElement disk self-verify sample skipped (worker ${workerId}, ` +
        `frame ${idx}): ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

// Branches are the gate conditions themselves (mode/armed/streaming guards +
// per-sample skip/breach) — already decomposed into psnrForDiskSample +
// assertDiskSampleAboveFloor; further splitting obscures the check.
// fallow-ignore-next-line complexity
export async function verifyDiskDrawElementSamples(
  session: CaptureSession,
  task: WorkerTask,
  streaming: boolean,
): Promise<void> {
  // Streaming capture verifies every sampled frame in the drain guard already.
  if (streaming || session.captureMode !== "drawelement") return;
  const truths = session.deVerifyFrames;
  if (!truths || truths.size === 0) return;
  const verifyMinDb = resolveDeVerifyMinDb();
  const ext = session.options.format === "png" ? "png" : "jpg";
  const offset = task.outputFrameOffset ?? 0;
  for (const idx of selectVerifySampleIndicesForTask(truths.keys(), task)) {
    const truth = truths.get(idx);
    if (!truth) continue;
    const framePath = join(task.outputDir, `frame_${String(idx - offset).padStart(6, "0")}.${ext}`);
    const db = await psnrForDiskSample(framePath, truth, task.workerId, idx);
    if (db === null) continue;
    assertDiskSampleAboveFloor(db, verifyMinDb, idx, task.workerId);
  }
}

// Inherited worker-lifecycle shape (session create → verify GPU → init →
// capture → self-verify → perf, with a classifying catch + closing finally);
// flagged only because the disk self-verify call shifted its line range into
// the changed-code audit. Not restructured by this PR.
// fallow-ignore-next-line complexity
async function executeWorkerTask(
  task: WorkerTask,
  serverUrl: string,
  captureOptions: CaptureOptions,
  createBeforeCaptureHook: () => BeforeCaptureHook | null,
  signal?: AbortSignal,
  onFrameCaptured?: (workerId: number, frameIndex: number) => void,
  onFrameBuffer?: (frameIndex: number, buffer: Buffer, session: CaptureSession) => Promise<void>,
  config?: Partial<EngineConfig>,
  parallel?: boolean,
  onFailure?: (failure: CaptureFailure) => void,
): Promise<WorkerResult> {
  const startTime = Date.now();
  let framesCaptured = 0;

  if (!existsSync(task.outputDir)) mkdirSync(task.outputDir, { recursive: true });

  let session: CaptureSession | null = null;
  let perf: CapturePerfSummary | undefined;

  const needsSeparateBrowsers = shouldDisableBrowserPoolForParallelWorker({
    parallel,
    platform: process.platform,
    forceScreenshot: config?.forceScreenshot,
    deviceScaleFactor: captureOptions.deviceScaleFactor,
    headlessShellPath: resolveHeadlessShellPath(config),
  });
  const workerConfig: Partial<EngineConfig> | undefined = needsSeparateBrowsers
    ? { ...config, enableBrowserPool: false }
    : config;

  try {
    session = await createCaptureSession(
      serverUrl,
      task.outputDir,
      captureOptions,
      createBeforeCaptureHook(),
      workerConfig,
    );
    logParDebug(() => `[par:w${task.workerId}] session created`);
    // Worker-0-only SwiftShader assertion — see `shouldVerifyWorkerGpu` and #955.
    if (shouldVerifyWorkerGpu(task.workerId, workerConfig)) {
      await assertSwiftShader(session.page, readWebGlVendorInfoFromCanvas);
    }
    await initializeSession(session);
    logParDebug(
      () =>
        `[par:w${task.workerId}] init done (mode=${session?.captureMode} workerEncode=${session?.workerEncodeEnabled === true})`,
    );
    framesCaptured = await captureFrameRange(
      session,
      task,
      captureOptions,
      signal,
      onFrameCaptured,
      onFrameBuffer,
    );

    await verifyDiskDrawElementSamples(session, task, Boolean(onFrameBuffer));

    perf = getCapturePerfSummary(session);
    return {
      workerId: task.workerId,
      framesCaptured,
      startFrame: task.startFrame,
      endFrame: task.endFrame,
      frameStride: task.frameStride,
      durationMs: Date.now() - startTime,
      perf,
    };
  } catch (error) {
    const diagnostics = session ? selectWorkerDiagnostics(session.browserConsoleBuffer) : [];
    const workerDiagnostic: CaptureWorkerDiagnostic = {
      workerId: task.workerId,
      framesCaptured,
      startFrame: task.startFrame,
      endFrame: task.endFrame,
      lines: diagnostics,
    };
    const failure = classifyCaptureFailure(error, {
      signal,
      workerDiagnostics: [workerDiagnostic],
    });
    onFailure?.(failure);
    return {
      workerId: task.workerId,
      framesCaptured,
      startFrame: task.startFrame,
      endFrame: task.endFrame,
      frameStride: task.frameStride,
      durationMs: Date.now() - startTime,
      perf,
      error: failure.message,
      diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
      failure,
    };
  } finally {
    if (session) await closeCaptureSession(session).catch(() => {});
  }
}

/**
 * drawElement self-verify sample count for multi-worker capture. Each worker
 * arms the same shared sample grid but drains only ~1/N of it, and N
 * concurrent hardware-GPU browsers are exactly where compositor-tile damage
 * shows up (wild 0.7.52 black-slab report) — so density rises with worker
 * count: 4 base + 2 per extra worker, clamped to the verify path's max of 8.
 * A caller-set value passes through untouched, and explicit HF_DE_VERIFY
 * still overrides inside the session.
 */
export function resolveParallelDeVerifySamples(
  callerValue: number | undefined,
  workerCount: number,
): number | undefined {
  if (callerValue !== undefined) return callerValue;
  if (workerCount <= 1) return undefined;
  return Math.min(8, 4 + 2 * (workerCount - 1));
}

export async function executeParallelCapture(
  serverUrl: string,
  workDir: string,
  tasks: WorkerTask[],
  captureOptions: CaptureOptions,
  createBeforeCaptureHook: () => BeforeCaptureHook | null,
  signal?: AbortSignal,
  onProgress?: (progress: ParallelProgress) => void,
  onFrameBuffer?: (frameIndex: number, buffer: Buffer, session: CaptureSession) => Promise<void>,
  config?: Partial<EngineConfig>,
): Promise<WorkerResult[]> {
  // `endFrame - startFrame` is the correct per-task frame count for contiguous
  // tasks (stride 1), but for interleaved tasks (stride = workerCount) each
  // task spans nearly the full range while only actually capturing 1/stride
  // of it — dividing by stride here matches the loop in `captureFrameRange`
  // (`i += stride`) so progress doesn't plateau at ~1/workerCount.
  const totalFrames = tasks.reduce(
    (sum, t) => sum + Math.ceil((t.endFrame - t.startFrame) / (t.frameStride ?? 1)),
    0,
  );
  const workerProgress = new Map<number, number>();

  for (const task of tasks) workerProgress.set(task.workerId, 0);

  const onFrameCaptured = (workerId: number, _frameIndex: number) => {
    const current = workerProgress.get(workerId) || 0;
    workerProgress.set(workerId, current + 1);

    if (onProgress) {
      const capturedFrames = Array.from(workerProgress.values()).reduce((a, b) => a + b, 0);
      onProgress({
        totalFrames,
        capturedFrames,
        activeWorkers: tasks.length,
        workerProgress: new Map(workerProgress),
      });
    }
  };

  const parallel = tasks.length > 1;
  const deVerifySamples = resolveParallelDeVerifySamples(
    captureOptions.deVerifySamples,
    tasks.length,
  );
  const workerCaptureOptions: CaptureOptions =
    deVerifySamples === captureOptions.deVerifySamples
      ? captureOptions
      : { ...captureOptions, deVerifySamples };
  const peerController = new AbortController();
  const workerSignal = signal
    ? AbortSignal.any([signal, peerController.signal])
    : peerController.signal;
  let firstFatalFailure: CaptureFailure | undefined;
  const onFailure = (failure: CaptureFailure): void => {
    if (firstFatalFailure || !isFatalCaptureFailure(failure)) return;
    firstFatalFailure = failure;
    peerController.abort(failure);
  };
  const results = await Promise.all(
    tasks.map((task) =>
      executeWorkerTask(
        task,
        serverUrl,
        workerCaptureOptions,
        createBeforeCaptureHook,
        workerSignal,
        onFrameCaptured,
        onFrameBuffer,
        config,
        parallel,
        onFailure,
      ),
    ),
  );

  flagSilentWorkerExits(results);

  const errors = results.filter((r) => r.failure || r.error);
  if (errors.length > 0) {
    const errorMessages = errors.map(formatWorkerFailure).join("; ");
    const representative = firstFatalFailure ?? errors.find((result) => result.failure)?.failure;
    const workerDiagnostics = errors.flatMap((result) => result.failure?.workerDiagnostics ?? []);
    throw new CaptureFailure({
      kind: representative?.kind ?? "io",
      message: `[Parallel] Capture failed: ${errorMessages}`,
      cause: representative,
      workerDiagnostics,
    });
  }

  return results;
}

export async function mergeWorkerFrames(
  workDir: string,
  tasks: WorkerTask[],
  outputDir: string,
): Promise<number> {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  let totalFrames = 0;
  const sortedTasks = [...tasks].sort((a, b) => a.startFrame - b.startFrame);

  for (const task of sortedTasks) {
    if (!existsSync(task.outputDir)) {
      continue;
    }

    const files = readdirSync(task.outputDir)
      .filter((f) => f.startsWith("frame_") && (f.endsWith(".jpg") || f.endsWith(".png")))
      .sort();
    const copyTasks = files.map(async (file) => {
      const sourcePath = join(task.outputDir, file);
      const targetPath = join(outputDir, file);
      try {
        await rename(sourcePath, targetPath);
      } catch {
        await copyFile(sourcePath, targetPath);
      }
    });
    await Promise.all(copyTasks);
    totalFrames += files.length;
  }

  return totalFrames;
}

export function getSystemResources(): {
  cpuCores: number;
  totalMemoryMB: number;
  freeMemoryMB: number;
  recommendedWorkers: number;
} {
  return {
    cpuCores: cpus().length,
    totalMemoryMB: getSystemTotalMb(),
    freeMemoryMB: Math.round(freemem() / (1024 * 1024)),
    recommendedWorkers: calculateOptimalWorkers(1000),
  };
}
