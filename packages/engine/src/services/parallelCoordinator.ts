/**
 * Parallel Coordinator Service
 *
 * Coordinates parallel frame capture across multiple Puppeteer sessions.
 * Auto-detects optimal worker count based on CPU/memory.
 */

import { cpus, freemem } from "os";
import { existsSync, mkdirSync, readdirSync } from "fs";
import { copyFile, rename } from "fs/promises";
import { join } from "path";

import {
  createCaptureSession,
  initializeSession,
  closeCaptureSession,
  captureFrame,
  captureFrameToBufferPipelined,
  captureFrameToBuffer,
  getCapturePerfSummary,
  type CaptureSession,
  type CaptureOptions,
  type CapturePerfSummary,
  type BeforeCaptureHook,
} from "./frameCapture.js";
import { DEFAULT_CONFIG, type EngineConfig } from "../config.js";
import { assertSwiftShader } from "../utils/assertSwiftShader.js";
import { readWebGlVendorInfoFromCanvas } from "../utils/readWebGlVendorInfoFromCanvas.js";
import { resolveHeadlessShellPath } from "./browserManager.js";
import { getSystemTotalMb } from "./systemMemory.js";

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
  durationMs: number;
  perf?: CapturePerfSummary;
  error?: string;
  diagnostics?: string[];
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

const MEMORY_PER_WORKER_MB = 256;
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

export function formatWorkerFailure(result: WorkerResult): string {
  const base = `Worker ${result.workerId}: ${result.error ?? "unknown error"}`;
  if (!result.diagnostics || result.diagnostics.length === 0) return base;

  const diagnostics = result.diagnostics.map(compactDiagnosticLine).join(" | ");
  return `${base}; diagnostics: ${diagnostics}`;
}

export function calculateOptimalWorkers(
  totalFrames: number,
  requested?: number,
  config?: WorkerSizingConfig,
): number {
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
  const captureCostMultiplier = Math.max(1, config?.captureCostMultiplier ?? 1);

  if (requested !== undefined) {
    return Math.max(MIN_WORKERS, Math.min(effectiveMaxWorkers, requested));
  }

  if (totalFrames < MIN_FRAMES_PER_WORKER * 2) return 1;

  const cpuCount = cpus().length;
  const cpuBasedWorkers = Math.max(1, cpuCount - 2);

  // Use total memory instead of free memory — macOS reports misleadingly low
  // freemem() because it aggressively caches files in "inactive" memory that
  // is immediately reclaimable.
  const totalMemoryMB = getSystemTotalMb();
  const memoryBasedWorkers = Math.max(1, Math.floor((totalMemoryMB * 0.5) / MEMORY_PER_WORKER_MB));

  const frameBasedWorkers = Math.floor(totalFrames / MIN_FRAMES_PER_WORKER);

  const optimal = Math.min(cpuBasedWorkers, memoryBasedWorkers, frameBasedWorkers);
  const minWorkersForJob = totalFrames >= effectiveMinParallelFrames ? 2 : MIN_WORKERS;
  let finalWorkers = Math.max(minWorkersForJob, Math.min(effectiveMaxWorkers, optimal));

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
    }
  }

  return finalWorkers;
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
    if (process.env.HF_DE_PAR_DEBUG === "1") {
      console.log(`[par:w${task.workerId}] session created`);
    }
    // Worker-0-only SwiftShader assertion — see `shouldVerifyWorkerGpu` and #955.
    if (shouldVerifyWorkerGpu(task.workerId, workerConfig)) {
      await assertSwiftShader(session.page, readWebGlVendorInfoFromCanvas);
    }
    await initializeSession(session);
    if (process.env.HF_DE_PAR_DEBUG === "1") {
      console.log(
        `[par:w${task.workerId}] init done (mode=${session.captureMode} workerEncode=${session.workerEncodeEnabled === true})`,
      );
    }
    framesCaptured = await captureFrameRange(
      session,
      task,
      captureOptions,
      signal,
      onFrameCaptured,
      onFrameBuffer,
    );

    perf = getCapturePerfSummary(session);
    return {
      workerId: task.workerId,
      framesCaptured,
      startFrame: task.startFrame,
      endFrame: task.endFrame,
      durationMs: Date.now() - startTime,
      perf,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const diagnostics = session ? selectWorkerDiagnostics(session.browserConsoleBuffer) : [];
    return {
      workerId: task.workerId,
      framesCaptured,
      startFrame: task.startFrame,
      endFrame: task.endFrame,
      durationMs: Date.now() - startTime,
      perf,
      error: errMsg,
      diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
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
  const results = await Promise.all(
    tasks.map((task) =>
      executeWorkerTask(
        task,
        serverUrl,
        workerCaptureOptions,
        createBeforeCaptureHook,
        signal,
        onFrameCaptured,
        onFrameBuffer,
        config,
        parallel,
      ),
    ),
  );

  const errors = results.filter((r) => r.error);
  if (errors.length > 0) {
    const errorMessages = errors.map(formatWorkerFailure).join("; ");
    throw new Error(`[Parallel] Capture failed: ${errorMessages}`);
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
