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
import { type BeforeCaptureHook, type CaptureOptions, type CaptureSession, type EngineConfig } from "@hyperframes/engine";
import type { FileServerHandle } from "../../fileServer.js";
import type { ProducerLogger } from "../../../logger.js";
import { type CaptureAttemptSummary, type ProgressCallback, type RenderJob } from "../../renderOrchestrator.js";
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
     * timeline. Used by distributed `renderChunk` workers to render only
     * their assigned chunk. Captured frames are written with file names
     * normalized to start at zero (`frame_000000.{ext}`) so the encoder
     * doesn't need an `-start_number` override; per-frame TIMES still
     * reflect the absolute frame index via `(absIdx * fps.den) / fps.num`,
     * keeping the page's virtual clock identical to what an in-process
     * render at that frame would see.
     *
     * Only honored on the sequential capture branch (workerCount === 1).
     * The parallel branch in this stage targets in-process renders where
     * adaptive retry across the whole timeline is the contract, and chunk
     * workers fan out at the activity layer instead. Passing `frameRange`
     * with `workerCount > 1` throws — the caller should reduce
     * `workerCount` to 1.
     *
     * Default `undefined`: the stage captures `[0, totalFrames)` (the
     * in-process contract).
     */
    frameRange?: {
        startFrame: number;
        endFrame: number;
    };
}
export interface CaptureStageResult {
    /** Final worker count after any adaptive retry. */
    workerCount: number;
    /** Always `null` after the stage — the probe session is closed before the stage returns. */
    probeSession: CaptureSession | null;
    /** Browser console buffer from whichever session was active last. */
    lastBrowserConsole: string[];
}
export declare function runCaptureStage(input: CaptureStageInput): Promise<CaptureStageResult>;
//# sourceMappingURL=captureStage.d.ts.map