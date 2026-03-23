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

export interface WorkerTask {
  workerId: number;
  startFrame: number;
  endFrame: number;
  outputDir: string;
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

const MEMORY_PER_WORKER_MB = 256;
const MIN_WORKERS = 1;
const ABSOLUTE_MAX_WORKERS = 10;
const DEFAULT_SAFE_MAX_WORKERS = 6;
const MIN_FRAMES_PER_WORKER = 30;

export function calculateOptimalWorkers(
  totalFrames: number,
  requested?: number,
  config?: Partial<
    Pick<
      EngineConfig,
      "concurrency" | "coresPerWorker" | "minParallelFrames" | "largeRenderThreshold"
    >
  >,
): number {
  // Resolve effective values: config overrides → DEFAULT_CONFIG fallback.
  const effectiveMaxWorkers = (() => {
    const concurrency = config?.concurrency ?? DEFAULT_CONFIG.concurrency;
    if (concurrency !== "auto") {
      return Math.max(MIN_WORKERS, Math.min(ABSOLUTE_MAX_WORKERS, Math.floor(concurrency)));
    }
    return DEFAULT_SAFE_MAX_WORKERS;
  })();
  const effectiveCoresPerWorker = config?.coresPerWorker ?? DEFAULT_CONFIG.coresPerWorker;
  const effectiveMinParallelFrames = config?.minParallelFrames ?? DEFAULT_CONFIG.minParallelFrames;
  const effectiveLargeRenderThreshold =
    config?.largeRenderThreshold ?? DEFAULT_CONFIG.largeRenderThreshold;

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

  // Adaptive scaling: cap workers for large renders to prevent CPU contention.
  // Each Chrome process (with SwiftShader) is CPU-heavy; too many on a long
  // render causes protocol timeouts from compositor starvation.
  // Scale proportionally to CPU count: ~3 cores per worker (benchmarked).
  // 8 cores → 2 workers, 16 cores → 5 workers, 32 cores → 10 workers.
  if (totalFrames >= effectiveLargeRenderThreshold) {
    const cpuScaledMax = Math.max(2, Math.floor(cpuCount / effectiveCoresPerWorker));
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
): WorkerTask[] {
  const tasks: WorkerTask[] = [];
  const framesPerWorker = Math.ceil(totalFrames / workerCount);

  for (let i = 0; i < workerCount; i++) {
    const startFrame = i * framesPerWorker;
    const endFrame = Math.min((i + 1) * framesPerWorker, totalFrames);
    if (startFrame >= totalFrames) break;

    tasks.push({
      workerId: i,
      startFrame,
      endFrame,
      outputDir: join(workDir, `worker-${i}`),
    });
  }

  return tasks;
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
    await initializeSession(session);

    for (let i = task.startFrame; i < task.endFrame; i++) {
      if (signal?.aborted) {
        throw new Error("Parallel worker cancelled");
      }
      const time = i / captureOptions.fps;

      if (onFrameBuffer) {
        // Streaming mode: capture to buffer and invoke callback
        const { buffer } = await captureFrameToBuffer(session, i, time);
        await onFrameBuffer(i, buffer);
      } else {
        // Disk mode: capture to file
        await captureFrame(session, i, time);
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
