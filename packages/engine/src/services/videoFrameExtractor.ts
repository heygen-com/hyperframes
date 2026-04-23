/**
 * Video Frame Extractor Service
 *
 * Pre-extracts video frames using FFmpeg for frame-accurate rendering.
 * Videos are replaced with <img> elements during capture.
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { isAbsolute, join } from "path";
import { parseHTML } from "linkedom";
import { extractMediaMetadata, type VideoMetadata } from "../utils/ffprobe.js";
import {
  analyzeCompositionHdr,
  isHdrColorSpace as isHdrColorSpaceUtil,
  type HdrTransfer,
} from "../utils/hdr.js";
import { downloadToTemp, isHttpUrl } from "../utils/urlDownloader.js";
import { runFfmpeg } from "../utils/runFfmpeg.js";
import { DEFAULT_CONFIG, type EngineConfig } from "../config.js";
import {
  FRAME_FILENAME_PREFIX,
  ensureCacheEntryDir,
  lookupCacheEntry,
  markCacheEntryComplete,
  readKeyStat,
  rehydrateCacheEntry,
  type CacheFrameFormat,
} from "./extractionCache.js";

export interface VideoElement {
  id: string;
  src: string;
  start: number;
  end: number;
  mediaStart: number;
  hasAudio: boolean;
}

export interface ExtractedFrames {
  videoId: string;
  srcPath: string;
  outputDir: string;
  framePattern: string;
  fps: number;
  totalFrames: number;
  metadata: VideoMetadata;
  framePaths: Map<number, string>;
  /**
   * True when the extractor owns `outputDir` and cleanup should rm it when
   * the render ends. Cache hits set this to false so the shared entry isn't
   * deleted by a single render's cleanup — the cache dir is owned by the
   * caller's gc policy, not any one render.
   */
  ownedByLookup?: boolean;
}

export interface ExtractionOptions {
  fps: number;
  outputDir: string;
  quality?: number;
  format?: "jpg" | "png";
}

/**
 * Per-phase timings and counters emitted by `extractAllVideoFrames`.
 *
 * Used by the producer to surface `perfSummary.videoExtractBreakdown` — without
 * this breakdown, a single `videoExtractMs` stage timing hides where cost lives
 * (HDR preflight, VFR preflight, per-video ffmpeg extract) when tuning renders.
 *
 * Field semantics:
 *   - *Ms fields are wall-clock durations inside each phase.
 *   - *Count fields report how many sources triggered that phase.
 *   - extractMs wraps the parallel `extractVideoFramesRange` calls; it
 *     reflects max-across-parallel-workers, not sum.
 *   - hdrPreflightMs / vfrPreflightMs both include their probe-time sibling
 *     (hdrProbeMs / vfrProbeMs) for symmetric semantics. The probe-only fields
 *     are a finer decomposition, not a separate carve-out.
 */
export interface ExtractionPhaseBreakdown {
  resolveMs: number;
  hdrProbeMs: number;
  hdrPreflightMs: number;
  hdrPreflightCount: number;
  vfrProbeMs: number;
  vfrPreflightMs: number;
  vfrPreflightCount: number;
  extractMs: number;
  cacheHits: number;
  cacheMisses: number;
}

export interface ExtractionResult {
  success: boolean;
  extracted: ExtractedFrames[];
  errors: Array<{ videoId: string; error: string }>;
  totalFramesExtracted: number;
  durationMs: number;
  phaseBreakdown: ExtractionPhaseBreakdown;
}

export function parseVideoElements(html: string): VideoElement[] {
  const videos: VideoElement[] = [];
  const { document } = parseHTML(html);

  const videoEls = document.querySelectorAll("video[src]");
  let autoIdCounter = 0;
  for (const el of videoEls) {
    const src = el.getAttribute("src");
    if (!src) continue;
    // Generate a stable ID for videos without one — the producer needs IDs
    // to track extracted frames and composite them during encoding.
    const id = el.getAttribute("id") || `hf-video-${autoIdCounter++}`;
    if (!el.getAttribute("id")) {
      el.setAttribute("id", id);
    }

    const startAttr = el.getAttribute("data-start");
    const endAttr = el.getAttribute("data-end");
    const durationAttr = el.getAttribute("data-duration");
    const mediaStartAttr = el.getAttribute("data-media-start");
    const hasAudioAttr = el.getAttribute("data-has-audio");

    const start = startAttr ? parseFloat(startAttr) : 0;
    // Derive end from data-end → data-start+data-duration → Infinity (natural duration).
    // The caller (htmlCompiler) clamps Infinity to the composition's absoluteEnd.
    let end = 0;
    if (endAttr) {
      end = parseFloat(endAttr);
    } else if (durationAttr) {
      end = start + parseFloat(durationAttr);
    } else {
      end = Infinity; // no explicit bounds — play for the full natural video duration
    }

    videos.push({
      id,
      src,
      start,
      end,
      mediaStart: mediaStartAttr ? parseFloat(mediaStartAttr) : 0,
      hasAudio: hasAudioAttr === "true",
    });
  }

  return videos;
}

export interface ImageElement {
  id: string;
  src: string;
  start: number;
  end: number;
}

export function parseImageElements(html: string): ImageElement[] {
  const images: ImageElement[] = [];
  const { document } = parseHTML(html);

  const imgEls = document.querySelectorAll("img[src]");
  let autoIdCounter = 0;
  for (const el of imgEls) {
    const src = el.getAttribute("src");
    if (!src) continue;

    const id = el.getAttribute("id") || `hf-img-${autoIdCounter++}`;
    if (!el.getAttribute("id")) {
      el.setAttribute("id", id);
    }

    const startAttr = el.getAttribute("data-start");
    const endAttr = el.getAttribute("data-end");
    const durationAttr = el.getAttribute("data-duration");

    const start = startAttr ? parseFloat(startAttr) : 0;
    let end = 0;
    if (endAttr) {
      end = parseFloat(endAttr);
    } else if (durationAttr) {
      end = start + parseFloat(durationAttr);
    } else {
      end = Infinity;
    }

    images.push({ id, src, start, end });
  }

  return images;
}

export async function extractVideoFramesRange(
  videoPath: string,
  videoId: string,
  startTime: number,
  duration: number,
  options: ExtractionOptions,
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegProcessTimeout">>,
  /**
   * Override the output directory for this extraction. When provided, frames
   * are written directly into `outputDirOverride` (no per-videoId subdir).
   * Used by the cache layer to materialize frames straight into the keyed
   * cache entry directory.
   */
  outputDirOverride?: string,
): Promise<ExtractedFrames> {
  const ffmpegProcessTimeout = config?.ffmpegProcessTimeout ?? DEFAULT_CONFIG.ffmpegProcessTimeout;
  const { fps, outputDir, quality = 95, format = "jpg" } = options;

  const videoOutputDir = outputDirOverride ?? join(outputDir, videoId);
  if (!existsSync(videoOutputDir)) mkdirSync(videoOutputDir, { recursive: true });

  const metadata = await extractMediaMetadata(videoPath);
  const framePattern = `${FRAME_FILENAME_PREFIX}%05d.${format}`;
  const outputPattern = join(videoOutputDir, framePattern);

  // When extracting from HDR source, tone-map to SDR in FFmpeg rather than
  // letting Chrome's uncontrollable tone-mapper handle it (which washes out).
  // macOS: VideoToolbox hardware decoder does HDR→SDR natively on Apple Silicon.
  // Linux: zscale filter (when available) or colorspace filter as fallback.
  const isHdr = isHdrColorSpaceUtil(metadata.colorSpace);
  const isMacOS = process.platform === "darwin";

  const args: string[] = [];
  if (isHdr && isMacOS) {
    args.push("-hwaccel", "videotoolbox");
  }
  args.push("-ss", String(startTime), "-i", videoPath, "-t", String(duration));

  const vfFilters: string[] = [];
  if (isHdr && isMacOS) {
    // VideoToolbox tone-maps during decode; force output to bt709 SDR format
    vfFilters.push("format=nv12");
  }
  vfFilters.push(`fps=${fps}`);
  args.push("-vf", vfFilters.join(","));

  args.push("-q:v", format === "jpg" ? String(Math.ceil((100 - quality) / 3)) : "0");
  if (format === "png") args.push("-compression_level", "6");
  args.push("-y", outputPattern);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args);
    let stderr = "";
    const onAbort = () => {
      ffmpeg.kill("SIGTERM");
    };
    if (signal) {
      if (signal.aborted) {
        ffmpeg.kill("SIGTERM");
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    const timer = setTimeout(() => {
      ffmpeg.kill("SIGTERM");
    }, ffmpegProcessTimeout);

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        reject(new Error("Video frame extraction cancelled"));
        return;
      }
      if (code !== 0) {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
        return;
      }

      const framePaths = new Map<number, string>();
      const files = readdirSync(videoOutputDir)
        .filter((f) => f.startsWith(FRAME_FILENAME_PREFIX) && f.endsWith(`.${format}`))
        .sort();
      files.forEach((file, index) => {
        framePaths.set(index, join(videoOutputDir, file));
      });

      resolve({
        videoId,
        srcPath: videoPath,
        outputDir: videoOutputDir,
        framePattern,
        fps,
        totalFrames: framePaths.size,
        metadata,
        framePaths,
      });
    });

    ffmpeg.on("error", (err) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("[FFmpeg] ffmpeg not found"));
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Convert an SDR (BT.709) video to BT.2020 wide-gamut so it can be composited
 * alongside HDR content without looking washed out.
 *
 * Uses FFmpeg's `colorspace` filter to remap BT.709 → BT.2020 (no real tone
 * mapping — just a primaries swap so the input fits inside the wider HDR
 * gamut), then re-tags the stream with the caller's target HDR transfer
 * function (PQ for HDR10, HLG for broadcast HDR). The output transfer must
 * match the dominant transfer of the surrounding HDR content; otherwise the
 * downstream encoder will tag the final video with the wrong curve.
 *
 * `startTime` and `duration` bound the re-encode to the segment the composition
 * actually uses. Without them a 30-minute screen recording that contributes a
 * 2-second clip was transcoded in full — a >100× waste for long sources.
 * Mirrors the segment-scope fix already applied to the VFR→CFR preflight.
 */
async function convertSdrToHdr(
  inputPath: string,
  outputPath: string,
  startTime: number,
  duration: number,
  targetTransfer: HdrTransfer,
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegProcessTimeout">>,
): Promise<void> {
  // Positive duration is required — FFmpeg's `-t 0` silently produces a 0-byte
  // output that the downstream extractor then treats as a valid (empty) file.
  if (duration <= 0) {
    throw new Error(`convertSdrToHdr: duration must be positive (got ${duration})`);
  }
  const timeout = config?.ffmpegProcessTimeout ?? DEFAULT_CONFIG.ffmpegProcessTimeout;

  // smpte2084 = PQ (HDR10), arib-std-b67 = HLG.
  const colorTrc = targetTransfer === "pq" ? "smpte2084" : "arib-std-b67";

  const args = [
    "-ss",
    String(startTime),
    "-i",
    inputPath,
    "-t",
    String(duration),
    "-vf",
    "colorspace=all=bt2020:iall=bt709:range=tv",
    "-color_primaries",
    "bt2020",
    "-color_trc",
    colorTrc,
    "-colorspace",
    "bt2020nc",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "16",
    "-c:a",
    "copy",
    "-y",
    outputPath,
  ];

  const result = await runFfmpeg(args, { signal, timeout });
  if (!result.success) {
    throw new Error(
      `SDR→HDR conversion failed (exit ${result.exitCode}): ${result.stderr.slice(-300)}`,
    );
  }
}

/**
 * Resolve the used-segment duration for a video, falling back to the source's
 * natural duration when the caller hasn't specified bounds (end=Infinity) or
 * the bounds are nonsensical (end<=start).
 */
function resolveSegmentDuration(
  requested: number,
  mediaStart: number,
  metadata: VideoMetadata,
): number {
  if (Number.isFinite(requested) && requested > 0) return requested;
  const sourceRemaining = metadata.durationSeconds - mediaStart;
  return sourceRemaining > 0 ? sourceRemaining : metadata.durationSeconds;
}

/**
 * Re-encode a VFR (variable frame rate) video segment to CFR so the downstream
 * fps filter can extract frames reliably. Screen recordings, phone videos, and
 * some webcams emit irregular timestamps that cause two failure modes:
 *   1. Output has fewer frames than expected (e.g. -ss 3 -t 4 produces 90
 *      frames instead of 120 @ 30fps). FrameLookupTable.getFrameAtTime then
 *      returns null for late timestamps and the caller freezes on the last
 *      valid frame.
 *   2. Large duplicate-frame runs where source PTS don't land on target
 *      timestamps.
 *
 * Only the [startTime, startTime+duration] window is re-encoded, so long
 * recordings aren't fully transcoded when only a short clip is used.
 */
async function convertVfrToCfr(
  inputPath: string,
  outputPath: string,
  targetFps: number,
  startTime: number,
  duration: number,
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegProcessTimeout">>,
): Promise<void> {
  const timeout = config?.ffmpegProcessTimeout ?? DEFAULT_CONFIG.ffmpegProcessTimeout;

  const args = [
    "-ss",
    String(startTime),
    "-i",
    inputPath,
    "-t",
    String(duration),
    "-fps_mode",
    "cfr",
    "-r",
    String(targetFps),
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "18",
    "-c:a",
    "copy",
    "-y",
    outputPath,
  ];

  const result = await runFfmpeg(args, { signal, timeout });
  if (!result.success) {
    throw new Error(
      `VFR→CFR conversion failed (exit ${result.exitCode}): ${result.stderr.slice(-300)}`,
    );
  }
}

export async function extractAllVideoFrames(
  videos: VideoElement[],
  baseDir: string,
  options: ExtractionOptions,
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegProcessTimeout" | "extractCacheDir">>,
  compiledDir?: string,
): Promise<ExtractionResult> {
  const startTime = Date.now();
  const extracted: ExtractedFrames[] = [];
  const errors: Array<{ videoId: string; error: string }> = [];
  let totalFramesExtracted = 0;
  const breakdown: ExtractionPhaseBreakdown = {
    resolveMs: 0,
    hdrProbeMs: 0,
    hdrPreflightMs: 0,
    hdrPreflightCount: 0,
    vfrProbeMs: 0,
    vfrPreflightMs: 0,
    vfrPreflightCount: 0,
    extractMs: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };

  // Phase 1: Resolve paths and download remote videos
  const phase1Start = Date.now();
  const resolvedVideos: Array<{ video: VideoElement; videoPath: string }> = [];
  for (const video of videos) {
    if (signal?.aborted) break;
    try {
      let videoPath = video.src;
      // Use isAbsolute() rather than startsWith("/"). On Windows, absolute paths
      // like "C:\…" are not detected by the latter, so we'd re-join them under
      // baseDir and produce duplicated, nonexistent paths
      // (e.g. C:\tmp\hf-vfr-test-X\C:\tmp\hf-vfr-test-X\vfr_screen.mp4).
      if (!isAbsolute(videoPath) && !isHttpUrl(videoPath)) {
        const fromCompiled = compiledDir ? join(compiledDir, videoPath) : null;
        videoPath =
          fromCompiled && existsSync(fromCompiled) ? fromCompiled : join(baseDir, videoPath);
      }

      if (isHttpUrl(videoPath)) {
        const downloadDir = join(options.outputDir, "_downloads");
        mkdirSync(downloadDir, { recursive: true });
        videoPath = await downloadToTemp(videoPath, downloadDir);
      }

      if (!existsSync(videoPath)) {
        errors.push({ videoId: video.id, error: `Video file not found: ${videoPath}` });
        continue;
      }
      resolvedVideos.push({ video, videoPath });
    } catch (err) {
      errors.push({ videoId: video.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  breakdown.resolveMs = Date.now() - phase1Start;

  // Snapshot the pre-preflight key inputs so the extraction cache keys on the
  // user-visible source (original path, original mediaStart, original segment
  // bounds) rather than the workDir-local normalized file produced by
  // Phase 2a/2b preflight. Without this, every render would write a new
  // normalized file with a fresh mtime → fresh cache key → perpetual misses.
  const cacheKeyInputs = resolvedVideos.map(({ video, videoPath }) => {
    const stat = readKeyStat(videoPath);
    // Missing files return null — skip the cache path for that entry. The
    // extractor will surface the real file-not-found error downstream, and we
    // avoid polluting the cache with a `(mtimeMs: 0, size: 0)` tuple that two
    // unrelated missing paths would otherwise share.
    if (!stat) return null;
    return {
      videoPath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      mediaStart: video.mediaStart,
      start: video.start,
      end: video.end,
    };
  });

  // Phase 2: Probe color spaces and normalize if mixed HDR/SDR
  const phase2ProbeStart = Date.now();
  const videoMetadata = await Promise.all(
    resolvedVideos.map(({ videoPath }) => extractMediaMetadata(videoPath)),
  );
  const videoColorSpaces = videoMetadata.map((m) => m.colorSpace);
  breakdown.hdrProbeMs = Date.now() - phase2ProbeStart;

  const hdrPreflightStart = Date.now();
  const hdrInfo = analyzeCompositionHdr(videoColorSpaces);
  // Track entries the HDR preflight validated as non-extractable so they can
  // be removed from every parallel array before Phase 2b and Phase 3 see them.
  // Without this, `errors.push({...}); continue;` only short-circuits the
  // normalization step — the invalid entry stays in `resolvedVideos` and
  // Phase 3 still calls `extractVideoFramesRange` on the same past-EOF
  // mediaStart, surfacing a second raw FFmpeg error for the same clip.
  const hdrSkippedIndices = new Set<number>();
  if (hdrInfo.hasHdr && hdrInfo.dominantTransfer) {
    // dominantTransfer is "majority wins" — if a composition mixes PQ and HLG
    // sources (rare but legal), the minority transfer's videos get converted
    // with the wrong curve. We treat this as caller-error: a single composition
    // should not mix PQ and HLG sources, the orchestrator picks one transfer
    // for the whole render, and any source not on that curve is normalized to
    // it. If you need both transfers, render two separate compositions.
    const targetTransfer = hdrInfo.dominantTransfer;
    const convertDir = join(options.outputDir, "_hdr_normalized");
    mkdirSync(convertDir, { recursive: true });

    for (let i = 0; i < resolvedVideos.length; i++) {
      if (signal?.aborted) break;
      const cs = videoColorSpaces[i] ?? null;
      if (!isHdrColorSpaceUtil(cs)) {
        // SDR video in a mixed timeline — convert to the dominant HDR transfer
        // so the encoder tags the final video correctly (PQ vs HLG).
        const entry = resolvedVideos[i];
        const metadata = videoMetadata[i];
        if (!entry || !metadata) continue;

        // Guard against mediaStart past EOF — FFmpeg's `-ss` silently produces
        // a 0-byte file when seeking beyond the source duration, and the
        // downstream extractor then points at a broken input.
        if (entry.video.mediaStart >= metadata.durationSeconds) {
          errors.push({
            videoId: entry.video.id,
            error: `SDR→HDR conversion skipped: mediaStart (${entry.video.mediaStart}s) ≥ source duration (${metadata.durationSeconds}s)`,
          });
          hdrSkippedIndices.add(i);
          continue;
        }

        // Scope the re-encode to the segment the composition actually uses.
        // Long sources (e.g. 30-minute screen recordings) contributing short
        // clips were transcoded in full pre-fix — a >100× waste.
        let segDuration = entry.video.end - entry.video.start;
        if (!Number.isFinite(segDuration) || segDuration <= 0) {
          const sourceRemaining = metadata.durationSeconds - entry.video.mediaStart;
          segDuration = sourceRemaining > 0 ? sourceRemaining : metadata.durationSeconds;
        }

        const convertedPath = join(convertDir, `${entry.video.id}_hdr.mp4`);
        try {
          await convertSdrToHdr(
            entry.videoPath,
            convertedPath,
            entry.video.mediaStart,
            segDuration,
            targetTransfer,
            signal,
            config,
          );
          entry.videoPath = convertedPath;
          // Segment-scoped re-encode starts the new file at t=0, so downstream
          // extraction must seek from 0, not the original mediaStart. Shallow-copy
          // to avoid mutating the caller's VideoElement (mirrors the VFR fix).
          entry.video = { ...entry.video, mediaStart: 0 };
          breakdown.hdrPreflightCount += 1;
        } catch (err) {
          errors.push({
            videoId: entry.video.id,
            error: `SDR→HDR conversion failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }
  }
  breakdown.hdrPreflightMs = Date.now() - hdrPreflightStart;

  // Remove HDR-preflight-skipped entries from every parallel array so Phase 2b
  // (VFR) and Phase 3 (extract) don't re-process them. Iterate backwards to
  // keep indices stable while splicing.
  if (hdrSkippedIndices.size > 0) {
    for (let i = resolvedVideos.length - 1; i >= 0; i--) {
      if (hdrSkippedIndices.has(i)) {
        resolvedVideos.splice(i, 1);
        videoMetadata.splice(i, 1);
        videoColorSpaces.splice(i, 1);
        // Added by the extraction-cache commit: keep cacheKeyInputs aligned
        // with the other parallel arrays so Phase 3's `cacheKeyInputs[i]`
        // lookup doesn't point at a stale slot after the splice.
        cacheKeyInputs.splice(i, 1);
      }
    }
  }

  // Phase 2b: Re-encode VFR inputs to CFR so the fps filter in Phase 3 produces
  // the expected frame count. Only the used segment is transcoded.
  const vfrPreflightStart = Date.now();
  const vfrNormDir = join(options.outputDir, "_vfr_normalized");
  for (let i = 0; i < resolvedVideos.length; i++) {
    if (signal?.aborted) break;
    const entry = resolvedVideos[i];
    if (!entry) continue;
    const vfrProbeStart = Date.now();
    const metadata = await extractMediaMetadata(entry.videoPath);
    breakdown.vfrProbeMs += Date.now() - vfrProbeStart;
    if (!metadata.isVFR) continue;

    let segDuration = entry.video.end - entry.video.start;
    if (!Number.isFinite(segDuration) || segDuration <= 0) {
      const sourceRemaining = metadata.durationSeconds - entry.video.mediaStart;
      segDuration = sourceRemaining > 0 ? sourceRemaining : metadata.durationSeconds;
    }

    mkdirSync(vfrNormDir, { recursive: true });
    const normalizedPath = join(vfrNormDir, `${entry.video.id}_cfr.mp4`);
    try {
      await convertVfrToCfr(
        entry.videoPath,
        normalizedPath,
        options.fps,
        entry.video.mediaStart,
        segDuration,
        signal,
        config,
      );
      entry.videoPath = normalizedPath;
      // Segment-scoped re-encode starts the new file at t=0, so downstream
      // extraction must seek from 0, not the original mediaStart. Shallow-copy
      // to avoid mutating the caller's VideoElement.
      entry.video = { ...entry.video, mediaStart: 0 };
      breakdown.vfrPreflightCount += 1;
    } catch (err) {
      errors.push({
        videoId: entry.video.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  breakdown.vfrPreflightMs = Date.now() - vfrPreflightStart;

  const phase3Start = Date.now();
  const cacheRootDir = config?.extractCacheDir;
  const cacheFormat: CacheFrameFormat = options.format ?? "jpg";

  async function tryCachedExtract(
    video: VideoElement,
    videoPath: string,
    videoDuration: number,
    i: number,
  ): Promise<ExtractedFrames | null> {
    if (!cacheRootDir) return null;
    const keyInput = cacheKeyInputs[i];
    const probedMeta = videoMetadata[i];
    if (!keyInput || !probedMeta) return null;

    const keyDuration = resolveSegmentDuration(
      keyInput.end - keyInput.start,
      keyInput.mediaStart,
      probedMeta,
    );
    const lookup = lookupCacheEntry(cacheRootDir, {
      videoPath: keyInput.videoPath,
      mtimeMs: keyInput.mtimeMs,
      size: keyInput.size,
      mediaStart: keyInput.mediaStart,
      duration: keyDuration,
      fps: options.fps,
      format: cacheFormat,
    });

    if (lookup.hit) {
      breakdown.cacheHits += 1;
      const rehydrated = rehydrateCacheEntry(lookup.entry, {
        videoId: video.id,
        srcPath: keyInput.videoPath,
        fps: options.fps,
        format: cacheFormat,
        metadata: probedMeta,
      });
      return { ...rehydrated, ownedByLookup: true };
    }

    breakdown.cacheMisses += 1;
    ensureCacheEntryDir(lookup.entry);
    const result = await extractVideoFramesRange(
      videoPath,
      video.id,
      video.mediaStart,
      videoDuration,
      options,
      signal,
      config,
      lookup.entry.dir,
    );
    // Mark complete only AFTER frames are on disk — a crash mid-extract
    // leaves the entry un-sentineled so the next lookup re-extracts over it.
    markCacheEntryComplete(lookup.entry);
    return { ...result, ownedByLookup: true };
  }

  const results = await Promise.all(
    resolvedVideos.map(async ({ video, videoPath }, i) => {
      if (signal?.aborted) {
        throw new Error("Video frame extraction cancelled");
      }
      try {
        const probedMeta = videoMetadata[i] ?? (await extractMediaMetadata(videoPath));
        const videoDuration = resolveSegmentDuration(
          video.end - video.start,
          video.mediaStart,
          probedMeta,
        );
        if (video.end - video.start !== videoDuration) {
          video.end = video.start + videoDuration;
        }

        const cached = await tryCachedExtract(video, videoPath, videoDuration, i);
        if (cached) return { result: cached };

        const result = await extractVideoFramesRange(
          videoPath,
          video.id,
          video.mediaStart,
          videoDuration,
          options,
          signal,
          config,
        );

        return { result };
      } catch (err) {
        return {
          error: {
            videoId: video.id,
            error: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }),
  );

  breakdown.extractMs = Date.now() - phase3Start;

  // Collect results and errors
  for (const item of results) {
    if ("error" in item && item.error) {
      errors.push(item.error);
    } else if ("result" in item) {
      extracted.push(item.result);
      totalFramesExtracted += item.result.totalFrames;
    }
  }

  return {
    success: errors.length === 0,
    extracted,
    errors,
    totalFramesExtracted,
    durationMs: Date.now() - startTime,
    phaseBreakdown: breakdown,
  };
}

export function getFrameAtTime(
  extracted: ExtractedFrames,
  globalTime: number,
  videoStart: number,
): string | null {
  const localTime = globalTime - videoStart;
  if (localTime < 0) return null;
  const frameIndex = Math.floor(localTime * extracted.fps);
  if (frameIndex < 0 || frameIndex >= extracted.totalFrames) return null;
  return extracted.framePaths.get(frameIndex) || null;
}

export class FrameLookupTable {
  private videos: Map<
    string,
    {
      extracted: ExtractedFrames;
      start: number;
      end: number;
      mediaStart: number;
    }
  > = new Map();
  private orderedVideos: Array<{
    videoId: string;
    extracted: ExtractedFrames;
    start: number;
    end: number;
    mediaStart: number;
  }> = [];
  private activeVideoIds: Set<string> = new Set();
  private startCursor = 0;
  private lastTime: number | null = null;

  addVideo(extracted: ExtractedFrames, start: number, end: number, mediaStart: number): void {
    this.videos.set(extracted.videoId, { extracted, start, end, mediaStart });
    this.orderedVideos = Array.from(this.videos.entries())
      .map(([videoId, video]) => ({ videoId, ...video }))
      .sort((a, b) => a.start - b.start);
    this.resetActiveState();
  }

  getFrame(videoId: string, globalTime: number): string | null {
    const video = this.videos.get(videoId);
    if (!video) return null;
    if (globalTime < video.start || globalTime >= video.end) return null;
    return getFrameAtTime(video.extracted, globalTime, video.start);
  }

  private resetActiveState(): void {
    this.activeVideoIds.clear();
    this.startCursor = 0;
    this.lastTime = null;
  }

  private refreshActiveSet(globalTime: number): void {
    if (this.lastTime == null || globalTime < this.lastTime) {
      this.activeVideoIds.clear();
      this.startCursor = 0;
      for (const entry of this.orderedVideos) {
        if (entry.start <= globalTime && globalTime < entry.end) {
          this.activeVideoIds.add(entry.videoId);
        }
        if (entry.start <= globalTime) {
          this.startCursor += 1;
        } else {
          break;
        }
      }
      this.lastTime = globalTime;
      return;
    }

    while (this.startCursor < this.orderedVideos.length) {
      const candidate = this.orderedVideos[this.startCursor];
      if (!candidate) break;
      if (candidate.start > globalTime) {
        break;
      }
      if (globalTime < candidate.end) {
        this.activeVideoIds.add(candidate.videoId);
      }
      this.startCursor += 1;
    }

    for (const videoId of Array.from(this.activeVideoIds)) {
      const video = this.videos.get(videoId);
      if (!video || globalTime < video.start || globalTime >= video.end) {
        this.activeVideoIds.delete(videoId);
      }
    }
    this.lastTime = globalTime;
  }

  getActiveFramePayloads(
    globalTime: number,
  ): Map<string, { framePath: string; frameIndex: number }> {
    const frames = new Map<string, { framePath: string; frameIndex: number }>();
    this.refreshActiveSet(globalTime);
    for (const videoId of this.activeVideoIds) {
      const video = this.videos.get(videoId);
      if (!video) continue;
      const localTime = globalTime - video.start;
      const frameIndex = Math.floor(localTime * video.extracted.fps);
      if (frameIndex < 0 || frameIndex >= video.extracted.totalFrames) continue;
      const framePath = video.extracted.framePaths.get(frameIndex);
      if (!framePath) continue;
      frames.set(videoId, { framePath, frameIndex });
    }
    return frames;
  }

  getActiveFrames(globalTime: number): Map<string, string> {
    const payloads = this.getActiveFramePayloads(globalTime);
    const frames = new Map<string, string>();
    for (const [videoId, payload] of payloads) {
      frames.set(videoId, payload.framePath);
    }
    return frames;
  }

  cleanup(): void {
    for (const video of this.videos.values()) {
      // Cache-hit / cache-write entries are owned by the extraction cache —
      // a single render must not delete them, or the next render's lookup
      // would miss and re-extract unnecessarily.
      if (video.extracted.ownedByLookup) continue;
      if (existsSync(video.extracted.outputDir)) {
        rmSync(video.extracted.outputDir, { recursive: true, force: true });
      }
    }
    this.videos.clear();
    this.orderedVideos = [];
    this.resetActiveState();
  }
}

export function createFrameLookupTable(
  videos: VideoElement[],
  extracted: ExtractedFrames[],
): FrameLookupTable {
  const table = new FrameLookupTable();
  const extractedMap = new Map<string, ExtractedFrames>();
  for (const ext of extracted) extractedMap.set(ext.videoId, ext);

  for (const video of videos) {
    const ext = extractedMap.get(video.id);
    if (ext) table.addVideo(ext, video.start, video.end, video.mediaStart);
  }

  return table;
}
