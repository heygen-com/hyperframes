/**
 * extractVideosStage — pre-extract source-video JPEG sequences, plus the
 * HDR color-space pre-detection that runs against the originals.
 *
 * The stage runs the existing video-frame extraction pipeline
 * (`extractAllVideoFrames`) but also probes BOTH videos and images for
 * native HDR color spaces before extraction (since extraction may convert
 * SDR → HDR). The HDR maps are returned so the downstream HDR auto-detect
 * block and the HDR composite path can identify which sources are natively
 * HDR vs. converted-SDR.
 *
 * Hard constraints preserved verbatim from the in-process renderer:
 *   - `composition.audios` is mutated in place to add audio entries
 *     auto-discovered from video files via ffprobe (preserves the
 *     "video had audio, no explicit <audio> tag" path).
 *   - `perfStages.videoExtractMs` is set at the same end-of-stage point.
 *   - `materializeExtractedFramesForCompiledDir` is still called once
 *     when `extractionResult.extracted` is non-empty.
 *   - `force-sdr` mode still skips ALL ffprobe overhead.
 *
 * New for distributed mode:
 *   - `materializeSymlinks` (default `false`) — when `true`, the stage
 *     instructs `materializeExtractedFramesForCompiledDir` to recursively
 *     copy frames into `compiledDir/__hyperframes_video_frames/<videoId>/`
 *     instead of creating a single symlink. Required for distributed
 *     plan() output where the planDir must be self-contained across
 *     machines (symlinks don't survive S3 / GCS round-trips). Default
 *     `false` preserves the in-process renderer's symlink behavior.
 */
import { type CaptureVideoMetadataHint, type EngineConfig, type FrameLookupTable, type HdrTransfer, type VideoColorSpace, extractAllVideoFrames } from "@hyperframes/engine";
import { type RenderJob } from "../../renderOrchestrator.js";
import { type CompositionMetadata } from "../shared.js";
export interface ExtractVideosStageInput {
    projectDir: string;
    /** `join(workDir, "compiled")`; the directory the file server roots at. */
    compiledDir: string;
    job: RenderJob;
    cfg: EngineConfig;
    /** Mutated in place — audio entries auto-discovered from video files are pushed onto `composition.audios`. */
    composition: CompositionMetadata;
    abortSignal: AbortSignal | undefined;
    assertNotAborted: () => void;
    /**
     * Whether to materialize symlinks into real files when staging extracted
     * frames inside `compiledDir`. Default `false` preserves the in-process
     * renderer's behavior (single symlink per video). Distributed `plan()`
     * passes `true` so the planDir is self-contained.
     */
    materializeSymlinks?: boolean;
}
export interface ExtractVideosStageResult {
    /** Result of `extractAllVideoFrames`, or `null` if the composition has no videos. */
    extractionResult: Awaited<ReturnType<typeof extractAllVideoFrames>> | null;
    /** Frame-lookup table for the runtime video-frame injector, or `null` if no frames were extracted. */
    frameLookup: FrameLookupTable | null;
    videoReadinessSkipIds: string[];
    videoMetadataHints: CaptureVideoMetadataHint[];
    /** Set of video IDs whose ORIGINAL color space was HDR (pre-extraction). */
    nativeHdrVideoIds: Set<string>;
    /** Per-video original transfer function (BT.2020 PQ/HLG). */
    videoTransfers: Map<string, HdrTransfer>;
    /** Set of image IDs whose ORIGINAL color space was HDR. */
    nativeHdrImageIds: Set<string>;
    /** Per-image original transfer function. */
    imageTransfers: Map<string, HdrTransfer>;
    /** Per-image resolved on-disk source path (used by the HDR composite path). */
    hdrImageSrcPaths: Map<string, string>;
    /** Per-image probed color space, or `null` for images that couldn't be probed. */
    imageColorSpaces: (VideoColorSpace | null)[];
    /** Wall-clock ms for the video extraction phase. */
    videoExtractMs: number;
}
export declare function runExtractVideosStage(input: ExtractVideosStageInput): Promise<ExtractVideosStageResult>;
//# sourceMappingURL=extractVideosStage.d.ts.map