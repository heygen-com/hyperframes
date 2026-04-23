/**
 * Render Orchestrator Service
 *
 * Coordinates the entire video rendering pipeline:
 * 1. Parse composition metadata
 * 2. Pre-extract video frames
 * 3. Pre-process audio tracks
 * 4. Parallel frame capture
 * 5. Video encoding
 * 6. Final assembly (audio mux + faststart)
 *
 * Heavy observability: every stage logs timing, errors include
 * full context, and failures produce a diagnostic summary.
 */

import {
  existsSync,
  mkdirSync,
  rmSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  copyFileSync,
  appendFileSync,
} from "fs";
import { parseHTML } from "linkedom";
import {
  type EngineConfig,
  resolveConfig,
  extractAllVideoFrames,
  type ExtractionPhaseBreakdown,
  createFrameLookupTable,
  type VideoElement,
  FrameLookupTable,
  type HdrTransfer,
  detectTransfer,
  createCaptureSession,
  initializeSession,
  closeCaptureSession,
  captureFrame,
  captureFrameToBuffer,
  getCompositionDuration,
  prepareCaptureSessionForReuse,
  type CaptureOptions,
  type CaptureSession,
  type BeforeCaptureHook,
  createVideoFrameInjector,
  encodeFramesFromDir,
  encodeFramesChunkedConcat,
  muxVideoWithAudio,
  applyFaststart,
  getEncoderPreset,
  processCompositionAudio,
  type AudioElement,
  type ImageElement,
  calculateOptimalWorkers,
  distributeFrames,
  executeParallelCapture,
  mergeWorkerFrames,
  spawnStreamingEncoder,
  createFrameReorderBuffer,
  type StreamingEncoder,
  analyzeCompositionHdr,
  isHdrColorSpace,
  runFfmpeg,
  extractMediaMetadata,
  type VideoColorSpace,
  initTransparentBackground,
  captureAlphaPng,
  applyDomLayerMask,
  removeDomLayerMask,
  decodePng,
  decodePngToRgb48le,
  blitRgba8OverRgb48le,
  blitRgb48leRegion,
  queryElementStacking,
  groupIntoLayers,
  blitRgb48leAffine,
  parseTransformMatrix,
  TRANSITIONS,
  crossfade,
  convertTransfer,
  resampleRgb48leObjectFit,
  normalizeObjectFit,
  type TransitionFn,
  type ElementStackingInfo,
  type HfTransitionMeta,
} from "@hyperframes/engine";
import { join, dirname, resolve } from "path";
import { randomUUID } from "crypto";
import { freemem } from "os";
import { fileURLToPath } from "url";
import { createFileServer, type FileServerHandle, VIRTUAL_TIME_SHIM } from "./fileServer.js";
import {
  compileForRender,
  resolveCompositionDurations,
  recompileWithResolutions,
  discoverMediaFromBrowser,
  type CompiledComposition,
} from "./htmlCompiler.js";
import { defaultLogger, type ProducerLogger } from "../logger.js";
import { isPathInside } from "../utils/paths.js";

/**
 * Wrap a cleanup operation so it never throws, but logs any failure.
 */
async function safeCleanup(
  label: string,
  fn: () => Promise<void> | void,
  log: ProducerLogger = defaultLogger,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    log.debug(`Cleanup failed (${label})`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Cache of the maximum 1-based frame index present in each pre-extracted frame
 * directory (e.g. `frame_0001.png … frame_0150.png` → 150). The directory is
 * read once on first access and the max is computed by parsing filenames.
 *
 * Used to bounds-check `videoFrameIndex` against the directory size before
 * calling `existsSync` per frame, which avoids redundant filesystem syscalls
 * when the requested time falls past the last extracted frame (e.g. a clip
 * shorter than the composition's effective video range).
 */
const frameDirMaxIndexCache = new Map<string, number>();

const FRAME_FILENAME_RE = /^frame_(\d+)\.png$/;

function getMaxFrameIndex(frameDir: string): number {
  const cached = frameDirMaxIndexCache.get(frameDir);
  if (cached !== undefined) return cached;
  let max = 0;
  try {
    for (const name of readdirSync(frameDir)) {
      const m = FRAME_FILENAME_RE.exec(name);
      if (!m) continue;
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  } catch {
    // Directory missing or unreadable → max stays 0; downstream existsSync
    // check will still produce the right "no frame" outcome.
  }
  frameDirMaxIndexCache.set(frameDir, max);
  return max;
}

/**
 * Sum file sizes under `dir` recursively. Used to report a `tmpPeakBytes`
 * proxy in `RenderPerfSummary` right before workDir cleanup. Swallows errors
 * because it's purely observational — a missing workDir or symlink loop must
 * not fail the render.
 */
function sampleDirectoryBytes(dir: string): number {
  let total = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(current, name);
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          stack.push(full);
        } else if (st.isFile()) {
          total += st.size;
        }
      } catch {
        // ignore
      }
    }
  }
  return total;
}

// Diagnostic helpers used by the HDR layered compositor when KEEP_TEMP=1
// is set. They are pure (capture no state), so we keep them at module scope
// to avoid re-creating closures per frame and to make them callable from
// any future composite path that needs to log non-zero pixel counts.
function countNonZeroAlpha(rgba: Uint8Array): number {
  let n = 0;
  for (let p = 3; p < rgba.length; p += 4) {
    if (rgba[p] !== 0) n++;
  }
  return n;
}

function countNonZeroRgb48(buf: Uint8Array): number {
  let n = 0;
  for (let p = 0; p < buf.length; p += 6) {
    if (
      buf[p] !== 0 ||
      buf[p + 1] !== 0 ||
      buf[p + 2] !== 0 ||
      buf[p + 3] !== 0 ||
      buf[p + 4] !== 0 ||
      buf[p + 5] !== 0
    )
      n++;
  }
  return n;
}

/**
 * Metadata for a shader transition between two scenes, extracted from
 * `window.__hf.transitions`. Re-exported from the engine so the producer
 * shares the contract with composition runtime code.
 */
type HdrTransitionMeta = HfTransitionMeta;

/** Pre-computed frame range for an active transition. */
interface TransitionRange extends HdrTransitionMeta {
  startFrame: number;
  endFrame: number;
}

export type RenderStatus =
  | "queued"
  | "preprocessing"
  | "rendering"
  | "encoding"
  | "assembling"
  | "complete"
  | "failed"
  | "cancelled";

export interface RenderConfig {
  fps: 24 | 30 | 60;
  quality: "draft" | "standard" | "high";
  /** Output container format. WebM uses VP9+alpha, MOV uses ProRes 4444+alpha for transparency. */
  format?: "mp4" | "webm" | "mov";
  workers?: number;
  useGpu?: boolean;
  debug?: boolean;
  /** Entry HTML file relative to projectDir. Defaults to "index.html". */
  entryFile?: string;
  /** Full producer config. When provided, env vars are not read. */
  producerConfig?: EngineConfig;
  /** Custom logger. Defaults to console-based defaultLogger. */
  logger?: ProducerLogger;
  /** Override CRF for the video encoder. Mutually exclusive with `videoBitrate`. */
  crf?: number;
  /** Target video bitrate (e.g. "10M"). Mutually exclusive with `crf`. */
  videoBitrate?: string;
  /** Enable HDR color space probing on video/image sources. */
  hdr?: boolean;
}

export interface RenderPerfSummary {
  renderId: string;
  totalElapsedMs: number;
  fps: number;
  quality: string;
  workers: number;
  chunkedEncode: boolean;
  chunkSizeFrames: number | null;
  compositionDurationSeconds: number;
  totalFrames: number;
  resolution: { width: number; height: number };
  videoCount: number;
  audioCount: number;
  stages: Record<string, number>;
  /** Per-phase breakdown of the Phase 2 video extraction (resolve, HDR probe, HDR preflight, VFR probe/preflight, per-video extract). Undefined when the composition has no videos. */
  videoExtractBreakdown?: ExtractionPhaseBreakdown;
  /** Bytes on disk in the render's workDir at assembly time (sampled before cleanup). Lets callers correlate peak temp usage with render duration. */
  tmpPeakBytes?: number;
  captureAvgMs?: number;
  capturePeakMs?: number;
  /**
   * Peak resident set size (RSS) observed during the render, in MiB.
   *
   * Sampled every 250ms by a process-wide poller; surfaces gross memory
   * regressions (e.g. unbounded image-cache growth) that wall-clock numbers
   * miss. Optional because callers can serialize older `RenderPerfSummary`
   * shapes back into this type.
   */
  peakRssMb?: number;
  /**
   * Peak V8 heap used observed during the render, in MiB.
   *
   * Useful as a finer-grained complement to {@link peakRssMb} — RSS includes
   * native ffmpeg/Chrome allocations, while heapUsed isolates JS-object growth
   * inside the orchestrator. Optional for the same back-compat reason.
   */
  peakHeapUsedMb?: number;
  hdrDiagnostics?: HdrDiagnostics;
}

export interface HdrDiagnostics {
  videoExtractionFailures: number;
  imageDecodeFailures: number;
}

export interface RenderJob {
  id: string;
  config: RenderConfig;
  status: RenderStatus;
  progress: number;
  currentStage: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  outputPath?: string;
  duration?: number;
  totalFrames?: number;
  framesRendered?: number;
  perfSummary?: RenderPerfSummary;
  failedStage?: string;
  errorDetails?: {
    message: string;
    stack?: string;
    elapsedMs: number;
    freeMemoryMB: number;
    browserConsoleTail?: string[];
    perfStages?: Record<string, number>;
    hdrDiagnostics?: HdrDiagnostics;
  };
}

export type ProgressCallback = (job: RenderJob, message: string) => void;

export class RenderCancelledError extends Error {
  reason: "user_cancelled" | "timeout" | "aborted";
  constructor(
    message: string = "render_cancelled",
    reason: "user_cancelled" | "timeout" | "aborted" = "aborted",
  ) {
    super(message);
    this.name = "RenderCancelledError";
    this.reason = reason;
  }
}

export interface CompositionMetadata {
  duration: number;
  videos: VideoElement[];
  audios: AudioElement[];
  images: ImageElement[];
  width: number;
  height: number;
}

function updateJobStatus(
  job: RenderJob,
  status: RenderStatus,
  stage: string,
  progress: number,
  onProgress?: ProgressCallback,
): void {
  job.status = status;
  job.currentStage = stage;
  job.progress = progress;
  if (status === "failed" || status === "complete") job.completedAt = new Date();
  if (onProgress) onProgress(job, stage);
}

function installDebugLogger(logPath: string, log: ProducerLogger = defaultLogger): () => void {
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;

  const write = (prefix: string, args: unknown[]) => {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${prefix} ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`;
    try {
      appendFileSync(logPath, line);
    } catch (err) {
      log.debug("Debug log write failed", {
        logPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  console.log = (...args: unknown[]) => {
    write("LOG", args);
    origLog(...args);
  };
  console.error = (...args: unknown[]) => {
    write("ERR", args);
    origError(...args);
  };
  console.warn = (...args: unknown[]) => {
    write("WRN", args);
    origWarn(...args);
  };

  return () => {
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
  };
}

/**
 * Write compiled HTML and sub-compositions to the work directory.
 */
// Exported for integration tests. Not part of the stable public API —
// callers outside this package should use `executeRenderJob` instead.
export function writeCompiledArtifacts(
  compiled: CompiledComposition,
  workDir: string,
  includeSummary: boolean,
): void {
  const compileDir = join(workDir, "compiled");
  mkdirSync(compileDir, { recursive: true });

  writeFileSync(join(compileDir, "index.html"), compiled.html, "utf-8");

  for (const [srcPath, html] of compiled.subCompositions) {
    const outPath = join(compileDir, srcPath);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html, "utf-8");
  }

  // Copy external assets (files outside projectDir) into the compiled directory
  // so the file server can serve them. The safe-path check uses
  // `isPathInside()` rather than a hardcoded separator — on Windows,
  // `compileDir + "/"` never matches because paths use `\\`, which caused
  // every external asset to be wrongly rejected as "unsafe" (see GH #321).
  for (const [relativePath, absolutePath] of compiled.externalAssets) {
    const outPath = resolve(join(compileDir, relativePath));
    if (!isPathInside(outPath, compileDir)) {
      console.warn(`[Render] Skipping external asset with unsafe path: ${relativePath}`);
      continue;
    }
    mkdirSync(dirname(outPath), { recursive: true });
    copyFileSync(absolutePath, outPath);
  }

  if (includeSummary) {
    const summary = {
      width: compiled.width,
      height: compiled.height,
      staticDuration: compiled.staticDuration,
      videos: compiled.videos.map((v) => ({
        id: v.id,
        src: v.src,
        start: v.start,
        end: v.end,
        mediaStart: v.mediaStart,
      })),
      audios: compiled.audios.map((a) => ({
        id: a.id,
        src: a.src,
        start: a.start,
        end: a.end,
        mediaStart: a.mediaStart,
      })),
      subCompositions: Array.from(compiled.subCompositions.keys()),
      renderModeHints: compiled.renderModeHints,
    };
    writeFileSync(join(compileDir, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");
  }
}

export function applyRenderModeHints(
  cfg: EngineConfig,
  compiled: CompiledComposition,
  log: ProducerLogger = defaultLogger,
): void {
  if (cfg.forceScreenshot || !compiled.renderModeHints.recommendScreenshot) return;

  cfg.forceScreenshot = true;
  log.warn("Auto-selected screenshot capture mode for render compatibility", {
    reasonCodes: compiled.renderModeHints.reasons.map((reason) => reason.code),
    reasons: compiled.renderModeHints.reasons.map((reason) => reason.message),
  });
}

/**
 * Blit a single HDR video layer onto an rgb48le canvas.
 *
 * Shared between the normal-frame compositing path (compositeToBuffer)
 * and the transition dual-scene compositing loop to avoid duplicating
 * the frame lookup, fallback, decode, transform, and blit logic.
 */
function blitHdrVideoLayer(
  canvas: Buffer,
  el: ElementStackingInfo,
  time: number,
  fps: number,
  hdrFrameDirs: Map<string, string>,
  hdrStartTimes: Map<string, number>,
  width: number,
  height: number,
  log?: ProducerLogger,
  sourceTransfer?: HdrTransfer,
  targetTransfer?: HdrTransfer,
): void {
  const frameDir = hdrFrameDirs.get(el.id);
  const startTime = hdrStartTimes.get(el.id);
  if (!frameDir || startTime === undefined) {
    return;
  }

  // Frame index within the video (1-based for FFmpeg image2 output).
  // Clamp against the highest extracted frame in the directory so that when
  // the composition outlives the source clip we freeze on the last frame
  // (matching Chrome's <video> behavior) without issuing an O(N) iterative
  // existsSync sweep per requested time.
  const videoFrameIndex = Math.round((time - startTime) * fps) + 1;
  if (videoFrameIndex < 1) return;
  const maxIndex = getMaxFrameIndex(frameDir);
  const effectiveIndex = maxIndex > 0 ? Math.min(videoFrameIndex, maxIndex) : videoFrameIndex;
  const framePath = join(frameDir, `frame_${String(effectiveIndex).padStart(4, "0")}.png`);

  if (!existsSync(framePath)) {
    return;
  }

  try {
    const { data: hdrRgb, width: srcW, height: srcH } = decodePngToRgb48le(readFileSync(framePath));

    // Convert between HDR transfer functions if source doesn't match output
    if (sourceTransfer && targetTransfer && sourceTransfer !== targetTransfer) {
      convertTransfer(hdrRgb, sourceTransfer, targetTransfer);
    }

    const viewportMatrix = parseTransformMatrix(el.transform);

    // Pass border-radius for rounded-corner masking (only when non-zero)
    const br = el.borderRadius;
    const hasBorderRadius = br[0] > 0 || br[1] > 0 || br[2] > 0 || br[3] > 0;
    const borderRadiusParam = hasBorderRadius ? br : undefined;

    if (viewportMatrix) {
      // Use the full viewport transform (handles scale, rotation, translate)
      blitRgb48leAffine(
        canvas,
        hdrRgb,
        viewportMatrix,
        srcW,
        srcH,
        width,
        height,
        el.opacity < 0.999 ? el.opacity : undefined,
        borderRadiusParam,
      );
    } else {
      // No transform — identity position, use fast region blit
      blitRgb48leRegion(
        canvas,
        hdrRgb,
        el.x,
        el.y,
        srcW,
        srcH,
        width,
        height,
        el.opacity < 0.999 ? el.opacity : undefined,
        borderRadiusParam,
      );
    }
  } catch (err) {
    if (log) {
      log.debug(`HDR blit failed for ${el.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Pre-decoded HDR image buffer with its native pixel dimensions.
 *
 * Static images decode exactly once at setup time and are blitted on every
 * visible frame, unlike video frames which are read fresh per timestamp.
 */
interface HdrImageBuffer {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Blit a single HDR image layer onto an rgb48le canvas.
 *
 * Image-equivalent of `blitHdrVideoLayer` — the buffer is pre-decoded and
 * static, so there's no time-based frame lookup or per-frame PNG read.
 */
function blitHdrImageLayer(
  canvas: Buffer,
  el: ElementStackingInfo,
  hdrImageBuffers: Map<string, HdrImageBuffer>,
  width: number,
  height: number,
  log?: ProducerLogger,
  sourceTransfer?: HdrTransfer,
  targetTransfer?: HdrTransfer,
): void {
  const buf = hdrImageBuffers.get(el.id);
  if (!buf) {
    return;
  }

  try {
    let hdrRgb = buf.data;
    if (sourceTransfer && targetTransfer && sourceTransfer !== targetTransfer) {
      // convertTransfer mutates in place; copy first so the cached decode stays
      // pristine for subsequent frames.
      hdrRgb = Buffer.from(buf.data);
      convertTransfer(hdrRgb, sourceTransfer, targetTransfer);
    }

    const viewportMatrix = parseTransformMatrix(el.transform);

    const br = el.borderRadius;
    const hasBorderRadius = br[0] > 0 || br[1] > 0 || br[2] > 0 || br[3] > 0;
    const borderRadiusParam = hasBorderRadius ? br : undefined;

    if (viewportMatrix) {
      blitRgb48leAffine(
        canvas,
        hdrRgb,
        viewportMatrix,
        buf.width,
        buf.height,
        width,
        height,
        el.opacity < 0.999 ? el.opacity : undefined,
        borderRadiusParam,
      );
    } else {
      blitRgb48leRegion(
        canvas,
        hdrRgb,
        el.x,
        el.y,
        buf.width,
        buf.height,
        width,
        height,
        el.opacity < 0.999 ? el.opacity : undefined,
        borderRadiusParam,
      );
    }
  } catch (err) {
    if (log) {
      log.debug(`HDR image blit failed for ${el.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Dependencies passed to `compositeHdrFrame`.
 *
 * Every field except the per-frame arguments is captured once when the HDR
 * render path opens its `try { ... }` block and reused across every frame —
 * extracting them into an explicit struct lets the helper live at module
 * scope (no closure-over-renderJob) and keeps the per-call signature small.
 */
interface HdrCompositeContext {
  log: ProducerLogger;
  domSession: CaptureSession;
  beforeCaptureHook: BeforeCaptureHook | null;
  width: number;
  height: number;
  fps: number;
  effectiveHdr: { transfer: HdrTransfer };
  nativeHdrImageIds: Set<string>;
  hdrImageBuffers: Map<string, HdrImageBuffer>;
  hdrFrameDirs: Map<string, string>;
  hdrVideoStartTimes: Map<string, number>;
  imageTransfers: Map<string, HdrTransfer>;
  videoTransfers: Map<string, HdrTransfer>;
  debugDumpEnabled: boolean;
  debugDumpDir: string | null;
}

/**
 * Composite a single HDR frame into a pre-allocated `rgb48le` canvas.
 *
 * Bottom-to-top z-order: HDR layers are blitted directly from cached image
 * buffers / extracted video frames; DOM layers are screenshotted with a
 * mass-hide mask (so each layer paints only its own elements) and then
 * blended into the canvas via `blitRgba8OverRgb48le` in the active HDR
 * transfer space.
 *
 * The `elementFilter` parameter exists so the transition path can composite
 * each scene independently; pass `undefined` for whole-stack rendering.
 *
 * @param ctx - Long-lived dependencies (logger, browser session, dimensions,
 *              HDR layer maps). Captured once per render — see
 *              {@link HdrCompositeContext}.
 * @param canvas - Pre-allocated `width * height * 6` byte buffer. Caller must
 *                 zero-fill before every frame (this helper does not).
 * @param time - Seek time in seconds.
 * @param fullStacking - Stacking info for ALL elements at this time. Even when
 *                       filtering, every other element id is needed to build
 *                       the DOM-layer hide-list.
 * @param elementFilter - When set, only elements whose id is in the set are
 *                        composited.
 * @param debugFrameIndex - Frame index used to label per-layer diagnostic
 *                          dumps. Pass `-1` to disable per-layer dumps even
 *                          when `KEEP_TEMP=1` (e.g. for warmup frames).
 */
async function compositeHdrFrame(
  ctx: HdrCompositeContext,
  canvas: Buffer,
  time: number,
  fullStacking: ElementStackingInfo[],
  elementFilter?: Set<string>,
  debugFrameIndex: number = -1,
): Promise<void> {
  const {
    log,
    domSession,
    beforeCaptureHook,
    width,
    height,
    fps,
    effectiveHdr,
    nativeHdrImageIds,
    hdrImageBuffers,
    hdrFrameDirs,
    hdrVideoStartTimes,
    imageTransfers,
    videoTransfers,
    debugDumpEnabled,
    debugDumpDir,
  } = ctx;

  const filteredStacking = elementFilter
    ? fullStacking.filter((e) => elementFilter.has(e.id))
    : fullStacking;

  const layers = groupIntoLayers(filteredStacking);

  const shouldLog = debugDumpEnabled && debugFrameIndex >= 0;
  if (shouldLog) {
    log.info("[diag] compositeToBuffer plan", {
      frame: debugFrameIndex,
      time: time.toFixed(3),
      filterSize: elementFilter?.size,
      fullStackingCount: fullStacking.length,
      filteredCount: filteredStacking.length,
      layerCount: layers.length,
      layers: layers.map((l) =>
        l.type === "hdr"
          ? {
              type: "hdr",
              id: l.element.id,
              z: l.element.zIndex,
              visible: l.element.visible,
              opacity: l.element.opacity,
              bounds: `${Math.round(l.element.x)},${Math.round(l.element.y)} ${Math.round(l.element.width)}x${Math.round(l.element.height)}`,
            }
          : { type: "dom", ids: l.elementIds },
      ),
    });
  }

  for (const [layerIdx, layer] of layers.entries()) {
    if (layer.type === "hdr") {
      const before = shouldLog ? countNonZeroRgb48(canvas) : 0;
      const isHdrImage = nativeHdrImageIds.has(layer.element.id);
      if (isHdrImage) {
        blitHdrImageLayer(
          canvas,
          layer.element,
          hdrImageBuffers,
          width,
          height,
          log,
          imageTransfers.get(layer.element.id),
          effectiveHdr.transfer,
        );
      } else {
        blitHdrVideoLayer(
          canvas,
          layer.element,
          time,
          fps,
          hdrFrameDirs,
          hdrVideoStartTimes,
          width,
          height,
          log,
          videoTransfers.get(layer.element.id),
          effectiveHdr.transfer,
        );
      }
      if (shouldLog) {
        const after = countNonZeroRgb48(canvas);
        if (isHdrImage) {
          const buf = hdrImageBuffers.get(layer.element.id);
          log.info("[diag] hdr layer blit", {
            frame: debugFrameIndex,
            layerIdx,
            id: layer.element.id,
            kind: "image",
            pixelsAdded: after - before,
            totalNonZero: after,
            bufferDecoded: !!buf,
            bufferDims: buf ? `${buf.width}x${buf.height}` : null,
          });
        } else {
          const frameDir = hdrFrameDirs.get(layer.element.id);
          const startTime = hdrVideoStartTimes.get(layer.element.id) ?? 0;
          const localTime = time - startTime;
          const frameNum = Math.floor(localTime * fps) + 1;
          const expectedFrame = frameDir
            ? join(frameDir, `frame_${String(frameNum).padStart(4, "0")}.png`)
            : null;
          log.info("[diag] hdr layer blit", {
            frame: debugFrameIndex,
            layerIdx,
            id: layer.element.id,
            kind: "video",
            pixelsAdded: after - before,
            totalNonZero: after,
            startTime,
            localTime: localTime.toFixed(3),
            hdrFrameNum: frameNum,
            expectedFrame,
            expectedFrameExists: expectedFrame ? existsSync(expectedFrame) : false,
          });
        }
      }
    } else {
      // DOM layer: capture only elements in this layer.
      //
      // Each layer gets a fresh seek + inject cycle to guarantee correct
      // visibility state — avoids fragile interactions between the frame
      // injector, applyDomLayerMask, removeDomLayerMask, and GSAP re-seek.
      //
      // The mask:
      //   - mass-hides every body descendant via stylesheet
      //   - re-shows the layer's elements (and their descendants and
      //     their injected `__render_frame_*` siblings) so deep-nested
      //     content stays visible even though intermediate ancestors
      //     are hidden
      //   - inline-hides every other data-start element so they don't
      //     paint when they happen to be descendants of a layer element
      //     (most importantly: HDR videos and other-layer SDR videos
      //     that live inside `#root` when capturing the root DOM layer)
      //
      // Without the mask, every DOM screenshot captures the full page
      // (root background, sibling scenes' static content, the painted
      // border/box-shadow of cards, etc.) and the resulting opaque
      // pixels overwrite previously composited HDR content beneath.
      const allElementIds = fullStacking.map((e) => e.id);
      const layerIds = new Set(layer.elementIds);
      const hideIds = allElementIds.filter((id) => !layerIds.has(id));

      // 1. Seek GSAP to restore all animated properties from clean state
      await domSession.page.evaluate((t: number) => {
        if (window.__hf && typeof window.__hf.seek === "function") window.__hf.seek(t);
      }, time);

      // 2. Run frame injector to set correct SDR video visibility
      if (beforeCaptureHook) {
        await beforeCaptureHook(domSession.page, time);
      }

      // 3. Install the mask (mass-hide stylesheet + inline-hide non-layer ids)
      await applyDomLayerMask(domSession.page, layer.elementIds, hideIds);

      // 4. Screenshot
      const domPng = await captureAlphaPng(domSession.page, width, height);

      // 5. Tear down the mask
      await removeDomLayerMask(domSession.page, hideIds);

      try {
        const { data: domRgba } = decodePng(domPng);
        const before = shouldLog ? countNonZeroRgb48(canvas) : 0;
        const alphaPixels = shouldLog ? countNonZeroAlpha(domRgba) : 0;
        blitRgba8OverRgb48le(domRgba, canvas, width, height, effectiveHdr.transfer);
        if (shouldLog && debugDumpDir) {
          const after = countNonZeroRgb48(canvas);
          const dumpName = `frame_${String(debugFrameIndex).padStart(4, "0")}_layer_${String(layerIdx).padStart(2, "0")}_dom.png`;
          const dumpPath = join(debugDumpDir, dumpName);
          writeFileSync(dumpPath, domPng);
          log.info("[diag] dom layer blit", {
            frame: debugFrameIndex,
            layerIdx,
            layerIds: layer.elementIds,
            hideCount: hideIds.length,
            pngBytes: domPng.length,
            alphaPixels,
            pixelsAdded: after - before,
            totalNonZero: after,
            dumpPath,
          });
        }
      } catch (err) {
        log.warn("DOM layer decode/blit failed; skipping overlay", {
          layerIds: layer.elementIds,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  if (shouldLog && debugDumpDir) {
    const finalNonZero = countNonZeroRgb48(canvas);
    log.info("[diag] compositeToBuffer end", {
      frame: debugFrameIndex,
      finalNonZeroPixels: finalNonZero,
      totalPixels: width * height,
      coverage: ((finalNonZero / (width * height)) * 100).toFixed(1) + "%",
    });
  }
}

export function createRenderJob(config: RenderConfig): RenderJob {
  return {
    id: randomUUID(),
    config,
    status: "queued",
    progress: 0,
    currentStage: "Queued",
    createdAt: new Date(),
  };
}

function normalizeCompositionSrcPath(srcPath: string): string {
  return srcPath.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Main render pipeline
 */

export function extractStandaloneEntryFromIndex(
  indexHtml: string,
  entryFile: string,
): string | null {
  const normalizedEntryFile = normalizeCompositionSrcPath(entryFile);
  const { document } = parseHTML(indexHtml);
  const body = document.querySelector("body");
  if (!body) return null;

  const hosts = Array.from(document.querySelectorAll("[data-composition-src]")) as Element[];
  const host = hosts.find(
    (candidate) =>
      normalizeCompositionSrcPath(candidate.getAttribute("data-composition-src") || "") ===
      normalizedEntryFile,
  );
  if (!host) return null;

  const root =
    (Array.from(body.children) as Element[]).find((candidate) =>
      candidate.hasAttribute("data-composition-id"),
    ) ?? null;
  if (!root) return null;

  const hostClone = host.cloneNode(true) as Element;
  hostClone.setAttribute("data-start", "0");

  body.innerHTML = "";

  if (root === host) {
    body.appendChild(hostClone);
    return document.toString();
  }

  const rootClone = root.cloneNode(false) as Element;
  rootClone.appendChild(hostClone);
  body.appendChild(rootClone);

  return document.toString();
}

export async function executeRenderJob(
  job: RenderJob,
  projectDir: string,
  outputPath: string,
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
): Promise<void> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const producerRoot = process.env.PRODUCER_RENDERS_DIR
    ? resolve(process.env.PRODUCER_RENDERS_DIR, "..")
    : resolve(moduleDir, "../..");
  const debugDir = join(producerRoot, ".debug");
  const workDir = job.config.debug
    ? join(debugDir, job.id)
    : join(dirname(outputPath), `work-${job.id}`);
  const pipelineStart = Date.now();
  const log = job.config.logger ?? defaultLogger;
  let fileServer: FileServerHandle | null = null;
  let probeSession: CaptureSession | null = null;
  let lastBrowserConsole: string[] = [];
  let restoreLogger: (() => void) | null = null;
  const perfStages: Record<string, number> = {};
  const hdrDiagnostics: HdrDiagnostics = {
    videoExtractionFailures: 0,
    imageDecodeFailures: 0,
  };
  const perfOutputPath = join(workDir, "perf-summary.json");
  const cfg = { ...(job.config.producerConfig ?? resolveConfig()) };
  const outputFormat = (job.config.format ?? "mp4") as "mp4" | "webm" | "mov";
  const isWebm = outputFormat === "webm";
  const isMov = outputFormat === "mov";
  const needsAlpha = isWebm || isMov;
  // Transparency requires screenshot mode — beginFrame doesn't support alpha channel
  if (needsAlpha) {
    cfg.forceScreenshot = true;
  }
  const enableChunkedEncode = cfg.enableChunkedEncode;
  const chunkedEncodeSize = cfg.chunkSizeFrames;
  const enableStreamingEncode = cfg.enableStreamingEncode;

  // Periodic memory sampler — surfaces peak RSS/heap so the benchmark harness
  // can detect memory regressions (e.g. unbounded image-cache growth) that
  // wall-clock numbers miss. Sampled every 250ms; the interval is `unref`'d so
  // it never keeps the event loop alive on its own, and always cleared in the
  // finally block below regardless of how the render exits.
  let peakRssBytes = 0;
  let peakHeapUsedBytes = 0;
  const sampleMemory = (): void => {
    try {
      const m = process.memoryUsage();
      if (m.rss > peakRssBytes) peakRssBytes = m.rss;
      if (m.heapUsed > peakHeapUsedBytes) peakHeapUsedBytes = m.heapUsed;
    } catch {
      // Defensive: process.memoryUsage() shouldn't throw, but if it ever
      // does we don't want to take down the render for a benchmark accessory.
    }
  };
  sampleMemory();
  const memSamplerInterval: NodeJS.Timeout = setInterval(sampleMemory, 250);
  memSamplerInterval.unref?.();

  try {
    const assertNotAborted = () => {
      if (abortSignal?.aborted) {
        throw new RenderCancelledError("render_cancelled");
      }
    };

    job.startedAt = new Date();
    assertNotAborted();
    if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });

    if (job.config.debug) {
      const logPath = join(workDir, "render.log");
      restoreLogger = installDebugLogger(logPath, log);
    }

    const entryFile = job.config.entryFile || "index.html";
    let htmlPath = join(projectDir, entryFile);
    if (!existsSync(htmlPath)) {
      throw new Error(`Entry file not found: ${htmlPath}`);
    }
    assertNotAborted();

    // If entryFile is a sub-composition (<template> wrapper), reuse the real
    // index.html shell and isolate the matching host instead of fabricating
    // a new standalone document.
    const rawEntry = readFileSync(htmlPath, "utf-8");
    if (entryFile !== "index.html" && rawEntry.trimStart().startsWith("<template")) {
      const wrapperPath = join(workDir, "standalone-entry.html");
      const projectIndexPath = join(projectDir, "index.html");
      if (!existsSync(projectIndexPath)) {
        throw new Error(
          `Template entry file "${entryFile}" requires a project index.html to extract its render shell.`,
        );
      }
      const standaloneHtml = extractStandaloneEntryFromIndex(
        readFileSync(projectIndexPath, "utf-8"),
        entryFile,
      );
      if (!standaloneHtml) {
        throw new Error(
          `Entry file "${entryFile}" is not mounted from index.html via data-composition-src, so it cannot be rendered independently.`,
        );
      }
      writeFileSync(wrapperPath, standaloneHtml, "utf-8");
      htmlPath = wrapperPath;
      log.info("Extracted standalone entry from index.html host context", {
        entryFile,
      });
    }

    // ── Stage 1: Compile ─────────────────────────────────────────────────
    const stage1Start = Date.now();
    updateJobStatus(job, "preprocessing", "Compiling composition", 5, onProgress);

    const compileStart = Date.now();
    let compiled = await compileForRender(projectDir, htmlPath, join(workDir, "downloads"));
    assertNotAborted();
    perfStages.compileOnlyMs = Date.now() - compileStart;
    applyRenderModeHints(cfg, compiled, log);
    writeCompiledArtifacts(compiled, workDir, Boolean(job.config.debug));

    log.info("Compiled composition metadata", {
      entryFile,
      staticDuration: compiled.staticDuration,
      width: compiled.width,
      height: compiled.height,
      videoCount: compiled.videos.length,
      audioCount: compiled.audios.length,
      renderModeHints: compiled.renderModeHints,
    });

    const composition: CompositionMetadata = {
      duration: compiled.staticDuration,
      videos: compiled.videos,
      audios: compiled.audios,
      images: compiled.images,
      width: compiled.width,
      height: compiled.height,
    };
    const { width, height } = composition;

    const probeStart = Date.now();
    const needsBrowser = composition.duration <= 0 || compiled.unresolvedCompositions.length > 0;

    if (needsBrowser) {
      const reasons = [];
      if (composition.duration <= 0) reasons.push("root duration unknown");
      if (compiled.unresolvedCompositions.length > 0)
        reasons.push(`${compiled.unresolvedCompositions.length} unresolved composition(s)`);

      fileServer = await createFileServer({
        projectDir,
        compiledDir: join(workDir, "compiled"),
        port: 0,
        preHeadScripts: [VIRTUAL_TIME_SHIM],
      });
      assertNotAborted();

      const captureOpts: CaptureOptions = {
        width,
        height,
        fps: job.config.fps,
        format: needsAlpha ? "png" : "jpeg",
        quality: needsAlpha ? undefined : 80,
      };
      probeSession = await createCaptureSession(
        fileServer.url,
        join(workDir, "probe"),
        captureOpts,
        null,
        cfg,
      );
      await initializeSession(probeSession);
      assertNotAborted();
      lastBrowserConsole = probeSession.browserConsoleBuffer;

      // Discover root composition duration
      if (composition.duration <= 0) {
        const discoveredDuration = await getCompositionDuration(probeSession);
        assertNotAborted();
        log.info("Probed composition duration from browser", {
          discoveredDuration,
          staticDuration: compiled.staticDuration,
        });
        composition.duration = discoveredDuration;
      } else {
        log.info("Using static duration from data-duration attribute", {
          duration: composition.duration,
        });
      }

      // Resolve unresolved composition durations via window.__timelines
      if (compiled.unresolvedCompositions.length > 0) {
        const resolutions = await resolveCompositionDurations(
          probeSession.page,
          compiled.unresolvedCompositions,
        );
        assertNotAborted();
        if (resolutions.length > 0) {
          compiled = await recompileWithResolutions(
            compiled,
            resolutions,
            projectDir,
            join(workDir, "downloads"),
          );
          assertNotAborted();
          // Update composition metadata with re-parsed media
          composition.videos = compiled.videos;
          composition.audios = compiled.audios;
          composition.images = compiled.images;
          writeCompiledArtifacts(compiled, workDir, Boolean(job.config.debug));
        }
      }

      // Discover media elements from browser DOM (catches dynamically-set src)
      const browserMedia = await discoverMediaFromBrowser(probeSession.page);
      assertNotAborted();
      if (browserMedia.length > 0) {
        const existingVideoIds = new Set(composition.videos.map((v) => v.id));
        const existingAudioIds = new Set(composition.audios.map((a) => a.id));

        for (const el of browserMedia) {
          if (!el.src || el.src === "about:blank") continue;

          // Convert absolute localhost URLs back to relative paths
          let src = el.src;
          if (fileServer && src.startsWith(fileServer.url)) {
            src = src.slice(fileServer.url.length).replace(/^\//, "");
          }

          if (el.tagName === "video") {
            if (existingVideoIds.has(el.id)) {
              // Reconcile to browser/runtime media metadata (runtime src can differ from static HTML).
              const existing = composition.videos.find((v) => v.id === el.id);
              if (existing) {
                if (existing.src !== src) {
                  existing.src = src;
                }
                if (el.end > 0 && (existing.end <= 0 || Math.abs(existing.end - el.end) > 0.0001)) {
                  existing.end = el.end;
                }
                if (
                  el.mediaStart > 0 &&
                  (existing.mediaStart <= 0 ||
                    Math.abs(existing.mediaStart - el.mediaStart) > 0.0001)
                ) {
                  existing.mediaStart = el.mediaStart;
                }
                if (el.hasAudio && !existing.hasAudio) {
                  existing.hasAudio = true;
                }
              }
            } else {
              // New video discovered from browser
              composition.videos.push({
                id: el.id,
                src,
                start: el.start,
                end: el.end,
                mediaStart: el.mediaStart,
                hasAudio: el.hasAudio,
              });
              existingVideoIds.add(el.id);
            }
          } else if (el.tagName === "audio") {
            if (existingAudioIds.has(el.id)) {
              const existing = composition.audios.find((a) => a.id === el.id);
              if (existing) {
                if (existing.src !== src) {
                  existing.src = src;
                }
                if (el.end > 0 && (existing.end <= 0 || Math.abs(existing.end - el.end) > 0.0001)) {
                  existing.end = el.end;
                }
                if (
                  el.mediaStart > 0 &&
                  (existing.mediaStart <= 0 ||
                    Math.abs(existing.mediaStart - el.mediaStart) > 0.0001)
                ) {
                  existing.mediaStart = el.mediaStart;
                }
                if (el.volume > 0 && Math.abs((existing.volume ?? 1) - el.volume) > 0.0001) {
                  existing.volume = el.volume;
                }
              }
            } else {
              composition.audios.push({
                id: el.id,
                src,
                start: el.start,
                end: el.end,
                mediaStart: el.mediaStart,
                layer: 0,
                volume: el.volume,
                type: "audio",
              });
              existingAudioIds.add(el.id);
            }
          }
        }
      }
    }
    perfStages.browserProbeMs = Date.now() - probeStart;

    job.duration = composition.duration;
    job.totalFrames = Math.ceil(composition.duration * job.config.fps);
    const totalFrames = job.totalFrames;

    if (job.duration <= 0) {
      // Gather diagnostics to help users understand why the render would produce a black video.
      // Wrapped in try/catch because the browser tab may have crashed (which could be
      // WHY duration is 0), and we don't want a Puppeteer error to mask the real message.
      const diagnostics: string[] = [];
      try {
        if (probeSession) {
          const timelinesInfo = await probeSession.page.evaluate(() => {
            const tl = (window as any).__timelines;
            const hf = (window as any).__hf;
            return {
              timelineKeys: tl ? Object.keys(tl) : [],
              hfDuration: hf?.duration ?? null,
              gsapLoaded: typeof (window as any).gsap !== "undefined",
            };
          });
          if (!timelinesInfo.gsapLoaded) {
            diagnostics.push(
              "GSAP is not loaded — CDN script may have failed to download. " +
                "Bundle GSAP locally in your project instead of using a CDN <script src>.",
            );
          } else if (timelinesInfo.timelineKeys.length === 0) {
            diagnostics.push(
              "GSAP is loaded but no timelines were registered on window.__timelines. " +
                "Ensure your script creates a timeline and assigns it: " +
                'window.__timelines["main"] = gsap.timeline({ paused: true });',
            );
          }
          for (const line of probeSession.browserConsoleBuffer) {
            if (/\[Browser:ERROR\]|\[Browser:PAGEERROR\]|404|net::ERR_/i.test(line)) {
              diagnostics.push(`Browser: ${line}`);
            }
          }
        }
      } catch (err) {
        log.warn("Failed to gather browser diagnostics for zero-duration composition", {
          error: err instanceof Error ? err.message : String(err),
        });
        diagnostics.push("(Could not gather browser diagnostics — page may have crashed)");
      }
      const hint =
        diagnostics.length > 0
          ? "\n\nDiagnostics:\n  - " + diagnostics.join("\n  - ")
          : "\n\nCheck that GSAP timelines are registered on window.__timelines.";
      throw new Error("Composition duration is 0 — this would produce a black video." + hint);
    }

    // Surface browser-side asset failures (404s, script errors) as warnings.
    // These don't block the render but indicate missing images, fonts, or
    // scripts that may produce unexpected visual artifacts.
    if (probeSession) {
      const failedRequests = probeSession.browserConsoleBuffer.filter((line) =>
        /404|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|net::ERR_/i.test(line),
      );
      if (failedRequests.length > 0) {
        log.warn("Browser encountered network failures during page load:", {
          failures: failedRequests.slice(0, 10),
        });
        for (const line of failedRequests.slice(0, 5)) {
          console.warn(`[Render] Asset load failure: ${line}`);
        }
      }
    }

    perfStages.compileMs = Date.now() - stage1Start;

    // ── Stage 2: Video frame extraction ─────────────────────────────────
    const stage2Start = Date.now();
    updateJobStatus(job, "preprocessing", "Extracting video frames", 10, onProgress);

    let frameLookup: FrameLookupTable | null = null;
    const compiledDir = join(workDir, "compiled");
    let extractionResult: Awaited<ReturnType<typeof extractAllVideoFrames>> | null = null;

    // Probe ORIGINAL color spaces before extraction (which may convert SDR→HDR).
    // This is needed to identify which videos are natively HDR vs converted-SDR
    // for the two-pass compositing path. Gated by --hdr flag to avoid ffprobe
    // overhead on SDR-only compositions.
    const nativeHdrVideoIds = new Set<string>();
    const videoTransfers = new Map<string, HdrTransfer>();
    if (job.config.hdr && composition.videos.length > 0) {
      await Promise.all(
        composition.videos.map(async (v) => {
          let videoPath = v.src;
          if (!videoPath.startsWith("/")) {
            const fromCompiled = existsSync(join(compiledDir, videoPath))
              ? join(compiledDir, videoPath)
              : join(projectDir, videoPath);
            videoPath = fromCompiled;
          }
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
    // trigger HDR output without any video sources present.
    const nativeHdrImageIds = new Set<string>();
    const imageTransfers = new Map<string, HdrTransfer>();
    const hdrImageSrcPaths = new Map<string, string>();
    const imageColorSpaces: (VideoColorSpace | null)[] = [];
    if (job.config.hdr && composition.images.length > 0) {
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
      extractionResult = await extractAllVideoFrames(
        composition.videos,
        projectDir,
        { fps: job.config.fps, outputDir: join(workDir, "video-frames") },
        abortSignal,
        { extractCacheDir: cfg.extractCacheDir },
        compiledDir,
      );
      assertNotAborted();

      if (extractionResult.extracted.length > 0) {
        frameLookup = createFrameLookupTable(composition.videos, extractionResult.extracted);
      }
      perfStages.videoExtractMs = Date.now() - stage2Start;

      // Auto-detect audio from video files via ffprobe metadata
      const existingAudioSrcs = new Set(composition.audios.map((a) => a.src));
      for (const ext of extractionResult.extracted) {
        if (ext.metadata.hasAudio) {
          const video = composition.videos.find((v) => v.id === ext.videoId);
          if (video && !existingAudioSrcs.has(video.src)) {
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
      }
    } else {
      perfStages.videoExtractMs = Date.now() - stage2Start;
    }

    // ── HDR auto-detection ──────────────────────────────────────────────
    // When --hdr is set, analyze probed video AND image color spaces.
    // If any HDR sources are found, output uses H.265 10-bit with the
    // dominant transfer (PQ if any PQ source is present, otherwise HLG).
    // Image-only compositions can trigger HDR output without any video.
    let effectiveHdr: { transfer: HdrTransfer } | undefined;
    if (job.config.hdr) {
      const videoColorSpaces = (extractionResult?.extracted ?? []).map(
        (ext) => ext.metadata.colorSpace,
      );
      const allColorSpaces = [...videoColorSpaces, ...imageColorSpaces];
      if (allColorSpaces.length > 0) {
        const info = analyzeCompositionHdr(allColorSpaces);
        if (info.hasHdr && info.dominantTransfer) {
          effectiveHdr = { transfer: info.dominantTransfer };
        }
      }
    }
    if (effectiveHdr && outputFormat !== "mp4") {
      log.warn(
        `[Render] HDR source detected but format is ${outputFormat} — falling back to SDR. Use --format mp4 for HDR10 output.`,
      );
      effectiveHdr = undefined;
    }
    if (effectiveHdr) {
      log.info(
        `[Render] HDR source detected — output: ${effectiveHdr.transfer.toUpperCase()} (BT.2020, 10-bit H.265)`,
      );
    }

    // ── Stage 3: Audio processing ───────────────────────────────────────
    const stage3Start = Date.now();
    updateJobStatus(job, "preprocessing", "Processing audio tracks", 20, onProgress);

    const audioOutputPath = join(workDir, "audio.aac");
    let hasAudio = false;

    if (composition.audios.length > 0) {
      const audioResult = await processCompositionAudio(
        composition.audios,
        projectDir,
        join(workDir, "audio-work"),
        audioOutputPath,
        job.duration,
        abortSignal,
        undefined,
        compiledDir,
      );
      assertNotAborted();

      hasAudio = audioResult.success;
      perfStages.audioProcessMs = Date.now() - stage3Start;
    } else {
      perfStages.audioProcessMs = Date.now() - stage3Start;
    }

    // ── Stage 4: Frame capture ──────────────────────────────────────────
    const stage4Start = Date.now();
    updateJobStatus(job, "rendering", "Starting frame capture", 25, onProgress);

    // Start file server (may already be running from duration discovery)
    if (!fileServer) {
      fileServer = await createFileServer({
        projectDir,
        compiledDir: join(workDir, "compiled"),
        port: 0,
        preHeadScripts: [VIRTUAL_TIME_SHIM],
      });
      assertNotAborted();
    }

    const framesDir = join(workDir, "captured-frames");
    if (!existsSync(framesDir)) mkdirSync(framesDir, { recursive: true });

    const captureOptions: CaptureOptions = {
      width,
      height,
      fps: job.config.fps,
      format: needsAlpha ? "png" : "jpeg",
      quality: needsAlpha ? undefined : job.config.quality === "draft" ? 80 : 95,
    };

    // Native HDR videos (e.g. HEVC) may be undecodable by Chrome on the current
    // platform — Linux headless-shell ships without HEVC support. Their pixels
    // come from out-of-band ffmpeg extraction, so the DOM `<video>` element is
    // only kept around for layout. Skip the per-page readiness wait for these
    // IDs in every capture session we open during HDR rendering; otherwise the
    // render hangs 45s and throws "video metadata not ready" even though we
    // never asked the browser to decode the video. Encapsulating the spread
    // here avoids drifting copies across the five capture call sites below.
    const buildHdrCaptureOptions = (): CaptureOptions => ({
      ...captureOptions,
      skipReadinessVideoIds: Array.from(nativeHdrVideoIds),
    });

    const workerCount = calculateOptimalWorkers(totalFrames, job.config.workers, cfg);

    const FORMAT_EXT: Record<string, string> = { mp4: ".mp4", webm: ".webm", mov: ".mov" };
    const videoExt = FORMAT_EXT[outputFormat] ?? ".mp4";
    const videoOnlyPath = join(workDir, `video-only${videoExt}`);
    // Only use the HDR encoder preset when there's HDR content to pass through —
    // either native HDR videos OR native HDR images. For SDR-only compositions,
    // --hdr is a no-op since H.265 10-bit causes browser color management issues
    // (orange shift) with no quality benefit.
    const nativeHdrIds = new Set([...nativeHdrVideoIds, ...nativeHdrImageIds]);
    const hasHdrContent = effectiveHdr && nativeHdrIds.size > 0;
    const encoderHdr = hasHdrContent ? effectiveHdr : undefined;
    const preset = getEncoderPreset(job.config.quality, outputFormat, encoderHdr);

    // CLI overrides (--crf, --video-bitrate) flow through job.config and must
    // win over the preset-derived defaults. The CLI enforces mutual exclusivity
    // upstream, but we still resolve them defensively. Without this, the flags
    // are silently ignored at the encoder spawn sites below — see PR #268 which
    // dropped the prior baseEncoderOpts wiring.
    //
    // Programmatic callers can construct RenderConfig directly and bypass the
    // CLI's mutual-exclusivity guard. If both are set we honor crf (matches the
    // CLI semantics where --crf is the explicit override) and warn loudly so
    // the caller doesn't get a quietly-different bitrate than they passed in.
    if (job.config.crf != null && job.config.videoBitrate) {
      log.warn(
        `[Render] Both crf=${job.config.crf} and videoBitrate=${job.config.videoBitrate} were set. ` +
          `These are mutually exclusive; honoring crf and ignoring videoBitrate. ` +
          `Set only one to silence this warning.`,
      );
    }
    const effectiveQuality = job.config.crf ?? preset.quality;
    const effectiveBitrate = job.config.crf != null ? undefined : job.config.videoBitrate;

    job.framesRendered = 0;

    // ── HDR z-ordered multi-layer compositing ──────────────────────────────
    // Per frame: query all elements' z-order, group into layers (DOM or HDR),
    // composite bottom-to-top in Node.js memory. HDR layers use native
    // pre-extracted HLG pixels; DOM layers use Chrome alpha screenshots
    // with sRGB→HLG conversion. Video position/opacity applied via queried bounds.
    if (hasHdrContent) {
      log.info("[Render] HDR layered composite: z-ordered DOM + native HLG video layers");

      // HDR layered compositing relies on captureAlphaPng (Page.captureScreenshot
      // with a transparent background) for the SDR DOM overlay layer. That CDP
      // call hangs indefinitely when Chrome is launched with --enable-begin-frame-control
      // (the default on Linux/headless-shell), because the compositor is paused
      // and never produces a frame to capture. Force screenshot mode for the
      // entire HDR path — same constraint as alpha output formats above.
      cfg.forceScreenshot = true;

      // Use NATIVE HDR IDs (probed before SDR→HDR conversion) so only originally-HDR
      // videos are hidden + extracted natively. SDR videos stay in the DOM screenshot
      // (injected via the frame injector) and get sRGB→HLG conversion in the blit.
      // HDR images don't need an equivalent array — they're keyed off
      // `nativeHdrImageIds` directly (decoded once into `hdrImageBuffers` and blitted
      // by `blitHdrImageLayer`, with the DOM mask hiding them via `nativeHdrIds`).
      const hdrVideoIds = composition.videos
        .filter((v) => nativeHdrVideoIds.has(v.id))
        .map((v) => v.id);

      // Resolve HDR video source paths
      const hdrVideoSrcPaths = new Map<string, string>();
      for (const v of composition.videos) {
        if (!hdrVideoIds.includes(v.id)) continue;
        let srcPath = v.src;
        if (!srcPath.startsWith("/")) {
          const fromCompiled = join(compiledDir, srcPath);
          srcPath = existsSync(fromCompiled) ? fromCompiled : join(projectDir, srcPath);
        }
        hdrVideoSrcPaths.set(v.id, srcPath);
      }

      // Launch headless Chrome for DOM capture.
      // Pass the video frame injector so SDR videos are rendered correctly in Chrome.
      // HDR videos get injected too but are masked out via applyDomLayerMask
      // before each DOM screenshot — only the native FFmpeg-extracted HLG
      // frames are used for HDR pixels.
      if (!fileServer) throw new Error("fileServer must be initialized before HDR compositing");
      // Native HDR videos (e.g. HEVC) may be undecodable by Chrome on the
      // current platform — Linux headless-shell ships without HEVC support.
      // Their pixels come from out-of-band ffmpeg extraction, so the DOM
      // `<video>` element is only kept around for layout. Skip the per-page
      // readiness wait for these IDs; otherwise the render hangs 45s and
      // throws "video metadata not ready" even though we never asked the
      // browser to decode the video.
      const domSession = await createCaptureSession(
        fileServer.url,
        framesDir,
        buildHdrCaptureOptions(),
        createVideoFrameInjector(frameLookup),
        cfg,
      );
      // Track lifecycle of resources spawned during HDR rendering so the
      // outer finally block can defensively reclaim anything that wasn't
      // cleaned up via the success path. Both closeCaptureSession and
      // StreamingEncoder.close() are idempotent, but the flags let us avoid
      // redundant work and make the intent explicit.
      let hdrEncoder: StreamingEncoder | null = null;
      let hdrEncoderClosed = false;
      let domSessionClosed = false;
      // Track HDR video frame directories at this scope so the outer finally
      // can clear their entries from the module-scoped frameDirMaxIndexCache.
      // Without this, the cache leaks one entry per HDR video per render.
      const hdrFrameDirs = new Map<string, string>();
      try {
        await initializeSession(domSession);
        assertNotAborted();
        lastBrowserConsole = domSession.browserConsoleBuffer;

        // Set transparent background once for this dedicated DOM session.
        // captureAlphaPng() per frame skips the per-frame CDP set/reset overhead.
        await initTransparentBackground(domSession.page);

        // ── Scene detection for shader transitions ──────────────────────────
        // Query the browser for transition metadata written by @hyperframes/shader-transitions
        // (window.__hf.transitions) and discover which elements belong to each scene.
        const transitionMeta: HdrTransitionMeta[] = await domSession.page.evaluate(() => {
          return window.__hf?.transitions ?? [];
        });

        // Contract: compositions using window.__hf.transitions must wrap each
        // scene's elements in a <div class="scene" id="sceneName"> where the id
        // matches the fromScene/toScene values declared in the transition metadata.
        const sceneElements: Record<string, string[]> = await domSession.page.evaluate(() => {
          const scenes = document.querySelectorAll(".scene");
          const map: Record<string, string[]> = {};
          for (const scene of scenes) {
            const els = scene.querySelectorAll("[data-start]");
            map[scene.id] = Array.from(els).map((e) => e.id);
          }
          return map;
        });

        const transitionRanges: TransitionRange[] = transitionMeta.map((t) => ({
          ...t,
          startFrame: Math.floor(t.time * job.config.fps),
          endFrame: Math.ceil((t.time + t.duration) * job.config.fps),
        }));

        if (transitionRanges.length > 0) {
          log.info("[Render] Detected shader transitions for HDR compositing", {
            count: transitionRanges.length,
            transitions: transitionRanges.map((t) => ({
              shader: t.shader,
              from: t.fromScene,
              to: t.toScene,
              frames: `${t.startFrame}-${t.endFrame}`,
            })),
          });
        }

        // Spawn HDR streaming encoder accepting raw rgb48le composited frames.
        // Assigned to the let declared above so the outer finally can close it
        // if any of the work between here and hdrEncoder.close() throws.
        hdrEncoder = await spawnStreamingEncoder(
          videoOnlyPath,
          {
            fps: job.config.fps,
            width,
            height,
            codec: preset.codec,
            preset: preset.preset,
            quality: effectiveQuality,
            bitrate: effectiveBitrate,
            pixelFormat: preset.pixelFormat,
            hdr: preset.hdr,
            rawInputFormat: "rgb48le",
          },
          abortSignal,
          { ffmpegStreamingTimeout: 3_600_000 },
        );
        assertNotAborted();

        // ── Query element bounds for HDR extraction dimensions ────────────
        // Extract at each HDR video's display dimensions (not composition dimensions)
        // so the source stride matches the blit dimensions. Elements that aren't
        // visible at t=0 (e.g., data-start > 0) need to be queried at their own
        // start time so their layout dimensions are available.
        const hdrExtractionDims = new Map<string, { width: number; height: number }>();
        // CSS `object-fit` / `object-position` for HDR <img> elements. Captured
        // alongside `hdrExtractionDims` so the static-image decoder can resample
        // the rgb48le buffer into the element's layout box the same way the
        // browser would, instead of blitting the source PNG at native size.
        const hdrImageFitInfo = new Map<string, { fit: string; position: string }>();
        const hdrVideoStartTimes = new Map<string, number>();
        for (const v of composition.videos) {
          if (hdrVideoIds.includes(v.id)) {
            hdrVideoStartTimes.set(v.id, v.start);
          }
        }
        const hdrImageStartTimes = new Map<string, number>();
        for (const img of composition.images) {
          if (nativeHdrImageIds.has(img.id)) {
            hdrImageStartTimes.set(img.id, img.start);
          }
        }

        // Collect unique start times to minimize seek operations. Merge HDR
        // video AND image start times so an HDR image with `data-start > 0`
        // also gets a stacking-query pass at its appearance moment.
        const uniqueStartTimes = [
          ...new Set([...hdrVideoStartTimes.values(), ...hdrImageStartTimes.values()]),
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
            // Use layout dimensions (offsetWidth/offsetHeight) for extraction — these
            // are unaffected by CSS transforms (GSAP scale/rotation). getBoundingClientRect
            // returns the transformed bounding box which can be wrong for extraction.
            if (
              el.isHdr &&
              el.layoutWidth > 0 &&
              el.layoutHeight > 0 &&
              !hdrExtractionDims.has(el.id)
            ) {
              hdrExtractionDims.set(el.id, { width: el.layoutWidth, height: el.layoutHeight });
            }
            // Record `object-fit` / `object-position` for HDR images so the
            // static-image decode pass can resample to layout dimensions with
            // the same semantics the browser would apply.
            if (el.isHdr && nativeHdrImageIds.has(el.id) && !hdrImageFitInfo.has(el.id)) {
              hdrImageFitInfo.set(el.id, {
                fit: el.objectFit,
                position: el.objectPosition,
              });
            }
          }
        }

        // Fallback probe for HDR images that weren't captured above.
        // When an image's `data-start` aligns with the exact visibility
        // boundary (or precedes a GSAP `from` tween that animates it in
        // later), Chrome reports 0 layout dimensions at that instant.
        // Re-probe slightly into the element's visible range so the
        // resample path gets real layout dims.
        for (const [imageId, startTime] of hdrImageStartTimes) {
          if (hdrExtractionDims.has(imageId)) continue;
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
              hdrExtractionDims.set(el.id, { width: el.layoutWidth, height: el.layoutHeight });
              if (!hdrImageFitInfo.has(el.id)) {
                hdrImageFitInfo.set(el.id, { fit: el.objectFit, position: el.objectPosition });
              }
              break;
            }
          }
        }

        // ── Pre-extract all HDR video frames in a single FFmpeg pass ──────
        // hdrFrameDirs is declared above the try block so the outer finally
        // can clear matching frameDirMaxIndexCache entries on any exit path.
        for (const [videoId, srcPath] of hdrVideoSrcPaths) {
          const video = composition.videos.find((v) => v.id === videoId);
          if (!video) continue;
          const frameDir = join(framesDir, `hdr_${videoId}`);
          mkdirSync(frameDir, { recursive: true });
          const duration = video.end - video.start;
          const dims = hdrExtractionDims.get(videoId) ?? { width, height };
          const ffmpegArgs = [
            "-ss",
            String(video.mediaStart),
            "-i",
            srcPath,
            "-t",
            String(duration),
            "-r",
            String(job.config.fps),
            "-vf",
            `scale=${dims.width}:${dims.height}:force_original_aspect_ratio=increase,crop=${dims.width}:${dims.height}`,
            "-pix_fmt",
            "rgb48le",
            "-c:v",
            "png",
            "-y",
            join(frameDir, "frame_%04d.png"),
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
          hdrFrameDirs.set(videoId, frameDir);
        }

        // ── Pre-decode all HDR image buffers once ────────────────────────
        // Static images decode exactly once, then the resulting rgb48le buffer
        // is blitted on every visible frame. Caching the decode here keeps the
        // per-frame cost to a memcpy + blit. Failures are logged and skipped so
        // a single broken file doesn't kill the render.
        //
        // We resample the decoded buffer to the element's *layout* dimensions
        // here (using CSS `object-fit` / `object-position` semantics), so the
        // affine blit downstream can treat the buffer as if the source was
        // sized to the element's box. Without this step, an `<img>` element
        // styled `object-fit: cover` would render its source PNG at native
        // pixel size inside the layout box — visually a small image floating
        // in the top-left corner of its container instead of filling it.
        const hdrImageBuffers = new Map<string, HdrImageBuffer>();
        for (const [imageId, srcPath] of hdrImageSrcPaths) {
          try {
            const decoded = decodePngToRgb48le(readFileSync(srcPath));
            const layout = hdrExtractionDims.get(imageId);
            const fitInfo = hdrImageFitInfo.get(imageId);
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
              hdrImageBuffers.set(imageId, {
                data: resampled,
                width: layout.width,
                height: layout.height,
              });
            } else {
              hdrImageBuffers.set(imageId, {
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

        assertNotAborted();

        try {
          // The beforeCaptureHook injects SDR video frames into the DOM.
          // We call it manually since the HDR loop doesn't use captureFrame().
          const beforeCaptureHook = domSession.onBeforeCapture;

          // Track which HDR video frame directories have been cleaned up.
          // Once a video's last frame has been used (time > video.end), its
          // extraction directory is deleted to free disk space. This prevents
          // disk exhaustion on compositions with many HDR videos.
          const cleanedUpVideos = new Set<string>();
          // Build a map of video end times for quick lookup
          const hdrVideoEndTimes = new Map<string, number>();
          for (const v of composition.videos) {
            if (hdrFrameDirs.has(v.id)) {
              hdrVideoEndTimes.set(v.id, v.end);
            }
          }

          // ── HDR composite helper context ───────────────────────────────────
          // The actual layer-compositing logic lives at module scope in
          // `compositeHdrFrame`; we just pre-bind its long-lived dependencies
          // here so call sites stay short.
          const debugDumpEnabled = process.env.KEEP_TEMP === "1";
          const debugDumpDir = debugDumpEnabled ? join(framesDir, "debug-composite") : null;
          if (debugDumpDir && !existsSync(debugDumpDir)) {
            mkdirSync(debugDumpDir, { recursive: true });
          }
          // INVARIANT: this entire `try` block is reachable only when HDR
          // output is enabled (`if (effectiveHdr) { ... try { ... } }`), so
          // narrowing here is safe even though `effectiveHdr` is typed as
          // `... | undefined` at the outer scope.
          if (!effectiveHdr) {
            throw new Error(
              "Internal: HDR render path entered without effectiveHdr — this is a bug.",
            );
          }
          const hdrCompositeCtx: HdrCompositeContext = {
            log,
            domSession,
            beforeCaptureHook,
            width,
            height,
            fps: job.config.fps,
            effectiveHdr,
            nativeHdrImageIds,
            hdrImageBuffers,
            hdrFrameDirs,
            hdrVideoStartTimes,
            imageTransfers,
            videoTransfers,
            debugDumpEnabled,
            debugDumpDir,
          };

          // ── Pre-allocate transition buffers ─────────────────────────────────
          // Each buffer is width * height * 6 bytes (~37 MB at 1080p). Reused
          // across frames to avoid per-frame allocation in the hot loop.
          const bufSize = width * height * 6;
          const hasTransitions = transitionRanges.length > 0;
          const transBufferA = hasTransitions ? Buffer.alloc(bufSize) : null;
          const transBufferB = hasTransitions ? Buffer.alloc(bufSize) : null;
          const transOutput = hasTransitions ? Buffer.alloc(bufSize) : null;
          // Pre-allocate the normal-frame canvas too — reused via .fill(0) each iteration
          // to avoid ~37 MB allocation per frame in the hot loop.
          const normalCanvas = Buffer.alloc(bufSize);

          for (let i = 0; i < totalFrames; i++) {
            assertNotAborted();
            const time = i / job.config.fps;

            // Seek timeline
            await domSession.page.evaluate((t: number) => {
              if (window.__hf && typeof window.__hf.seek === "function") window.__hf.seek(t);
            }, time);

            // Inject SDR video frames into the DOM
            if (beforeCaptureHook) {
              await beforeCaptureHook(domSession.page, time);
            }

            // Query ALL timed elements for z-order analysis
            const stackingInfo = await queryElementStacking(domSession.page, nativeHdrIds);

            // Find active transition for this frame (if any)
            const activeTransition = transitionRanges.find(
              (t) => i >= t.startFrame && i <= t.endFrame,
            );

            // Per-frame debug snapshot (every 30 frames). The meta object
            // requires `Array.find` over `stackingInfo` plus a number-format
            // and conditional struct allocation — non-trivial work to do
            // every 30 frames in the encode hot loop. Gate the entire block
            // on the logger's level check so production runs (level=info)
            // pay nothing.
            //
            // Audit note (PR #383 review): this is the only per-frame log
            // site in the streaming HDR encode loop that constructs
            // non-trivial metadata. The `[diag]` log.info calls inside
            // compositeToBuffer (compositeToBuffer plan, hdr layer blit,
            // dom layer blit, compositeToBuffer end) are already gated by
            // `shouldLog = debugDumpEnabled && debugFrameIndex >= 0`, where
            // debugDumpEnabled is driven by KEEP_TEMP=1 — strictly stricter
            // than an isLevelEnabled check. The HDR blit error-path
            // log.debugs only fire on caught failures, not on the happy
            // path. Any new per-frame log site that builds meta should
            // follow the same `if (log.isLevelEnabled?.("level") ?? true)`
            // pattern (or stay behind `shouldLog`) so production stays
            // allocation-free in the hot loop.
            if (i % 30 === 0 && (log.isLevelEnabled?.("debug") ?? true)) {
              const hdrEl = stackingInfo.find((e) => e.isHdr);
              log.debug("[Render] HDR layer composite frame", {
                frame: i,
                time: time.toFixed(2),
                hdrElement: hdrEl
                  ? { z: hdrEl.zIndex, visible: hdrEl.visible, width: hdrEl.width }
                  : null,
                stackingCount: stackingInfo.length,
                activeTransition: activeTransition?.shader,
              });
            }

            if (activeTransition && transBufferA && transBufferB && transOutput) {
              // ── Transition frame: dual-scene compositing ──────────────────
              const progress =
                activeTransition.endFrame === activeTransition.startFrame
                  ? 1
                  : (i - activeTransition.startFrame) /
                    (activeTransition.endFrame - activeTransition.startFrame);

              // Resolve scene element IDs
              const sceneAIds = new Set(sceneElements[activeTransition.fromScene] ?? []);
              const sceneBIds = new Set(sceneElements[activeTransition.toScene] ?? []);

              // Zero-fill scene buffers (transition function writes every output pixel)
              transBufferA.fill(0);
              transBufferB.fill(0);

              for (const [sceneBuf, sceneIds] of [
                [transBufferA, sceneAIds],
                [transBufferB, sceneBIds],
              ] as const) {
                // Re-check abort between scene A and scene B. Each scene
                // capture below performs a DOM seek, optional hook,
                // per-layer HDR blits, and a full-page screenshot — easily
                // hundreds of ms. Without this, an abort that arrives
                // during scene A's capture won't fire until the next outer
                // frame, after scene B has already been fully composited
                // and discarded.
                assertNotAborted();
                // Fresh state: seek + inject
                await domSession.page.evaluate((t: number) => {
                  if (window.__hf && typeof window.__hf.seek === "function") window.__hf.seek(t);
                }, time);
                if (beforeCaptureHook) {
                  await beforeCaptureHook(domSession.page, time);
                }

                // Blit all HDR videos/images for this scene
                for (const el of stackingInfo) {
                  if (!el.isHdr || !sceneIds.has(el.id)) continue;
                  if (nativeHdrImageIds.has(el.id)) {
                    blitHdrImageLayer(
                      sceneBuf as Buffer,
                      el,
                      hdrImageBuffers,
                      width,
                      height,
                      log,
                      imageTransfers.get(el.id),
                      effectiveHdr?.transfer,
                    );
                  } else {
                    blitHdrVideoLayer(
                      sceneBuf as Buffer,
                      el,
                      time,
                      job.config.fps,
                      hdrFrameDirs,
                      hdrVideoStartTimes,
                      width,
                      height,
                      log,
                      videoTransfers.get(el.id),
                      effectiveHdr?.transfer,
                    );
                  }
                }

                // Single DOM screenshot: mask the page so only this scene's DOM
                // elements paint. Same masking strategy as the per-layer DOM
                // branch — see applyDomLayerMask for details. Native HDR videos
                // and images are always inline-hidden so their fallback poster /
                // SDR thumbnail doesn't bleed into the DOM overlay (HDR pixels
                // are blitted separately by blitHdrVideoLayer / blitHdrImageLayer
                // above).
                const showIds = Array.from(sceneIds);
                const hideIds = stackingInfo
                  .map((e) => e.id)
                  .filter((id) => !sceneIds.has(id) || nativeHdrIds.has(id));
                await applyDomLayerMask(domSession.page, showIds, hideIds);
                const domPng = await captureAlphaPng(domSession.page, width, height);
                await removeDomLayerMask(domSession.page, hideIds);

                try {
                  const { data: domRgba } = decodePng(domPng);
                  // Invariant: `hasHdrVideo` requires `effectiveHdr` to be set (see line ~919).
                  if (!effectiveHdr) {
                    throw new Error(
                      "Invariant violation: effectiveHdr is undefined inside hasHdrVideo branch",
                    );
                  }
                  blitRgba8OverRgb48le(
                    domRgba,
                    sceneBuf as Buffer,
                    width,
                    height,
                    effectiveHdr.transfer,
                  );
                } catch (err) {
                  log.warn("DOM layer decode/blit failed; skipping overlay for transition scene", {
                    frameIndex: i,
                    sceneIds: Array.from(sceneIds),
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }

              // Apply shader transition blend directly in PQ/HLG signal space.
              // Linearization was attempted but destroys dark PQ content — values below
              // PQ ~5000 quantize to zero in 16-bit linear, wiping out the bottom portion
              // of dark video content. PQ space is perceptual and works well enough
              // for shader math since the shaders were designed for perceptual (sRGB) space.
              const transitionFn: TransitionFn = TRANSITIONS[activeTransition.shader] ?? crossfade;
              transitionFn(transBufferA, transBufferB, transOutput, width, height, progress);

              hdrEncoder.writeFrame(transOutput);
            } else {
              // ── Normal frame: full layer composite (no transition) ─────────
              normalCanvas.fill(0);
              await compositeHdrFrame(
                hdrCompositeCtx,
                normalCanvas,
                time,
                stackingInfo,
                undefined,
                i,
              );
              if (debugDumpEnabled && debugDumpDir && i % 30 === 0) {
                const previewPath = join(
                  debugDumpDir,
                  `frame_${String(i).padStart(4, "0")}_final_rgb48le.bin`,
                );
                writeFileSync(previewPath, normalCanvas);
              }
              hdrEncoder.writeFrame(normalCanvas);
            }

            // Clean up HDR frame directories for videos that have ended.
            // Frees disk space during long renders with many HDR videos.
            // Skip when KEEP_TEMP=1 so we can inspect intermediate state.
            if (process.env.KEEP_TEMP !== "1") {
              for (const [videoId, endTime] of hdrVideoEndTimes) {
                if (time > endTime && !cleanedUpVideos.has(videoId)) {
                  // Also check no active transition references this video's scene
                  const stillNeeded =
                    activeTransition &&
                    (sceneElements[activeTransition.fromScene]?.includes(videoId) ||
                      sceneElements[activeTransition.toScene]?.includes(videoId));
                  if (!stillNeeded) {
                    const frameDir = hdrFrameDirs.get(videoId);
                    if (frameDir) {
                      try {
                        rmSync(frameDir, { recursive: true, force: true });
                      } catch (err) {
                        log.warn("Failed to clean up HDR frame directory", {
                          videoId,
                          frameDir,
                          error: err instanceof Error ? err.message : String(err),
                        });
                      }
                      // Drop the matching cache entry so we don't leak a stale
                      // max-frame-index reading for a directory that no longer
                      // exists. Without this, the module-scoped cache grows
                      // monotonically across renders.
                      frameDirMaxIndexCache.delete(frameDir);
                      hdrFrameDirs.delete(videoId);
                    }
                    cleanedUpVideos.add(videoId);
                  }
                }
              }
            }

            job.framesRendered = i + 1;
            if ((i + 1) % 10 === 0 || i + 1 === totalFrames) {
              const frameProgress = (i + 1) / totalFrames;
              updateJobStatus(
                job,
                "rendering",
                `HDR composite frame ${i + 1}/${job.totalFrames}`,
                Math.round(25 + frameProgress * 55),
                onProgress,
              );
            }
          }
        } finally {
          lastBrowserConsole = domSession.browserConsoleBuffer;
          await closeCaptureSession(domSession);
          domSessionClosed = true;
        }

        const hdrEncodeResult = await hdrEncoder.close();
        hdrEncoderClosed = true;
        assertNotAborted();
        if (!hdrEncodeResult.success) {
          throw new Error(`HDR encode failed: ${hdrEncodeResult.error}`);
        }

        perfStages.captureMs = Date.now() - stage4Start;
        perfStages.encodeMs = hdrEncodeResult.durationMs;
      } finally {
        // Defensive cleanup: if anything between domSession creation and the
        // success-path closes threw, the encoder ffmpeg subprocess and the
        // browser would otherwise be leaked. Both close() methods are
        // idempotent so it's safe to call them when the flags are already set,
        // but we skip the redundant work to keep logs clean.
        if (hdrEncoder && !hdrEncoderClosed) {
          try {
            await hdrEncoder.close();
          } catch (err) {
            log.warn("hdrEncoder defensive close failed", {
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
        if (!domSessionClosed) {
          await closeCaptureSession(domSession).catch((err) => {
            log.warn("closeCaptureSession defensive close failed", {
              err: err instanceof Error ? err.message : String(err),
            });
          });
        }
        // Drop frameDirMaxIndexCache entries for any HDR frame directories
        // that survived the in-loop cleanup (early failures, KEEP_TEMP=1,
        // videos still active when the render exits). The on-disk frames
        // themselves are torn down with workDir; we just don't want the
        // module-scoped cache to leak entries across renders.
        for (const frameDir of hdrFrameDirs.values()) {
          frameDirMaxIndexCache.delete(frameDir);
        }
        hdrFrameDirs.clear();
      }
    } else // ── Standard capture paths (SDR or DOM-only HDR) ──────────────────
    // Streaming encode mode: pipe frame buffers directly to FFmpeg stdin,
    // skipping disk writes and the separate Stage 5 encode step.
    {
      let streamingEncoder: StreamingEncoder | null = null;
      let streamingEncoderClosed = false;

      if (enableStreamingEncode) {
        streamingEncoder = await spawnStreamingEncoder(
          videoOnlyPath,
          {
            fps: job.config.fps,
            width,
            height,
            codec: preset.codec,
            preset: preset.preset,
            quality: effectiveQuality,
            bitrate: effectiveBitrate,
            pixelFormat: preset.pixelFormat,
            useGpu: job.config.useGpu,
            imageFormat: captureOptions.format || "jpeg",
            hdr: preset.hdr,
          },
          abortSignal,
        );
        assertNotAborted();
      }

      try {
        if (enableStreamingEncode && streamingEncoder) {
          // ── Streaming capture + encode (Stage 4 absorbs Stage 5) ──────────
          const reorderBuffer = createFrameReorderBuffer(0, totalFrames);
          const currentEncoder = streamingEncoder;

          if (workerCount > 1) {
            // Parallel capture → streaming encode
            const tasks = distributeFrames(job.totalFrames, workerCount, workDir);

            const onFrameBuffer = async (frameIndex: number, buffer: Buffer): Promise<void> => {
              await reorderBuffer.waitForFrame(frameIndex);
              currentEncoder.writeFrame(buffer);
              reorderBuffer.advanceTo(frameIndex + 1);
            };

            await executeParallelCapture(
              fileServer.url,
              workDir,
              tasks,
              buildHdrCaptureOptions(),
              () => createVideoFrameInjector(frameLookup),
              abortSignal,
              (progress) => {
                job.framesRendered = progress.capturedFrames;
                const frameProgress = progress.capturedFrames / progress.totalFrames;
                const progressPct = 25 + frameProgress * 55;

                if (
                  progress.capturedFrames % 30 === 0 ||
                  progress.capturedFrames === progress.totalFrames
                ) {
                  updateJobStatus(
                    job,
                    "rendering",
                    `Streaming frame ${progress.capturedFrames}/${progress.totalFrames} (${workerCount} workers)`,
                    Math.round(progressPct),
                    onProgress,
                  );
                }
              },
              onFrameBuffer,
              cfg,
            );

            if (probeSession) {
              lastBrowserConsole = probeSession.browserConsoleBuffer;
              await closeCaptureSession(probeSession);
              probeSession = null;
            }
          } else {
            // Sequential capture → streaming encode

            const videoInjector = createVideoFrameInjector(frameLookup);
            const session =
              probeSession ??
              (await createCaptureSession(
                fileServer.url,
                framesDir,
                buildHdrCaptureOptions(),
                videoInjector,
                cfg,
              ));
            if (probeSession) {
              prepareCaptureSessionForReuse(session, framesDir, videoInjector);
              probeSession = null;
            }

            try {
              if (!session.isInitialized) {
                await initializeSession(session);
              }
              assertNotAborted();
              lastBrowserConsole = session.browserConsoleBuffer;

              for (let i = 0; i < totalFrames; i++) {
                assertNotAborted();
                const time = i / job.config.fps;
                const { buffer } = await captureFrameToBuffer(session, i, time);
                await reorderBuffer.waitForFrame(i);
                currentEncoder.writeFrame(buffer);
                reorderBuffer.advanceTo(i + 1);
                job.framesRendered = i + 1;

                const frameProgress = (i + 1) / totalFrames;
                const progress = 25 + frameProgress * 55;

                updateJobStatus(
                  job,
                  "rendering",
                  `Streaming frame ${i + 1}/${job.totalFrames}`,
                  Math.round(progress),
                  onProgress,
                );
              }
            } finally {
              lastBrowserConsole = session.browserConsoleBuffer;
              await closeCaptureSession(session);
            }
          }

          // Close encoder and get result
          const encodeResult = await currentEncoder.close();
          streamingEncoderClosed = true;
          assertNotAborted();

          if (!encodeResult.success) {
            throw new Error(`Streaming encode failed: ${encodeResult.error}`);
          }

          perfStages.captureMs = Date.now() - stage4Start;
          perfStages.encodeMs = encodeResult.durationMs; // Overlapped with capture
        } else {
          // ── Disk-based capture (original flow) ────────────────────────────
          if (workerCount > 1) {
            // Parallel capture
            const tasks = distributeFrames(job.totalFrames, workerCount, workDir);

            await executeParallelCapture(
              fileServer.url,
              workDir,
              tasks,
              buildHdrCaptureOptions(),
              () => createVideoFrameInjector(frameLookup),
              abortSignal,
              (progress) => {
                job.framesRendered = progress.capturedFrames;
                const frameProgress = progress.capturedFrames / progress.totalFrames;
                const progressPct = 25 + frameProgress * 45;

                if (
                  progress.capturedFrames % 30 === 0 ||
                  progress.capturedFrames === progress.totalFrames
                ) {
                  updateJobStatus(
                    job,
                    "rendering",
                    `Capturing frame ${progress.capturedFrames}/${progress.totalFrames} (${workerCount} workers)`,
                    Math.round(progressPct),
                    onProgress,
                  );
                }
              },
              undefined,
              cfg,
            );

            await mergeWorkerFrames(workDir, tasks, framesDir);
            if (probeSession) {
              lastBrowserConsole = probeSession.browserConsoleBuffer;
              await closeCaptureSession(probeSession);
              probeSession = null;
            }
          } else {
            // Sequential capture

            const videoInjector = createVideoFrameInjector(frameLookup);
            const session =
              probeSession ??
              (await createCaptureSession(
                fileServer.url,
                framesDir,
                buildHdrCaptureOptions(),
                videoInjector,
                cfg,
              ));
            if (probeSession) {
              prepareCaptureSessionForReuse(session, framesDir, videoInjector);
              probeSession = null;
            }

            try {
              if (!session.isInitialized) {
                await initializeSession(session);
              }
              assertNotAborted();
              lastBrowserConsole = session.browserConsoleBuffer;

              for (let i = 0; i < job.totalFrames; i++) {
                assertNotAborted();
                const time = i / job.config.fps;
                await captureFrame(session, i, time);
                job.framesRendered = i + 1;

                const frameProgress = (i + 1) / job.totalFrames;
                const progress = 25 + frameProgress * 45;

                updateJobStatus(
                  job,
                  "rendering",
                  `Capturing frame ${i + 1}/${job.totalFrames}`,
                  Math.round(progress),
                  onProgress,
                );
              }
            } finally {
              lastBrowserConsole = session.browserConsoleBuffer;
              await closeCaptureSession(session);
            }
          }

          perfStages.captureMs = Date.now() - stage4Start;

          // ── Stage 5: Encode ─────────────────────────────────────────────────
          const stage5Start = Date.now();
          updateJobStatus(job, "encoding", "Encoding video", 75, onProgress);

          const frameExt = needsAlpha ? "png" : "jpg";
          const framePattern = `frame_%06d.${frameExt}`;
          const encoderOpts = {
            fps: job.config.fps,
            width,
            height,
            codec: preset.codec,
            preset: preset.preset,
            quality: effectiveQuality,
            bitrate: effectiveBitrate,
            pixelFormat: preset.pixelFormat,
            useGpu: job.config.useGpu,
            hdr: preset.hdr,
          };
          const encodeResult = enableChunkedEncode
            ? await encodeFramesChunkedConcat(
                framesDir,
                framePattern,
                videoOnlyPath,
                encoderOpts,
                chunkedEncodeSize,
                abortSignal,
              )
            : await encodeFramesFromDir(
                framesDir,
                framePattern,
                videoOnlyPath,
                encoderOpts,
                abortSignal,
              );
          assertNotAborted();

          if (!encodeResult.success) {
            throw new Error(`Encoding failed: ${encodeResult.error}`);
          }

          perfStages.encodeMs = Date.now() - stage5Start;
        }
      } finally {
        // Defensive cleanup: if the streaming encoder branch threw before
        // currentEncoder.close() (e.g. capture failure, abort, broken pipe),
        // the ffmpeg subprocess would otherwise leak. close() is idempotent so
        // this is safe to call alongside the success-path close — we just gate
        // on the flag to avoid redundant work.
        if (streamingEncoder && !streamingEncoderClosed) {
          try {
            await streamingEncoder.close();
          } catch (err) {
            log.warn("streamingEncoder defensive close failed", {
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    } // end SDR capture paths block

    if (probeSession !== null) {
      const remainingProbeSession: CaptureSession = probeSession;
      lastBrowserConsole = remainingProbeSession.browserConsoleBuffer;
      await closeCaptureSession(remainingProbeSession);
      probeSession = null;
    }

    if (frameLookup) frameLookup.cleanup();

    // Stop file server
    fileServer.close();
    fileServer = null;

    // ── Stage 6: Assemble ───────────────────────────────────────────────
    const stage6Start = Date.now();
    updateJobStatus(job, "assembling", "Assembling final video", 90, onProgress);

    if (hasAudio) {
      const muxResult = await muxVideoWithAudio(
        videoOnlyPath,
        audioOutputPath,
        outputPath,
        abortSignal,
      );
      assertNotAborted();
      if (!muxResult.success) {
        throw new Error(`Audio muxing failed: ${muxResult.error}`);
      }
    } else {
      const faststartResult = await applyFaststart(videoOnlyPath, outputPath, abortSignal);
      assertNotAborted();
      if (!faststartResult.success) {
        throw new Error(`Faststart failed: ${faststartResult.error}`);
      }
    }

    perfStages.assembleMs = Date.now() - stage6Start;

    // ── Complete ─────────────────────────────────────────────────────────
    job.outputPath = outputPath;
    updateJobStatus(job, "complete", "Render complete", 100, onProgress);

    const totalElapsed = Date.now() - pipelineStart;
    sampleMemory();

    const tmpPeakBytes = existsSync(workDir) ? sampleDirectoryBytes(workDir) : 0;

    const perfSummary: RenderPerfSummary = {
      renderId: job.id,
      totalElapsedMs: totalElapsed,
      fps: job.config.fps,
      quality: job.config.quality,
      workers: workerCount,
      chunkedEncode: enableChunkedEncode,
      chunkSizeFrames: enableChunkedEncode ? chunkedEncodeSize : null,
      compositionDurationSeconds: composition.duration,
      totalFrames: totalFrames,
      resolution: { width, height },
      videoCount: composition.videos.length,
      audioCount: composition.audios.length,
      stages: perfStages,
      videoExtractBreakdown: extractionResult?.phaseBreakdown,
      tmpPeakBytes,
      hdrDiagnostics:
        hdrDiagnostics.videoExtractionFailures > 0 || hdrDiagnostics.imageDecodeFailures > 0
          ? { ...hdrDiagnostics }
          : undefined,
      captureAvgMs:
        totalFrames > 0 ? Math.round((perfStages.captureMs ?? 0) / totalFrames) : undefined,
      peakRssMb: Math.round(peakRssBytes / (1024 * 1024)),
      peakHeapUsedMb: Math.round(peakHeapUsedBytes / (1024 * 1024)),
    };
    job.perfSummary = perfSummary;
    if (job.config.debug) {
      try {
        writeFileSync(perfOutputPath, JSON.stringify(perfSummary, null, 2), "utf-8");
      } catch (err) {
        log.debug("Failed to write perf summary", {
          perfOutputPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── Cleanup ─────────────────────────────────────────────────────────
    if (job.config.debug) {
      // Copy output MP4 into debug dir for easy access
      if (existsSync(outputPath)) {
        const debugOutput = join(workDir, `output${videoExt}`);
        copyFileSync(outputPath, debugOutput);
      }
    } else if (process.env.KEEP_TEMP === "1") {
      log.info("KEEP_TEMP=1 — leaving workDir on disk for inspection", { workDir });
    } else {
      await safeCleanup(
        "remove workDir",
        () => {
          rmSync(workDir, { recursive: true, force: true });
        },
        log,
      );
    }

    if (restoreLogger) restoreLogger();
  } catch (error) {
    if (error instanceof RenderCancelledError || abortSignal?.aborted) {
      job.error = error instanceof Error ? error.message : "render_cancelled";
      updateJobStatus(job, "cancelled", "Render cancelled", job.progress, onProgress);
      if (fileServer) {
        const fs = fileServer;
        await safeCleanup(
          "close file server (cancel)",
          () => {
            fs.close();
          },
          log,
        );
      }
      if (probeSession) {
        const session = probeSession;
        await safeCleanup("close probe session (cancel)", () => closeCaptureSession(session), log);
      }
      if (!job.config.debug) {
        await safeCleanup(
          "remove workDir (cancel)",
          () => {
            rmSync(workDir, { recursive: true, force: true });
          },
          log,
        );
      }
      if (restoreLogger) restoreLogger();
      throw error instanceof RenderCancelledError
        ? error
        : new RenderCancelledError("render_cancelled");
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    // Suggest single-worker retry on parallel capture timeout.
    // Video-heavy compositions often cause multi-worker timeouts because
    // Chrome can't seek multiple video elements simultaneously.
    const isTimeoutError =
      errorMessage.includes("Waiting failed") ||
      errorMessage.includes("timeout exceeded") ||
      errorMessage.includes("Navigation timeout");
    const wasParallel = job.config.workers !== 1;
    if (isTimeoutError && wasParallel) {
      log.warn(
        `Parallel capture timed out with ${job.config.workers ?? "auto"} workers. ` +
          `Video-heavy compositions often need sequential capture. Retry with --workers 1`,
      );
    }

    job.error = errorMessage;
    updateJobStatus(job, "failed", `Failed: ${errorMessage}`, job.progress, onProgress);

    // Diagnostic summary
    const elapsed = Date.now() - pipelineStart;
    const freeMemMB = Math.round(freemem() / (1024 * 1024));

    // Populate structured error details for downstream consumers (SSE, sync response)
    job.failedStage = job.currentStage;
    job.errorDetails = {
      message: errorMessage,
      stack: errorStack,
      elapsedMs: elapsed,
      freeMemoryMB: freeMemMB,
      browserConsoleTail: lastBrowserConsole.length > 0 ? lastBrowserConsole.slice(-30) : undefined,
      perfStages: Object.keys(perfStages).length > 0 ? { ...perfStages } : undefined,
      hdrDiagnostics:
        hdrDiagnostics.videoExtractionFailures > 0 || hdrDiagnostics.imageDecodeFailures > 0
          ? { ...hdrDiagnostics }
          : undefined,
    };

    // Cleanup
    if (fileServer) {
      const fs = fileServer;
      await safeCleanup(
        "close file server (error)",
        () => {
          fs.close();
        },
        log,
      );
    }
    if (probeSession) {
      const session = probeSession;
      await safeCleanup("close probe session (error)", () => closeCaptureSession(session), log);
    }

    if (!job.config.debug) {
      await safeCleanup(
        "remove workDir (error)",
        () => {
          if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
        },
        log,
      );
    }

    if (restoreLogger) restoreLogger();
    throw error;
  } finally {
    clearInterval(memSamplerInterval);
  }
}
