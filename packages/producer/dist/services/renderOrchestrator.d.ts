/**
 * Render Orchestrator Service
 *
 * `executeRenderJob` is the in-process entry point that composes the
 * pipeline's six stages. Each stage lives in its own module under
 * `./render/stages/` so the pure-function primitives can be reused by
 * the distributed render path without dragging the orchestrator's
 * cleanup and observability scaffolding with them.
 *
 *   Stage 1  compile         → services/render/stages/compileStage.ts
 *   Stage 1b probe           → services/render/stages/probeStage.ts
 *            (browser-driven duration discovery + media reconciliation;
 *            grouped with Stage 1 in the perf summary)
 *   Stage 2  extract videos  → services/render/stages/extractVideosStage.ts
 *   Stage 3  audio           → services/render/stages/audioStage.ts
 *   Stage 4  capture         → services/render/stages/captureStage.ts
 *                              services/render/stages/captureStreamingStage.ts
 *                              services/render/stages/captureHdrStage.ts
 *   Stage 5  encode          → services/render/stages/encodeStage.ts
 *   Stage 6  assemble        → services/render/stages/assembleStage.ts
 *
 * Resources spawned by stages (file server, capture sessions, streaming
 * encoders, raw HDR frame files) are tracked in the orchestrator's
 * `try/finally` so a stage throwing mid-pipeline doesn't leak Chrome
 * processes or ffmpeg subprocesses.
 *
 * Heavy observability: every stage records timing into `perfStages`,
 * errors carry full context, and failures produce a diagnostic summary
 * (browser console tail, memory peaks, capture attempts, HDR
 * diagnostics).
 */
import { type CanvasResolution, type Fps } from "@hyperframes/core";
import { type EngineConfig, type ExtractedFrames, type ExtractionPhaseBreakdown, type HdrTransfer, type CaptureOptions, type CaptureVideoMetadataHint, type CaptureSession, type BeforeCaptureHook, type ParallelProgress, type WorkerTask, type ElementStackingInfo, type HfTransitionMeta } from "@hyperframes/engine";
import { type CompiledComposition } from "./htmlCompiler.js";
import { type ProducerLogger } from "../logger.js";
import { type HdrImageTransferCache } from "./hdrImageTransferCache.js";
/**
 * Metadata for a shader transition between two scenes, extracted from
 * `window.__hf.transitions`. Re-exported from the engine so the producer
 * shares the contract with composition runtime code.
 */
export type HdrTransitionMeta = HfTransitionMeta;
/** Pre-computed frame range for an active transition. */
export interface TransitionRange extends HdrTransitionMeta {
    startFrame: number;
    endFrame: number;
}
export type RenderStatus = "queued" | "preprocessing" | "rendering" | "encoding" | "assembling" | "complete" | "failed" | "cancelled";
export interface RenderConfig {
    /**
     * Frame rate as an exact rational. Integer fps is `{ num: 30, den: 1 }`;
     * NTSC is `{ num: 30000, den: 1001 }`. This shape lets the orchestrator
     * pass the exact rational through to FFmpeg's `-r` / `-framerate` flags
     * without a decimal round-trip — see `fpsToFfmpegArg` in @hyperframes/core.
     *
     * Use `fpsToNumber(config.fps)` at any site that needs a `number` for
     * arithmetic (frame-index → time, telemetry, frame-interval ms). Decimal
     * precision at our scales is more than sufficient.
     */
    fps: Fps;
    quality: "draft" | "standard" | "high";
    /**
     * Output container format. Defaults to `"mp4"`; existing renders are
     * unaffected unless this field is set explicitly.
     *
     * - `"mp4"`: H.264 by default, or H.265 + HDR10 when HDR auto-detect
     *   engages or `hdrMode: "force-hdr"` is set. Opaque. The
     *   default streaming/social deliverable. Faststart is applied so the
     *   `moov` atom sits at the file start and the file plays from a
     *   partial download.
     * - `"webm"`: VP9 + `yuva420p` pixel format → **true alpha channel**, no
     *   chroma key. Plays in Chrome, Edge, and Firefox; Safari support for
     *   alpha-WebM is incomplete. Use this when the output should drop
     *   straight into a `<video>` over a colored background on the web.
     *   Audio is muxed as Opus.
     * - `"mov"`: ProRes 4444 + `yuva444p10le` → **true alpha channel +
     *   10-bit color**. Sized for editor ingest (Premiere, Final Cut Pro,
     *   DaVinci Resolve), not direct web playback. Audio is muxed as AAC.
     * - `"png-sequence"`: a directory of zero-padded RGBA PNGs
     *   (`frame_000001.png` …). Lossless alpha, largest on disk, no muxed
     *   audio (an `audio.aac` sidecar is written alongside the PNGs when
     *   the composition has audio elements). Use for After Effects / Nuke
     *   / Fusion ingest, or when frames need post-processing before
     *   encoding. `outputPath` is treated as a directory; it is created if
     *   it doesn't exist.
     *
     * Alpha output (`"webm"`, `"mov"`, `"png-sequence"`) automatically
     * forces screenshot capture (Chrome's BeginFrame compositor does not
     * preserve alpha on Linux headless-shell) and disables HDR — HDR +
     * alpha is not a supported combination, a warning is logged and HDR
     * falls back to SDR. The transparent-background CSS is injected by
     * the engine's `initTransparentBackground` helper, so authors should
     * not paint a fullscreen `body` / `#root` background in their
     * compositions when targeting alpha output.
     */
    format?: "mp4" | "webm" | "mov" | "png-sequence";
    workers?: number;
    useGpu?: boolean;
    debug?: boolean;
    /** Entry HTML file relative to projectDir. Defaults to "index.html". */
    entryFile?: string;
    /** Full producer config. When provided, env vars are not read. */
    producerConfig?: EngineConfig;
    /** Custom logger. Defaults to console-based defaultLogger. */
    logger?: ProducerLogger;
    /** Override CRF for the video encoder. Mutually exclusive with `videoBitrate`. */
    crf?: number;
    /** Target video bitrate (e.g. "10M"). Mutually exclusive with `crf`. */
    videoBitrate?: string;
    /** HDR rendering mode.
     * - `auto` (default): probe sources; enable HDR if any HDR content is found.
     * - `force-hdr`: enable HDR even on SDR-only compositions (falls back to HLG transfer).
     * - `force-sdr`: skip probing entirely; always render SDR.
     */
    hdrMode?: "auto" | "force-hdr" | "force-sdr";
    /**
     * Render-time variable overrides for the composition. Injected as
     * `window.__hfVariables` before any page script runs and consumed by the
     * runtime helper `getVariables()`, which merges them over the declared
     * defaults from `<html data-composition-variables="...">`.
     *
     * Populated by the CLI from `--variables '<json>'` /
     * `--variables-file <path>`. Must be a JSON-serializable plain object.
     */
    variables?: Record<string, unknown>;
    /**
     * Override the output resolution via Chrome `deviceScaleFactor` (DPR).
     * The composition's authored dimensions are unchanged. See
     * {@link resolveDeviceScaleFactor} for the integer-scale, aspect, and
     * HDR constraints.
     */
    outputResolution?: CanvasResolution;
}
export interface RenderPerfSummary {
    renderId: string;
    totalElapsedMs: number;
    fps: number;
    quality: string;
    workers: number;
    chunkedEncode: boolean;
    chunkSizeFrames: number | null;
    compositionDurationSeconds: number;
    totalFrames: number;
    resolution: {
        width: number;
        height: number;
    };
    videoCount: number;
    audioCount: number;
    stages: Record<string, number>;
    /** Per-phase breakdown of the Phase 2 video extraction (resolve, HDR probe, HDR preflight, VFR probe/preflight, per-video extract). Undefined when the composition has no videos. */
    videoExtractBreakdown?: ExtractionPhaseBreakdown;
    /** Bytes on disk in the render's workDir at assembly time (sampled before cleanup). Lets callers correlate peak temp usage with render duration. */
    tmpPeakBytes?: number;
    captureAvgMs?: number;
    capturePeakMs?: number;
    captureCalibration?: {
        sampledFrames: number[];
        p95Ms?: number;
        multiplier: number;
        reasons: string[];
    };
    captureAttempts?: CaptureAttemptSummary[];
    /**
     * Peak resident set size (RSS) observed during the render, in MiB.
     *
     * Sampled every 250ms by a process-wide poller; surfaces gross memory
     * regressions (e.g. unbounded image-cache growth) that wall-clock numbers
     * miss. Optional because callers can serialize older `RenderPerfSummary`
     * shapes back into this type.
     */
    peakRssMb?: number;
    /**
     * Peak V8 heap used observed during the render, in MiB.
     *
     * Useful as a finer-grained complement to {@link peakRssMb} — RSS includes
     * native ffmpeg/Chrome allocations, while heapUsed isolates JS-object growth
     * inside the orchestrator. Optional for the same back-compat reason.
     */
    peakHeapUsedMb?: number;
    hdrDiagnostics?: HdrDiagnostics;
    hdrPerf?: HdrPerfSummary;
}
export interface HdrDiagnostics {
    videoExtractionFailures: number;
    imageDecodeFailures: number;
}
export interface HdrPerfSummary {
    frames: number;
    normalFrames: number;
    transitionFrames: number;
    domLayerCaptures: number;
    hdrVideoLayerBlits: number;
    hdrImageLayerBlits: number;
    timings: Record<string, number>;
    avgMs: Record<string, number>;
}
export type HdrPerfTimingKey = "frameSeekMs" | "frameInjectMs" | "stackingQueryMs" | "canvasClearMs" | "normalCompositeMs" | "transitionCompositeMs" | "encoderWriteMs" | "hdrVideoReadDecodeMs" | "hdrVideoTransferMs" | "hdrVideoBlitMs" | "hdrImageTransferMs" | "hdrImageBlitMs" | "domLayerSeekMs" | "domLayerInjectMs" | "domMaskApplyMs" | "domScreenshotMs" | "domMaskRemoveMs" | "domPngDecodeMs" | "domBlitMs";
export interface HdrPerfCollector {
    frames: number;
    normalFrames: number;
    transitionFrames: number;
    domLayerCaptures: number;
    hdrVideoLayerBlits: number;
    hdrImageLayerBlits: number;
    timings: Record<HdrPerfTimingKey, number>;
}
export declare function createHdrPerfCollector(): HdrPerfCollector;
export declare function addHdrTiming(perf: HdrPerfCollector | undefined, key: HdrPerfTimingKey, startMs: number): void;
export interface CaptureCostEstimate {
    multiplier: number;
    reasons: string[];
    p95Ms?: number;
}
export interface CaptureCalibrationSample {
    frameIndex: number;
    captureTimeMs: number;
}
export interface FrameRange {
    startFrame: number;
    endFrame: number;
}
export interface CaptureAttemptSummary {
    attempt: number;
    workers: number;
    frameCount: number;
    reason: "initial" | "retry";
}
export interface RenderJob {
    id: string;
    config: RenderConfig;
    status: RenderStatus;
    progress: number;
    currentStage: string;
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    error?: string;
    outputPath?: string;
    duration?: number;
    totalFrames?: number;
    framesRendered?: number;
    perfSummary?: RenderPerfSummary;
    failedStage?: string;
    errorDetails?: {
        message: string;
        stack?: string;
        elapsedMs: number;
        freeMemoryMB: number;
        browserConsoleTail?: string[];
        perfStages?: Record<string, number>;
        hdrDiagnostics?: HdrDiagnostics;
    };
}
export type ProgressCallback = (job: RenderJob, message: string) => void;
export declare class RenderCancelledError extends Error {
    reason: "user_cancelled" | "timeout" | "aborted";
    constructor(message?: string, reason?: "user_cancelled" | "timeout" | "aborted");
}
export declare function createCompiledFrameSrcResolver(compiledDir: string): (framePath: string) => string | null;
type MaterializedExtractedFrames = Pick<ExtractedFrames, "videoId" | "outputDir" | "framePaths">;
type MaterializePathModule = {
    resolve: (...segments: string[]) => string;
    join: (...segments: string[]) => string;
    dirname: (path: string) => string;
    basename: (path: string) => string;
    relative: (from: string, to: string) => string;
    isAbsolute: (path: string) => boolean;
};
type MaterializeFileSystem = {
    existsSync: (path: string) => boolean;
    mkdirSync: (path: string, options: {
        recursive: true;
    }) => unknown;
    symlinkSync: (target: string, path: string) => unknown;
    cpSync: (src: string, dest: string, options: {
        recursive: true;
    }) => unknown;
};
type MaterializeExtractedFramesOptions = {
    pathModule?: MaterializePathModule;
    fileSystem?: MaterializeFileSystem;
    /**
     * When `true`, recursively copy frames into `compiledDir` as real files
     * instead of creating a single symlink per video. Required for
     * distributed plan() output where the planDir must be self-contained
     * across machines (symlinks don't survive S3 / GCS round-trips).
     * Default `false` preserves the in-process renderer's symlink behavior.
     */
    materializeSymlinks?: boolean;
};
export declare function materializeExtractedFramesForCompiledDir(extracted: MaterializedExtractedFrames[], compiledDir: string, options?: MaterializeExtractedFramesOptions): void;
export declare function collectVideoReadinessSkipIds(nativeHdrVideoIds: ReadonlySet<string>, extractedVideos: readonly ExtractedVideoReadinessInput[]): string[];
interface ExtractedVideoReadinessInput {
    videoId: string;
    metadata: {
        width: number;
        height: number;
    };
}
export declare function collectVideoMetadataHints(extractedVideos: readonly ExtractedVideoReadinessInput[]): CaptureVideoMetadataHint[];
export declare function resolveRenderWorkerCount(totalFrames: number, requestedWorkers: number | undefined, cfg: EngineConfig, compiled: Pick<CompiledComposition, "hasShaderTransitions" | "renderModeHints">, log?: ProducerLogger, measuredCaptureCost?: CaptureCostEstimate): number;
export declare function estimateCaptureCostMultiplier(compiled: Pick<CompiledComposition, "hasShaderTransitions" | "renderModeHints">): CaptureCostEstimate;
export declare function createCaptureCalibrationConfig(cfg: EngineConfig): EngineConfig;
export declare function estimateMeasuredCaptureCostMultiplier(samples: CaptureCalibrationSample[]): CaptureCostEstimate;
export declare function selectCaptureCalibrationFrames(totalFrames: number): number[];
export declare function findMissingFrameRanges(totalFrames: number, framesDir: string, frameExt: "jpg" | "png"): FrameRange[];
export declare function buildMissingFrameRetryBatches(ranges: FrameRange[], maxWorkers: number, workDir: string, attempt: number): WorkerTask[][];
export declare function getNextRetryWorkerCount(currentWorkers: number): number;
export declare function isRecoverableParallelCaptureError(error: unknown): boolean;
export declare function shouldFallbackToScreenshotAfterCalibrationError(error: unknown): boolean;
export declare function executeDiskCaptureWithAdaptiveRetry(options: {
    serverUrl: string;
    workDir: string;
    framesDir: string;
    totalFrames: number;
    initialWorkerCount: number;
    allowRetry: boolean;
    frameExt: "jpg" | "png";
    captureOptions: CaptureOptions;
    createBeforeCaptureHook: () => BeforeCaptureHook | null;
    abortSignal?: AbortSignal;
    onProgress?: (progress: ParallelProgress) => void;
    cfg: EngineConfig;
    log: ProducerLogger;
}): Promise<CaptureAttemptSummary[]>;
/**
 * Blit a single HDR video layer onto an rgb48le canvas.
 *
 * Shared between the normal-frame compositing path (compositeToBuffer)
 * and the transition dual-scene compositing loop to avoid duplicating
 * the frame lookup, raw read, transfer, transform, and blit logic.
 */
export interface HdrVideoFrameSource {
    dir: string;
    rawPath: string;
    fd: number;
    width: number;
    height: number;
    frameSize: number;
    frameCount: number;
    scratch: Buffer;
}
export declare function closeHdrVideoFrameSource(source: HdrVideoFrameSource, log?: ProducerLogger): void;
export declare function blitHdrVideoLayer(canvas: Buffer, el: ElementStackingInfo, time: number, fps: number, hdrVideoFrameSources: Map<string, HdrVideoFrameSource>, hdrStartTimes: Map<string, number>, width: number, height: number, log?: ProducerLogger, sourceTransfer?: HdrTransfer, targetTransfer?: HdrTransfer, hdrPerf?: HdrPerfCollector): void;
/**
 * Pre-decoded HDR image buffer with its native pixel dimensions.
 *
 * Static images decode exactly once at setup time and are blitted on every
 * visible frame, unlike video frames which are read fresh per timestamp.
 */
export interface HdrImageBuffer {
    data: Buffer;
    width: number;
    height: number;
}
/**
 * Blit a single HDR image layer onto an rgb48le canvas.
 *
 * Image-equivalent of `blitHdrVideoLayer` — the buffer is pre-decoded and
 * static, so there's no time-based frame lookup or per-frame PNG read.
 */
export declare function blitHdrImageLayer(canvas: Buffer, el: ElementStackingInfo, hdrImageBuffers: Map<string, HdrImageBuffer>, hdrImageTransferCache: HdrImageTransferCache, width: number, height: number, log?: ProducerLogger, sourceTransfer?: HdrTransfer, targetTransfer?: HdrTransfer, hdrPerf?: HdrPerfCollector): void;
/**
 * Dependencies passed to `compositeHdrFrame`.
 *
 * Every field except the per-frame arguments is captured once when the HDR
 * render path opens its `try { ... }` block and reused across every frame —
 * extracting them into an explicit struct lets the helper live at module
 * scope (no closure-over-renderJob) and keeps the per-call signature small.
 */
type CompositeTransfer = HdrTransfer | "srgb";
export declare function shouldUseLayeredComposite(options: {
    hasHdrContent: boolean;
    hasShaderTransitions: boolean;
    isPngSequence: boolean;
}): boolean;
export declare function resolveCompositeTransfer(hasHdrContent: boolean, effectiveHdr: {
    transfer: HdrTransfer;
} | undefined): CompositeTransfer;
export interface HdrCompositeContext {
    log: ProducerLogger;
    domSession: CaptureSession;
    beforeCaptureHook: BeforeCaptureHook | null;
    width: number;
    height: number;
    fps: number;
    compositeTransfer: CompositeTransfer;
    nativeHdrImageIds: Set<string>;
    hdrImageBuffers: Map<string, HdrImageBuffer>;
    hdrImageTransferCache: HdrImageTransferCache;
    hdrVideoFrameSources: Map<string, HdrVideoFrameSource>;
    hdrVideoStartTimes: Map<string, number>;
    imageTransfers: Map<string, HdrTransfer>;
    videoTransfers: Map<string, HdrTransfer>;
    debugDumpEnabled: boolean;
    debugDumpDir: string | null;
    hdrPerf?: HdrPerfCollector;
}
/**
 * Composite a single HDR frame into a pre-allocated `rgb48le` canvas.
 *
 * Bottom-to-top z-order: HDR layers are blitted directly from cached image
 * buffers / extracted video frames; DOM layers are screenshotted with a
 * mass-hide mask (so each layer paints only its own elements) and then
 * blended into the canvas via `blitRgba8OverRgb48le` in the active HDR
 * transfer space.
 *
 * The `elementFilter` parameter exists so the transition path can composite
 * each scene independently; pass `undefined` for whole-stack rendering.
 *
 * @param ctx - Long-lived dependencies (logger, browser session, dimensions,
 *              HDR layer maps). Captured once per render — see
 *              {@link HdrCompositeContext}.
 * @param canvas - Pre-allocated `width * height * 6` byte buffer. Caller must
 *                 zero-fill before every frame (this helper does not).
 * @param time - Seek time in seconds.
 * @param fullStacking - Stacking info for ALL elements at this time. Even when
 *                       filtering, every other element id is needed to build
 *                       the DOM-layer hide-list.
 * @param elementFilter - When set, only elements whose id is in the set are
 *                        composited.
 * @param debugFrameIndex - Frame index used to label per-layer diagnostic
 *                          dumps. Pass `-1` to disable per-layer dumps even
 *                          when `KEEP_TEMP=1` (e.g. for warmup frames).
 */
export declare function compositeHdrFrame(ctx: HdrCompositeContext, canvas: Buffer, time: number, fullStacking: ElementStackingInfo[], elementFilter?: Set<string>, debugFrameIndex?: number): Promise<void>;
export declare function createRenderJob(config: RenderConfig): RenderJob;
export declare function shouldUseStreamingEncode(cfg: Pick<EngineConfig, "enableStreamingEncode" | "streamingEncodeMaxDurationSeconds">, outputFormat: NonNullable<RenderConfig["format"]>, workerCount: number, durationSeconds: number): boolean;
/**
 * Main render pipeline
 */
export declare function extractStandaloneEntryFromIndex(indexHtml: string, entryFile: string): string | null;
/**
 * Render a `RenderJob` end-to-end: compile → probe → extract videos →
 * audio → capture → encode → assemble. The function body is a thin
 * sequencer over the eight stage modules in `./render/stages/`; the
 * orchestrator owns shared resources (work dir, file server, probe
 * session, browser console buffer, perf counters, peak-memory sampler)
 * and the `try/finally` cleanup. Returns once the final output exists at
 * `outputPath`; throws on cancellation, encoder failure, or a stage
 * error (with a diagnostic summary written to `perf-summary.json`).
 */
export declare function executeRenderJob(job: RenderJob, projectDir: string, outputPath: string, onProgress?: ProgressCallback, abortSignal?: AbortSignal): Promise<void>;
export {};
//# sourceMappingURL=renderOrchestrator.d.ts.map