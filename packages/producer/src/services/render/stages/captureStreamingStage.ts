/**
 * captureStreamingStage — single-machine fused capture + encode path.
 *
 * Streaming mode pipes captured frame buffers directly into ffmpeg's stdin
 * via `spawnStreamingEncoder`, skipping disk writes and the separate
 * Stage 5 encode step. In effect, Stage 4 (capture) absorbs Stage 5
 * (encode) for renders that fit the single-machine fusion path.
 *
 * The streaming path is gated by `shouldUseStreamingEncode(...)` upstream:
 *   - Disabled when output is png-sequence (no encoder).
 *   - Disabled for parallel renders auto-selected by calibration where the
 *     ordered streaming writer would stall later workers behind earlier
 *     ranges (the orchestrator decides this; the stage is told via input).
 *   - Disabled in distributed mode (which writes chunks to disk).
 *
 * If `spawnStreamingEncoder` fails for any non-abort reason, the stage
 * returns `{ success: false }` and the sequencer falls back to the disk
 * capture path. This mirrors the original orchestrator's flag-flip
 * (`useStreamingEncode = false`).
 *
 * Hard constraints preserved verbatim from the in-process renderer:
 *   - `probeSession` is closed when the parallel path takes over, OR in
 *     the sequential session's `finally`. Either way the local binding
 *     is nulled and the result returns the updated value.
 *   - `lastBrowserConsole` is set to the buffer of whichever session
 *     was active last (probe close path, or sequential session finally).
 *   - `job.framesRendered` is updated per-frame; `Streaming frame N/M`
 *     `updateJobStatus` payloads fire at the same 30-frame and
 *     completion checkpoints (parallel) or every frame (sequential).
 *   - Encoder close + result inspection happens inside the stage; a
 *     `Streaming encode failed: ...` error throws on `success: false`.
 *   - Defensive cleanup of `streamingEncoder` happens in the stage's
 *     own `finally` regardless of success/failure, gated on
 *     `streamingEncoderClosed` so it's idempotent.
 *
 * Known follow-up (same as captureStage): this stage imports
 * `updateJobStatus` from `renderOrchestrator.ts`, forming a runtime
 * cycle with the orchestrator's import of `runCaptureStreamingStage`.
 * Safe at runtime; a subsequent change will move the capture helpers
 * into a shared module so the stages can import without reaching back.
 */

import {
  type BeforeCaptureHook,
  type CaptureOptions,
  type CaptureSession,
  type EngineConfig,
  type StreamingEncoder,
  captureFrameToBuffer,
  closeCaptureSession,
  createCaptureSession,
  createFrameReorderBuffer,
  distributeFrames,
  executeParallelCapture,
  initializeSession,
  prepareCaptureSessionForReuse,
  spawnStreamingEncoder,
} from "@hyperframes/engine";
import type { FileServerHandle } from "../../fileServer.js";
import type { ProducerLogger } from "../../../logger.js";
import type { ProgressCallback, RenderJob } from "../../renderOrchestrator.js";
import { wrapCaptureStageError } from "../captureStageError.js";
import { updateJobStatus } from "../shared.js";

/**
 * Pre-built ffmpeg streaming-encoder options, exactly matching the
 * second argument to `spawnStreamingEncoder`. The sequencer constructs
 * this from its in-scope preset / dimensions / quality fields and
 * passes it through so the stage doesn't have to reach back for the
 * preset's internal shape.
 */
export type StreamingEncoderOptions = Parameters<typeof spawnStreamingEncoder>[1];

export interface CaptureStreamingStageInput {
  fileServer: FileServerHandle;
  workDir: string;
  framesDir: string;
  videoOnlyPath: string;
  job: RenderJob;
  /**
   * `job.totalFrames` is `number | undefined` in the public type — the
   * sequencer narrows it via the probeStage result before calling here.
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
  workerCount: number;
  probeSession: CaptureSession | null;
  /** For the spawn-failure log message context only. */
  outputFormat: string;
  /** Pre-built encoder options; passed straight to `spawnStreamingEncoder`. */
  streamingEncoderOptions: StreamingEncoderOptions;
  buildCaptureOptions: () => CaptureOptions;
  createRenderVideoFrameInjector: () => BeforeCaptureHook | null;
  abortSignal: AbortSignal | undefined;
  assertNotAborted: () => void;
  onProgress?: ProgressCallback;
}

export type CaptureStreamingStageResult =
  | {
      /** Streaming path ran successfully — sequencer should skip the disk path AND Stage 5 encode. */
      success: true;
      /** Wall-clock ms for the encode phase (overlapped with capture; from the encoder's own report). */
      encodeMs: number;
      probeSession: CaptureSession | null;
      lastBrowserConsole: string[];
      workerCount: number;
    }
  | {
      /** Spawn failed (non-abort) — sequencer should fall back to the disk path. */
      success: false;
    };

export async function runCaptureStreamingStage(
  input: CaptureStreamingStageInput,
): Promise<CaptureStreamingStageResult> {
  const {
    fileServer,
    workDir,
    framesDir,
    videoOnlyPath,
    job,
    totalFrames,
    cfg,
    forceScreenshot,
    log,
    outputFormat,
    streamingEncoderOptions,
    buildCaptureOptions,
    createRenderVideoFrameInjector,
    abortSignal,
    assertNotAborted,
    onProgress,
  } = input;
  let { workerCount, probeSession } = input;
  let lastBrowserConsole: string[] = [];

  // Derive a local cfg view rather than reading `forceScreenshot` from the
  // caller-owned `cfg`. The sequencer threads the resolved value via the
  // explicit parameter; this keeps the engine-facing config a pure
  // pass-through.
  const captureCfg: EngineConfig =
    cfg.forceScreenshot === forceScreenshot ? cfg : { ...cfg, forceScreenshot };

  let streamingEncoder: StreamingEncoder | null = null;
  let streamingEncoderClosed = false;

  try {
    streamingEncoder = await spawnStreamingEncoder(
      videoOnlyPath,
      streamingEncoderOptions,
      abortSignal,
      cfg,
    );
    assertNotAborted();
  } catch (err) {
    if (abortSignal?.aborted) {
      if (streamingEncoder && !streamingEncoderClosed) {
        await (streamingEncoder as StreamingEncoder).close().catch(() => {});
        streamingEncoderClosed = true;
      }
      throw err;
    }
    log.warn("[Render] Streaming encoder spawn failed; falling back to disk-frame encode.", {
      error: err instanceof Error ? err.message : String(err),
      outputFormat,
      workerCount,
      durationSeconds: job.duration,
    });
    return { success: false };
  }

  const currentEncoder: StreamingEncoder = streamingEncoder;

  try {
    // ── Streaming capture + encode (Stage 4 absorbs Stage 5) ──────────
    // Streaming encode is locked in here; capture retries may shrink
    // workerCount later, but must not grow a streaming render past one worker.
    const reorderBuffer = createFrameReorderBuffer(0, totalFrames);

    if (workerCount > 1) {
      // Parallel capture → streaming encode
      const tasks = distributeFrames(totalFrames, workerCount, workDir);

      const onFrameBuffer = async (frameIndex: number, buffer: Buffer): Promise<void> => {
        await reorderBuffer.waitForFrame(frameIndex);
        currentEncoder.writeFrame(buffer);
        reorderBuffer.advanceTo(frameIndex + 1);
      };

      await executeParallelCapture(
        fileServer.url,
        workDir,
        tasks,
        buildCaptureOptions(),
        createRenderVideoFrameInjector,
        abortSignal,
        (progress) => {
          job.framesRendered = progress.capturedFrames;
          const frameProgress = progress.capturedFrames / progress.totalFrames;
          const progressPct = 25 + frameProgress * 55;

          if (
            progress.capturedFrames % 30 === 0 ||
            progress.capturedFrames === progress.totalFrames
          ) {
            updateJobStatus(
              job,
              "rendering",
              `Streaming frame ${progress.capturedFrames}/${progress.totalFrames} (${workerCount} workers)`,
              Math.round(progressPct),
              onProgress,
            );
          }
        },
        onFrameBuffer,
        captureCfg,
      );

      if (probeSession) {
        lastBrowserConsole = probeSession.browserConsoleBuffer;
        await closeCaptureSession(probeSession);
        probeSession = null;
      }
    } else {
      // Sequential capture → streaming encode

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

        for (let i = 0; i < totalFrames; i++) {
          assertNotAborted();
          const time = (i * job.config.fps.den) / job.config.fps.num;
          const { buffer } = await captureFrameToBuffer(session, i, time);
          await reorderBuffer.waitForFrame(i);
          currentEncoder.writeFrame(buffer);
          reorderBuffer.advanceTo(i + 1);
          job.framesRendered = i + 1;

          const frameProgress = (i + 1) / totalFrames;
          const progress = 25 + frameProgress * 55;

          // Keep status cadence identical to disk sequential capture; the
          // capture error wrapper below must remain separate from finally so it
          // can throw with the browser console before encoder cleanup runs.
          // fallow-ignore-next-line code-duplication
          updateJobStatus(
            job,
            "rendering",
            `Streaming frame ${i + 1}/${totalFrames}`,
            Math.round(progress),
            onProgress,
          );
        }
        // This must mirror disk capture: catch wraps the original failure with
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

    // Close encoder and get result
    const encodeResult = await currentEncoder.close();
    streamingEncoderClosed = true;
    assertNotAborted();

    if (!encodeResult.success) {
      throw new Error(`Streaming encode failed: ${encodeResult.error}`);
    }

    return {
      success: true,
      encodeMs: encodeResult.durationMs,
      probeSession,
      lastBrowserConsole,
      workerCount,
    };
  } finally {
    // Defensive cleanup: if the streaming branch threw before
    // currentEncoder.close() (e.g. capture failure, abort, broken pipe),
    // the ffmpeg subprocess would otherwise leak. close() is idempotent so
    // this is safe to call alongside the success-path close — we just gate
    // on the flag to avoid redundant work.
    if (streamingEncoder && !streamingEncoderClosed) {
      try {
        await streamingEncoder.close();
      } catch (err) {
        log.warn("streamingEncoder defensive close failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
