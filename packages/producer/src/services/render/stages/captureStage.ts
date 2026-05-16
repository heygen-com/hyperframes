/**
 * captureStage — SDR disk-capture path of `executeRenderJob`.
 *
 * Handles both branches of the SDR / DOM-only-HDR disk-capture flow:
 *   - `workerCount > 1`: parallel capture with adaptive retry via
 *     `executeDiskCaptureWithAdaptiveRetry`.
 *   - `workerCount === 1`: sequential capture in the orchestrator process,
 *     reusing `probeSession` when available.
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

import {
  type BeforeCaptureHook,
  type CaptureOptions,
  type CaptureSession,
  type EngineConfig,
  captureFrame,
  closeCaptureSession,
  createCaptureSession,
  initializeSession,
  prepareCaptureSessionForReuse,
} from "@hyperframes/engine";
import type { FileServerHandle } from "../../fileServer.js";
import type { ProducerLogger } from "../../../logger.js";
import {
  executeDiskCaptureWithAdaptiveRetry,
  type CaptureAttemptSummary,
  type ProgressCallback,
  type RenderJob,
} from "../../renderOrchestrator.js";
import { updateJobStatus } from "../shared.js";

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
  /**
   * Capture-mode flag threaded from `compileStage`. The stage derives a
   * local copy of `cfg` with this value applied to `forceScreenshot`
   * before any engine call, so the caller-owned `cfg` is never mutated.
   * The sequencer may override `compileResult.forceScreenshot` after a
   * BeginFrame calibration timeout — passing the override through this
   * parameter keeps the decision visible at the call site instead of
   * hiding it inside a shared mutable config.
   */
  forceScreenshot: boolean;
  log: ProducerLogger;
  /** Initial worker count from `resolveRenderWorkerCount`; adaptive retry may reduce it. */
  workerCount: number;
  /** Reused for the sequential path's first session if non-null. */
  probeSession: CaptureSession | null;
  /** True for webm / mov / png-sequence (controls capture format + extension). */
  needsAlpha: boolean;
  /** Mutated in place — each parallel retry attempt is appended. */
  captureAttempts: CaptureAttemptSummary[];
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
}

export async function runCaptureStage(input: CaptureStageInput): Promise<CaptureStageResult> {
  const {
    fileServer,
    workDir,
    framesDir,
    job,
    totalFrames,
    cfg,
    forceScreenshot,
    log,
    captureAttempts,
    buildCaptureOptions,
    createRenderVideoFrameInjector,
    abortSignal,
    assertNotAborted,
    onProgress,
    needsAlpha,
    frameRange,
  } = input;
  let { workerCount, probeSession } = input;
  let lastBrowserConsole: string[] = [];

  // Derive a local cfg view rather than reading `forceScreenshot` from the
  // caller-owned `cfg`. The sequencer threads the resolved value via the
  // explicit parameter; this keeps the engine-facing config a pure
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
      allowRetry: job.config.workers === undefined,
      frameExt: needsAlpha ? "png" : "jpg",
      captureOptions: buildCaptureOptions(),
      createBeforeCaptureHook: createRenderVideoFrameInjector,
      abortSignal,
      frameRangeStart: frameRange?.startFrame,
      onProgress: (progress) => {
        job.framesRendered = progress.capturedFrames;
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
      lastBrowserConsole = probeSession.browserConsoleBuffer;
      await closeCaptureSession(probeSession);
      probeSession = null;
    }
  } else {
    // Sequential capture

    const videoInjector = createRenderVideoFrameInjector();
    const session =
      probeSession ??
      (await createCaptureSession(
        fileServer.url,
        framesDir,
        buildCaptureOptions(),
        videoInjector,
        captureCfg,
      ));
    if (probeSession) {
      prepareCaptureSessionForReuse(session, framesDir, videoInjector);
      probeSession = null;
    }

    try {
      if (!session.isInitialized) {
        await initializeSession(session);
      }
      assertNotAborted();
      lastBrowserConsole = session.browserConsoleBuffer;

      // `frameRange` captures only a sub-range of the timeline. Per-frame
      // TIMES still use the absolute composition frame index so the page's
      // virtual clock matches an in-process render at the same frame;
      // file NAMES are normalized to 0 (via the relative loop index `i`)
      // so the encoder can read frames without an `-start_number` override.
      const rangeStart = frameRange?.startFrame ?? 0;
      const rangeEnd = frameRange?.endFrame ?? totalFrames;
      const rangeFrames = rangeEnd - rangeStart;

      for (let i = 0; i < rangeFrames; i++) {
        assertNotAborted();
        const absoluteIdx = rangeStart + i;
        const time = (absoluteIdx * job.config.fps.den) / job.config.fps.num;
        await captureFrame(session, i, time);
        job.framesRendered = i + 1;

        const frameProgress = (i + 1) / rangeFrames;
        const progress = 25 + frameProgress * 45;

        updateJobStatus(
          job,
          "rendering",
          `Capturing frame ${i + 1}/${rangeFrames}`,
          Math.round(progress),
          onProgress,
        );
      }
    } finally {
      lastBrowserConsole = session.browserConsoleBuffer;
      await closeCaptureSession(session);
    }
  }

  return { workerCount, probeSession, lastBrowserConsole };
}
