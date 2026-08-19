/**
 * captureHdrResources — HDR resource setup helpers for the HDR layered
 * composite stage. Extracted from `captureHdrStage.ts` so the orchestrator
 * stays under the project's 500-line ceiling.
 *
 * Responsibilities (in order, called by `captureHdrStage.ts`):
 *   1. Probe per-element HDR extraction dimensions at the elements' own
 *      start times (so GSAP-driven `data-start > 0` images don't fall out).
 *   2. Pre-extract every HDR video into a raw rgb48le frame file via a
 *      single FFmpeg pass per video.
 *   3. Pre-decode every HDR image into rgb48le buffers, resampled to the
 *      element's layout box using CSS `object-fit` / `object-position`
 *      semantics.
 *
 * All helpers are SDR-content-safe: they no-op cleanly when no HDR layers
 * exist, leaving the caller with empty maps that the hot loop tolerates.
 */

import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statfsSync,
} from "node:fs";
import { join } from "node:path";
import {
  type CaptureSession,
  decodePngToRgb48le,
  extractMediaMetadata,
  getCgroupMemoryLimitMb,
  normalizeObjectFit,
  queryElementStacking,
  resampleRgb48leObjectFit,
  resolveFinalFrameExtractionWindow,
  resolveVideoExtractionWindow,
  runFfmpeg,
  type TimelineExtractionWindow,
  type VideoMetadata,
} from "@hyperframes/engine";
import { fpsToFfmpegArg, fpsToNumber } from "@hyperframes/core";
import type { ProducerLogger } from "../../../logger.js";
import {
  closeHdrVideoFrameSource,
  type HdrImageBuffer,
  type HdrVideoFrameSource,
} from "../../hdrCompositor.js";
import type { HdrDiagnostics, RenderJob } from "../../renderOrchestrator.js";
import type { CompositionMetadata } from "../shared.js";

const NO_FOLLOW_FLAG = constants.O_NOFOLLOW ?? 0;

function tempDirSafePrefix(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
  return safe || "video";
}

export interface HdrResourcePrep {
  hdrVideoIds: string[];
  hdrVideoSrcPaths: Map<string, string>;
  hdrVideoStartTimes: Map<string, number>;
  hdrImageStartTimes: Map<string, number>;
  hdrExtractionDims: Map<string, { width: number; height: number }>;
  hdrImageFitInfo: Map<string, { fit: string; position: string }>;
}

/**
 * Build the maps the resource-extraction helpers below need. Pure data
 * transformation against `composition` + the native-HDR ID sets.
 */
export function planHdrResources(args: {
  composition: CompositionMetadata;
  nativeHdrVideoIds: Set<string>;
  nativeHdrImageIds: Set<string>;
  projectDir: string;
  compiledDir: string;
  existsSync: (p: string) => boolean;
}): HdrResourcePrep {
  const { composition, nativeHdrVideoIds, nativeHdrImageIds, projectDir, compiledDir } = args;
  const hdrVideoIds = composition.videos
    .filter((v) => nativeHdrVideoIds.has(v.id))
    .map((v) => v.id);
  const hdrVideoSrcPaths = new Map<string, string>();
  for (const v of composition.videos) {
    if (!hdrVideoIds.includes(v.id)) continue;
    let srcPath = v.src;
    if (!srcPath.startsWith("/")) {
      const fromCompiled = join(compiledDir, srcPath);
      srcPath = args.existsSync(fromCompiled) ? fromCompiled : join(projectDir, srcPath);
    }
    hdrVideoSrcPaths.set(v.id, srcPath);
  }
  const hdrVideoStartTimes = new Map<string, number>();
  for (const v of composition.videos) {
    if (hdrVideoIds.includes(v.id)) hdrVideoStartTimes.set(v.id, v.start);
  }
  const hdrImageStartTimes = new Map<string, number>();
  for (const img of composition.images) {
    if (nativeHdrImageIds.has(img.id)) hdrImageStartTimes.set(img.id, img.start);
  }
  return {
    hdrVideoIds,
    hdrVideoSrcPaths,
    hdrVideoStartTimes,
    hdrImageStartTimes,
    hdrExtractionDims: new Map(),
    hdrImageFitInfo: new Map(),
  };
}

/**
 * Probe per-element layout dimensions at each unique start time, populating
 * `hdrExtractionDims` and `hdrImageFitInfo` in place. Also runs a fallback
 * probe for HDR images whose `data-start` instant reports zero dims (GSAP
 * `from` tweens animate the element in slightly later).
 */
// fallow-ignore-next-line complexity code-duplication
export async function probeHdrExtractionDims(args: {
  domSession: CaptureSession;
  nativeHdrIds: Set<string>;
  nativeHdrImageIds: Set<string>;
  composition: CompositionMetadata;
  prep: HdrResourcePrep;
}): Promise<void> {
  const { domSession, nativeHdrIds, nativeHdrImageIds, composition, prep } = args;
  const uniqueStartTimes = [
    ...new Set([...prep.hdrVideoStartTimes.values(), ...prep.hdrImageStartTimes.values()]),
  ].sort((a, b) => a - b);
  for (const seekTime of uniqueStartTimes) {
    await domSession.page.evaluate((t: number) => {
      if (window.__hf && typeof window.__hf.seek === "function") window.__hf.seek(t);
    }, seekTime);
    if (domSession.onBeforeCapture) {
      await domSession.onBeforeCapture(domSession.page, seekTime);
    }
    const stacking = await queryElementStacking(domSession.page, nativeHdrIds);
    for (const el of stacking) {
      if (
        el.isHdr &&
        el.layoutWidth > 0 &&
        el.layoutHeight > 0 &&
        !prep.hdrExtractionDims.has(el.id)
      ) {
        prep.hdrExtractionDims.set(el.id, { width: el.layoutWidth, height: el.layoutHeight });
      }
      if (el.isHdr && nativeHdrImageIds.has(el.id) && !prep.hdrImageFitInfo.has(el.id)) {
        prep.hdrImageFitInfo.set(el.id, { fit: el.objectFit, position: el.objectPosition });
      }
    }
  }
  for (const [imageId, startTime] of prep.hdrImageStartTimes) {
    if (prep.hdrExtractionDims.has(imageId)) continue;
    const img = composition.images.find((i) => i.id === imageId);
    if (!img) continue;
    const duration = img.end - img.start;
    const retryTime = startTime + Math.min(0.5, duration * 0.1);
    await domSession.page.evaluate((t: number) => {
      if (window.__hf && typeof window.__hf.seek === "function") window.__hf.seek(t);
    }, retryTime);
    if (domSession.onBeforeCapture) {
      await domSession.onBeforeCapture(domSession.page, retryTime);
    }
    const retryStacking = await queryElementStacking(domSession.page, nativeHdrIds);
    for (const el of retryStacking) {
      if (el.id === imageId && el.isHdr && el.layoutWidth > 0 && el.layoutHeight > 0) {
        prep.hdrExtractionDims.set(el.id, { width: el.layoutWidth, height: el.layoutHeight });
        if (!prep.hdrImageFitInfo.has(el.id)) {
          prep.hdrImageFitInfo.set(el.id, { fit: el.objectFit, position: el.objectPosition });
        }
        break;
      }
    }
  }
}

/**
 * Total bytes the raw rgb48le pre-extraction below will write: 6 bytes/px ×
 * frame area × frame count, summed across HDR videos. Exposed for the
 * disk-headroom gate — a plain iPhone HLG clip auto-detected as HDR filled a
 * near-full disk with 16-bit raw frames before the user found --sdr (wild
 * report, CLI 0.7.52), so the commitment must be checked and surfaced BEFORE
 * FFmpeg starts writing.
 */
export function estimateHdrExtractionBytes(
  videos: Array<{ durationSeconds: number; width: number; height: number }>,
  fps: number,
): number {
  let total = 0;
  for (const v of videos) {
    const frames = Math.ceil(Math.max(0, v.durationSeconds) * fps);
    total += frames * v.width * v.height * 6;
  }
  return total;
}

const HDR_EXTRACTION_HEADROOM_FRACTION = 0.9;
const HDR_EXTRACTION_CGROUP_BUDGET_FRACTION = 0.5;
const HDR_EXTRACTION_WARN_BYTES = 10e9;
const HDR_EXTRACTION_MAX_BYTES_ENV = "HDR_EXTRACTION_MAX_BYTES";
const BYTES_PER_MIB = 1024 * 1024;
let aggregateHdrExtractionReservedBytes = 0;

export function resolveHdrExtractionBudgetBytes(
  raw: string | undefined,
  cgroupLimitMb: number | null = getCgroupMemoryLimitMb(),
): number | undefined {
  let configuredBudget: number | undefined;
  if (raw !== undefined && raw.trim() !== "") {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${HDR_EXTRACTION_MAX_BYTES_ENV} must be a positive finite byte count`);
    }
    configuredBudget = Math.floor(value);
  }
  const cgroupBudget =
    cgroupLimitMb !== null && Number.isFinite(cgroupLimitMb) && cgroupLimitMb > 0
      ? Math.floor(cgroupLimitMb * BYTES_PER_MIB * HDR_EXTRACTION_CGROUP_BUDGET_FRACTION)
      : undefined;
  if (configuredBudget === undefined) return cgroupBudget;
  if (cgroupBudget === undefined) return configuredBudget;
  return Math.min(configuredBudget, cgroupBudget);
}

export function resolveHdrExtractionActiveBudgetBytes(
  configuredBudgetBytes: number | undefined,
  freeBytes: number,
): number {
  const diskBudgetBytes = Math.floor(freeBytes * HDR_EXTRACTION_HEADROOM_FRACTION);
  return configuredBudgetBytes === undefined
    ? diskBudgetBytes
    : Math.min(configuredBudgetBytes, diskBudgetBytes);
}

export function reserveHdrExtractionBytes(
  estimatedBytes: number,
  budgetBytes: number | undefined,
): () => void {
  if (!Number.isFinite(estimatedBytes) || estimatedBytes < 0) {
    throw new Error(`HDR extraction reservation must be a finite non-negative byte count`);
  }
  const aggregateBytes = aggregateHdrExtractionReservedBytes + estimatedBytes;
  if (budgetBytes !== undefined && aggregateBytes > budgetBytes) {
    throw new Error(
      `Concurrent HDR pre-extractions need ~${(aggregateBytes / 1e9).toFixed(1)} GB of raw ` +
        `16-bit frame scratch, exceeding the active ${(budgetBytes / 1e9).toFixed(1)} GB budget.`,
    );
  }
  aggregateHdrExtractionReservedBytes = aggregateBytes;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    aggregateHdrExtractionReservedBytes = Math.max(
      0,
      aggregateHdrExtractionReservedBytes - estimatedBytes,
    );
  };
}

export function getHdrExtractionReservedBytes(): number {
  return aggregateHdrExtractionReservedBytes;
}

export type HdrExtractionWindow = TimelineExtractionWindow;

export function resolveHdrExtractionWindow(
  video: {
    id: string;
    start: number;
    end: number;
    mediaStart: number;
    loop: boolean;
  },
  compositionDuration: number,
  metadata: VideoMetadata,
): HdrExtractionWindow | null {
  if (!Number.isFinite(compositionDuration) || compositionDuration <= 0) {
    throw new Error(
      `Cannot extract HDR video "${video.id}" with invalid composition duration ${String(compositionDuration)}`,
    );
  }
  const window = resolveVideoExtractionWindow(video, metadata, compositionDuration);
  if (!Number.isFinite(window.durationSeconds)) {
    throw new Error(
      `HDR video "${video.id}" has no finite interval inside the ${compositionDuration}s composition`,
    );
  }
  if (window.durationSeconds <= 0) return null;
  if (!Number.isFinite(window.mediaStart) || window.mediaStart < 0) {
    throw new Error(`HDR video "${video.id}" has invalid mediaStart ${String(window.mediaStart)}`);
  }
  return window;
}

function cleanupHdrFrameDirectory(
  frameDir: string,
  rawPath: string | undefined,
  log?: ProducerLogger,
): void {
  if (process.env.KEEP_TEMP === "1") return;
  try {
    rmSync(frameDir, { recursive: true, force: true });
  } catch (err) {
    log?.warn("Failed to clean up HDR raw frame directory", {
      frameDir,
      rawPath,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Close the raw-frame descriptor and release its directory unless KEEP_TEMP=1. */
export function cleanupHdrVideoFrameSource(
  source: HdrVideoFrameSource,
  log?: ProducerLogger,
): void {
  closeHdrVideoFrameSource(source, log);
  cleanupHdrFrameDirectory(source.dir, source.rawPath, log);
}

/**
 * Disk-headroom gate for raw rgb48le pre-extraction: throws if the planned
 * writes would consume more than 90% of free space at `framesDir`, warns
 * above 10 GB either way. Fails fast with the --sdr escape hatch instead of
 * running the disk to zero mid-extraction ("No space left on device", wild
 * report: a plain iPhone HLG clip auto-detected as HDR). `statfsSync` errors
 * (unsupported platform/filesystem) skip the gate silently — only the
 * headroom violation itself is rethrown.
 */
function assertHdrExtractionDiskHeadroom(
  framesDir: string,
  plannedVideos: Array<{ durationSeconds: number; width: number; height: number }>,
  fps: number,
  log: ProducerLogger,
): { estimatedBytes: number; budgetBytes: number | undefined } {
  const estimatedBytes = estimateHdrExtractionBytes(plannedVideos, fps);
  const configuredBudget = resolveHdrExtractionBudgetBytes(
    process.env[HDR_EXTRACTION_MAX_BYTES_ENV],
  );
  const estimatedGb = (estimatedBytes / 1e9).toFixed(1);
  if (configuredBudget !== undefined && estimatedBytes > configuredBudget) {
    throw new Error(
      `HDR pre-extraction needs ~${estimatedGb} GB of raw 16-bit frames, exceeding the ` +
        `active scratch budget of ${(configuredBudget / 1e9).toFixed(1)} GB. ` +
        `If the composition doesn't need HDR output, re-run with --sdr; otherwise reduce its ` +
        `HDR duration/resolution or use a render container with a larger memory limit.`,
    );
  }
  let freeBytes: number;
  try {
    const stat = statfsSync(framesDir);
    freeBytes = stat.bavail * stat.bsize;
  } catch {
    // statfs unsupported on this platform/filesystem — skip the gate.
    return { estimatedBytes, budgetBytes: configuredBudget };
  }
  const diskBudgetBytes = Math.floor(freeBytes * HDR_EXTRACTION_HEADROOM_FRACTION);
  if (estimatedBytes > diskBudgetBytes) {
    throw new Error(
      `HDR pre-extraction needs ~${estimatedGb} GB of raw 16-bit frames but only ` +
        `${(freeBytes / 1e9).toFixed(1)} GB is free at ${framesDir}. ` +
        `If the composition doesn't need HDR output, re-run with --sdr; ` +
        `otherwise free up disk space and retry.`,
    );
  }
  if (estimatedBytes > HDR_EXTRACTION_WARN_BYTES) {
    log.warn(
      `HDR pre-extraction will write ~${estimatedGb} GB of raw 16-bit frames ` +
        `(pass --sdr to skip if HDR output isn't needed)`,
      { estimatedBytes, freeBytes },
    );
  }
  return {
    estimatedBytes,
    budgetBytes: resolveHdrExtractionActiveBudgetBytes(configuredBudget, freeBytes),
  };
}

export interface HdrVideoExtractionResult {
  sources: Map<string, HdrVideoFrameSource>;
  estimatedBytes: number;
  releaseReservation: () => void;
}

/**
 * Extract each HDR video into a raw rgb48le frame file via a single FFmpeg
 * pass per video, and open a file descriptor for each. The caller owns both
 * source teardown and the aggregate scratch reservation, which intentionally
 * remains held until the capture-stage finally block.
 */
// fallow-ignore-next-line complexity
export async function extractHdrVideoFrames(args: {
  job: RenderJob;
  log: ProducerLogger;
  framesDir: string;
  composition: CompositionMetadata;
  prep: HdrResourcePrep;
  width: number;
  height: number;
  abortSignal: AbortSignal | undefined;
  hdrDiagnostics: HdrDiagnostics;
  runFfmpegImpl?: typeof runFfmpeg;
  extractMediaMetadataImpl?: typeof extractMediaMetadata;
  resolveFinalFrameExtractionWindowImpl?: typeof resolveFinalFrameExtractionWindow;
}): Promise<HdrVideoExtractionResult> {
  const { job, log, framesDir, composition, prep, width, height, abortSignal, hdrDiagnostics } =
    args;
  const runFfmpegImpl = args.runFfmpegImpl ?? runFfmpeg;
  const extractMediaMetadataImpl = args.extractMediaMetadataImpl ?? extractMediaMetadata;
  const resolveFinalFrameExtractionWindowImpl =
    args.resolveFinalFrameExtractionWindowImpl ?? resolveFinalFrameExtractionWindow;
  const out = new Map<string, HdrVideoFrameSource>();
  mkdirSync(framesDir, { recursive: true });
  const plannedVideos: Array<{ durationSeconds: number; width: number; height: number }> = [];
  const extractionWindows = new Map<string, HdrExtractionWindow>();
  for (const [videoId, srcPath] of prep.hdrVideoSrcPaths) {
    const video = composition.videos.find((v) => v.id === videoId);
    if (!video) continue;
    const dims = prep.hdrExtractionDims.get(videoId) ?? { width, height };
    const metadata = await extractMediaMetadataImpl(srcPath);
    const initialWindow = resolveHdrExtractionWindow(video, composition.duration, metadata);
    if (!initialWindow) continue;
    const window = await resolveFinalFrameExtractionWindowImpl(
      srcPath,
      video,
      metadata,
      initialWindow,
      abortSignal,
    );
    extractionWindows.set(videoId, window);
    prep.hdrVideoStartTimes.set(videoId, window.compositionStart);
    plannedVideos.push({
      durationSeconds: window.durationSeconds,
      width: dims.width,
      height: dims.height,
    });
  }
  const { estimatedBytes, budgetBytes } = assertHdrExtractionDiskHeadroom(
    framesDir,
    plannedVideos,
    fpsToNumber(job.config.fps),
    log,
  );
  const releaseReservation = reserveHdrExtractionBytes(estimatedBytes, budgetBytes);
  const createdFrameDirs = new Set<string>();
  try {
    for (const [videoId, srcPath] of prep.hdrVideoSrcPaths) {
      const video = composition.videos.find((v) => v.id === videoId);
      const window = extractionWindows.get(videoId);
      if (!video || !window) continue;
      mkdirSync(framesDir, { recursive: true });
      const frameDir = mkdtempSync(join(framesDir, `hdr_${tempDirSafePrefix(videoId)}-`));
      createdFrameDirs.add(frameDir);
      const dims = prep.hdrExtractionDims.get(videoId) ?? { width, height };
      const rawPath = join(frameDir, "frames.rgb48le");
      const extractionStart = String(window.extractionMediaStart ?? window.mediaStart);
      const ffmpegArgs: string[] = [];
      if (window.finalFrameOnly) {
        // Decode before seeking for the one-frame path. Input-side seeking can
        // return zero frames for valid unindexed/negative-base transports.
        ffmpegArgs.push("-i", srcPath, "-ss", extractionStart, "-frames:v", "1");
      } else {
        ffmpegArgs.push(
          "-ss",
          extractionStart,
          "-i",
          srcPath,
          "-t",
          String(window.durationSeconds),
        );
      }
      if (!window.finalFrameOnly) {
        ffmpegArgs.push("-r", fpsToFfmpegArg(job.config.fps));
      }
      ffmpegArgs.push(
        "-vf",
        `scale=${dims.width}:${dims.height}:force_original_aspect_ratio=increase,crop=${dims.width}:${dims.height}`,
        "-pix_fmt",
        "rgb48le",
        "-f",
        "rawvideo",
        "-y",
        rawPath,
      );
      const result = await runFfmpegImpl(ffmpegArgs, { signal: abortSignal });
      if (!result.success) {
        hdrDiagnostics.videoExtractionFailures += 1;
        log.error("HDR frame pre-extraction failed; aborting render", {
          videoId,
          srcPath,
          stderr: result.stderr.slice(-400),
        });
        throw new Error(
          `HDR frame extraction failed for video "${videoId}". ` +
            `Aborting render to avoid shipping black HDR layers.`,
        );
      }
      const frameSize = dims.width * dims.height * 6;
      const fd = openSync(rawPath, constants.O_RDONLY | NO_FOLLOW_FLAG);
      let handedOff = false;
      try {
        const frameCount = Math.floor(fstatSync(fd).size / frameSize);
        if (frameCount < 1) {
          hdrDiagnostics.videoExtractionFailures += 1;
          throw new Error(
            `HDR frame extraction produced no frames for video "${videoId}". ` +
              `Aborting render to avoid shipping black HDR layers.`,
          );
        }
        out.set(videoId, {
          dir: frameDir,
          rawPath,
          fd,
          width: dims.width,
          height: dims.height,
          frameSize,
          frameCount,
          scratch: Buffer.allocUnsafe(frameSize),
          loop: video.loop,
        });
        handedOff = true;
      } finally {
        if (!handedOff) closeSync(fd);
      }
    }
    return { sources: out, estimatedBytes, releaseReservation };
  } catch (error) {
    for (const source of out.values()) {
      cleanupHdrVideoFrameSource(source, log);
      createdFrameDirs.delete(source.dir);
    }
    for (const frameDir of createdFrameDirs) {
      cleanupHdrFrameDirectory(frameDir, undefined, log);
    }
    releaseReservation();
    throw error;
  }
}

/**
 * Decode each HDR image into an rgb48le buffer, resampling to the element's
 * layout box if known. Failures abort the render to avoid shipping missing
 * layers (the hot loop has no fallback for a missing HDR layer that the
 * composition expects to see).
 */
export function decodeHdrImageBuffers(args: {
  log: ProducerLogger;
  hdrImageSrcPaths: Map<string, string>;
  prep: HdrResourcePrep;
  hdrDiagnostics: HdrDiagnostics;
}): Map<string, HdrImageBuffer> {
  const { log, hdrImageSrcPaths, prep, hdrDiagnostics } = args;
  const out = new Map<string, HdrImageBuffer>();
  for (const [imageId, srcPath] of hdrImageSrcPaths) {
    try {
      const decoded = decodePngToRgb48le(readFileSync(srcPath));
      const layout = prep.hdrExtractionDims.get(imageId);
      const fitInfo = prep.hdrImageFitInfo.get(imageId);
      if (layout && (layout.width !== decoded.width || layout.height !== decoded.height)) {
        const fit = normalizeObjectFit(fitInfo?.fit);
        const resampled = resampleRgb48leObjectFit(
          decoded.data,
          decoded.width,
          decoded.height,
          layout.width,
          layout.height,
          fit,
          fitInfo?.position,
        );
        out.set(imageId, { data: resampled, width: layout.width, height: layout.height });
      } else {
        out.set(imageId, {
          data: Buffer.from(decoded.data),
          width: decoded.width,
          height: decoded.height,
        });
      }
    } catch (err) {
      hdrDiagnostics.imageDecodeFailures += 1;
      log.error("HDR image decode failed; aborting render", {
        imageId,
        srcPath,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error(
        `HDR image decode failed for image "${imageId}". ` +
          `Aborting render to avoid shipping missing HDR image layers.`,
      );
    }
  }
  return out;
}
