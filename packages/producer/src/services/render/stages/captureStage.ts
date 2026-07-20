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
  type CapturePerfSummary,
  type CaptureSession,
  type EngineConfig,
  captureFrame,
  captureFrameToBufferPipelined,
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
    assertNotAborted,
    onProgress,
    frameRange,
    dedupPerfs,
  } = input;
  let { probeSession } = input;
  let { workerCount } = plan;
  const { forceScreenshot, needsAlpha } = plan;
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
      frameExt: needsAlpha ? "png" : "jpg",
      captureOptions: buildCaptureOptions(),
      createBeforeCaptureHook: createRenderVideoFrameInjector,
      abortSignal,
      frameRangeStart: frameRange?.startFrame,
      dedupPerfs,
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
      captureBeyondViewport = probeSession.options.captureBeyondViewport;
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
    captureBeyondViewport = session.options.captureBeyondViewport;
    if (probeSession) {
      prepareCaptureSessionForReuse(session, framesDir, videoInjector);
      probeSession = null;
    }

    try {
      if (!session.isInitialized) {
        await initializeSession(session);
      } else if (process.env.PRODUCER_EXPERIMENTAL_FAST_CAPTURE === "true") {
        // Deferred drawElement init (probe-initialized video comps). The disk
        // path has no drain-time self-verification, so only an explicit opt-in
        // completes it here — mirroring the orchestrator clamp that routes
        // default-on drawElement renders to the screenshot baseline on this
        // path. No-op unless the session is deferred with an injector attached.
        await completeDeferredDrawElementInit(session);
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

      const reportFrame = (fileIndex: number): void => {
        job.framesRendered = fileIndex + 1;
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
        // Worker-encode depth-2 pipeline on the DISK path (mirrors the streaming
        // path): frame N's in-page Worker encodes while frame N+1's main thread
        // does seek+paint+drawElement. Long comps (>streaming cap) land here, so
        // without this they'd fall back to synchronous toDataURL and lose the
        // ~1.5-2x worker-encode speedup entirely.
        let prev: { fileIndex: number; encodeResult: Promise<Buffer> } | null = null;
        const drainPrev = async (): Promise<void> => {
          if (!prev) return;
          assertNotAborted();
          const buf = await prev.encodeResult;
          writeCapturedFrame(session, prev.fileIndex, buf);
          reportFrame(prev.fileIndex);
        };
        for (let i = 0; i < rangeFrames; i++) {
          assertNotAborted();
          const absoluteIdx = rangeStart + i;
          const time = (absoluteIdx * job.config.fps.den) / job.config.fps.num;
          const { encodeResult } = await captureFrameToBufferPipelined(session, i, time);
          await drainPrev();
          prev = { fileIndex: i, encodeResult };
        }
        await drainPrev();
      } else {
        for (let i = 0; i < rangeFrames; i++) {
          assertNotAborted();
          const absoluteIdx = rangeStart + i;
          const time = (absoluteIdx * job.config.fps.den) / job.config.fps.num;
          await captureFrame(session, i, time);
          reportFrame(i);
        }
      }
      // Capture the sequential session's static-dedup perf before close (the
      // counters are valid only while the session is live).
      dedupPerfs.push(getCapturePerfSummary(session));
      // This must mirror streaming capture: catch wraps the original failure with
      // browser diagnostics, finally only handles cleanup.
      // fallow-ignore-next-line code-duplication
    } catch (error) {
      lastBrowserConsole = session.browserConsoleBuffer;
      throw wrapCaptureStageError(error, lastBrowserConsole);
    } finally {
      // Keep the latest console buffer for success and cleanup-error summaries.
      lastBrowserConsole = session.browserConsoleBuffer;
      await closeCaptureSession(session);
    }
  }

  return { workerCount, probeSession, lastBrowserConsole, captureBeyondViewport };
}
