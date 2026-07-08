// fallow-ignore-file unused-class-member code-duplication complexity
/**
 * Video Frame Extractor Service
 *
 * Pre-extracts video frames using FFmpeg for frame-accurate rendering.
 * Videos are replaced with <img> elements during capture.
 */

import { spawn } from "child_process";
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, rmSync } from "fs";
import { isAbsolute, join, posix, resolve, sep } from "path";
import { parseHTML } from "linkedom";
import {
  decodeUrlPathVariants,
  MEDIA_DURATION_CLAMP_EPSILON_SECONDS,
  parseNumeric,
  parseStartExpression,
} from "@hyperframes/core";
import { trackChildProcess } from "../utils/processTracker.js";
import { extractMediaMetadata, type VideoMetadata } from "../utils/ffprobe.js";
import {
  analyzeCompositionHdr,
  isHdrColorSpace as isHdrColorSpaceUtil,
  type HdrTransfer,
} from "../utils/hdr.js";
import { downloadToTemp, isHttpUrl } from "../utils/urlDownloader.js";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { DEFAULT_CONFIG, type EngineConfig } from "../config.js";
import { unwrapTemplate } from "../utils/htmlTemplate.js";
import {
  FRAME_FILENAME_PREFIX,
  gcExtractionCache,
  gcSweepDue,
  lookupCacheEntry,
  partialCacheEntryDir,
  publishCacheEntry,
  readKeyStat,
  rehydrateCacheEntry,
  touchCacheEntry,
  type CacheEntry,
  type CacheFrameFormat,
} from "./extractionCache.js";

export interface VideoElement {
  id: string;
  src: string;
  start: number;
  end: number;
  mediaStart: number;
  loop: boolean;
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

/**
 * The single source of truth for the source-video frame-extraction allow-list.
 * The CLI flag parser, the producer HTTP server, and the distributed-config
 * validator all validate against this same set via {@link isVideoFrameFormat}
 * so the boundaries can't drift when a new format is added.
 */
export const VIDEO_FRAME_FORMATS = ["auto", "jpg", "png"] as const;
export type VideoFrameFormat = (typeof VIDEO_FRAME_FORMATS)[number];

/** Runtime guard for {@link VideoFrameFormat} over an untrusted value. */
export function isVideoFrameFormat(value: unknown): value is VideoFrameFormat {
  return typeof value === "string" && (VIDEO_FRAME_FORMATS as readonly string[]).includes(value);
}

export interface ExtractionOptions {
  fps: number;
  outputDir: string;
  quality?: number;
  format?: VideoFrameFormat;
  sdrToHdrTransfer?: HdrTransfer;
}

const EXTRACT_CACHE_MIN_AGE_MS = 60 * 60 * 1000;
const GC_STALENESS_MS = 24 * 60 * 60 * 1000;
const SDR_TO_HDR_COLORSPACE_FILTER = "colorspace=all=bt2020:iall=bt709:range=tv";

function sdrToHdrTransformKey(transfer: HdrTransfer): string {
  return `sdr2hdr-${transfer}`;
}

/**
 * Per-phase timings and counters emitted by `extractAllVideoFrames`.
 *
 * Used by the producer to surface `perfSummary.videoExtractBreakdown` — without
 * this breakdown, a single `videoExtractMs` stage timing hides where cost lives
 * (HDR preflight, VFR classification, per-video ffmpeg extract) when tuning renders.
 *
 * Field semantics:
 *   - *Ms fields are wall-clock durations inside each phase.
 *   - *Count fields report how many sources triggered that phase.
 *   - extractMs wraps the parallel `extractVideoFramesRange` calls; it
 *     reflects max-across-parallel-workers, not sum.
 *   - hdrPreflightMs includes its probe-time sibling (hdrProbeMs); the
 *     probe-only field is a finer decomposition, not a separate carve-out.
 *   - vfrPreflightCount reports sources classified as VFR and routed through
 *     the one-pass `-fps_mode cfr -r` extraction path. DEFINITION CHANGE:
 *     before the one-pass refactor, vfrPreflightMs timed a per-source
 *     VFR-to-CFR re-encode and could reach seconds; it now times only the
 *     (promise-cached) classification probe and is expected to be ~0.
 *     Dashboards alerting on vfrPreflightMs thresholds should key on
 *     vfrPreflightCount or extractMs instead.
 */
export interface ExtractionPhaseBreakdown {
  resolveMs: number;
  /** Publishes that could not land atomically — the render still succeeded
   *  from the partial dir, but future renders re-extract. A rising rate is
   *  the first signal that warm renders are silently going cold. */
  cachePublishFailures: number;
  /** Entries evicted by the post-extraction LRU sweep. */
  cacheGcEvictions: number;
  /** Bytes reclaimed by the LRU sweep. */
  cacheGcBytesFreed: number;
  /** Aged .partial-* dirs (crashed writers) removed by the sweep. */
  cacheAgedPartialsCleared: number;
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

// Minimal structural DOM shape the reference resolver needs, so it works
// against linkedom (Node) without pulling in lib.dom types.
interface RefResolverEl {
  getAttribute(name: string): string | null;
}
interface RefResolverDoc {
  getElementById(id: string): RefResolverEl | null;
  querySelector(selector: string): RefResolverEl | null;
}

/**
 * Find the element a relative `data-start` reference points at — by `id`
 * first, then by `data-composition-id` (a sub-composition can be referenced).
 * The reference-id grammar (see parseStartExpression) is restricted to
 * `[A-Za-z0-9_.:-]`, none of which need escaping inside a quoted attribute
 * selector, so no CSS.escape (absent in linkedom) is required.
 */
function findReferenceTargetEl(doc: RefResolverDoc, refId: string): RefResolverEl | null {
  return doc.getElementById(refId) ?? doc.querySelector(`[data-composition-id="${refId}"]`);
}

/**
 * Resolve an element's absolute start time (seconds) the same way the browser
 * runtime's startResolver does, so `<video data-start="intro">` (a relative
 * reference to another clip's end) renders at the right time instead of
 * producing NaN and compositing blank. Durations come from `data-duration` or
 * `data-end` here; the natural-media-duration fallback isn't known at parse
 * time, so — exactly like the runtime — an unknown-duration reference falls
 * back to the target's start and an unknown target falls back to 0 (never NaN).
 */
function resolveReferencedStart(
  doc: RefResolverDoc,
  el: RefResolverEl,
  startCache: Map<RefResolverEl, number>,
  visiting: Set<RefResolverEl>,
): number {
  const cached = startCache.get(el);
  if (cached !== undefined) return cached;
  if (visiting.has(el)) return 0; // cycle guard (A -> B -> A)
  visiting.add(el);
  try {
    const expression = parseStartExpression(el.getAttribute("data-start"));
    if (!expression) {
      startCache.set(el, 0);
      return 0;
    }
    if (expression.kind === "absolute") {
      const value = Math.max(0, expression.value);
      startCache.set(el, value);
      return value;
    }
    const target = findReferenceTargetEl(doc, expression.refId);
    if (!target) {
      startCache.set(el, 0);
      return 0;
    }
    const targetStart = resolveReferencedStart(doc, target, startCache, visiting);
    const targetDuration = resolveReferencedDuration(doc, target, startCache, visiting);
    const resolved =
      targetDuration != null && targetDuration > 0
        ? Math.max(0, targetStart + targetDuration + expression.offset)
        : Math.max(0, targetStart + expression.offset);
    startCache.set(el, resolved);
    return resolved;
  } finally {
    visiting.delete(el);
  }
}

/**
 * Duration of a referenced clip, from `data-duration` or `data-end - start`.
 * Returns null when only the natural media duration would settle it (unknown
 * at parse time) — the caller then treats the reference as duration-0.
 */
function resolveReferencedDuration(
  doc: RefResolverDoc,
  el: RefResolverEl,
  startCache: Map<RefResolverEl, number>,
  visiting: Set<RefResolverEl>,
): number | null {
  const durationAttr = parseNumeric(el.getAttribute("data-duration"));
  if (durationAttr != null && durationAttr > 0) return durationAttr;
  const endAttr = parseNumeric(el.getAttribute("data-end"));
  if (endAttr != null) {
    const start = resolveReferencedStart(doc, el, startCache, visiting);
    const delta = endAttr - start;
    if (Number.isFinite(delta) && delta > 0) return delta;
  }
  return null;
}

export function parseVideoElements(html: string): VideoElement[] {
  const videos: VideoElement[] = [];
  const { document } = parseHTML(unwrapTemplate(html));
  const startCache = new Map<RefResolverEl, number>();
  const visiting = new Set<RefResolverEl>();

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

    // Resolve data-start, including relative references ("intro", "intro + 2")
    // to another clip's end — the browser runtime resolves these but a raw
    // parseFloat here would yield NaN, placing the clip at NaN so it composites
    // blank in the final render. `startAttr` may be a plain number or a
    // reference; the resolver handles both.
    const start = startAttr ? resolveReferencedStart(document, el, startCache, visiting) : 0;
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
      loop: el.hasAttribute("loop"),
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
  const { document } = parseHTML(unwrapTemplate(html));
  const startCache = new Map<RefResolverEl, number>();
  const visiting = new Set<RefResolverEl>();

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

    // Resolve relative data-start references (see parseVideoElements) so a
    // referenced image start doesn't become NaN and drop the image from the render.
    const start = startAttr ? resolveReferencedStart(document, el, startCache, visiting) : 0;
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
  const { fps, outputDir, quality = 95 } = options;

  const videoOutputDir = outputDirOverride ?? join(outputDir, videoId);
  if (!existsSync(videoOutputDir)) mkdirSync(videoOutputDir, { recursive: true });

  const metadata = await extractMediaMetadata(videoPath);
  const format = resolveFrameFormat(metadata, options.format);
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
  // Always force the alpha-aware decoder on codecs that can carry alpha. The
  // alternative — gating on `metadata.hasAlpha` — relies on tag detection that
  // has at least three known failure modes: case-sensitivity across ffmpeg
  // versions (`alpha_mode` vs `ALPHA_MODE`), missing tags from older muxers,
  // and mp4-as-webm rewraps that drop the sidecar. A wrong negative there
  // silently strips alpha during decode and the bug doesn't surface until
  // the rendered video is missing layers. Codec-based default has no such
  // ambiguity: libvpx-vp9 reads the alpha sidecar when present and decodes
  // normally when it isn't.
  if (codecMayHaveAlpha(metadata.videoCodec)) {
    args.push("-c:v", decoderForCodec(metadata.videoCodec));
  }
  args.push("-ss", String(startTime), "-i", videoPath, "-t", String(duration));

  const vfFilters: string[] = [];
  if (isHdr && isMacOS) {
    // VideoToolbox tone-maps during decode; force output to bt709 SDR format
    vfFilters.push("format=nv12");
  }
  if (!metadata.isVFR) {
    vfFilters.push(`fps=${fps}`);
  }
  if (options.sdrToHdrTransfer) {
    // Ordering intent: fps sampling runs BEFORE the colorspace remap so only
    // kept frames are converted. The remap is pointwise per-frame, so the
    // output is identical either way for the SDR (BT.709, 8-bit) inputs this
    // flag is set for. If format=nv12 (macOS HDR-source decode) ever combines
    // with this flag, revisit: nv12 subsampling before a BT.2020 remap is an
    // untested interaction (today the flags are mutually exclusive — the
    // remap only applies to SDR sources, nv12 only to HDR sources).
    vfFilters.push(SDR_TO_HDR_COLORSPACE_FILTER);
  }
  if (vfFilters.length > 0) args.push("-vf", vfFilters.join(","));
  if (metadata.isVFR) args.push("-fps_mode", "cfr", "-r", String(fps));

  args.push("-q:v", format === "jpg" ? String(Math.ceil((100 - quality) / 3)) : "0");
  // Render-scoped temp frames are read once; level 1 measured 3-5x faster for ~14% larger files.
  if (format === "png") args.push("-compression_level", "1");
  args.push("-y", outputPattern);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(getFfmpegBinary(), args);
    trackChildProcess(ffmpeg);
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
        // With the SDR-to-HDR remap folded into this pass, a filter failure
        // (e.g. an ffmpeg built without the colorspace filter) would otherwise
        // surface as a generic extract error and the operator has to grep the
        // filter chain to learn it was the HDR conversion. Attribute it.
        const hdrPrefix = options.sdrToHdrTransfer
          ? `SDR→HDR conversion failed (colorspace filter in extract pass, target ${options.sdrToHdrTransfer}): `
          : "";
        reject(new Error(`${hdrPrefix}FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
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
 * Codecs whose bitstream is allowed to carry an alpha channel. Default the
 * extraction path to PNG output for these regardless of `metadata.hasAlpha`
 * so a missed sidecar tag doesn't silently strip transparency. Opaque content
 * encoded in one of these codecs pays a small file-size cost on the cached
 * frames but stays correct on the rare case where alpha IS present and the
 * tag was missed.
 */
const ALPHA_CAPABLE_CODECS = new Set(["vp9", "vp8", "prores"]);

export function codecMayHaveAlpha(codec: string | undefined): boolean {
  return ALPHA_CAPABLE_CODECS.has((codec ?? "").toLowerCase());
}

export function decoderForCodec(codec: string | undefined): string {
  const c = (codec ?? "").toLowerCase();
  if (c === "vp9") return "libvpx-vp9";
  if (c === "vp8") return "libvpx";
  return c;
}

export function resolveFrameFormat(
  metadata: VideoMetadata,
  requested?: VideoFrameFormat,
): CacheFrameFormat {
  if (metadata.hasAlpha || codecMayHaveAlpha(metadata.videoCodec)) return "png";
  if (requested === "png" || requested === "jpg") return requested;
  return "jpg";
}

type PreparedExtraction = {
  video: VideoElement;
  videoPath: string;
  index: number;
  metadata: VideoMetadata;
  videoDuration: number;
  format: CacheFrameFormat;
  sdrToHdrTransfer?: HdrTransfer;
  dedupeKey: string;
};

type CacheMissTarget = {
  entry: CacheEntry;
  srcPath: string;
};

type UniqueExtractionMiss = {
  work: PreparedExtraction;
  cacheTarget?: CacheMissTarget;
};

type SupersetMemberPlan = {
  miss: UniqueExtractionMiss;
  offsetFrames: number;
};

type SupersetGroupPlan = {
  groupId: string;
  baseStart: number;
  unionDuration: number;
  members: SupersetMemberPlan[];
};

function extractedFrameFileNames(outputDir: string, format: CacheFrameFormat): string[] {
  const suffix = `.${format}`;
  return readdirSync(outputDir)
    .filter((file) => file.startsWith(FRAME_FILENAME_PREFIX) && file.endsWith(suffix))
    .sort();
}

function extractedFramesFromDirectory(
  work: PreparedExtraction,
  outputDir: string,
  srcPath: string,
  fps: number,
): ExtractedFrames {
  const framePattern = `${FRAME_FILENAME_PREFIX}%05d.${work.format}`;
  const framePaths = new Map<number, string>();
  extractedFrameFileNames(outputDir, work.format).forEach((file, index) => {
    framePaths.set(index, join(outputDir, file));
  });
  return {
    videoId: work.video.id,
    srcPath,
    outputDir,
    framePattern,
    fps,
    totalFrames: framePaths.size,
    metadata: work.metadata,
    framePaths,
  };
}

function frameFileName(frameNumber: number, format: CacheFrameFormat): string {
  return `${FRAME_FILENAME_PREFIX}${String(frameNumber).padStart(5, "0")}.${format}`;
}

function linkOrCopyFrame(src: string, dest: string): void {
  try {
    linkSync(src, dest);
  } catch {
    copyFileSync(src, dest);
  }
}

function supersetGroupingKey(work: PreparedExtraction, fps: number): string {
  return [work.videoPath, String(fps), work.format, work.sdrToHdrTransfer ?? ""].join("\0");
}

function isIntegralFrameOffset(offsetSeconds: number, fps: number): boolean {
  const frames = offsetSeconds * fps;
  return Math.abs(frames - Math.round(frames)) <= 1e-4;
}

function windowsOverlapOrTouch(misses: UniqueExtractionMiss[], baseStart: number): boolean {
  const unionEnd = Math.max(
    ...misses.map(({ work }) => work.video.mediaStart + work.videoDuration),
  );
  const unionDuration = unionEnd - baseStart;
  const summedDuration = misses.reduce((sum, { work }) => sum + work.videoDuration, 0);
  return unionDuration > 0 && unionDuration <= summedDuration + 1e-9;
}

function buildSupersetGroup(
  groupId: string,
  misses: UniqueExtractionMiss[],
  fps: number,
): SupersetGroupPlan | null {
  if (misses.length < 2) return null;
  const baseStart = Math.min(...misses.map(({ work }) => work.video.mediaStart));
  if (!misses.every(({ work }) => isIntegralFrameOffset(work.video.mediaStart - baseStart, fps))) {
    return null;
  }
  if (!windowsOverlapOrTouch(misses, baseStart)) return null;

  const unionEnd = Math.max(
    ...misses.map(({ work }) => work.video.mediaStart + work.videoDuration),
  );
  return {
    groupId,
    baseStart,
    unionDuration: unionEnd - baseStart,
    members: misses.map((miss) => ({
      miss,
      offsetFrames: Math.round((miss.work.video.mediaStart - baseStart) * fps),
    })),
  };
}

/**
 * Partition one source's misses into overlap-connected components: sort by
 * window start and cut wherever the next window starts past the running end.
 * Without this, one disjoint outlier trim (e.g. [100..105] next to three
 * overlapping trims at [0..11]) fails the union<=sum check for the whole
 * bucket and every trim falls back to direct extraction.
 */
function overlapClusters(misses: UniqueExtractionMiss[]): UniqueExtractionMiss[][] {
  const sorted = [...misses].sort((a, b) => a.work.video.mediaStart - b.work.video.mediaStart);
  const clusters: UniqueExtractionMiss[][] = [];
  let current: UniqueExtractionMiss[] = [];
  let currentEnd = -Infinity;
  for (const miss of sorted) {
    const start = miss.work.video.mediaStart;
    const end = start + miss.work.videoDuration;
    if (current.length > 0 && start > currentEnd + 1e-9) {
      clusters.push(current);
      current = [];
      currentEnd = -Infinity;
    }
    current.push(miss);
    currentEnd = Math.max(currentEnd, end);
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

function planSupersetGroups(
  misses: UniqueExtractionMiss[],
  fps: number,
): { groups: SupersetGroupPlan[]; direct: UniqueExtractionMiss[] } {
  const bySource = new Map<string, UniqueExtractionMiss[]>();
  for (const miss of misses) {
    const key = supersetGroupingKey(miss.work, fps);
    bySource.set(key, [...(bySource.get(key) ?? []), miss]);
  }

  const groups: SupersetGroupPlan[] = [];
  const direct: UniqueExtractionMiss[] = [];
  let groupIndex = 0;
  for (const groupMisses of bySource.values()) {
    for (const cluster of overlapClusters(groupMisses)) {
      const group = buildSupersetGroup(`__superset-${groupIndex}`, cluster, fps);
      if (group) {
        groups.push(group);
        groupIndex += 1;
      } else {
        direct.push(...cluster);
      }
    }
  }
  return { groups, direct };
}

function sliceSupersetMember(
  member: SupersetMemberPlan,
  superset: ExtractedFrames,
  outputDir: string,
  fps: number,
): ExtractedFrames {
  const { work } = member.miss;
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  // Sample-time correctness: member frame k uses superset frame
  // offset_i + k, so its source time is
  // baseStart + (offset_i + k) / fps = mediaStart_i + k / fps.
  // The frame-alignment precondition is what makes offset_i integral.
  const requestedFrames = Math.round(work.videoDuration * fps);
  const availableFrames = Math.max(0, superset.totalFrames - member.offsetFrames);
  const frameCount = Math.min(requestedFrames, availableFrames);
  for (let i = 0; i < frameCount; i += 1) {
    const sourceFrame = superset.framePaths.get(member.offsetFrames + i);
    if (!sourceFrame) throw new Error(`superset frame ${member.offsetFrames + i} missing`);
    linkOrCopyFrame(sourceFrame, join(outputDir, frameFileName(i + 1, work.format)));
  }

  return extractedFramesFromDirectory(work, outputDir, work.videoPath, fps);
}

/**
 * Resolve a relative `<video src>` to a filesystem path the way the browser
 * resolves it as a URL. Browsers clamp `..` segments at the served origin's
 * root; `path.join(projectDir, "../assets/foo")` does not. So a sub-comp
 * `<video src="../assets/foo">` loads in the page (browser clamps to
 * `<projectDir>/assets/foo`) but the filesystem-side resolver lands at
 * `<parentOfProjectDir>/assets/foo` — file missing, extraction skipped,
 * the rendered output shows the video's first frame for the whole clip.
 *
 * The clamp covers two escape patterns: leading `..` (`../assets/foo`) AND
 * mid-path escapes (`assets/../../foo`) that `path.join` collapses past the
 * project root silently. Both fall back to a project-rooted candidate that
 * strips traversal from the resolved path.
 *
 * Returns the first existing candidate, or the base-dir join on miss so
 * the caller's `existsSync` check produces a stable error path.
 */
export function resolveProjectRelativeSrc(
  src: string,
  baseDir: string,
  compiledDir?: string,
): string {
  const qIdx = src.indexOf("?");
  const cleanSrc = qIdx >= 0 ? src.slice(0, qIdx) : src;
  const candidates: string[] = [];

  const addCandidate = (candidate: string): void => {
    if (!candidates.includes(candidate)) candidates.push(candidate);
  };

  for (const variant of decodeUrlPathVariants(cleanSrc)) {
    const fromCompiled = compiledDir ? join(compiledDir, variant) : null;
    const fromBase = join(baseDir, variant);

    // If the joined result escapes the project root (either via leading `..`
    // or mid-path traversal that path.join collapsed past baseDir), retry
    // with the basename re-anchored at the project root. This mirrors the
    // browser URL clamp without relying on a particular `..` shape.
    const baseAbs = resolve(baseDir);
    const fromBaseAbs = resolve(fromBase);
    if (!fromBaseAbs.startsWith(baseAbs + sep) && fromBaseAbs !== baseAbs) {
      // Normalize first (`assets/../../assets/foo.mp4` → `../assets/foo.mp4`)
      // then strip any remaining leading `..` segments. Stripping `..` from the
      // raw input would leave dangling siblings (`assets/../../assets/foo`
      // would become `assets/assets/foo` instead of `assets/foo`).
      const normalized = posix.normalize(variant.replace(/\\/g, "/"));
      const stripped = normalized.replace(/^(\.\.\/)+/, "");
      if (stripped && stripped !== variant && !stripped.startsWith("..")) {
        if (compiledDir) addCandidate(join(compiledDir, stripped));
        addCandidate(join(baseDir, stripped));
      }
    }

    if (fromCompiled) addCandidate(fromCompiled);
    addCandidate(fromBase);
  }
  return candidates.find(existsSync) ?? join(baseDir, cleanSrc);
}

export async function extractAllVideoFrames(
  videos: VideoElement[],
  baseDir: string,
  options: ExtractionOptions,
  signal?: AbortSignal,
  config?: Partial<
    Pick<EngineConfig, "ffmpegProcessTimeout" | "extractCacheDir" | "extractCacheMaxBytes">
  >,
  compiledDir?: string,
): Promise<ExtractionResult> {
  const startTime = Date.now();
  const extracted: ExtractedFrames[] = [];
  const errors: Array<{ videoId: string; error: string }> = [];
  let totalFramesExtracted = 0;
  const breakdown: ExtractionPhaseBreakdown = {
    resolveMs: 0,
    cachePublishFailures: 0,
    cacheGcEvictions: 0,
    cacheGcBytesFreed: 0,
    cacheAgedPartialsCleared: 0,
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
  // Dedupe missing-src warnings: a composition with N <video> elements all
  // pointing at the same broken src should only print one warning, not N.
  const warnedSrcs = new Set<string>();
  for (const video of videos) {
    if (signal?.aborted) break;
    try {
      let videoPath = video.src;
      // Use isAbsolute() rather than startsWith("/"). On Windows, absolute paths
      // like "C:\…" are not detected by the latter, so we'd re-join them under
      // baseDir and produce duplicated, nonexistent paths
      // (e.g. C:\tmp\hf-vfr-test-X\C:\tmp\hf-vfr-test-X\vfr_screen.mp4).
      if (!isAbsolute(videoPath) && !isHttpUrl(videoPath)) {
        videoPath = resolveProjectRelativeSrc(video.src, baseDir, compiledDir);
      }

      if (isHttpUrl(videoPath)) {
        const downloadDir = join(options.outputDir, "_downloads");
        mkdirSync(downloadDir, { recursive: true });
        videoPath = await downloadToTemp(videoPath, downloadDir);
      }

      if (!existsSync(videoPath)) {
        // Loud: silent miss leaves the rendered video frozen at frame 0 with
        // no error in stdout — extremely confusing for authors. Dedupe by
        // src so 50 broken videos pointing at the same path don't spam.
        if (!warnedSrcs.has(video.src)) {
          warnedSrcs.add(video.src);
          process.stderr.write(
            `[hyperframes:render] WARNING: video src="${video.src}" ` +
              `could not be resolved on disk (looked for ${videoPath}). ` +
              `The rendered output will show this video's first frame for the entire clip duration. ` +
              `If your <video> lives inside a sub-composition, prefer project-root-relative paths ` +
              `(e.g. src="assets/foo.mp4") over "../assets/foo.mp4".\n`,
          );
        }
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
  // bounds) rather than the workDir-local normalized file produced by the
  // HDR preflight. Without this, every render would write a new
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
  // Canonical per-index record of the SDR-to-HDR transform decision. BOTH the
  // cache key (transform discriminator) and the extraction options read from
  // this array via the prepared work items — never set one side independently
  // or cache lookups and written frames drift apart (the poisoning bug this
  // field exists to fix).
  const sdrToHdrTransfers: Array<HdrTransfer | undefined> = resolvedVideos.map(() => undefined);
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

    for (let i = 0; i < resolvedVideos.length; i++) {
      if (signal?.aborted) break;
      const cs = videoColorSpaces[i] ?? null;
      if (!isHdrColorSpaceUtil(cs)) {
        // SDR video in a mixed timeline — extract through a BT.709→BT.2020
        // colorspace filter so the encoder tags the final video correctly
        // (PQ vs HLG) without a separate normalized intermediate.
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

        sdrToHdrTransfers[i] = targetTransfer;
        breakdown.hdrPreflightCount += 1;
      }
    }
  }
  breakdown.hdrPreflightMs = Date.now() - hdrPreflightStart;

  // Remove HDR-preflight-skipped entries from every parallel array so Phase 2b
  // (VFR classification) and Phase 3 (extract) don't re-process them. Iterate
  // backwards to keep indices stable while splicing.
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
        sdrToHdrTransfers.splice(i, 1);
      }
    }
  }

  // Phase 2b: Keep VFR observability while routing VFR inputs through the
  // one-pass CFR extraction path in Phase 3.
  const vfrPreflightStart = Date.now();
  for (let i = 0; i < resolvedVideos.length; i++) {
    if (signal?.aborted) break;
    const entry = resolvedVideos[i];
    if (!entry) continue;
    const vfrProbeStart = Date.now();
    const metadata = await extractMediaMetadata(entry.videoPath);
    breakdown.vfrProbeMs += Date.now() - vfrProbeStart;
    if (metadata.isVFR) breakdown.vfrPreflightCount += 1;
  }
  breakdown.vfrPreflightMs = Date.now() - vfrPreflightStart;

  const phase3Start = Date.now();
  const configuredCacheRootDir = config?.extractCacheDir;
  let cacheRootDir: string | undefined;
  if (configuredCacheRootDir) {
    try {
      mkdirSync(configuredCacheRootDir, { recursive: true });
      cacheRootDir = configuredCacheRootDir;
    } catch {
      process.stderr.write(
        `[hyperframes:render] WARNING: extraction cache dir ${configuredCacheRootDir} is not writable; caching disabled for this render\n`,
      );
    }
  }

  function extractionError(videoId: string, err: unknown): { videoId: string; error: string } {
    return { videoId, error: err instanceof Error ? err.message : String(err) };
  }

  type PreparedExtractionResult =
    | { work: PreparedExtraction }
    | { error: { videoId: string; error: string } };

  type ExtractionOutcome =
    | { result: ExtractedFrames }
    | { error: { videoId: string; error: string } };

  function scopedExtractionOptions(work: PreparedExtraction): ExtractionOptions {
    return { ...options, format: work.format, sdrToHdrTransfer: work.sdrToHdrTransfer };
  }

  function rehydratePublishedCache(work: PreparedExtraction, target: CacheMissTarget) {
    const rehydrated = rehydrateCacheEntry(target.entry, {
      videoId: work.video.id,
      srcPath: target.srcPath,
      fps: options.fps,
      format: work.format,
      metadata: work.metadata,
    });
    return { ...rehydrated, ownedByLookup: true };
  }

  function lookupCacheFor(work: PreparedExtraction): ExtractionOutcome | UniqueExtractionMiss {
    if (!cacheRootDir) return { work };
    const keyInput = cacheKeyInputs[work.index];
    if (!keyInput) return { work };
    const transform = work.sdrToHdrTransfer
      ? sdrToHdrTransformKey(work.sdrToHdrTransfer)
      : undefined;

    const keyDuration = resolveSegmentDuration(
      keyInput.end - keyInput.start,
      keyInput.mediaStart,
      work.metadata,
    );
    const lookup = lookupCacheEntry(cacheRootDir, {
      videoPath: keyInput.videoPath,
      mtimeMs: keyInput.mtimeMs,
      size: keyInput.size,
      mediaStart: keyInput.mediaStart,
      duration: keyDuration,
      fps: options.fps,
      format: work.format,
      transform,
    });

    if (!lookup.hit) {
      breakdown.cacheMisses += 1;
      return { work, cacheTarget: { entry: lookup.entry, srcPath: keyInput.videoPath } };
    }

    breakdown.cacheHits += 1;
    touchCacheEntry(lookup.entry);
    return {
      result: rehydratePublishedCache(work, { entry: lookup.entry, srcPath: keyInput.videoPath }),
    };
  }

  async function extractDirectMiss(miss: UniqueExtractionMiss): Promise<ExtractedFrames> {
    const { work, cacheTarget } = miss;
    if (!cacheTarget) {
      return extractVideoFramesRange(
        work.videoPath,
        work.video.id,
        work.video.mediaStart,
        work.videoDuration,
        scopedExtractionOptions(work),
        signal,
        config,
      );
    }

    const partialDir = partialCacheEntryDir(cacheTarget.entry);
    mkdirSync(partialDir, { recursive: true });
    const result = await extractVideoFramesRange(
      work.videoPath,
      work.video.id,
      work.video.mediaStart,
      work.videoDuration,
      scopedExtractionOptions(work),
      signal,
      config,
      partialDir,
    );
    const published = publishCacheEntry(cacheTarget.entry, partialDir);
    if (!published.published) {
      breakdown.cachePublishFailures += 1;
      return { ...result, ownedByLookup: false };
    }
    return rehydratePublishedCache(work, cacheTarget);
  }

  async function executeDirectMiss(miss: UniqueExtractionMiss): Promise<ExtractionOutcome> {
    try {
      return { result: await extractDirectMiss(miss) };
    } catch (err) {
      return { error: extractionError(miss.work.video.id, err) };
    }
  }

  function materializeSupersetMember(
    member: SupersetMemberPlan,
    superset: ExtractedFrames,
  ): ExtractedFrames {
    const { miss } = member;
    const { work, cacheTarget } = miss;
    if (!cacheTarget) {
      return sliceSupersetMember(
        member,
        superset,
        join(options.outputDir, work.video.id),
        options.fps,
      );
    }

    const partialDir = partialCacheEntryDir(cacheTarget.entry);
    const sliced = sliceSupersetMember(member, superset, partialDir, options.fps);
    const published = publishCacheEntry(cacheTarget.entry, partialDir);
    if (!published.published) {
      breakdown.cachePublishFailures += 1;
      return { ...sliced, ownedByLookup: false };
    }
    return rehydratePublishedCache(work, cacheTarget);
  }

  async function executeSupersetGroup(
    group: SupersetGroupPlan,
  ): Promise<Array<[string, ExtractionOutcome]>> {
    const first = group.members[0]?.miss.work;
    if (!first) return [];
    // Hardlinks require source and destination on ONE filesystem. Cache-bound
    // members link into partial dirs under cacheRootDir, which is commonly a
    // different mount than the render's outputDir — extracting the superset
    // next to the cache keeps linkSync viable there (the EXDEV copyFileSync
    // fallback would silently multiply disk usage per member). The
    // `.partial-` name puts crashed leftovers under the GC's aged-partial
    // sweep.
    const tempDir = cacheRootDir
      ? join(cacheRootDir, `${group.groupId}.partial-${process.pid}`)
      : join(options.outputDir, group.groupId);

    try {
      rmSync(tempDir, { recursive: true, force: true });
      const superset = await extractVideoFramesRange(
        first.videoPath,
        group.groupId,
        group.baseStart,
        group.unionDuration,
        scopedExtractionOptions(first),
        signal,
        config,
        tempDir,
      );
      const outcomes: Array<[string, ExtractionOutcome]> = [];
      for (const member of group.members) {
        outcomes.push([
          member.miss.work.dedupeKey,
          { result: materializeSupersetMember(member, superset) },
        ]);
      }
      return outcomes;
    } catch (err) {
      // On abort, the union failure is the cancellation itself — re-running
      // every member through direct extraction would spawn N doomed ffmpeg
      // processes. Surface the cancellation per member instead.
      if (signal?.aborted) {
        return group.members.map((member) => [
          member.miss.work.dedupeKey,
          { error: extractionError(member.miss.work.video.id, err) },
        ]);
      }
      const fallback = await Promise.all(
        group.members.map(
          async (member) =>
            [member.miss.work.dedupeKey, await executeDirectMiss(member.miss)] as [
              string,
              ExtractionOutcome,
            ],
        ),
      );
      return fallback;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  const preparedExtractions: PreparedExtractionResult[] = await Promise.all(
    resolvedVideos.map(async ({ video, videoPath }, index) => {
      if (signal?.aborted) {
        throw new Error("Video frame extraction cancelled");
      }
      try {
        const metadata = videoMetadata[index] ?? (await extractMediaMetadata(videoPath));
        const videoDuration = resolveSegmentDuration(
          video.end - video.start,
          video.mediaStart,
          metadata,
        );
        if (video.end - video.start !== videoDuration) {
          video.end = video.start + videoDuration;
        }

        const format = resolveFrameFormat(metadata, options.format);
        const sdrToHdrTransfer = sdrToHdrTransfers[index];
        const dedupeKey = `${videoPath}\0${video.mediaStart}\0${videoDuration}\0${options.fps}\0${format}\0${sdrToHdrTransfer ?? ""}`;

        return {
          work: {
            video,
            videoPath,
            index,
            metadata,
            videoDuration,
            format,
            sdrToHdrTransfer,
            dedupeKey,
          },
        };
      } catch (err) {
        return { error: extractionError(video.id, err) };
      }
    }),
  );

  const uniqueWorks = new Map<string, PreparedExtraction>();
  for (const prepared of preparedExtractions) {
    if ("work" in prepared && !uniqueWorks.has(prepared.work.dedupeKey)) {
      uniqueWorks.set(prepared.work.dedupeKey, prepared.work);
    }
  }

  const uniqueOutcomes = new Map<string, ExtractionOutcome>();
  const cacheMisses: UniqueExtractionMiss[] = [];
  for (const work of uniqueWorks.values()) {
    const lookup = lookupCacheFor(work);
    if ("work" in lookup) {
      cacheMisses.push(lookup);
    } else {
      uniqueOutcomes.set(work.dedupeKey, lookup);
    }
  }

  const supersetPlan = planSupersetGroups(cacheMisses, options.fps);
  const directOutcomes = await Promise.all(
    supersetPlan.direct.map(
      async (miss) =>
        [miss.work.dedupeKey, await executeDirectMiss(miss)] as [string, ExtractionOutcome],
    ),
  );
  for (const [key, outcome] of directOutcomes) uniqueOutcomes.set(key, outcome);

  const supersetOutcomes = await Promise.all(
    supersetPlan.groups.map((group) => executeSupersetGroup(group)),
  );
  for (const groupOutcomes of supersetOutcomes) {
    for (const [key, outcome] of groupOutcomes) uniqueOutcomes.set(key, outcome);
  }

  const results: ExtractionOutcome[] = preparedExtractions.map((prepared) => {
    if ("error" in prepared) return prepared;
    const outcome = uniqueOutcomes.get(prepared.work.dedupeKey);
    if (!outcome)
      return { error: extractionError(prepared.work.video.id, "missing extraction result") };
    if ("error" in outcome) {
      // A shared (deduped/superset) failure fans out to every element with the
      // same key; annotate followers with the leader's videoId so N copies of
      // one root failure are traceable to a single extraction in traces.
      const isFollower = outcome.error.videoId !== prepared.work.video.id;
      const message = isFollower
        ? `[shared extraction, leader ${outcome.error.videoId}] ${outcome.error.error}`
        : outcome.error.error;
      return { error: { videoId: prepared.work.video.id, error: message } };
    }
    return { result: { ...outcome.result, videoId: prepared.work.video.id } };
  });

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

  // Sweep when this render wrote something, plus a staleness fallback so a
  // 100%-warm workload (misses never > 0) still reclaims space once a day.
  const sweepDue =
    breakdown.cacheMisses > 0 ||
    (cacheRootDir !== undefined && gcSweepDue(cacheRootDir, GC_STALENESS_MS));
  if (cacheRootDir && sweepDue) {
    const gcStats = gcExtractionCache(cacheRootDir, {
      maxBytes: config?.extractCacheMaxBytes ?? DEFAULT_CONFIG.extractCacheMaxBytes,
      minAgeMs: EXTRACT_CACHE_MIN_AGE_MS,
    });
    breakdown.cacheGcEvictions = gcStats.evictedEntries;
    breakdown.cacheGcBytesFreed = gcStats.evictedBytes;
    breakdown.cacheAgedPartialsCleared = gcStats.agedPartialsRemoved;
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
  loop = false,
  mediaStart = 0,
): string | null {
  let localTime = globalTime - videoStart;
  if (localTime < 0) return null;
  const loopDuration = Math.max(0, extracted.metadata.durationSeconds - mediaStart);
  if (loop && loopDuration > 0 && localTime >= loopDuration) {
    localTime %= loopDuration;
  }
  // Add epsilon before flooring to avoid IEEE 754 boundary errors where
  // e.g. 0.28 * 25 === 6.999999999999999 instead of 7.
  const frameIndex = Math.floor(localTime * extracted.fps + 1e-9);
  if (loop && frameIndex >= extracted.totalFrames && extracted.totalFrames > 0) {
    return extracted.framePaths.get(extracted.totalFrames - 1) || null;
  }
  if (frameIndex < 0 || frameIndex >= extracted.totalFrames) return null;
  return extracted.framePaths.get(frameIndex) || null;
}

const HOLD_LAST_FRAME_TOLERANCE_FRAMES = 2;

/**
 * Whether a clip's source is shorter than its `data-duration` slot by more than
 * the compiler tolerates before clamping the slot to the media
 * (MEDIA_DURATION_CLAMP_EPSILON_SECONDS) — the case worth warning about. Shared
 * by the render and `validate` warnings. `null` when the media covers the slot,
 * the clip loops, or inputs are unusable.
 */
export function analyzeClipMediaFit(params: {
  /** Timeline slot length in seconds — `end - start` (a.k.a. data-duration). */
  slotSeconds: number;
  /** Playable source media after the trim offset — `duration - mediaStart`. */
  mediaSeconds: number;
  /** Looping clips repeat to fill the slot, so they never fall short. */
  loop?: boolean;
}): { shortfallSeconds: number; toleranceSeconds: number } | null {
  const { slotSeconds, mediaSeconds, loop } = params;
  if (loop) return null;
  if (!(slotSeconds > 0) || !Number.isFinite(mediaSeconds) || mediaSeconds < 0) return null;
  const toleranceSeconds = MEDIA_DURATION_CLAMP_EPSILON_SECONDS;
  const shortfallSeconds = slotSeconds - mediaSeconds;
  if (shortfallSeconds <= toleranceSeconds) return null;
  return { shortfallSeconds, toleranceSeconds };
}

export class FrameLookupTable {
  private videos: Map<
    string,
    {
      extracted: ExtractedFrames;
      start: number;
      end: number;
      mediaStart: number;
      loop: boolean;
    }
  > = new Map();
  private orderedVideos: Array<{
    videoId: string;
    extracted: ExtractedFrames;
    start: number;
    end: number;
    mediaStart: number;
    loop: boolean;
  }> = [];
  private activeVideoIds: Set<string> = new Set();
  private startCursor = 0;
  private lastTime: number | null = null;

  addVideo(
    extracted: ExtractedFrames,
    start: number,
    end: number,
    mediaStart: number,
    loop = false,
  ): void {
    this.videos.set(extracted.videoId, { extracted, start, end, mediaStart, loop });
    this.orderedVideos = Array.from(this.videos.entries())
      .map(([videoId, video]) => ({ videoId, ...video }))
      .sort((a, b) => a.start - b.start);
    this.resetActiveState();
  }

  getFrame(videoId: string, globalTime: number): string | null {
    const video = this.videos.get(videoId);
    if (!video) return null;
    if (globalTime < video.start || globalTime > video.end) return null;
    return getFrameAtTime(video.extracted, globalTime, video.start, video.loop, video.mediaStart);
  }

  private resetActiveState(): void {
    this.activeVideoIds.clear();
    this.startCursor = 0;
    this.lastTime = null;
  }

  private refreshActiveSet(globalTime: number): void {
    // The active window is [start, end] INCLUSIVE of the end, mirroring the
    // runtime's element-visibility contract (core/runtime init.ts keeps an
    // element visible through `currentTime <= end`). An exclusive end-bound
    // here deactivated the video one frame early, so the frame landing exactly
    // on a clip's end rendered blank while the runtime still showed it.
    if (this.lastTime == null || globalTime < this.lastTime) {
      this.activeVideoIds.clear();
      this.startCursor = 0;
      for (const entry of this.orderedVideos) {
        if (entry.start <= globalTime && globalTime <= entry.end) {
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
      if (globalTime <= candidate.end) {
        this.activeVideoIds.add(candidate.videoId);
      }
      this.startCursor += 1;
    }

    for (const videoId of Array.from(this.activeVideoIds)) {
      const video = this.videos.get(videoId);
      if (!video || globalTime < video.start || globalTime > video.end) {
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
      let localTime = globalTime - video.start;
      const loopDuration = Math.max(0, video.extracted.metadata.durationSeconds - video.mediaStart);
      if (video.loop && loopDuration > 0 && localTime >= loopDuration) {
        localTime %= loopDuration;
      }
      const frameIndex = Math.floor(localTime * video.extracted.fps + 1e-9);
      if (video.loop && frameIndex >= video.extracted.totalFrames) {
        const framePath = video.extracted.framePaths.get(video.extracted.totalFrames - 1);
        if (framePath) {
          frames.set(videoId, { framePath, frameIndex: video.extracted.totalFrames - 1 });
        }
        continue;
      }
      if (frameIndex < 0 || frameIndex >= video.extracted.totalFrames) {
        // Source exhausted. Hold the last frame near the clip end so a media that
        // falls a hair short of its slot (e.g. `ffmpeg -t 1.45` → 1.433s at 30fps)
        // doesn't flash the background for one frame. A clip that's substantially
        // shorter than its slot still blanks for the tail. Tolerance floored at
        // the clamp epsilon so the seam is covered at any fps (see that const).
        const fps = video.extracted.fps;
        const holdTolerance = Math.max(
          fps > 0 ? HOLD_LAST_FRAME_TOLERANCE_FRAMES / fps : 0,
          MEDIA_DURATION_CLAMP_EPSILON_SECONDS,
        );
        if (globalTime >= video.end - holdTolerance && video.extracted.totalFrames > 0) {
          const lastIndex = video.extracted.totalFrames - 1;
          const lastPath = video.extracted.framePaths.get(lastIndex);
          if (lastPath) frames.set(videoId, { framePath: lastPath, frameIndex: lastIndex });
        }
        continue;
      }
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
    if (ext) table.addVideo(ext, video.start, video.end, video.mediaStart, video.loop);
  }

  return table;
}
