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
import type { AudioElement, EngineConfig, ImageElement, VideoElement } from "@hyperframes/engine";
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
export declare function applyRenderModeHints(cfg: EngineConfig, compiled: CompiledComposition, log?: ProducerLogger): void;
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
//# sourceMappingURL=shared.d.ts.map