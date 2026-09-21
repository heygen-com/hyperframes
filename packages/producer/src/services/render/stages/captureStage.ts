/**
 * captureStage — SDR disk-capture path of `executeRenderJob`.
 *
 * Handles both branches of the SDR / DOM-only-HDR disk-capture flow:
 *   - `workerCount > 1`: parallel capture with adaptive retry via
 *     `executeDiskCaptureWithAdaptiveRetry`.
 *   - `workerCount === 1`: sequential capture in the orchestrator process,
 *     reusing `probeSession` when available. A transient browser death retries
 *     with a fresh session resuming from the first missing frame.
 *
 * The HDR layered branch (`useLayeredComposite === true`) and the streaming
 * encode fusion path (`useStreamingEncode === true` with successful encoder
 * spawn) live in separate stages.
 *
 * Hard constraints preserved verbatim:
 *   - `probeSession` is closed (and the local binding nulled) once the
 *     stage no longer needs it. The sequencer's `let probeSession` is
 *     updated via the returned result.
 *   - `captureAttempts` is mutated in place — the parallel path appends
 *     each retry attempt to the array the sequencer owns.
 *   - `workerCount` may be reduced by an adaptive retry; the returned
 *     value reflects the final worker count for the perf summary.
 *   - `lastBrowserConsole` is set to the buffer of whichever session was
 *     active last (probe session in the parallel close path; sequential
 *     session in the sequential path).
 *   - `job.framesRendered` is updated at the same per-frame / per-progress
 *     points; the same `Capturing frame N/M` `updateJobStatus` payloads
 *     fire at 30-frame and completion checkpoints (parallel) or every
 *     frame (sequential).
 *
 * Known follow-up: this stage imports `executeDiskCaptureWithAdaptiveRetry`
 * from `renderOrchestrator.ts`, which itself imports the stage — a runtime
 * cycle that resolves at module-init time because no stage function is
 * invoked during load. A subsequent PR will consolidate the capture
 * helpers (`executeDiskCaptureWithAdaptiveRetry`, `countFrameRanges`,
 * `safeCleanup`, `sampleDirectoryBytes`, etc.) into a shared module so
 * the stages can import them without reaching back into the orchestrator.
 */

import { existsSync, readdirSync, statfsSync } from "node:fs";
import { join } from "node:path";
import {
  classifyCaptureFailure,
  frameFileExtension,
  type BeforeCaptureHook,
  type CaptureOptions,
  type CapturePerfSummary,
  type CaptureSession,
  type EngineConfig,
  captureFrame,
  captureFrameToBufferPipelined,
  verifyDiskDrawElementSamples,
  writeCapturedFrame,
  closeCaptureSession,
  completeDeferredDrawElementInit,
  createCaptureSession,
  getCapturePerfSummary,
  initializeSession,
  prepareCaptureSessionForReuse,
} from "@hyperframes/engine";
import type { FileServerHandle } from "../../fileServer.js";
import type { ProducerLogger } from "../../../logger.js";
import {
  executeDiskCaptureWithAdaptiveRetry,
  findMissingFrameRanges,
  isTransientCaptureRetryEligible,
  sampleDirectoryBytes,
  type CaptureAttemptSummary,
  type ProgressCallback,
  type RenderJob,
} from "../../renderOrchestrator.js";
import { wrapCaptureStageError } from "../captureStageError.js";
import { updateJobStatus } from "../shared.js";
import type { SdrDiskCapturePlan } from "../capturePlan.js";

export interface CaptureStageInput {
  fileServer: FileServerHandle;
  workDir: string;
  framesDir: string;
  job: RenderJob;
  /**
   * `job.totalFrames` is `number | undefined` in the public type — the
   * sequencer narrows it to a `number` via the probeStage result before
   * calling this stage. Passed in explicitly here so the stage doesn't
   * have to re-narrow on every reference.
   */
  totalFrames: number;
  cfg: EngineConfig;
  /** Immutable route selected by the sequencer. */
  plan: SdrDiskCapturePlan;
  log: ProducerLogger;
  /** Reused for the sequential path's first session if non-null. */
  probeSession: CaptureSession | null;
  /** Mutated in place — each parallel retry attempt is appended. */
  captureAttempts: CaptureAttemptSummary[];
  /**
   * Mutated in place — per-session static-dedup perf is appended (one entry
   * for the sequential session, one per worker on the parallel path). The
   * sequencer aggregates these into the `RenderPerfSummary` dedup block. Same
   * append-in-place contract as `captureAttempts`.
   */
  dedupPerfs: CapturePerfSummary[];
  buildCaptureOptions: () => CaptureOptions;
  createRenderVideoFrameInjector: () => BeforeCaptureHook | null;
  abortSignal: AbortSignal | undefined;
  assertNotAborted: () => void;
  onProgress?: ProgressCallback;
  /**
   * Capture a sub-range `[startFrame, endFrame)` of the composition's
   * timeline. Used by distributed `renderChunk` to render only its chunk.
   * Captured file names are 0-indexed within the range; per-frame TIMES use
   * the absolute frame index so the page's virtual clock matches an
   * in-process render at that frame. Supported on both the sequential and
   * parallel branches; the parallel branch threads `frameRange.startFrame`
   * through as `frameRangeStart`. See `WorkerTask.outputFrameOffset`.
   *
   * Default `undefined`: capture `[0, totalFrames)` (in-process contract).
   * When set, `endFrame - startFrame` MUST equal `totalFrames`.
   */
  frameRange?: { startFrame: number; endFrame: number };
}

export interface CaptureStageResult {
  /** Final worker count after any adaptive retry. */
  workerCount: number;
  /** Always `null` after the stage — the probe session is closed before the stage returns. */
  probeSession: CaptureSession | null;
  /** Browser console buffer from whichever session was active last. */
  lastBrowserConsole: string[];
  /** Engine-resolved screenshot flag from the consumed sequential/probe session, when observed. */
  captureBeyondViewport?: boolean;
}

/**
 * An explicit worker count selects the initial concurrency; it must not disable
 * recovery after a worker times out. The adaptive loop only retries missing
 * frames, requires forward progress, and halves workers until sequential, so it
 * remains bounded while preserving already-captured work.
 */
export function shouldAllowAdaptiveCaptureRetry(
  workerCount: number,
  _explicitlyConfigured: boolean,
): boolean {
  return workerCount > 1;
}

/** Jpeg frames are far smaller than raw pixels; this divisor is a conservative bound. */
const JPEG_RAW_RGBA_DIVISOR = 8;
/** Frames captured before the measured projection replaces the static estimate. */
const DISK_PROJECTION_SAMPLE_FRAMES = 10;

export function estimateDiskCaptureBytes(
  totalFrames: number,
  captureOptions: CaptureOptions,
): number {
  const scale = captureOptions.deviceScaleFactor ?? 1;
  const outputWidth = Math.ceil(captureOptions.width * scale);
  const outputHeight = Math.ceil(captureOptions.height * scale);
  const rawBytes = Math.ceil(totalFrames) * outputWidth * outputHeight * 4;
  return frameFileExtension(captureOptions.format) === "jpg"
    ? Math.ceil(rawBytes / JPEG_RAW_RGBA_DIVISOR)
    : rawBytes;
}

function freeDiskBytesAt(path: string): number | null {
  try {
    const stat = statfsSync(path);
    return stat.bavail * stat.bsize;
  } catch {
    return null;
  }
}

/**
 * Unknown free space (`freeBytes: null`) counts as available: the gate can
 * only reject when it has a measurement.
 */
export type DiskCaptureHeadroom =
  | { available: true; estimatedBytes: number; freeBytes: number | null }
  | { available: false; estimatedBytes: number; freeBytes: number };

/** Shared 90% disk gate used by both fallback planning and disk execution. */
export function inspectDiskCaptureHeadroom(
  framesDir: string,
  totalFrames: number,
  captureOptions: CaptureOptions,
  freeDiskBytes: (path: string) => number | null = freeDiskBytesAt,
): DiskCaptureHeadroom {
  const freeBytes = freeDiskBytes(framesDir);
  const estimatedBytes = estimateDiskCaptureBytes(totalFrames, captureOptions);
  if (freeBytes === null || estimatedBytes <= freeBytes * 0.9) {
    return { available: true, estimatedBytes, freeBytes };
  }
  return { available: false, estimatedBytes, freeBytes };
}

export function diskCaptureShortfallError(
  needBytes: number,
  freeBytes: number,
  framesDir: string,
  basis: "estimate" | "measured",
): Error {
  const basisNote =
    basis === "measured"
      ? ` (measured from the first ${DISK_PROJECTION_SAMPLE_FRAMES} frames)`
      : "";
  return new Error(
    `Disk capture may need ~${(needBytes / 1e6).toFixed(1)} MB of temporary frame storage${basisNote}, ` +
      `but only ${(freeBytes / 1e6).toFixed(1)} MB is free at ${framesDir}. ` +
      "Disk capture stores every frame as an image file (JPEG, or PNG for alpha). mp4/mov renders stream instead: " +
      "always at --workers 1, and multi-worker on Linux BeginFrame capture. " +
      "This render landed on disk because the output is png-sequence or gif, because it " +
      "is multi-worker screenshot capture (opt in with HF_CAPTURE_PARALLEL_STREAM=true), " +
      "or because streaming was switched off: HF_CAPTURE_PARALLEL_STREAM=false, " +
      "PRODUCER_ENABLE_STREAMING_ENCODE=false, or the duration cap " +
      "(PRODUCER_STREAMING_ENCODE_DURATION_CAP_ENABLED=true) on a render longer than " +
      "PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS. HDR and shader-transition renders " +
      "never reach this check; they run their own compositor. " +
      "Re-run with --workers 1, use --low-memory-mode, or free up disk space.",
  );
}

export function assertDiskCaptureHeadroom(
  framesDir: string,
  totalFrames: number,
  captureOptions: CaptureOptions,
  freeDiskBytes?: (path: string) => number | null,
): void {
  const headroom = inspectDiskCaptureHeadroom(
    framesDir,
    totalFrames,
    captureOptions,
    freeDiskBytes,
  );
  if (headroom.available) return;
  throw diskCaptureShortfallError(
    headroom.estimatedBytes,
    headroom.freeBytes,
    framesDir,
    "estimate",
  );
}

/** Frame bytes written so far: the merged frames dir plus every capture attempt's worker dirs. */
export function measureCaptureFrameBytes(workDir: string, framesDir: string): number {
  let total = sampleDirectoryBytes(framesDir);
  if (!existsSync(workDir)) return total;
  for (const attempt of readdirSync(workDir)) {
    if (/^retry-\d+-batch-\d+-worker-\d+$/.test(attempt)) {
      total += sampleDirectoryBytes(join(workDir, attempt));
      continue;
    }
    if (!/^capture-attempt-\d+$/.test(attempt)) continue;
    const attemptDir = join(workDir, attempt);
    for (const name of readdirSync(attemptDir)) {
      if (/^worker-\d+$/.test(name)) total += sampleDirectoryBytes(join(attemptDir, name));
    }
  }
  return total;
}

/** Per-frame callback: after the sample frames, throws if the projected remainder exceeds 90% of free space. */
export function createDiskCaptureProjection(input: {
  framesDir: string;
  totalFrames: number;
  measureBytes: () => number;
  freeDiskBytes?: (path: string) => number | null;
}): (capturedFrames: number) => void {
  const { framesDir, totalFrames, measureBytes, freeDiskBytes = freeDiskBytesAt } = input;
  let checked = false;
  return (capturedFrames) => {
    if (checked || capturedFrames < DISK_PROJECTION_SAMPLE_FRAMES) return;
    const measured = measureBytes();
    if (measured <= 0) return;
    checked = true;
    const remaining = totalFrames - capturedFrames;
    const freeBytes = freeDiskBytes(framesDir);
    if (remaining <= 0 || freeBytes === null) return;
    const needBytes = Math.ceil((measured / capturedFrames) * remaining);
    if (needBytes > freeBytes * 0.9) {
      throw diskCaptureShortfallError(needBytes, freeBytes, framesDir, "measured");
    }
  };
}

export async function runCaptureStage(input: CaptureStageInput): Promise<CaptureStageResult> {
  const {
    fileServer,
    workDir,
    framesDir,
    job,
    totalFrames,
    cfg,
    plan,
    log,
    captureAttempts,
    buildCaptureOptions,
    createRenderVideoFrameInjector,
    abortSignal,
    onProgress,
    frameRange,
    dedupPerfs,
  } = input;
  let { probeSession } = input;
  let { workerCount } = plan;
  const { forceScreenshot } = plan;
  let lastBrowserConsole: string[] = [];
  let captureBeyondViewport: boolean | undefined = probeSession?.options.captureBeyondViewport;

  // Derive a local cfg view rather than reading `forceScreenshot` from the
  // caller-owned `cfg`. The sequencer threads the resolved value via the
  // immutable plan; this keeps the engine-facing config a pure
  // pass-through.
  const captureCfg: EngineConfig =
    cfg.forceScreenshot === forceScreenshot ? cfg : { ...cfg, forceScreenshot };

  if (frameRange !== undefined) {
    if (
      !Number.isFinite(frameRange.startFrame) ||
      !Number.isFinite(frameRange.endFrame) ||
      frameRange.startFrame < 0 ||
      frameRange.endFrame <= frameRange.startFrame
    ) {
      throw new Error(
        `[captureStage] invalid frameRange: ${JSON.stringify(frameRange)}. ` +
          `Expected non-negative startFrame strictly less than endFrame.`,
      );
    }
    // The parallel branch passes `totalFrames` to executeDiskCaptureWithAdaptiveRetry
    // (which drives `distributeFrames` partitioning and `findMissingFrameRanges`
    // completion checks) AND `frameRangeStart` separately. They must describe the
    // same window: callers passing `totalFrames=100, frameRange={50, 200}` would
    // get a silently wrong distribution.
    const rangeFrames = frameRange.endFrame - frameRange.startFrame;
    if (rangeFrames !== totalFrames) {
      throw new Error(
        `[captureStage] frameRange size (${rangeFrames}) must equal totalFrames (${totalFrames}). ` +
          `Received frameRange=${JSON.stringify(frameRange)}.`,
      );
    }
  }

  const captureOptions = buildCaptureOptions();
  assertDiskCaptureHeadroom(framesDir, totalFrames, captureOptions);
  const checkDiskProjection = createDiskCaptureProjection({
    framesDir,
    totalFrames,
    measureBytes: () => measureCaptureFrameBytes(workDir, framesDir),
  });

  if (workerCount > 1) {
    // Parallel capture. When `frameRange` is set (distributed chunk), pass
    // `frameRangeStart` so workers land on absolute composition frame indices
    // for time math while file names stay 0-indexed within the chunk range.
    const attempts = await executeDiskCaptureWithAdaptiveRetry({
      serverUrl: fileServer.url,
      workDir,
      framesDir,
      totalFrames,
      initialWorkerCount: workerCount,
      allowRetry: shouldAllowAdaptiveCaptureRetry(workerCount, job.config.workers !== undefined),
      frameExt: frameFileExtension(captureOptions.format),
      captureOptions,
      createBeforeCaptureHook: createRenderVideoFrameInjector,
      abortSignal,
      frameRangeStart: frameRange?.startFrame,
      dedupPerfs,
      onProgress: (progress) => {
        job.framesRendered = progress.capturedFrames;
        checkDiskProjection(progress.capturedFrames);
        const frameProgress = progress.capturedFrames / progress.totalFrames;
        const progressPct = 25 + frameProgress * 45;

        if (
          progress.capturedFrames % 30 === 0 ||
          progress.capturedFrames === progress.totalFrames
        ) {
          updateJobStatus(
            job,
            "rendering",
            `Capturing frame ${progress.capturedFrames}/${progress.totalFrames} (${progress.activeWorkers} workers)`,
            Math.round(progressPct),
            onProgress,
          );
        }
      },
      cfg: captureCfg,
      log,
    });
    captureAttempts.push(...attempts);
    const lastAttempt = attempts[attempts.length - 1];
    if (lastAttempt) {
      workerCount = lastAttempt.workers;
    }
    if (probeSession) {
      captureBeyondViewport = probeSession.options.captureBeyondViewport;
      lastBrowserConsole = probeSession.browserConsoleBuffer;
      await closeCaptureSession(probeSession);
      probeSession = null;
    }
  } else {
    const sequential = await runSequentialDiskCapture(
      input,
      captureOptions,
      captureCfg,
      checkDiskProjection,
    );
    probeSession = null;
    lastBrowserConsole = sequential.lastBrowserConsole;
    captureBeyondViewport = sequential.captureBeyondViewport;
  }

  return { workerCount, probeSession, lastBrowserConsole, captureBeyondViewport };
}

interface SequentialCaptureResult {
  lastBrowserConsole: string[];
  captureBeyondViewport: boolean | undefined;
}

async function runSequentialDiskCapture(
  input: CaptureStageInput,
  captureOptions: CaptureOptions,
  captureCfg: EngineConfig,
  checkDiskProjection: (capturedFrames: number) => void,
): Promise<SequentialCaptureResult> {
  const {
    fileServer,
    framesDir,
    totalFrames,
    log,
    createRenderVideoFrameInjector,
    abortSignal,
    assertNotAborted,
    frameRange,
  } = input;
  let { probeSession } = input;
  let lastBrowserConsole: string[] = [];
  let captureBeyondViewport: boolean | undefined;
  // Sequential capture. Frame TIMES use the absolute composition index;
  // file NAMES are relative (loop index `i`), so the encoder needs no
  // `-start_number`.
  const { rangeStart, rangeEnd } = resolveCaptureRange(frameRange, totalFrames);
  const rangeFrames = rangeEnd - rangeStart;
  const frameExt = frameFileExtension(captureOptions.format);
  // Transient-browser retry: `resumeFrom` moves to the first frame missing
  // from disk and a fresh session captures the remainder. Capped by
  // `isTransientCaptureRetryEligible`.
  let transientRetriesUsed = 0;
  let resumeFrom = 0;

  while (true) {
    const videoInjector = createRenderVideoFrameInjector();
    const session =
      probeSession ??
      (await createCaptureSession(
        fileServer.url,
        framesDir,
        captureOptions,
        videoInjector,
        captureCfg,
      ));
    captureBeyondViewport = session.options.captureBeyondViewport;

    try {
      // Reuse preparation can fail on the output dir (permissions, read-only, disk full);
      // keep it inside try/finally so the borrowed probe browser is still closed.
      if (probeSession) {
        prepareCaptureSessionForReuse(session, framesDir, videoInjector);
        probeSession = null;
      }
      await ensureSessionReady(session);
      assertNotAborted();
      lastBrowserConsole = session.browserConsoleBuffer;

      await captureSessionFrames(session, {
        input,
        rangeStart,
        rangeEnd,
        resumeFrom,
        checkDiskProjection,
      });
      break;
      // This must mirror streaming capture: catch wraps the original failure with
      // browser diagnostics, finally only handles cleanup.
      // fallow-ignore-next-line code-duplication
    } catch (error) {
      lastBrowserConsole = session.browserConsoleBuffer;
      const resume = planTransientResume(error, {
        abortSignal,
        rangeFrames,
        framesDir,
        frameExt,
        retriesUsed: transientRetriesUsed,
      });
      if (resume !== null) {
        transientRetriesUsed++;
        resumeFrom = resume;
        log.warn(
          "[Render] Transient browser failure during sequential capture; retrying once with a fresh session.",
          {
            resumeFrom,
            rangeFrames,
            transientRetriesUsed,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        continue;
      }
      throw wrapCaptureStageError(error, lastBrowserConsole);
    } finally {
      // Keep the latest console buffer for success and cleanup-error summaries.
      lastBrowserConsole = session.browserConsoleBuffer;
      await closeCaptureSession(session);
    }
  }
  return { lastBrowserConsole, captureBeyondViewport };
}

function resolveCaptureRange(
  frameRange: CaptureStageInput["frameRange"],
  totalFrames: number,
): { rangeStart: number; rangeEnd: number } {
  return { rangeStart: frameRange?.startFrame ?? 0, rangeEnd: frameRange?.endFrame ?? totalFrames };
}

/** First frame missing on disk when the failure is a retryable browser death, else null. */
function planTransientResume(
  error: unknown,
  ctx: {
    abortSignal: AbortSignal | undefined;
    rangeFrames: number;
    framesDir: string;
    frameExt: "png" | "jpg";
    retriesUsed: number;
  },
): number | null {
  const failure = classifyCaptureFailure(error, { signal: ctx.abortSignal });
  const missing = findMissingFrameRanges(ctx.rangeFrames, ctx.framesDir, ctx.frameExt);
  const [firstMissing] = missing;
  if (!firstMissing) return null;
  return isTransientCaptureRetryEligible(failure.kind, missing, ctx.retriesUsed)
    ? firstMissing.startFrame
    : null;
}

async function ensureSessionReady(session: CaptureSession): Promise<void> {
  if (!session.isInitialized) {
    await initializeSession(session);
    return;
  }
  // Deferred drawElement init (probe-initialized video comps). The disk path has no
  // drain-time self-verification, so only the explicit fast-capture opt-in completes it.
  if (process.env.PRODUCER_EXPERIMENTAL_FAST_CAPTURE === "true") {
    await completeDeferredDrawElementInit(session);
  }
}

interface SequentialFrameLoop {
  input: CaptureStageInput;
  rangeStart: number;
  rangeEnd: number;
  resumeFrom: number;
  checkDiskProjection: (capturedFrames: number) => void;
}

async function captureSessionFrames(
  session: CaptureSession,
  { input, rangeStart, rangeEnd, resumeFrom, checkDiskProjection }: SequentialFrameLoop,
): Promise<void> {
  const { job, framesDir, dedupPerfs, assertNotAborted, onProgress } = input;
  const rangeFrames = rangeEnd - rangeStart;
  const reportFrame = (fileIndex: number): void => {
    job.framesRendered = fileIndex + 1;
    checkDiskProjection(fileIndex + 1);
    // Keep status cadence identical to the streaming sequential path; the
    // capture error wrapper below must remain separate from finally so it
    // can throw with the browser console before cleanup overwrites flow.
    // fallow-ignore-next-line code-duplication
    updateJobStatus(
      job,
      "rendering",
      `Capturing frame ${fileIndex + 1}/${rangeFrames}`,
      Math.round(25 + ((fileIndex + 1) / rangeFrames) * 45),
      onProgress,
    );
  };

  if (session.workerEncodeEnabled) {
    // Depth-2 pipeline: frame N encodes in the page Worker while frame N+1 seeks and paints.
    let prev: { fileIndex: number; encodeResult: Promise<Buffer> } | null = null;
    const drainPrev = async (): Promise<void> => {
      if (!prev) return;
      assertNotAborted();
      const buf = await prev.encodeResult;
      writeCapturedFrame(session, prev.fileIndex, buf);
      reportFrame(prev.fileIndex);
    };
    for (let i = resumeFrom; i < rangeFrames; i++) {
      assertNotAborted();
      const absoluteIdx = rangeStart + i;
      const time = (absoluteIdx * job.config.fps.den) / job.config.fps.num;
      const { encodeResult } = await captureFrameToBufferPipelined(session, i, time);
      await drainPrev();
      prev = { fileIndex: i, encodeResult };
    }
    await drainPrev();
  } else {
    for (let i = resumeFrom; i < rangeFrames; i++) {
      assertNotAborted();
      const absoluteIdx = rangeStart + i;
      const time = (absoluteIdx * job.config.fps.den) / job.config.fps.num;
      await captureFrame(session, i, time);
      reportFrame(i);
    }
  }
  // A breach throws DrawElementVerificationError; the orchestrator retries via screenshot.
  // Only the resumed range is sampled after a transient retry.
  await verifyDiskDrawElementSamples(
    session,
    {
      workerId: 0,
      startFrame: rangeStart + resumeFrom,
      endFrame: rangeEnd,
      outputDir: framesDir,
      outputFrameOffset: rangeStart,
    },
    false,
  );
  // Capture the sequential session's static-dedup perf before close (the
  // counters are valid only while the session is live).
  dedupPerfs.push(getCapturePerfSummary(session));
}
