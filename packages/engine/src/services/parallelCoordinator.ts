/**
 * Parallel Coordinator Service
 *
 * Coordinates parallel frame capture across multiple Puppeteer sessions.
 * Auto-detects optimal worker count based on CPU/memory.
 */

import { cpus, freemem, totalmem } from "os";
import { existsSync, mkdirSync, readdirSync } from "fs";
import { copyFile, rename } from "fs/promises";
import { join } from "path";

import {
  createCaptureSession,
  initializeSession,
  closeCaptureSession,
  captureFrame,
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
}

export interface WorkerResult {
  workerId: number;
  framesCaptured: number;
  startFrame: number;
  endFrame: number;
  durationMs: number;
  perf?: CapturePerfSummary;
  error?: string;
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

const MEMORY_PER_WORKER_MB = 256;
const MIN_WORKERS = 1;
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
  const totalMemoryMB = Math.round(totalmem() / (1024 * 1024));
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
 * Decide whether a parallel worker should run the per-worker SwiftShader
 * assertion. Gated to worker 0 only: workers within a chunk share the same
 * Chrome binary, flags, and OS/driver state, so one verification per chunk
 * is sufficient. See `heygen-com/hyperframes#955`.
 */
export function shouldVerifyWorkerGpu(workerId: number, config?: Partial<EngineConfig>): boolean {
  return config?.browserGpuMode === "software" && workerId === 0;
}

async function executeWorkerTask(
  task: WorkerTask,
  serverUrl: string,
  captureOptions: CaptureOptions,
  createBeforeCaptureHook: () => BeforeCaptureHook | null,
  signal?: AbortSignal,
  onFrameCaptured?: (workerId: number, frameIndex: number) => void,
  onFrameBuffer?: (frameIndex: number, buffer: Buffer) => Promise<void>,
  config?: Partial<EngineConfig>,
): Promise<WorkerResult> {
  const startTime = Date.now();
  let framesCaptured = 0;

  if (!existsSync(task.outputDir)) mkdirSync(task.outputDir, { recursive: true });

  let session: CaptureSession | null = null;
  let perf: CapturePerfSummary | undefined;

  try {
    session = await createCaptureSession(
      serverUrl,
      task.outputDir,
      captureOptions,
      createBeforeCaptureHook(),
      config,
    );
    // Per-worker SwiftShader assertion, gated to worker 0 only.
    // When `browserGpuMode: "software"` is declared, the chunk's GL backend
    // must be verified as SwiftShader before the first frame — a host that
    // falls back to a hardware GL backend (or silently fails to load
    // SwiftShader) would otherwise produce non-deterministic pixels and
    // break the distributed byte-identical-retry contract. Running this
    // probe on every worker means N concurrent navigations to a WebGL
    // probe page per chunk; with `chunkWorkerCount=6` × 3 chunks, that's
    // 18 simultaneous CDP page-loads, which inflated c=3 worst-case wall
    // by ~24s vs c=6/c=8 on the texture-launch bench. Workers in the same
    // chunk share the same Chrome binary, flags, and OS/driver state, so
    // worker 0's success is representative — gate it there and skip the
    // rest. See `heygen-com/hyperframes#955` for the bench data and the
    // pre-warmup probe interaction (which `renderChunk` already skips
    // when `chunkWorkerCount > 1`).
    if (shouldVerifyWorkerGpu(task.workerId, config)) {
      await assertSwiftShader(session.page, readWebGlVendorInfoFromCanvas);
    }
    await initializeSession(session);

    const outputOffset = task.outputFrameOffset ?? 0;
    for (let i = task.startFrame; i < task.endFrame; i++) {
      if (signal?.aborted) {
        throw new Error("Parallel worker cancelled");
      }
      // captureOptions.fps is an Fps rational; collapse to decimal for the
      // frame-index → time math. The 1-in-1001 ULP loss for NTSC is invisible
      // at our scales (frame count tops out at single-digit thousands).
      const time = (i * captureOptions.fps.den) / captureOptions.fps.num;
      const fileFrameIdx = i - outputOffset;

      if (onFrameBuffer) {
        // The streaming-encode callback receives the absolute index `i`
        // (not `fileFrameIdx`) so the encoder sequences frames against the
        // composition's timeline.
        const { buffer } = await captureFrameToBuffer(session, fileFrameIdx, time);
        await onFrameBuffer(i, buffer);
      } else {
        await captureFrame(session, fileFrameIdx, time);
      }
      framesCaptured++;

      if (onFrameCaptured) onFrameCaptured(task.workerId, i);
    }

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
    return {
      workerId: task.workerId,
      framesCaptured,
      startFrame: task.startFrame,
      endFrame: task.endFrame,
      durationMs: Date.now() - startTime,
      perf,
      error: errMsg,
    };
  } finally {
    if (session) await closeCaptureSession(session).catch(() => {});
  }
}

export async function executeParallelCapture(
  serverUrl: string,
  workDir: string,
  tasks: WorkerTask[],
  captureOptions: CaptureOptions,
  createBeforeCaptureHook: () => BeforeCaptureHook | null,
  signal?: AbortSignal,
  onProgress?: (progress: ParallelProgress) => void,
  onFrameBuffer?: (frameIndex: number, buffer: Buffer) => Promise<void>,
  config?: Partial<EngineConfig>,
): Promise<WorkerResult[]> {
  const totalFrames = tasks.reduce((sum, t) => sum + (t.endFrame - t.startFrame), 0);
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

  const results = await Promise.all(
    tasks.map((task) =>
      executeWorkerTask(
        task,
        serverUrl,
        captureOptions,
        createBeforeCaptureHook,
        signal,
        onFrameCaptured,
        onFrameBuffer,
        config,
      ),
    ),
  );

  const errors = results.filter((r) => r.error);
  if (errors.length > 0) {
    const errorMessages = errors.map((e) => `Worker ${e.workerId}: ${e.error}`).join("; ");
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
    totalMemoryMB: Math.round(totalmem() / (1024 * 1024)),
    freeMemoryMB: Math.round(freemem() / (1024 * 1024)),
    recommendedWorkers: calculateOptimalWorkers(1000),
  };
}
