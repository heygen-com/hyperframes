/**
 * captureHdrStage — Z-ordered HDR / shader-transition layered composite.
 *
 * The most complex capture path:
 *   - Spawns a dedicated `domSession` for transparent-background screenshots.
 *   - Spawns an `hdrEncoder` (`spawnStreamingEncoder` with
 *     `rawInputFormat: "rgb48le"`) accepting pre-composited HDR frames.
 *   - Opens raw HDR video frame files (`hdrVideoFrameSources`) and reads
 *     them per-frame for native-HDR video layers.
 *   - Decodes 16-bit HDR PNGs once and blits them as image layers.
 *   - Queries Chrome z-order at layout-change boundaries and groups
 *     elements into DOM / HDR video / HDR image layers.
 *   - Dispatches per-frame work to either the sequential layered loop
 *     (HDR-content, single-worker, all-transition edge cases) or the
 *     hybrid parallel loop introduced in hf#732 (multi-worker SDR with
 *     `worker_threads`-pool shader blend).
 *
 * Cleanup invariants the design doc explicitly flags as risky —
 * preserved verbatim from the in-process renderer:
 *   - `hdrEncoderClosed` / `domSessionClosed` flags gate defensive-close
 *     paths so they don't run twice when the success path already closed.
 *   - `hdrVideoFrameSources` is drained + cleared in the outer `finally`
 *     regardless of how the body exits.
 *   - The layered path unconditionally captures in screenshot mode
 *     because `captureAlphaPng` hangs under `--enable-begin-frame-control`.
 *     Previously the stage mutated `cfg.forceScreenshot = true` directly;
 *     the value is now derived into a local `hdrCfg` so the caller-owned
 *     `cfg` survives the stage unchanged. The sequencer is expected to
 *     pass `forceScreenshot: true` for the layered branch as a contract
 *     check.
 *
 * Resource setup (HDR video extraction, image decode, dim probing) lives
 * in `captureHdrResources.ts`; per-frame work lives in
 * `captureHdrSequentialLoop.ts` and `captureHdrHybridLoop.ts`. Shared
 * primitives across both loops live in `captureHdrFrameShared.ts`.
 */
import { type BeforeCaptureHook, type CaptureOptions, type EngineConfig, type HdrTransfer, getEncoderPreset } from "@hyperframes/engine";
import type { FileServerHandle } from "../../fileServer.js";
import type { ProducerLogger } from "../../../logger.js";
import { type HdrDiagnostics, type HdrPerfCollector, type ProgressCallback, type RenderJob } from "../../renderOrchestrator.js";
import type { CompositionMetadata } from "../shared.js";
export interface CaptureHdrStageInput {
    job: RenderJob;
    cfg: EngineConfig;
    /**
     * Capture-mode flag threaded from `compileStage`. The HDR layered
     * branch requires `true` (see file header for the
     * `captureAlphaPng` / `--enable-begin-frame-control` constraint);
     * the stage throws if called with `false`. Stored locally as
     * `hdrCfg.forceScreenshot` so the caller-owned `cfg` is not mutated.
     */
    forceScreenshot: boolean;
    log: ProducerLogger;
    projectDir: string;
    compiledDir: string;
    framesDir: string;
    videoOnlyPath: string;
    width: number;
    height: number;
    totalFrames: number;
    composition: CompositionMetadata;
    hasHdrContent: boolean;
    effectiveHdr: {
        transfer: HdrTransfer;
    } | undefined;
    nativeHdrVideoIds: Set<string>;
    nativeHdrImageIds: Set<string>;
    videoTransfers: Map<string, HdrTransfer>;
    imageTransfers: Map<string, HdrTransfer>;
    hdrImageSrcPaths: Map<string, string>;
    preset: ReturnType<typeof getEncoderPreset>;
    effectiveQuality: number;
    effectiveBitrate: string | undefined;
    fileServer: FileServerHandle;
    buildCaptureOptions: () => CaptureOptions;
    createRenderVideoFrameInjector: () => BeforeCaptureHook | null;
    /** Mutated in place (counters incremented). */
    hdrDiagnostics: HdrDiagnostics;
    /**
     * Worker budget for the hybrid layered path. Only consulted when the
     * gating predicate (`shouldUseHybridLayeredPath`) returns true. The
     * sequential loop always runs on a single DOM session.
     */
    workerCount?: number;
    abortSignal: AbortSignal | undefined;
    assertNotAborted: () => void;
    onProgress?: ProgressCallback;
}
export interface CaptureHdrStageResult {
    lastBrowserConsole: string[];
    hdrPerf: HdrPerfCollector | undefined;
    /** Wall-clock ms for the HDR capture phase. */
    captureDurationMs: number;
    /** ffmpeg-reported encode duration; overlapped with capture. */
    encodeMs: number;
}
export declare function runCaptureHdrStage(input: CaptureHdrStageInput): Promise<CaptureHdrStageResult>;
//# sourceMappingURL=captureHdrStage.d.ts.map