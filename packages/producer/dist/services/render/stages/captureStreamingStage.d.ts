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
import { type BeforeCaptureHook, type CaptureOptions, type CaptureSession, type EngineConfig, spawnStreamingEncoder } from "@hyperframes/engine";
import type { FileServerHandle } from "../../fileServer.js";
import type { ProducerLogger } from "../../../logger.js";
import type { ProgressCallback, RenderJob } from "../../renderOrchestrator.js";
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
export type CaptureStreamingStageResult = {
    /** Streaming path ran successfully — sequencer should skip the disk path AND Stage 5 encode. */
    success: true;
    /** Wall-clock ms for the encode phase (overlapped with capture; from the encoder's own report). */
    encodeMs: number;
    probeSession: CaptureSession | null;
    lastBrowserConsole: string[];
    workerCount: number;
} | {
    /** Spawn failed (non-abort) — sequencer should fall back to the disk path. */
    success: false;
};
export declare function runCaptureStreamingStage(input: CaptureStreamingStageInput): Promise<CaptureStreamingStageResult>;
//# sourceMappingURL=captureStreamingStage.d.ts.map