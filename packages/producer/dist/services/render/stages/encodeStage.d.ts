/**
 * encodeStage — Stage 5 of `executeRenderJob`. Two paths share the stage:
 *
 *   1. png-sequence: no encoder. Captured PNGs are renamed to
 *      `frame_NNNNNN.png` and copied to `outputPath`. Audio (if any) is
 *      written as an `audio.aac` sidecar.
 *   2. mp4 / webm / mov: invokes `encodeFramesFromDir` (or the chunked-
 *      concat variant when `enableChunkedEncode` is on) to produce
 *      `videoOnlyPath`. The mux + faststart pass lives in `assembleStage`.
 *
 * Skipped entirely when the streaming-encode fusion path
 * (`captureStreamingStage`) already produced `videoOnlyPath` — the
 * sequencer gates the call on `!streamingHandled`.
 *
 * Hard constraints preserved verbatim:
 *   - The "Writing PNG sequence" / "Encoding video" `updateJobStatus`
 *     payload fires at 75% from inside the stage.
 *   - The png-sequence path throws "png-sequence output requested but no
 *     PNGs were captured to ..." if `framesDir` is empty.
 *   - The png-sequence audio sidecar is only written when
 *     `hasAudio && existsSync(audioOutputPath)`.
 *   - For encoded output, `enableChunkedEncode` selects
 *     `encodeFramesChunkedConcat` vs `encodeFramesFromDir` — same
 *     branch + same args.
 *   - `Encoding failed: <err>` throws on the encoder's
 *     `success: false`.
 */
import { getEncoderPreset } from "@hyperframes/engine";
import type { ProducerLogger } from "../../../logger.js";
import type { ProgressCallback, RenderJob } from "../../renderOrchestrator.js";
export interface EncodeStageInput {
    job: RenderJob;
    log: ProducerLogger;
    /** Output path: a directory for png-sequence, a file for everything else. */
    outputPath: string;
    /** Where captured frames live on disk. */
    framesDir: string;
    /** Encoded video output (ignored on the png-sequence path). */
    videoOnlyPath: string;
    /** Output dimensions (post-deviceScaleFactor). */
    width: number;
    height: number;
    /** True when the output format requires an alpha channel; selects frame extension. */
    needsAlpha: boolean;
    /** True iff the composition has audio. Drives the sidecar copy. */
    hasAudio: boolean;
    /** Path to the mixed audio (only read when `hasAudio` is true). */
    audioOutputPath: string;
    /** Mp4 vs png-sequence vs … gates the entire stage branch. */
    isPngSequence: boolean;
    /** Encoder preset (codec, preset, pixelFormat, hdr). Only used on the non-png path. */
    preset: ReturnType<typeof getEncoderPreset>;
    effectiveQuality: number;
    effectiveBitrate: string | undefined;
    /** Producer config — enables the chunked-concat encoder when on. */
    enableChunkedEncode: boolean;
    chunkedEncodeSize: number;
    abortSignal: AbortSignal | undefined;
    assertNotAborted: () => void;
    onProgress?: ProgressCallback;
}
export interface EncodeStageResult {
    /** Wall-clock ms for the encode (or png-copy) phase. */
    encodeMs: number;
}
export declare function runEncodeStage(input: EncodeStageInput): Promise<EncodeStageResult>;
//# sourceMappingURL=encodeStage.d.ts.map