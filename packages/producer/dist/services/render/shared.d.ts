/**
 * Shared types and pure helpers used by the staged render pipeline.
 *
 * Lives in its own module so the stage files in `./stages/` can import the
 * helpers they need without reaching back into `renderOrchestrator.ts` —
 * the orchestrator imports the stage functions, so a runtime cycle would
 * otherwise form (and grow as more stages are extracted).
 *
 * `renderOrchestrator.ts` re-exports everything declared here for
 * backwards compatibility with existing test files and external callers.
 */
import { type CanvasResolution } from "@hyperframes/core";
import type { AudioElement, EngineConfig, ExtractedFrames, ImageElement, VideoElement } from "@hyperframes/engine";
import type { CompiledComposition } from "../htmlCompiler.js";
import { type ProducerLogger } from "../../logger.js";
import type { ProgressCallback, RenderJob, RenderStatus } from "../renderOrchestrator.js";
export interface CompositionMetadata {
    duration: number;
    videos: VideoElement[];
    audios: AudioElement[];
    images: ImageElement[];
    width: number;
    height: number;
}
/**
 * Floating-point tolerance for reconciling browser-discovered media timing
 * against statically-parsed metadata. Used when the browser reports a
 * slightly different `end` / `mediaStart` / `volume` than the compiled
 * HTML and we want to ignore sub-millisecond float noise.
 */
export declare const BROWSER_MEDIA_EPSILON = 0.0001;
/**
 * Browser-discovered media inside inlined sub-compositions can still report
 * scene-local timing from the merged DOM (e.g. start=0, end=85.52) while the
 * compiled metadata is already offset into the parent host timeline
 * (e.g. start=4.417, end=89.937). Reproject browser end-time into the
 * compiled element's time origin before reconciling it back into the render
 * metadata.
 */
export declare function projectBrowserEndToCompositionTimeline(existingStart: number, browserStart: number, browserEnd: number): number;
/**
 * Translate the user-facing `--resolution` flag into a Chrome
 * `deviceScaleFactor`. The composition's intrinsic dimensions stay the
 * page-layout viewport; the screenshot lands at output dims via DPR.
 *
 * The scale must be a positive integer ≥ 1 — fractional DPRs introduce
 * visible aliasing and we'd rather fail loudly than produce a blurry
 * 4K render. Downsampling (output < composition) is rejected because
 * the user is unlikely to have intended it; if the use case appears
 * we can plumb a separate flag.
 *
 * Throws on:
 *   - HDR + outputResolution (HDR compositor processes raw pixel buffers
 *     at composition dimensions and would need parallel scaling).
 *   - Aspect-ratio mismatch (e.g. landscape composition → portrait-4k).
 *   - Non-integer scale ratio.
 *   - Downsampling (output dimensions smaller than composition).
 */
export declare function resolveDeviceScaleFactor(input: {
    compositionWidth: number;
    compositionHeight: number;
    outputResolution: CanvasResolution | undefined;
    hdrRequested: boolean;
    alphaRequested: boolean;
}): number;
/**
 * Write compiled HTML and sub-compositions to the work directory.
 *
 * Exported for integration tests. Not part of the stable public API —
 * callers outside this package should use `executeRenderJob` instead.
 */
export declare function writeCompiledArtifacts(compiled: CompiledComposition, workDir: string, includeSummary: boolean): void;
export interface RenderModeHintResult {
    /** Resolved capture-mode boolean after folding in the hint. */
    forceScreenshot: boolean;
    /** True iff the hint flipped a `false` input to `true` (warn log fired). */
    autoSelected: boolean;
}
/**
 * Fold the composition's `renderModeHints.recommendScreenshot` signal
 * into the caller's already-resolved `forceScreenshot` value. Pure: the
 * caller owns the assignment to its own config. When the hint is the
 * deciding factor (caller passed `false`, hint says recommend), fires
 * the auto-select warn log with the composition's reason codes.
 */
export declare function applyRenderModeHints(alreadyForced: boolean, compiled: CompiledComposition, log?: ProducerLogger): RenderModeHintResult;
export interface WebGpuRenderModeHintOptions {
    allowBrowserGpuModeAuto: boolean;
    allowBrowserWebGpuModeAuto: boolean;
}
export interface WebGpuRenderModeHintResult {
    changed: boolean;
    browserGpuModeChanged: boolean;
    browserWebGpuModeChanged: boolean;
}
/**
 * WebGPU compositions need both a non-software browser GPU profile and browser
 * WebGPU exposure. Direct producer callers historically received the engine
 * defaults (`browserGpuMode: "software"`, `browserWebGpuMode: "off"`), which
 * made WebGPU fixtures render without adapters unless the caller knew to pass
 * a full producerConfig. Keep explicit config/env choices intact and only lift
 * default direct-render jobs when static compile hints prove the scene uses
 * WebGPU or TypeGPU.
 */
export declare function applyWebGpuRenderModeHints(cfg: EngineConfig, compiled: CompiledComposition, log: ProducerLogger | undefined, options: WebGpuRenderModeHintOptions): WebGpuRenderModeHintResult;
/**
 * Mutate the `RenderJob` view of the pipeline's progress and fire the
 * caller's `onProgress` callback. Hoisted here (out of `renderOrchestrator.ts`)
 * so the stage modules can call it without forming a runtime cycle.
 *
 * `completedAt` is stamped on the terminal `"failed"` / `"complete"`
 * transitions so callers that poll the job state can tell when the
 * pipeline finished.
 */
export declare function updateJobStatus(job: RenderJob, status: RenderStatus, stage: string, progress: number, onProgress?: ProgressCallback): void;
/**
 * Build a `resolver(framePath)` closure that maps an absolute path to
 * a frame inside `compiledDir` into a server-relative URL the producer's
 * file server will serve. Returns `null` for any path that escapes the
 * compiled directory — the resolver is used by the video frame injector
 * to rewrite local frame references into HTTP `<video>` srcs.
 */
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
/**
 * Periodic peak-RSS / peak-heapUsed sampler. The benchmark harness reads
 * the peaks to detect memory regressions (e.g. unbounded image-cache
 * growth) that wall-clock metrics miss.
 *
 * Sampled every 250ms; the interval is `unref`'d so the sampler never
 * holds the event loop open on its own. Callers MUST invoke `stop()`
 * in a `finally` block — `stop()` takes one final reading before
 * clearing the interval so the peak values are accurate up to the
 * moment the render returns.
 */
export interface MemorySampler {
    /** Take an immediate sample then read the peak RSS in bytes. */
    peakRssBytes: () => number;
    /** Take an immediate sample then read the peak heap-used in bytes. */
    peakHeapUsedBytes: () => number;
    /** Stop the interval after one final sample. Idempotent. */
    stop: () => void;
}
export declare function createMemorySampler(intervalMs?: number): MemorySampler;
/**
 * Symlink (or copy) each extracted-frames directory into a stable path
 * under `compiledDir/__hyperframes_video_frames/<videoId>/`, and rewrite
 * the per-frame paths so the file server can serve them.
 *
 * Exported for integration tests; not part of the stable public API —
 * external callers should use `executeRenderJob` instead.
 */
export declare function materializeExtractedFramesForCompiledDir(extracted: MaterializedExtractedFrames[], compiledDir: string, options?: MaterializeExtractedFramesOptions): void;
export {};
//# sourceMappingURL=shared.d.ts.map