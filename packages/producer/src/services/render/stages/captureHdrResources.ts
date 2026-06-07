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
} from "node:fs";
import { join } from "node:path";
import {
  type CaptureSession,
  decodePngToRgb48le,
  normalizeObjectFit,
  queryElementStacking,
  resampleRgb48leObjectFit,
  runFfmpeg,
} from "@hyperframes/engine";
import { fpsToFfmpegArg } from "@hyperframes/core";
import type { ProducerLogger } from "../../../logger.js";
import type {
  HdrDiagnostics,
  HdrImageBuffer,
  HdrVideoFrameSource,
  RenderJob,
} from "../../renderOrchestrator.js";
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
 * Extract each HDR video into a raw rgb48le frame file via a single FFmpeg
 * pass per video, and open a file descriptor for each. Returns a map keyed
 * by video id. Caller owns lifecycle teardown (closing fds + rm-rf).
 */
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
}): Promise<Map<string, HdrVideoFrameSource>> {
  const { job, log, framesDir, composition, prep, width, height, abortSignal, hdrDiagnostics } =
    args;
  const out = new Map<string, HdrVideoFrameSource>();
  for (const [videoId, srcPath] of prep.hdrVideoSrcPaths) {
    const video = composition.videos.find((v) => v.id === videoId);
    if (!video) continue;
    mkdirSync(framesDir, { recursive: true });
    const frameDir = mkdtempSync(join(framesDir, `hdr_${tempDirSafePrefix(videoId)}-`));
    const duration = video.end - video.start;
    const dims = prep.hdrExtractionDims.get(videoId) ?? { width, height };
    const rawPath = join(frameDir, "frames.rgb48le");
    const ffmpegArgs = [
      "-ss",
      String(video.mediaStart),
      "-i",
      srcPath,
      "-t",
      String(duration),
      "-r",
      fpsToFfmpegArg(job.config.fps),
      "-vf",
      `scale=${dims.width}:${dims.height}:force_original_aspect_ratio=increase,crop=${dims.width}:${dims.height}`,
      "-pix_fmt",
      "rgb48le",
      "-f",
      "rawvideo",
      "-y",
      rawPath,
    ];
    const result = await runFfmpeg(ffmpegArgs, { signal: abortSignal });
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
      });
      handedOff = true;
    } finally {
      if (!handedOff) closeSync(fd);
    }
  }
  return out;
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
