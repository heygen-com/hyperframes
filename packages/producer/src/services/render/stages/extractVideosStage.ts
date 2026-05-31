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

import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  type CaptureVideoMetadataHint,
  type EngineConfig,
  type ExtractedFrames,
  type FrameLookupTable,
  type HdrTransfer,
  type VideoColorSpace,
  createFrameLookupTable,
  detectTransfer,
  extractAllVideoFrames,
  extractMediaMetadata,
  isHdrColorSpace,
  resolveProjectRelativeSrc,
} from "@hyperframes/engine";
import { fpsToNumber } from "@hyperframes/core";
import {
  collectVideoMetadataHints,
  collectVideoReadinessSkipIds,
  type RenderJob,
} from "../../renderOrchestrator.js";
import { materializeExtractedFramesForCompiledDir, type CompositionMetadata } from "../shared.js";
import type { ProducerLogger } from "../../../logger.js";

export interface ExtractVideosStageInput {
  projectDir: string;
  /** `join(workDir, "compiled")`; the directory the file server roots at. */
  compiledDir: string;
  job: RenderJob;
  cfg: EngineConfig;
  log?: ProducerLogger;
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

export async function runExtractVideosStage(
  input: ExtractVideosStageInput,
): Promise<ExtractVideosStageResult> {
  const {
    projectDir,
    compiledDir,
    job,
    cfg,
    log,
    composition,
    abortSignal,
    assertNotAborted,
    materializeSymlinks,
  } = input;

  const stage2Start = Date.now();

  let frameLookup: FrameLookupTable | null = null;
  let extractionResult: Awaited<ReturnType<typeof extractAllVideoFrames>> | null = null;
  let videoReadinessSkipIds: string[] = [];
  let videoMetadataHints: CaptureVideoMetadataHint[] = [];

  // Probe ORIGINAL color spaces before extraction (which may convert SDR→HDR).
  // This is needed to identify which videos are natively HDR vs converted-SDR
  // for the two-pass compositing path. Skipped only in force-sdr mode to
  // avoid ffprobe overhead when the user has explicitly opted out.
  const nativeHdrVideoIds = new Set<string>();
  const videoTransfers = new Map<string, HdrTransfer>();
  if (job.config.hdrMode !== "force-sdr" && composition.videos.length > 0) {
    log?.info("Probing video color spaces...", { videoCount: composition.videos.length });
    await Promise.all(
      composition.videos.map(async (v) => {
        // Use the shared resolver so a `<video src="../assets/foo">` in a
        // sub-composition resolves the same way the browser would (see
        // resolveProjectRelativeSrc in videoFrameExtractor for the full
        // explanation). isAbsolute (not `startsWith("/")`) so Windows
        // absolute paths like `C:\...` skip the join correctly.
        const videoPath = isAbsolute(v.src)
          ? v.src
          : resolveProjectRelativeSrc(v.src, projectDir, compiledDir);
        if (!existsSync(videoPath)) return;
        const meta = await extractMediaMetadata(videoPath);
        if (isHdrColorSpace(meta.colorSpace)) {
          nativeHdrVideoIds.add(v.id);
          videoTransfers.set(v.id, detectTransfer(meta.colorSpace));
        }
      }),
    );
  }

  // Probe images for HDR color spaces (16-bit PNGs tagged BT.2020 PQ/HLG).
  // Mirrors the video probe loop above so image-only compositions can
  // trigger HDR output without any video sources present. Skipped only in
  // force-sdr mode to avoid ffprobe overhead when the user has explicitly
  // opted out.
  const nativeHdrImageIds = new Set<string>();
  const imageTransfers = new Map<string, HdrTransfer>();
  const hdrImageSrcPaths = new Map<string, string>();
  const imageColorSpaces: (VideoColorSpace | null)[] = [];
  if (job.config.hdrMode !== "force-sdr" && composition.images.length > 0) {
    const probed = await Promise.all(
      composition.images.map(async (img) => {
        let imgPath = img.src;
        if (!imgPath.startsWith("/")) {
          const fromCompiled = existsSync(join(compiledDir, imgPath))
            ? join(compiledDir, imgPath)
            : join(projectDir, imgPath);
          imgPath = fromCompiled;
        }
        if (!existsSync(imgPath)) return null;
        const meta = await extractMediaMetadata(imgPath);
        if (isHdrColorSpace(meta.colorSpace)) {
          nativeHdrImageIds.add(img.id);
          imageTransfers.set(img.id, detectTransfer(meta.colorSpace));
          hdrImageSrcPaths.set(img.id, imgPath);
        }
        return meta.colorSpace;
      }),
    );
    imageColorSpaces.push(...probed);
  }

  if (composition.videos.length > 0) {
    const totalVideos = composition.videos.length;
    for (let i = 0; i < totalVideos; i++) {
      const v = composition.videos[i]!;
      log?.info(`Extracting frames from video ${i + 1}/${totalVideos}: ${v.src}`);
    }
    extractionResult = await extractAllVideoFrames(
      composition.videos,
      projectDir,
      // extractAllVideoFrames takes fps as a number (decimal). Frames sampled
      // from a video at 29.97 vs 30 differ by ~1 frame in 1000 — not enough
      // to break visual parity, and the encoder-side rational keeps the
      // output framerate exact.
      {
        fps: fpsToNumber(job.config.fps),
        outputDir: join(compiledDir, "__hyperframes_video_frames"),
        format: job.config.videoFrameFormat ?? "auto",
      },
      abortSignal,
      { extractCacheDir: cfg.extractCacheDir },
      compiledDir,
    );
    assertNotAborted();

    materializeExtractedFramesForCompiledDir(extractionResult.extracted, compiledDir, {
      materializeSymlinks,
    });

    if (extractionResult.extracted.length > 0) {
      frameLookup = createFrameLookupTable(composition.videos, extractionResult.extracted);
    }
    videoReadinessSkipIds = collectVideoReadinessSkipIds(
      nativeHdrVideoIds,
      extractionResult.extracted,
    );
    videoMetadataHints = collectVideoMetadataHints(extractionResult.extracted);

    appendAutoDetectedVideoAudio(composition, extractionResult.extracted);
  }
  const videoExtractMs = Date.now() - stage2Start;

  return {
    extractionResult,
    frameLookup,
    videoReadinessSkipIds,
    videoMetadataHints,
    nativeHdrVideoIds,
    videoTransfers,
    nativeHdrImageIds,
    imageTransfers,
    hdrImageSrcPaths,
    imageColorSpaces,
    videoExtractMs,
  };
}

/**
 * Auto-detect audio from extracted video files (ffprobe metadata) and append
 * to composition.audios. Both the file AND the element must declare audio —
 * a muted <video> whose source contains audio should not leak into the render.
 */
export function appendAutoDetectedVideoAudio(
  composition: Pick<CompositionMetadata, "videos" | "audios">,
  extracted: ExtractedFrames[],
): void {
  const existingAudioSrcs = new Set(composition.audios.map((a) => a.src));
  for (const ext of extracted) {
    if (!ext.metadata.hasAudio) continue;
    const video = composition.videos.find((v) => v.id === ext.videoId);
    if (!video || !video.hasAudio || existingAudioSrcs.has(video.src)) continue;
    composition.audios.push({
      id: `${video.id}-audio`,
      src: video.src,
      start: video.start,
      end: video.end,
      mediaStart: video.mediaStart,
      layer: 0,
      volume: 1.0,
      type: "video",
    });
    existingAudioSrcs.add(video.src);
  }
}
