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
import { join } from "node:path";
import {
  type CaptureVideoMetadataHint,
  type EngineConfig,
  type ExtractedFrames,
  type ExtractionResult,
  type FrameLookupTable,
  type HdrTransfer,
  type VideoExtractionFailureKind,
  type VideoColorSpace,
  classifyVideoExtractionError,
  createFrameLookupTable,
  detectTransfer,
  extractAllVideoFrames,
  extractMediaMetadata,
  isHdrColorSpace,
  resolveProjectRelativeSrc,
  runVideoExtractionWithRetry,
} from "@hyperframes/engine";
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
  /**
   * Candidate-only typed failure gate. Callers throw this only after their
   * extraction telemetry checkpoint has been emitted.
   */
  failureToEnforce: VideoExtractionStageError | null;
}

/**
 * Whether the extract stage should COPY frames into the compiled dir instead of
 * symlinking them. Windows without Developer Mode / Administrator can't create
 * symlinks (`symlinkSync` throws EPERM), which failed local video renders; copy
 * there instead. Elsewhere symlinking is cheaper, so keep it. (The distributed
 * `plan()` path already forces copying for a different reason — a self-contained
 * planDir — by passing `materializeSymlinks: true` explicitly.)
 */
export function shouldCopyExtractedFrames(platform: NodeJS.Platform): boolean {
  return platform === "win32";
}

export type VideoExtractionStageErrorCode = "VIDEO_SOURCE_UNRENDERABLE" | "VIDEO_EXTRACTION_FAILED";

export interface VideoExtractionStageFailureSummary {
  kind: VideoExtractionFailureKind;
  count: number;
}

export type VideoExtractionFailureMode = "off" | "observe" | "enforce";

export interface VideoExtractionPolicy {
  failureMode: VideoExtractionFailureMode;
  maxTransientRetries: 0 | 1;
}

/**
 * Candidate-lane rollout controls. Stable behavior remains unchanged unless
 * explicitly enabled in the producer environment.
 */
export function resolveVideoExtractionPolicy(
  env: Readonly<Record<string, string | undefined>> = process.env,
): VideoExtractionPolicy {
  const rawMode = env.HF_VIDEO_EXTRACTION_FAILURE_MODE?.trim().toLowerCase();
  const failureMode: VideoExtractionFailureMode =
    rawMode === "observe" || rawMode === "enforce" ? rawMode : "off";
  const maxTransientRetries =
    failureMode !== "off" && env.HF_VIDEO_EXTRACTION_MAX_RETRIES?.trim() === "1" ? 1 : 0;
  return { failureMode, maxTransientRetries };
}

/**
 * Producer-safe terminal error for per-source extraction failures.
 *
 * `ExtractionResult.errors[].error` intentionally retains local diagnostics
 * and can contain signed URLs or filesystem paths. This error carries only a
 * bounded taxonomy/count summary so the HTTP/Temporal boundary can transport
 * the cause without leaking those values.
 */
export class VideoExtractionStageError extends Error {
  constructor(
    readonly code: VideoExtractionStageErrorCode,
    readonly retryable: boolean,
    readonly failures: readonly VideoExtractionStageFailureSummary[],
  ) {
    const total = failures.reduce((sum, failure) => sum + failure.count, 0);
    const breakdown = failures.map((failure) => `${failure.kind}=${failure.count}`).join(",");
    super(`Video extraction failed for ${total} source(s) [${code}; ${breakdown}]`);
    this.name = "VideoExtractionStageError";
  }
}

export function assertVideoExtractionSucceeded(result: ExtractionResult): void {
  const error = buildVideoExtractionStageError(result);
  if (error) throw error;
}

function buildVideoExtractionStageError(
  result: ExtractionResult,
): VideoExtractionStageError | null {
  if (result.success && result.errors.length === 0) return null;
  const counts = new Map<VideoExtractionFailureKind, number>();
  for (const failure of result.errors) {
    const kind = failure.kind ?? "internal";
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const failures = Array.from(counts, ([kind, count]) => ({ kind, count })).sort((a, b) =>
    a.kind.localeCompare(b.kind),
  );
  const retryable =
    result.errors.length > 0 && result.errors.every((failure) => failure.retryable === true);
  return new VideoExtractionStageError(
    retryable ? "VIDEO_EXTRACTION_FAILED" : "VIDEO_SOURCE_UNRENDERABLE",
    retryable,
    failures,
  );
}

export function buildHdrProbeStageError(
  failures: readonly Pick<ReturnType<typeof classifyVideoExtractionError>, "kind" | "retryable">[],
): VideoExtractionStageError {
  const counts = new Map<VideoExtractionFailureKind, number>();
  for (const failure of failures) {
    counts.set(failure.kind, (counts.get(failure.kind) ?? 0) + 1);
  }
  const summary = Array.from(counts, ([kind, count]) => ({ kind, count })).sort((a, b) =>
    a.kind.localeCompare(b.kind),
  );
  const retryable = failures.length > 0 && failures.every((failure) => failure.retryable);
  return new VideoExtractionStageError(
    retryable ? "VIDEO_EXTRACTION_FAILED" : "VIDEO_SOURCE_UNRENDERABLE",
    retryable,
    summary,
  );
}

type HdrProbeFailure = {
  error: unknown;
  classified: ReturnType<typeof classifyVideoExtractionError>;
};

function isHdrProbeFailure(failure: HdrProbeFailure | null): failure is HdrProbeFailure {
  return failure !== null;
}

function throwHdrProbeFailures(
  failures: readonly HdrProbeFailure[],
  mode: VideoExtractionFailureMode,
): void {
  if (failures.length === 0) return;
  if (mode === "enforce") {
    throw buildHdrProbeStageError(failures.map((failure) => failure.classified));
  }
  const firstFailure = failures[0];
  if (firstFailure) throw firstFailure.error;
}

function applyVideoExtractionFailurePolicy(
  result: ExtractionResult,
  policy: VideoExtractionPolicy,
  log?: ProducerLogger,
): VideoExtractionStageError | null {
  const error = buildVideoExtractionStageError(result);
  if (!error || policy.failureMode === "off") return null;
  log?.warn("Video extraction produced typed source failures", {
    mode: policy.failureMode,
    code: error.code,
    retryable: error.retryable,
    failures: error.failures,
  });
  return policy.failureMode === "enforce" ? error : null;
}

/**
 * Probe a media file's color space, returning null when it can't be read.
 *
 * Both HDR probes below widened which files they resolve (PRINFRA-349: the
 * shared resolver percent-decodes non-ASCII names, so `%E5%9B%BE1.png` now
 * finds `图1.png`). Files that used to silently fail to resolve are therefore
 * reachable for the first time — including truncated / 0-byte assets, on which
 * ffprobe exits non-zero and `extractMediaMetadata` throws. These probes run
 * inside a bare `Promise.all`, so an unguarded throw aborts the whole render
 * over one unreadable image. A probe that can't read a file must skip it, not
 * kill the render.
 */
async function probeColorSpaceSafely(
  path: string,
  log: ProducerLogger | undefined,
): Promise<VideoColorSpace | null> {
  try {
    const meta = await extractMediaMetadata(path);
    return meta.colorSpace;
  } catch (error) {
    log?.warn("HDR color-space probe failed; treating source as SDR", {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
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
  const extractionPolicy = resolveVideoExtractionPolicy();

  let frameLookup: FrameLookupTable | null = null;
  let extractionResult: Awaited<ReturnType<typeof extractAllVideoFrames>> | null = null;
  let failureToEnforce: VideoExtractionStageError | null = null;
  let videoReadinessSkipIds: string[] = [];
  let videoMetadataHints: CaptureVideoMetadataHint[] = [];

  // Probe ORIGINAL color spaces before extraction (which may convert SDR→HDR).
  // This is needed to identify which videos are natively HDR vs converted-SDR
  // for the two-pass compositing path. Skipped only in force-sdr mode to
  // avoid ffprobe overhead when the user has explicitly opted out.
  const nativeHdrVideoIds = new Set<string>();
  const videoTransfers = new Map<string, HdrTransfer>();
  let hdrProbeTransientRetries = 0;
  if (job.config.hdrMode !== "force-sdr" && composition.videos.length > 0) {
    log?.info("Probing video color spaces...", { videoCount: composition.videos.length });
    const probeFailures = await Promise.all(
      composition.videos.map(async (v) => {
        // Shared resolver so a `<video src="../assets/foo">` in a sub-composition
        // resolves the same way the browser would, and a percent-encoded
        // non-ASCII name decodes to its real on-disk path. Called with no
        // isAbsolute() pre-check: the resolver already returns an absolute path
        // that exists, and otherwise treats a leading slash as a browser
        // origin-root URL — pre-checking would hand back `/assets/%E5%9B%BE1.png`
        // undecoded and re-open PRINFRA-349 for root-relative srcs.
        const videoPath = resolveProjectRelativeSrc(v.src, projectDir, compiledDir);
        if (!existsSync(videoPath)) return null;
        try {
          // Retries are separately opt-in from the failure gate. With the
          // default zero budget this remains the exact legacy single probe.
          const attempted =
            extractionPolicy.maxTransientRetries === 0
              ? { result: await extractMediaMetadata(videoPath), retries: 0 }
              : await runVideoExtractionWithRetry(() => extractMediaMetadata(videoPath), {
                  signal: abortSignal,
                  maxTransientRetries: extractionPolicy.maxTransientRetries,
                  onRetry: () => {
                    hdrProbeTransientRetries += 1;
                  },
                });
          const meta = attempted.result;
          if (isHdrColorSpace(meta.colorSpace)) {
            nativeHdrVideoIds.add(v.id);
            videoTransfers.set(v.id, detectTransfer(meta.colorSpace));
          }
          return null;
        } catch (error) {
          if (extractionPolicy.failureMode === "off") throw error;
          const classified = classifyVideoExtractionError(error);
          log?.warn("Video HDR metadata probe failed", {
            mode: extractionPolicy.failureMode,
            kind: classified.kind,
            retryable: classified.retryable,
            transientRetries: hdrProbeTransientRetries,
          });
          return { error, classified };
        }
      }),
    );
    throwHdrProbeFailures(probeFailures.filter(isHdrProbeFailure), extractionPolicy.failureMode);
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
        // Same shared resolver as the video probe above — a percent-encoded
        // non-ASCII `<img src>` must decode to the on-disk path, or the HDR image
        // never enters nativeHdrImageIds and the composition silently renders
        // through the SDR fallback with wrong color (PRINFRA-349 symptom c).
        const imgPath = resolveProjectRelativeSrc(img.src, projectDir, compiledDir);
        if (!existsSync(imgPath)) return null;
        const colorSpace = await probeColorSpaceSafely(imgPath, log);
        if (isHdrColorSpace(colorSpace)) {
          nativeHdrImageIds.add(img.id);
          imageTransfers.set(img.id, detectTransfer(colorSpace));
          hdrImageSrcPaths.set(img.id, imgPath);
        }
        return colorSpace;
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
      // Preserve the configured rational through FFmpeg extraction. NTSC
      // rates must remain `30000/1001`, not a rounded JavaScript decimal,
      // because short boundary counts can differ by one frame.
      {
        fps: job.config.fps,
        outputDir: join(compiledDir, "__hyperframes_video_frames"),
        format: job.config.videoFrameFormat ?? "auto",
        timelineEnd: composition.duration,
        maxTransientRetries: extractionPolicy.maxTransientRetries,
        collectProbeFailures: extractionPolicy.failureMode === "enforce",
      },
      abortSignal,
      { extractCacheDir: cfg.extractCacheDir, extractCacheMaxBytes: cfg.extractCacheMaxBytes },
      compiledDir,
    );
    extractionResult.phaseBreakdown.transientRetries =
      (extractionResult.phaseBreakdown.transientRetries ?? 0) + hdrProbeTransientRetries;
    assertNotAborted();
    failureToEnforce = applyVideoExtractionFailurePolicy(extractionResult, extractionPolicy, log);

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
    failureToEnforce,
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
