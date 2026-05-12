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
 *   - Composites bottom-to-top in Node memory, writing rgb48le buffers
 *     to the encoder's stdin.
 *
 * Cleanup invariants the design doc explicitly flags as risky —
 * preserved verbatim from the in-process renderer:
 *   - `hdrEncoderClosed` / `domSessionClosed` flags gate defensive-close
 *     paths so they don't run twice when the success path already closed.
 *   - `hdrVideoFrameSources` is drained + cleared in the outer `finally`
 *     regardless of how the body exits.
 *   - `cfg.forceScreenshot = true` is set unconditionally inside the
 *     layered path because `captureAlphaPng` hangs under
 *     `--enable-begin-frame-control`.
 *
 * Known follow-up: same runtime import cycle pattern as the other
 * capture stages — the stage imports HDR helpers from
 * `renderOrchestrator.ts` (runtime), which imports the stage back.
 * Safe at runtime; a future PR will consolidate these helpers.
 */
import { type BeforeCaptureHook, type CaptureOptions, type EngineConfig, type HdrTransfer, getEncoderPreset } from "@hyperframes/engine";
import type { FileServerHandle } from "../../fileServer.js";
import type { ProducerLogger } from "../../../logger.js";
import { type HdrDiagnostics, type HdrPerfCollector, type ProgressCallback, type RenderJob } from "../../renderOrchestrator.js";
import { type CompositionMetadata } from "../shared.js";
export interface CaptureHdrStageInput {
    job: RenderJob;
    cfg: EngineConfig;
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