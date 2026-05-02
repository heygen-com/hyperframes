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
  openSync,
  readSync,
  closeSync,
  readdirSync,
  statSync,
  writeFileSync,
  copyFileSync,
  appendFileSync,
  symlinkSync,
} from "fs";
import { parseHTML } from "linkedom";
import {
  type EngineConfig,
  resolveConfig,
  extractAllVideoFrames,
  type ExtractedFrames,
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
  type CaptureVideoMetadataHint,
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
  type ParallelProgress,
  type WorkerTask,
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
import { join, dirname, resolve, relative, isAbsolute, basename } from "path";
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
import {
  type HdrImageTransferCache,
  createHdrImageTransferCache,
} from "./hdrImageTransferCache.js";

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
  /**
   * Output container format. Defaults to `"mp4"`; existing renders are
   * unaffected unless this field is set explicitly.
   *
   * - `"mp4"`: H.264 by default, or H.265 + HDR10 when HDR auto-detect
   *   engages or `hdrMode: "force-hdr"` is set. Opaque. The
   *   default streaming/social deliverable. Faststart is applied so the
   *   `moov` atom sits at the file start and the file plays from a
   *   partial download.
   * - `"webm"`: VP9 + `yuva420p` pixel format → **true alpha channel**, no
   *   chroma key. Plays in Chrome, Edge, and Firefox; Safari support for
   *   alpha-WebM is incomplete. Use this when the output should drop
   *   straight into a `<video>` over a colored background on the web.
   *   Audio is muxed as Opus.
   * - `"mov"`: ProRes 4444 + `yuva444p10le` → **true alpha channel +
   *   10-bit color**. Sized for editor ingest (Premiere, Final Cut Pro,
   *   DaVinci Resolve), not direct web playback. Audio is muxed as AAC.
   * - `"png-sequence"`: a directory of zero-padded RGBA PNGs
   *   (`frame_000001.png` …). Lossless alpha, largest on disk, no muxed
   *   audio (an `audio.aac` sidecar is written alongside the PNGs when
   *   the composition has audio elements). Use for After Effects / Nuke
   *   / Fusion ingest, or when frames need post-processing before
   *   encoding. `outputPath` is treated as a directory; it is created if
   *   it doesn't exist.
   *
   * Alpha output (`"webm"`, `"mov"`, `"png-sequence"`) automatically
   * forces screenshot capture (Chrome's BeginFrame compositor does not
   * preserve alpha on Linux headless-shell) and disables HDR — HDR +
   * alpha is not a supported combination, a warning is logged and HDR
   * falls back to SDR. The transparent-background CSS is injected by
   * the engine's `initTransparentBackground` helper, so authors should
   * not paint a fullscreen `body` / `#root` background in their
   * compositions when targeting alpha output.
   */
  format?: "mp4" | "webm" | "mov" | "png-sequence";
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
  /** HDR rendering mode.
   * - `auto` (default): probe sources; enable HDR if any HDR content is found.
   * - `force-hdr`: enable HDR even on SDR-only compositions (falls back to HLG transfer).
   * - `force-sdr`: skip probing entirely; always render SDR.
   */
  hdrMode?: "auto" | "force-hdr" | "force-sdr";
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
  captureCalibration?: {
    sampledFrames: number[];
    p95Ms?: number;
    multiplier: number;
    reasons: string[];
  };
  captureAttempts?: CaptureAttemptSummary[];
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
  hdrPerf?: HdrPerfSummary;
}

export interface HdrDiagnostics {
  videoExtractionFailures: number;
  imageDecodeFailures: number;
}

export interface HdrPerfSummary {
  frames: number;
  normalFrames: number;
  transitionFrames: number;
  domLayerCaptures: number;
  hdrVideoLayerBlits: number;
  hdrImageLayerBlits: number;
  timings: Record<string, number>;
  avgMs: Record<string, number>;
}

type HdrPerfTimingKey =
  | "frameSeekMs"
  | "frameInjectMs"
  | "stackingQueryMs"
  | "canvasClearMs"
  | "normalCompositeMs"
  | "transitionCompositeMs"
  | "encoderWriteMs"
  | "hdrVideoReadDecodeMs"
  | "hdrVideoTransferMs"
  | "hdrVideoBlitMs"
  | "hdrImageTransferMs"
  | "hdrImageBlitMs"
  | "domLayerSeekMs"
  | "domLayerInjectMs"
  | "domMaskApplyMs"
  | "domScreenshotMs"
  | "domMaskRemoveMs"
  | "domPngDecodeMs"
  | "domBlitMs";

interface HdrPerfCollector {
  frames: number;
  normalFrames: number;
  transitionFrames: number;
  domLayerCaptures: number;
  hdrVideoLayerBlits: number;
  hdrImageLayerBlits: number;
  timings: Record<HdrPerfTimingKey, number>;
}

function createHdrPerfCollector(): HdrPerfCollector {
  return {
    frames: 0,
    normalFrames: 0,
    transitionFrames: 0,
    domLayerCaptures: 0,
    hdrVideoLayerBlits: 0,
    hdrImageLayerBlits: 0,
    timings: {
      frameSeekMs: 0,
      frameInjectMs: 0,
      stackingQueryMs: 0,
      canvasClearMs: 0,
      normalCompositeMs: 0,
      transitionCompositeMs: 0,
      encoderWriteMs: 0,
      hdrVideoReadDecodeMs: 0,
      hdrVideoTransferMs: 0,
      hdrVideoBlitMs: 0,
      hdrImageTransferMs: 0,
      hdrImageBlitMs: 0,
      domLayerSeekMs: 0,
      domLayerInjectMs: 0,
      domMaskApplyMs: 0,
      domScreenshotMs: 0,
      domMaskRemoveMs: 0,
      domPngDecodeMs: 0,
      domBlitMs: 0,
    },
  };
}

function addHdrTiming(perf: HdrPerfCollector | undefined, key: HdrPerfTimingKey, startMs: number) {
  if (!perf) return;
  perf.timings[key] += Date.now() - startMs;
}

function averageTiming(totalMs: number, count: number): number {
  return count > 0 ? Math.round((totalMs / count) * 100) / 100 : 0;
}

function finalizeHdrPerf(perf: HdrPerfCollector): HdrPerfSummary {
  const avgMs: Record<string, number> = {};
  const perFrameKeys: HdrPerfTimingKey[] = [
    "frameSeekMs",
    "frameInjectMs",
    "stackingQueryMs",
    "canvasClearMs",
    "encoderWriteMs",
  ];
  for (const key of perFrameKeys) avgMs[key] = averageTiming(perf.timings[key], perf.frames);
  avgMs.normalCompositeMs = averageTiming(perf.timings.normalCompositeMs, perf.normalFrames);
  avgMs.transitionCompositeMs = averageTiming(
    perf.timings.transitionCompositeMs,
    perf.transitionFrames,
  );

  const perDomLayerKeys: HdrPerfTimingKey[] = [
    "domLayerSeekMs",
    "domLayerInjectMs",
    "domMaskApplyMs",
    "domScreenshotMs",
    "domMaskRemoveMs",
    "domPngDecodeMs",
    "domBlitMs",
  ];
  for (const key of perDomLayerKeys) {
    avgMs[key] = averageTiming(perf.timings[key], perf.domLayerCaptures);
  }

  const perHdrVideoKeys: HdrPerfTimingKey[] = [
    "hdrVideoReadDecodeMs",
    "hdrVideoTransferMs",
    "hdrVideoBlitMs",
  ];
  for (const key of perHdrVideoKeys) {
    avgMs[key] = averageTiming(perf.timings[key], perf.hdrVideoLayerBlits);
  }

  const perHdrImageKeys: HdrPerfTimingKey[] = ["hdrImageTransferMs", "hdrImageBlitMs"];
  for (const key of perHdrImageKeys) {
    avgMs[key] = averageTiming(perf.timings[key], perf.hdrImageLayerBlits);
  }

  return {
    frames: perf.frames,
    normalFrames: perf.normalFrames,
    transitionFrames: perf.transitionFrames,
    domLayerCaptures: perf.domLayerCaptures,
    hdrVideoLayerBlits: perf.hdrVideoLayerBlits,
    hdrImageLayerBlits: perf.hdrImageLayerBlits,
    timings: { ...perf.timings },
    avgMs,
  };
}

export interface CaptureCostEstimate {
  multiplier: number;
  reasons: string[];
  p95Ms?: number;
}

export interface CaptureCalibrationSample {
  frameIndex: number;
  captureTimeMs: number;
}

export interface FrameRange {
  startFrame: number;
  endFrame: number;
}

export interface CaptureAttemptSummary {
  attempt: number;
  workers: number;
  frameCount: number;
  reason: "initial" | "retry";
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

const BROWSER_MEDIA_EPSILON = 0.0001;

/**
 * Browser-discovered media inside inlined sub-compositions can still report
 * scene-local timing from the merged DOM (e.g. start=0, end=85.52) while the
 * compiled metadata is already offset into the parent host timeline
 * (e.g. start=4.417, end=89.937). Reproject browser end-time into the
 * compiled element's time origin before reconciling it back into the render
 * metadata.
 */
export function projectBrowserEndToCompositionTimeline(
  existingStart: number,
  browserStart: number,
  browserEnd: number,
): number {
  return browserEnd + (existingStart - browserStart);
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
      hasShaderTransitions: compiled.hasShaderTransitions,
    };
    writeFileSync(join(compileDir, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");
  }
}

export function createCompiledFrameSrcResolver(
  compiledDir: string,
): (framePath: string) => string | null {
  const compiledRoot = resolve(compiledDir);
  return (framePath: string): string | null => {
    const resolvedFramePath = resolve(framePath);
    if (!isPathInside(resolvedFramePath, compiledRoot)) return null;

    const relativePath = relative(compiledRoot, resolvedFramePath);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      return null;
    }

    return `/${relativePath
      .split(/[\\/]+/)
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
  };
}

type MaterializedExtractedFrames = Pick<ExtractedFrames, "videoId" | "outputDir" | "framePaths">;

type MaterializePathModule = {
  resolve: (...segments: string[]) => string;
  join: (...segments: string[]) => string;
  dirname: (path: string) => string;
  basename: (path: string) => string;
  relative: (from: string, to: string) => string;
  isAbsolute: (path: string) => boolean;
};

type MaterializeFileSystem = {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, options: { recursive: true }) => unknown;
  symlinkSync: (target: string, path: string) => unknown;
};

type MaterializeExtractedFramesOptions = {
  pathModule?: MaterializePathModule;
  fileSystem?: MaterializeFileSystem;
};

const materializePathModule: MaterializePathModule = {
  resolve,
  join,
  dirname,
  basename,
  relative,
  isAbsolute,
};

const materializeFileSystem: MaterializeFileSystem = {
  existsSync,
  mkdirSync,
  symlinkSync,
};

export function materializeExtractedFramesForCompiledDir(
  extracted: MaterializedExtractedFrames[],
  compiledDir: string,
  options: MaterializeExtractedFramesOptions = {},
): void {
  const pathModule = options.pathModule ?? materializePathModule;
  const fileSystem = options.fileSystem ?? materializeFileSystem;
  const resolvedCompiledDir = pathModule.resolve(compiledDir);
  const compiledFrameRoot = pathModule.join(resolvedCompiledDir, "__hyperframes_video_frames");

  for (const ext of extracted) {
    const resolvedOut = pathModule.resolve(ext.outputDir);
    if (isPathInside(resolvedOut, resolvedCompiledDir, { pathModule })) continue;

    const linkPath = pathModule.join(compiledFrameRoot, ext.videoId);
    if (!fileSystem.existsSync(linkPath)) {
      fileSystem.mkdirSync(pathModule.dirname(linkPath), { recursive: true });
      fileSystem.symlinkSync(resolvedOut, linkPath);
    }

    const remapped = new Map<number, string>();
    for (const [idx, framePath] of ext.framePaths) {
      remapped.set(idx, pathModule.join(linkPath, pathModule.basename(framePath)));
    }
    ext.framePaths = remapped;
    ext.outputDir = linkPath;
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

export function collectVideoReadinessSkipIds(
  nativeHdrVideoIds: ReadonlySet<string>,
  extractedVideos: readonly ExtractedVideoReadinessInput[],
): string[] {
  return Array.from(
    new Set([
      ...nativeHdrVideoIds,
      ...extractedVideos
        .filter((video) => hasUsableVideoDimensions(video.metadata))
        .map((video) => video.videoId),
    ]),
  ).sort();
}

interface ExtractedVideoReadinessInput {
  videoId: string;
  metadata: {
    width: number;
    height: number;
  };
}

function hasUsableVideoDimensions(metadata: ExtractedVideoReadinessInput["metadata"]) {
  return (
    Number.isFinite(metadata.width) &&
    Number.isFinite(metadata.height) &&
    metadata.width > 0 &&
    metadata.height > 0
  );
}

export function collectVideoMetadataHints(
  extractedVideos: readonly ExtractedVideoReadinessInput[],
): CaptureVideoMetadataHint[] {
  return extractedVideos
    .filter((video) => hasUsableVideoDimensions(video.metadata))
    .map((video) => ({
      id: video.videoId,
      width: video.metadata.width,
      height: video.metadata.height,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function resolveRenderWorkerCount(
  totalFrames: number,
  requestedWorkers: number | undefined,
  cfg: EngineConfig,
  compiled: Pick<CompiledComposition, "hasShaderTransitions" | "renderModeHints">,
  log: ProducerLogger = defaultLogger,
  measuredCaptureCost?: CaptureCostEstimate,
): number {
  const captureCost = combineCaptureCostEstimates(
    estimateCaptureCostMultiplier(compiled),
    measuredCaptureCost,
  );
  const workerCount = calculateOptimalWorkers(totalFrames, requestedWorkers, {
    ...cfg,
    captureCostMultiplier: captureCost.multiplier,
  });

  if (requestedWorkers !== undefined || captureCost.multiplier <= 1) {
    return workerCount;
  }

  const baselineWorkers = calculateOptimalWorkers(totalFrames, undefined, cfg);
  if (workerCount < baselineWorkers) {
    log.warn(
      "[Render] Reduced auto worker count for high-cost capture workload to avoid Chrome compositor starvation.",
      {
        from: baselineWorkers,
        to: workerCount,
        costMultiplier: captureCost.multiplier,
        reasons: captureCost.reasons,
      },
    );
  }

  return workerCount;
}

export function estimateCaptureCostMultiplier(
  compiled: Pick<CompiledComposition, "hasShaderTransitions" | "renderModeHints">,
): CaptureCostEstimate {
  let multiplier = 1;
  const reasons: string[] = [];

  if (compiled.hasShaderTransitions) {
    multiplier += 2;
    reasons.push("shader-transitions");
  }

  const reasonCodes = new Set(compiled.renderModeHints.reasons.map((reason) => reason.code));
  if (reasonCodes.has("requestAnimationFrame")) {
    multiplier += 1;
    reasons.push("requestAnimationFrame");
  }
  if (reasonCodes.has("iframe")) {
    multiplier += 0.5;
    reasons.push("iframe");
  }

  return {
    multiplier: Math.round(multiplier * 100) / 100,
    reasons,
  };
}

function combineCaptureCostEstimates(
  staticCost: CaptureCostEstimate,
  measuredCost?: CaptureCostEstimate,
): CaptureCostEstimate {
  if (!measuredCost || measuredCost.multiplier <= 1) return staticCost;
  if (staticCost.multiplier >= measuredCost.multiplier) {
    return {
      multiplier: staticCost.multiplier,
      reasons: [...staticCost.reasons, ...measuredCost.reasons],
      p95Ms: measuredCost.p95Ms,
    };
  }
  return {
    multiplier: measuredCost.multiplier,
    reasons: [...measuredCost.reasons, ...staticCost.reasons],
    p95Ms: measuredCost.p95Ms,
  };
}

const CAPTURE_CALIBRATION_TARGET_MS = 600;
const MAX_MEASURED_CAPTURE_COST_MULTIPLIER = 8;
const CAPTURE_CALIBRATION_PROTOCOL_TIMEOUT_MS = 30_000;

export function createCaptureCalibrationConfig(cfg: EngineConfig): EngineConfig {
  return {
    ...cfg,
    protocolTimeout: Math.min(cfg.protocolTimeout, CAPTURE_CALIBRATION_PROTOCOL_TIMEOUT_MS),
  };
}

export function estimateMeasuredCaptureCostMultiplier(
  samples: CaptureCalibrationSample[],
): CaptureCostEstimate {
  if (samples.length === 0) {
    return { multiplier: 1, reasons: [] };
  }

  const sorted = [...samples].sort((a, b) => a.captureTimeMs - b.captureTimeMs);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  const p95Sample = sorted[p95Index] ?? sorted[sorted.length - 1];
  if (!p95Sample) {
    return { multiplier: 1, reasons: [] };
  }
  const p95Ms = Math.round(p95Sample.captureTimeMs);
  const multiplier = Math.min(
    MAX_MEASURED_CAPTURE_COST_MULTIPLIER,
    Math.max(1, Math.round((p95Ms / CAPTURE_CALIBRATION_TARGET_MS) * 100) / 100),
  );

  return {
    multiplier,
    reasons: multiplier > 1 ? [`calibration-p95=${p95Ms}ms`] : [],
    p95Ms,
  };
}

export function selectCaptureCalibrationFrames(totalFrames: number): number[] {
  if (totalFrames <= 0) return [];
  const lastFrame = totalFrames - 1;
  const candidates = [
    0,
    Math.floor(totalFrames * 0.25),
    Math.floor(totalFrames * 0.5),
    Math.floor(totalFrames * 0.75),
    lastFrame,
  ];
  return Array.from(
    new Set(candidates.map((frame) => Math.max(0, Math.min(lastFrame, frame)))),
  ).sort((a, b) => a - b);
}

export function findMissingFrameRanges(
  totalFrames: number,
  framesDir: string,
  frameExt: "jpg" | "png",
): FrameRange[] {
  const ranges: FrameRange[] = [];
  let rangeStart: number | null = null;

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    const framePath = join(framesDir, `frame_${String(frameIndex).padStart(6, "0")}.${frameExt}`);
    const missing = !existsSync(framePath);
    if (missing && rangeStart === null) {
      rangeStart = frameIndex;
    } else if (!missing && rangeStart !== null) {
      ranges.push({ startFrame: rangeStart, endFrame: frameIndex });
      rangeStart = null;
    }
  }

  if (rangeStart !== null) {
    ranges.push({ startFrame: rangeStart, endFrame: totalFrames });
  }

  return ranges;
}

export function buildMissingFrameRetryBatches(
  ranges: FrameRange[],
  maxWorkers: number,
  workDir: string,
  attempt: number,
): WorkerTask[][] {
  const workersPerBatch = Math.max(1, Math.floor(maxWorkers));
  const batches: WorkerTask[][] = [];

  for (let i = 0; i < ranges.length; i += workersPerBatch) {
    const batchIndex = batches.length;
    const batch = ranges.slice(i, i + workersPerBatch).map((range, workerId) => ({
      workerId,
      startFrame: range.startFrame,
      endFrame: range.endFrame,
      outputDir: join(workDir, `retry-${attempt}-batch-${batchIndex}-worker-${workerId}`),
    }));
    batches.push(batch);
  }

  return batches;
}

export function getNextRetryWorkerCount(currentWorkers: number): number {
  return Math.max(1, Math.floor(currentWorkers / 2));
}

export function isRecoverableParallelCaptureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("[Parallel] Capture failed") &&
    /Runtime\.callFunctionOn timed out|HeadlessExperimental\.beginFrame timed out|Waiting failed|timeout exceeded|timed out|Navigation timeout|Protocol error|Target closed/i.test(
      message,
    )
  );
}

export function shouldFallbackToScreenshotAfterCalibrationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /HeadlessExperimental\.beginFrame timed out|beginFrame probe timeout|Another frame is pending|Frame still pending|Protocol error.*HeadlessExperimental\.beginFrame|Runtime\.callFunctionOn timed out|Runtime\.evaluate timed out/i.test(
    message,
  );
}

function countCapturedFrames(
  totalFrames: number,
  framesDir: string,
  frameExt: "jpg" | "png",
): number {
  let captured = 0;
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    const framePath = join(framesDir, `frame_${String(frameIndex).padStart(6, "0")}.${frameExt}`);
    if (existsSync(framePath)) captured++;
  }
  return captured;
}

function countFrameRanges(ranges: FrameRange[]): number {
  return ranges.reduce((sum, range) => sum + (range.endFrame - range.startFrame), 0);
}

async function measureCaptureCostFromSession(
  session: CaptureSession,
  totalFrames: number,
  fps: number,
): Promise<{ estimate: CaptureCostEstimate; samples: CaptureCalibrationSample[] }> {
  const sampledFrames = selectCaptureCalibrationFrames(totalFrames);
  const samples: CaptureCalibrationSample[] = [];

  for (const frameIndex of sampledFrames) {
    const time = frameIndex / fps;
    const startedAt = Date.now();
    const result = await captureFrameToBuffer(session, frameIndex, time);
    samples.push({
      frameIndex,
      captureTimeMs: result.captureTimeMs || Date.now() - startedAt,
    });
  }

  return {
    estimate: estimateMeasuredCaptureCostMultiplier(samples),
    samples,
  };
}

function logCaptureCalibrationResult(
  calibration: { estimate: CaptureCostEstimate; samples: CaptureCalibrationSample[] },
  log: ProducerLogger,
): void {
  if (calibration.estimate.multiplier > 1) {
    log.warn("[Render] Measured slow frame capture during auto-worker calibration.", {
      multiplier: calibration.estimate.multiplier,
      p95Ms: calibration.estimate.p95Ms,
      sampledFrames: calibration.samples.map((sample) => sample.frameIndex),
    });
  } else {
    log.debug("[Render] Auto-worker calibration kept baseline capture cost.", {
      p95Ms: calibration.estimate.p95Ms,
      sampledFrames: calibration.samples.map((sample) => sample.frameIndex),
    });
  }
}

function createFailedCaptureCalibrationEstimate(reason: string): {
  estimate: CaptureCostEstimate;
  samples: CaptureCalibrationSample[];
} {
  return {
    estimate: {
      multiplier: MAX_MEASURED_CAPTURE_COST_MULTIPLIER,
      reasons: [reason],
    },
    samples: [],
  };
}

async function executeDiskCaptureWithAdaptiveRetry(options: {
  serverUrl: string;
  workDir: string;
  framesDir: string;
  totalFrames: number;
  initialWorkerCount: number;
  allowRetry: boolean;
  frameExt: "jpg" | "png";
  captureOptions: CaptureOptions;
  createBeforeCaptureHook: () => BeforeCaptureHook | null;
  abortSignal?: AbortSignal;
  onProgress?: (progress: ParallelProgress) => void;
  cfg: EngineConfig;
  log: ProducerLogger;
}): Promise<CaptureAttemptSummary[]> {
  const attempts: CaptureAttemptSummary[] = [];
  let currentWorkers = options.initialWorkerCount;
  let missingRanges: FrameRange[] | null = null;
  let attempt = 0;

  while (true) {
    const frameCount = missingRanges ? countFrameRanges(missingRanges) : options.totalFrames;
    attempts.push({
      attempt,
      workers: currentWorkers,
      frameCount,
      reason: attempt === 0 ? "initial" : "retry",
    });

    const attemptWorkDir = join(options.workDir, `capture-attempt-${attempt}`);
    const batches = missingRanges
      ? buildMissingFrameRetryBatches(missingRanges, currentWorkers, attemptWorkDir, attempt)
      : [distributeFrames(options.totalFrames, currentWorkers, attemptWorkDir)];

    try {
      for (const tasks of batches) {
        const capturedBeforeBatch = countCapturedFrames(
          options.totalFrames,
          options.framesDir,
          options.frameExt,
        );
        try {
          await executeParallelCapture(
            options.serverUrl,
            attemptWorkDir,
            tasks,
            options.captureOptions,
            options.createBeforeCaptureHook,
            options.abortSignal,
            options.onProgress
              ? (progress) => {
                  options.onProgress?.({
                    ...progress,
                    totalFrames: options.totalFrames,
                    capturedFrames: Math.min(
                      options.totalFrames,
                      capturedBeforeBatch + progress.capturedFrames,
                    ),
                  });
                }
              : undefined,
            undefined,
            options.cfg,
          );
        } finally {
          await mergeWorkerFrames(attemptWorkDir, tasks, options.framesDir);
        }
      }

      const remaining = findMissingFrameRanges(
        options.totalFrames,
        options.framesDir,
        options.frameExt,
      );
      if (remaining.length === 0) {
        return attempts;
      }
      if (!options.allowRetry || currentWorkers <= 1) {
        throw new Error(
          `[Render] Capture completed but ${countFrameRanges(remaining)} frame(s) are missing`,
        );
      }

      const nextWorkers = getNextRetryWorkerCount(currentWorkers);
      options.log.warn("[Render] Retrying missing captured frames with fewer workers.", {
        fromWorkers: currentWorkers,
        toWorkers: nextWorkers,
        missingFrames: countFrameRanges(remaining),
      });
      currentWorkers = nextWorkers;
      missingRanges = remaining;
      attempt++;
    } catch (error) {
      const remaining = findMissingFrameRanges(
        options.totalFrames,
        options.framesDir,
        options.frameExt,
      );
      if (remaining.length === 0) {
        return attempts;
      }
      if (!options.allowRetry || currentWorkers <= 1 || !isRecoverableParallelCaptureError(error)) {
        throw error;
      }

      const nextWorkers = getNextRetryWorkerCount(currentWorkers);
      options.log.warn("[Render] Parallel capture timed out; retrying missing frames.", {
        fromWorkers: currentWorkers,
        toWorkers: nextWorkers,
        missingFrames: countFrameRanges(remaining),
        error: error instanceof Error ? error.message : String(error),
      });
      currentWorkers = nextWorkers;
      missingRanges = remaining;
      attempt++;
    }
  }
}

/**
 * Crop an rgb48le buffer to a sub-region. Returns a new Buffer containing
 * only the cropped pixels.
 */
function cropRgb48le(
  src: Buffer,
  srcW: number,
  srcH: number,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
): Buffer {
  const BPP = 6;
  const dst = Buffer.alloc(cropW * cropH * BPP);
  for (let row = 0; row < cropH; row++) {
    const srcRow = cropY + row;
    if (srcRow < 0 || srcRow >= srcH) continue;
    const srcOff = (srcRow * srcW + cropX) * BPP;
    const dstOff = row * cropW * BPP;
    const copyLen = Math.min(cropW, srcW - cropX) * BPP;
    if (copyLen > 0) src.copy(dst, dstOff, srcOff, srcOff + copyLen);
  }
  return dst;
}

/**
 * Blit a single HDR video layer onto an rgb48le canvas.
 *
 * Shared between the normal-frame compositing path (compositeToBuffer)
 * and the transition dual-scene compositing loop to avoid duplicating
 * the frame lookup, raw read, transfer, transform, and blit logic.
 */
interface HdrVideoFrameSource {
  dir: string;
  rawPath: string;
  fd: number;
  width: number;
  height: number;
  frameSize: number;
  frameCount: number;
  scratch: Buffer;
}

function closeHdrVideoFrameSource(source: HdrVideoFrameSource, log?: ProducerLogger): void {
  try {
    closeSync(source.fd);
  } catch (err) {
    log?.warn("Failed to close HDR raw frame file", {
      rawPath: source.rawPath,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function blitHdrVideoLayer(
  canvas: Buffer,
  el: ElementStackingInfo,
  time: number,
  fps: number,
  hdrVideoFrameSources: Map<string, HdrVideoFrameSource>,
  hdrStartTimes: Map<string, number>,
  width: number,
  height: number,
  log?: ProducerLogger,
  sourceTransfer?: HdrTransfer,
  targetTransfer?: HdrTransfer,
  hdrPerf?: HdrPerfCollector,
): void {
  const frameSource = hdrVideoFrameSources.get(el.id);
  const startTime = hdrStartTimes.get(el.id);
  if (!frameSource || startTime === undefined || el.opacity <= 0) {
    return;
  }

  // Frame index within the video. Clamp to the extracted raw frame count so
  // a composition that outlives the source clip freezes on the last frame,
  // matching Chrome's <video> behavior.
  const videoFrameIndex = Math.round((time - startTime) * fps) + 1;
  if (videoFrameIndex < 1) return;
  const effectiveIndex = Math.min(videoFrameIndex, frameSource.frameCount);
  if (effectiveIndex < 1) return;
  const frameOffset = (effectiveIndex - 1) * frameSource.frameSize;

  try {
    if (hdrPerf) hdrPerf.hdrVideoLayerBlits += 1;
    let timingStart = Date.now();
    const bytesRead = readSync(
      frameSource.fd,
      frameSource.scratch,
      0,
      frameSource.frameSize,
      frameOffset,
    );
    if (bytesRead !== frameSource.frameSize) return;
    const hdrRgb = frameSource.scratch;
    const srcW = frameSource.width;
    const srcH = frameSource.height;
    addHdrTiming(hdrPerf, "hdrVideoReadDecodeMs", timingStart);

    // Convert between HDR transfer functions if source doesn't match output
    if (sourceTransfer && targetTransfer && sourceTransfer !== targetTransfer) {
      timingStart = Date.now();
      convertTransfer(hdrRgb, sourceTransfer, targetTransfer);
      addHdrTiming(hdrPerf, "hdrVideoTransferMs", timingStart);
    }

    const viewportMatrix = parseTransformMatrix(el.transform);

    // Pass border-radius for rounded-corner masking (only when non-zero)
    const br = el.borderRadius;
    const hasBorderRadius = br[0] > 0 || br[1] > 0 || br[2] > 0 || br[3] > 0;
    const borderRadiusParam = hasBorderRadius ? br : undefined;

    // Apply ancestor overflow:hidden clip rect by constraining the blit
    // bounds. For the no-transform (region) path, we crop the source
    // image and adjust the destination position. For the affine path,
    // clip rect support is not yet implemented (would require per-pixel
    // scissor in the affine blit); log a warning and skip clipping.
    let blitX = el.x;
    let blitY = el.y;
    let blitSrcX = 0;
    let blitSrcY = 0;
    let blitW = srcW;
    let blitH = srcH;
    let clipped = false;

    if (el.clipRect) {
      const cr = el.clipRect;
      const cx1 = Math.max(blitX, cr.x);
      const cy1 = Math.max(blitY, cr.y);
      const cx2 = Math.min(blitX + blitW, cr.x + cr.width);
      const cy2 = Math.min(blitY + blitH, cr.y + cr.height);
      if (cx2 <= cx1 || cy2 <= cy1) return; // fully clipped
      blitSrcX = cx1 - blitX;
      blitSrcY = cy1 - blitY;
      blitW = cx2 - cx1;
      blitH = cy2 - cy1;
      blitX = cx1;
      blitY = cy1;
      clipped = true;
    }

    // Detect translation-only matrix (no scale/rotation) — route through the
    // region path which supports clip rects. Chrome reports a viewport matrix
    // for all HDR elements, even untransformed ones or those with only layout
    // translation (e.g. `left: 960px` → `matrix(1,0,0,1,960,0)`). The region
    // blit handles translation via el.x/el.y, so we only need the affine path
    // for actual scale/rotation transforms.
    // parseTransformMatrix returns a 6-element array or null — length check unnecessary.
    const isTranslationOnly = !!(
      viewportMatrix &&
      Math.abs(viewportMatrix[0]! - 1) < 0.001 &&
      Math.abs(viewportMatrix[1]!) < 0.001 &&
      Math.abs(viewportMatrix[2]!) < 0.001 &&
      Math.abs(viewportMatrix[3]! - 1) < 0.001
    );

    timingStart = Date.now();
    if (viewportMatrix && !isTranslationOnly) {
      if (clipped && log) {
        log.debug(
          `HDR clip rect on affine-transformed element ${el.id} — clip not applied (affine scissor not yet supported)`,
        );
      }
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
    } else if (clipped) {
      // Crop the source buffer to the clipped region before blitting
      const croppedBuf = cropRgb48le(hdrRgb, srcW, srcH, blitSrcX, blitSrcY, blitW, blitH);
      blitRgb48leRegion(
        canvas,
        croppedBuf,
        blitX,
        blitY,
        blitW,
        blitH,
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
        srcW,
        srcH,
        width,
        height,
        el.opacity < 0.999 ? el.opacity : undefined,
        borderRadiusParam,
      );
    }
    addHdrTiming(hdrPerf, "hdrVideoBlitMs", timingStart);
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
  hdrImageTransferCache: HdrImageTransferCache,
  width: number,
  height: number,
  log?: ProducerLogger,
  sourceTransfer?: HdrTransfer,
  targetTransfer?: HdrTransfer,
  hdrPerf?: HdrPerfCollector,
): void {
  const buf = hdrImageBuffers.get(el.id);
  if (!buf || el.opacity <= 0) {
    return;
  }
  if (el.clipRect && log) {
    log.debug(`HDR clip rect on image element ${el.id} — clip not yet supported for images`);
  }

  try {
    if (hdrPerf) hdrPerf.hdrImageLayerBlits += 1;
    // The cache returns `buf.data` unchanged when no conversion is needed,
    // and otherwise returns a per-(imageId, targetTransfer) buffer that was
    // converted exactly once and reused across every subsequent frame.
    let timingStart = Date.now();
    const hdrRgb =
      sourceTransfer && targetTransfer
        ? hdrImageTransferCache.getConverted(el.id, sourceTransfer, targetTransfer, buf.data)
        : buf.data;
    addHdrTiming(hdrPerf, "hdrImageTransferMs", timingStart);

    const viewportMatrix = parseTransformMatrix(el.transform);

    const br = el.borderRadius;
    const hasBorderRadius = br[0] > 0 || br[1] > 0 || br[2] > 0 || br[3] > 0;
    const borderRadiusParam = hasBorderRadius ? br : undefined;

    timingStart = Date.now();
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
    addHdrTiming(hdrPerf, "hdrImageBlitMs", timingStart);
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
  hdrImageTransferCache: HdrImageTransferCache;
  hdrVideoFrameSources: Map<string, HdrVideoFrameSource>;
  hdrVideoStartTimes: Map<string, number>;
  imageTransfers: Map<string, HdrTransfer>;
  videoTransfers: Map<string, HdrTransfer>;
  debugDumpEnabled: boolean;
  debugDumpDir: string | null;
  hdrPerf?: HdrPerfCollector;
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
    hdrImageTransferCache,
    hdrVideoFrameSources,
    hdrVideoStartTimes,
    imageTransfers,
    videoTransfers,
    debugDumpEnabled,
    debugDumpDir,
    hdrPerf,
  } = ctx;

  const filteredStacking = elementFilter
    ? fullStacking.filter((e) => elementFilter.has(e.id))
    : fullStacking;

  // Zero-opacity elements stay in the stacking for correct hide-list
  // generation (their <img> replacements must be hidden from sibling
  // screenshots). The actual blit is skipped in the compositing loop below.
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
      // Skip zero-opacity HDR elements — their parent scene may have faded out.
      if (layer.element.opacity <= 0) continue;
      const before = shouldLog ? countNonZeroRgb48(canvas) : 0;
      const isHdrImage = nativeHdrImageIds.has(layer.element.id);
      if (isHdrImage) {
        blitHdrImageLayer(
          canvas,
          layer.element,
          hdrImageBuffers,
          hdrImageTransferCache,
          width,
          height,
          log,
          imageTransfers.get(layer.element.id),
          effectiveHdr.transfer,
          hdrPerf,
        );
      } else {
        blitHdrVideoLayer(
          canvas,
          layer.element,
          time,
          fps,
          hdrVideoFrameSources,
          hdrVideoStartTimes,
          width,
          height,
          log,
          videoTransfers.get(layer.element.id),
          effectiveHdr.transfer,
          hdrPerf,
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
          const frameSource = hdrVideoFrameSources.get(layer.element.id);
          const startTime = hdrVideoStartTimes.get(layer.element.id) ?? 0;
          const localTime = time - startTime;
          const frameNum = Math.floor(localTime * fps) + 1;
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
            rawPath: frameSource?.rawPath ?? null,
            frameCount: frameSource?.frameCount ?? null,
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
      if (hdrPerf) hdrPerf.domLayerCaptures += 1;

      // 1. Seek GSAP to restore all animated properties from clean state
      let timingStart = Date.now();
      await domSession.page.evaluate((t: number) => {
        if (window.__hf && typeof window.__hf.seek === "function") window.__hf.seek(t);
      }, time);
      addHdrTiming(hdrPerf, "domLayerSeekMs", timingStart);

      // 2. Run frame injector to set correct SDR video visibility
      if (beforeCaptureHook) {
        timingStart = Date.now();
        await beforeCaptureHook(domSession.page, time);
        addHdrTiming(hdrPerf, "domLayerInjectMs", timingStart);
      }

      // 3. Install the mask (mass-hide stylesheet + inline-hide non-layer ids)
      timingStart = Date.now();
      await applyDomLayerMask(domSession.page, layer.elementIds, hideIds);
      addHdrTiming(hdrPerf, "domMaskApplyMs", timingStart);

      // 4. Screenshot
      timingStart = Date.now();
      const domPng = await captureAlphaPng(domSession.page, width, height);
      addHdrTiming(hdrPerf, "domScreenshotMs", timingStart);

      // 5. Tear down the mask
      timingStart = Date.now();
      await removeDomLayerMask(domSession.page, hideIds);
      addHdrTiming(hdrPerf, "domMaskRemoveMs", timingStart);

      try {
        timingStart = Date.now();
        const { data: domRgba } = decodePng(domPng);
        addHdrTiming(hdrPerf, "domPngDecodeMs", timingStart);
        const before = shouldLog ? countNonZeroRgb48(canvas) : 0;
        const alphaPixels = shouldLog ? countNonZeroAlpha(domRgba) : 0;
        timingStart = Date.now();
        blitRgba8OverRgb48le(domRgba, canvas, width, height, effectiveHdr.transfer);
        addHdrTiming(hdrPerf, "domBlitMs", timingStart);
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

function createStandaloneEntryRenderClone(root: Element, host: Element): Element {
  const hostClone = host.cloneNode(true) as Element;
  hostClone.setAttribute("data-start", "0");

  if (root === host) return hostClone;

  const rootClone = root.cloneNode(false) as Element;
  rootClone.appendChild(hostClone);
  return rootClone;
}

function replaceBodyWithRenderClone(body: HTMLElement, renderClone: Element): void {
  while (body.firstChild) {
    body.removeChild(body.firstChild);
  }
  body.appendChild(renderClone);
}

export function shouldUseStreamingEncode(
  cfg: Pick<EngineConfig, "enableStreamingEncode" | "streamingEncodeMaxDurationSeconds">,
  outputFormat: NonNullable<RenderConfig["format"]>,
  workerCount: number,
  // Composition timeline duration in seconds.
  durationSeconds: number,
): boolean {
  if (!cfg.enableStreamingEncode) return false;
  if (outputFormat === "png-sequence") return false;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
  if (durationSeconds > cfg.streamingEncodeMaxDurationSeconds) return false;
  return workerCount === 1;
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

  const renderClone = createStandaloneEntryRenderClone(root, host);
  replaceBodyWithRenderClone(body, renderClone);

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
  let hdrPerf: HdrPerfCollector | undefined;
  const perfOutputPath = join(workDir, "perf-summary.json");
  const cfg = { ...(job.config.producerConfig ?? resolveConfig()) };
  const outputFormat = (job.config.format ?? "mp4") as NonNullable<RenderConfig["format"]>;
  const isWebm = outputFormat === "webm";
  const isMov = outputFormat === "mov";
  const isPngSequence = outputFormat === "png-sequence";
  const needsAlpha = isWebm || isMov || isPngSequence;
  // Transparency requires screenshot mode — beginFrame doesn't support alpha channel
  if (needsAlpha) {
    cfg.forceScreenshot = true;
  }
  const enableChunkedEncode = cfg.enableChunkedEncode;
  const chunkedEncodeSize = cfg.chunkSizeFrames;
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
                const projectedEnd = projectBrowserEndToCompositionTimeline(
                  existing.start,
                  el.start,
                  el.end,
                );
                if (
                  projectedEnd > 0 &&
                  (existing.end <= 0 ||
                    Math.abs(existing.end - projectedEnd) > BROWSER_MEDIA_EPSILON)
                ) {
                  existing.end = projectedEnd;
                }
                if (
                  el.mediaStart > 0 &&
                  (existing.mediaStart <= 0 ||
                    Math.abs(existing.mediaStart - el.mediaStart) > BROWSER_MEDIA_EPSILON)
                ) {
                  existing.mediaStart = el.mediaStart;
                }
                if (el.hasAudio && !existing.hasAudio) {
                  existing.hasAudio = true;
                }
                if (el.loop && !existing.loop) {
                  existing.loop = true;
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
                loop: el.loop,
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
                const projectedEnd = projectBrowserEndToCompositionTimeline(
                  existing.start,
                  el.start,
                  el.end,
                );
                if (
                  projectedEnd > 0 &&
                  (existing.end <= 0 ||
                    Math.abs(existing.end - projectedEnd) > BROWSER_MEDIA_EPSILON)
                ) {
                  existing.end = projectedEnd;
                }
                if (
                  el.mediaStart > 0 &&
                  (existing.mediaStart <= 0 ||
                    Math.abs(existing.mediaStart - el.mediaStart) > BROWSER_MEDIA_EPSILON)
                ) {
                  existing.mediaStart = el.mediaStart;
                }
                if (
                  el.volume > 0 &&
                  Math.abs((existing.volume ?? 1) - el.volume) > BROWSER_MEDIA_EPSILON
                ) {
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
    let videoReadinessSkipIds: string[] = [];
    let videoMetadataHints: CaptureVideoMetadataHint[] = [];

    // Probe ORIGINAL color spaces before extraction (which may convert SDR→HDR).
    // This is needed to identify which videos are natively HDR vs converted-SDR
    // for the two-pass compositing path. Skipped only in force-sdr mode to
    // avoid ffprobe overhead when the user has explicitly opted out.
    const nativeHdrVideoIds = new Set<string>();
    const videoTransfers = new Map<string, HdrTransfer>();
    if (job.config.hdrMode !== "force-sdr" && composition.videos.length > 0) {
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
      extractionResult = await extractAllVideoFrames(
        composition.videos,
        projectDir,
        { fps: job.config.fps, outputDir: join(compiledDir, "__hyperframes_video_frames") },
        abortSignal,
        { extractCacheDir: cfg.extractCacheDir },
        compiledDir,
      );
      assertNotAborted();

      materializeExtractedFramesForCompiledDir(extractionResult.extracted, compiledDir);

      if (extractionResult.extracted.length > 0) {
        frameLookup = createFrameLookupTable(composition.videos, extractionResult.extracted);
      }
      videoReadinessSkipIds = collectVideoReadinessSkipIds(
        nativeHdrVideoIds,
        extractionResult.extracted,
      );
      videoMetadataHints = collectVideoMetadataHints(extractionResult.extracted);
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
    // Analyze probed video AND image color spaces. In auto mode, any HDR
    // source enables HDR output. force-hdr always enables HDR, and force-sdr
    // always disables it. Image-only compositions can trigger HDR output
    // without any video.
    let effectiveHdr: { transfer: HdrTransfer } | undefined;
    let forcedHdrWithoutSources = false;
    {
      const hdrMode = job.config.hdrMode ?? "auto";
      const videoColorSpaces = (extractionResult?.extracted ?? []).map(
        (ext) => ext.metadata.colorSpace,
      );
      const allColorSpaces = [...videoColorSpaces, ...imageColorSpaces];
      const info = allColorSpaces.length > 0 ? analyzeCompositionHdr(allColorSpaces) : null;

      if (hdrMode === "force-sdr") {
        effectiveHdr = undefined;
      } else if (hdrMode === "force-hdr") {
        if (info?.hasHdr && info.dominantTransfer) {
          effectiveHdr = { transfer: info.dominantTransfer };
        } else {
          effectiveHdr = { transfer: "hlg" };
          forcedHdrWithoutSources = true;
        }
      } else {
        if (info?.hasHdr && info.dominantTransfer) {
          effectiveHdr = { transfer: info.dominantTransfer };
        }
      }
    }
    if (effectiveHdr && outputFormat !== "mp4") {
      const hdrSourceReason = forcedHdrWithoutSources
        ? "HDR was forced without detected HDR sources"
        : "HDR source detected";
      log.warn(
        `[Render] ${hdrSourceReason}, but format is "${outputFormat}" — falling back to SDR. ` +
          `HDR + alpha is not supported. Use --format mp4 for HDR10 output.`,
      );
      effectiveHdr = undefined;
    }
    {
      const hdrMode = job.config.hdrMode ?? "auto";
      if (forcedHdrWithoutSources) {
        log.warn(
          "[Render] HDR forced by --hdr flag, but no HDR sources were detected — defaulting to HLG. SDR-only compositions may look perceptually wrong on HDR displays.",
        );
      }
      if (effectiveHdr) {
        const reason =
          hdrMode === "force-hdr"
            ? forcedHdrWithoutSources
              ? "forced by --hdr flag (no HDR sources detected — defaulting to HLG)"
              : "forced by --hdr flag"
            : "auto-detected from source(s)";
        log.info(
          `[Render] HDR ${reason} — output: ${effectiveHdr.transfer.toUpperCase()} (BT.2020, 10-bit H.265)`,
        );
      } else if (hdrMode === "force-sdr") {
        log.info("[Render] SDR forced by --sdr flag");
      } else {
        log.info("[Render] No HDR sources detected — rendering SDR");
      }
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

    // Capture sessions do not need native browser metadata for videos whose
    // pixels come from out-of-band FFmpeg frame extraction. Waiting on those
    // `<video>` elements lets browser decode/cache quirks block renders even
    // though the browser never supplies their pixels. We still pass FFmpeg
    // dimensions as metadata hints so CSS layouts that depend on intrinsic
    // aspect ratio stay stable before the first injected frame. Native HDR
    // videos are included for the same reason: Chrome may not decode them at
    // all, while the renderer composites their extracted frames separately.
    const buildCaptureOptions = (): CaptureOptions => ({
      ...captureOptions,
      videoMetadataHints,
      skipReadinessVideoIds: videoReadinessSkipIds,
    });
    const frameSrcResolver = createCompiledFrameSrcResolver(compiledDir);
    const createRenderVideoFrameInjector = (): BeforeCaptureHook | null =>
      createVideoFrameInjector(frameLookup, {
        frameDataUriCacheLimit: cfg.frameDataUriCacheLimit,
        frameSrcResolver,
      });

    let captureCalibration:
      | {
          estimate: CaptureCostEstimate;
          samples: CaptureCalibrationSample[];
        }
      | undefined;

    if (job.config.workers === undefined && totalFrames >= 60) {
      const calibrationDir = join(workDir, "capture-calibration");
      const calibrationCfg = createCaptureCalibrationConfig(cfg);
      const videoInjector = createRenderVideoFrameInjector();
      let calibrationSession: CaptureSession | null = null;
      try {
        calibrationSession = await createCaptureSession(
          fileServer.url,
          calibrationDir,
          buildCaptureOptions(),
          videoInjector,
          calibrationCfg,
        );
        if (!calibrationSession.isInitialized) {
          await initializeSession(calibrationSession);
        }
        assertNotAborted();

        captureCalibration = await measureCaptureCostFromSession(
          calibrationSession,
          totalFrames,
          job.config.fps,
        );
        logCaptureCalibrationResult(captureCalibration, log);
      } catch (error) {
        const shouldFallbackToScreenshot =
          !cfg.forceScreenshot && shouldFallbackToScreenshotAfterCalibrationError(error);
        if (shouldFallbackToScreenshot) {
          cfg.forceScreenshot = true;
          if (probeSession) {
            lastBrowserConsole = probeSession.browserConsoleBuffer;
            await closeCaptureSession(probeSession).catch(() => {});
            probeSession = null;
          }
          if (calibrationSession) {
            lastBrowserConsole = calibrationSession.browserConsoleBuffer;
            await closeCaptureSession(calibrationSession).catch(() => {});
            calibrationSession = null;
          }

          log.warn(
            "[Render] BeginFrame auto-worker calibration timed out; retrying calibration in screenshot capture mode.",
            {
              protocolTimeout: calibrationCfg.protocolTimeout,
              error: error instanceof Error ? error.message : String(error),
            },
          );

          const screenshotCalibrationCfg = createCaptureCalibrationConfig(cfg);
          try {
            calibrationSession = await createCaptureSession(
              fileServer.url,
              join(workDir, "capture-calibration-screenshot"),
              buildCaptureOptions(),
              createRenderVideoFrameInjector(),
              screenshotCalibrationCfg,
            );
            if (!calibrationSession.isInitialized) {
              await initializeSession(calibrationSession);
            }
            assertNotAborted();

            captureCalibration = await measureCaptureCostFromSession(
              calibrationSession,
              totalFrames,
              job.config.fps,
            );
            logCaptureCalibrationResult(captureCalibration, log);
          } catch (fallbackError) {
            captureCalibration = createFailedCaptureCalibrationEstimate(
              "calibration-screenshot-failed",
            );
            log.warn(
              "[Render] Screenshot auto-worker calibration failed after BeginFrame fallback; using conservative worker budget.",
              {
                protocolTimeout: screenshotCalibrationCfg.protocolTimeout,
                error:
                  fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
              },
            );
          }
        } else {
          captureCalibration = createFailedCaptureCalibrationEstimate("calibration-failed");
          log.warn("[Render] Auto-worker calibration failed; using conservative worker budget.", {
            protocolTimeout: calibrationCfg.protocolTimeout,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (calibrationSession) {
          lastBrowserConsole = calibrationSession.browserConsoleBuffer;
          await closeCaptureSession(calibrationSession).catch(() => {});
        }
      }
    }

    let workerCount = resolveRenderWorkerCount(
      totalFrames,
      job.config.workers,
      cfg,
      compiled,
      log,
      captureCalibration?.estimate,
    );

    if (workerCount > 1 && probeSession) {
      lastBrowserConsole = probeSession.browserConsoleBuffer;
      await closeCaptureSession(probeSession);
      probeSession = null;
    }

    // Streaming encode pipes captured frames through ffmpeg's stdin to produce
    // a single video file. Keep the default enabled for sequential capture, but
    // let auto-parallel renders use disk frames: the current ordered streaming
    // writer would otherwise stall later workers behind earlier frame ranges.
    // png-sequence has no encoded video output, so streaming is always bypassed.
    let useStreamingEncode = shouldUseStreamingEncode(cfg, outputFormat, workerCount, job.duration);
    log.info("streaming-encode gate", {
      enabled: useStreamingEncode,
      configFlag: cfg.enableStreamingEncode,
      outputFormat,
      workerCount,
      durationSeconds: job.duration,
      maxDurationSeconds: cfg.streamingEncodeMaxDurationSeconds,
    });

    const captureAttempts: CaptureAttemptSummary[] = [];

    // png-sequence is "no container" — outputPath is treated as a directory and
    // the encode/mux/faststart stages are skipped entirely. The empty extension
    // keeps `videoOnlyPath` (which is constructed below) sensible even though
    // it will not be written.
    const FORMAT_EXT: Record<string, string> = {
      mp4: ".mp4",
      webm: ".webm",
      mov: ".mov",
      "png-sequence": "",
    };
    const videoExt = FORMAT_EXT[outputFormat] ?? ".mp4";
    const videoOnlyPath = join(workDir, `video-only${videoExt}`);
    // Only use the HDR encoder preset when there's HDR content to pass through —
    // either native HDR videos OR native HDR images. For SDR-only compositions,
    // auto mode stays SDR since H.265 10-bit causes browser color management
    // issues (orange shift) with no quality benefit.
    const nativeHdrIds = new Set([...nativeHdrVideoIds, ...nativeHdrImageIds]);
    const hasHdrContent = effectiveHdr && nativeHdrIds.size > 0;
    const encoderHdr = hasHdrContent ? effectiveHdr : undefined;
    // png-sequence has no encoder, but the rest of the orchestrator still
    // reads `preset.quality` for `effectiveQuality` and `preset.codec` for
    // unrelated bookkeeping. Fall back to the mp4 preset shape — its values
    // are never written to ffmpeg in the png-sequence path.
    const presetFormat: "mp4" | "webm" | "mov" = isPngSequence ? "mp4" : outputFormat;
    const preset = getEncoderPreset(job.config.quality, presetFormat, encoderHdr);

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
      hdrPerf = createHdrPerfCollector();

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
        buildCaptureOptions(),
        createRenderVideoFrameInjector(),
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
      // Open raw HDR frame files at this scope so cleanup can close descriptors
      // on both success and early failure paths.
      const hdrVideoFrameSources = new Map<string, HdrVideoFrameSource>();
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
        // Use raw rgb48le instead of PNG sequences so the hot loop can read a
        // fixed byte range per frame and skip PNG decode entirely.
        for (const [videoId, srcPath] of hdrVideoSrcPaths) {
          const video = composition.videos.find((v) => v.id === videoId);
          if (!video) continue;
          const frameDir = join(framesDir, `hdr_${videoId}`);
          mkdirSync(frameDir, { recursive: true });
          const duration = video.end - video.start;
          const dims = hdrExtractionDims.get(videoId) ?? { width, height };
          const rawPath = join(frameDir, "frames.rgb48le");
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
          const frameCount = Math.floor(statSync(rawPath).size / frameSize);
          if (frameCount < 1) {
            hdrDiagnostics.videoExtractionFailures += 1;
            throw new Error(
              `HDR frame extraction produced no frames for video "${videoId}". ` +
                `Aborting render to avoid shipping black HDR layers.`,
            );
          }
          hdrVideoFrameSources.set(videoId, {
            dir: frameDir,
            rawPath,
            fd: openSync(rawPath, "r"),
            width: dims.width,
            height: dims.height,
            frameSize,
            frameCount,
            scratch: Buffer.allocUnsafe(frameSize),
          });
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

          // Track which HDR video raw frame sources have been cleaned up.
          // Once a video's last frame has been used (time > video.end), its
          // extraction directory is deleted to free disk space. This prevents
          // disk exhaustion on compositions with many HDR videos.
          const cleanedUpVideos = new Set<string>();
          // Build a map of video end times for quick lookup
          const hdrVideoEndTimes = new Map<string, number>();
          for (const v of composition.videos) {
            if (hdrVideoFrameSources.has(v.id)) {
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
          // Per-job LRU cache for transfer-converted HDR image buffers. Static HDR
          // images that need PQ↔HLG conversion are converted exactly once per
          // (imageId, targetTransfer) and then reused for every subsequent frame
          // instead of paying a fresh `Buffer.from` + `convertTransfer` on every
          // composite. The cache is local to this render job so concurrent renders
          // do not share state.
          const hdrCacheMaxBytes = process.env.HDR_TRANSFER_CACHE_MAX_BYTES
            ? Number(process.env.HDR_TRANSFER_CACHE_MAX_BYTES)
            : undefined;
          const hdrImageTransferCache = createHdrImageTransferCache(
            hdrCacheMaxBytes !== undefined ? { maxBytes: hdrCacheMaxBytes } : {},
          );
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
            hdrImageTransferCache,
            hdrVideoFrameSources,
            hdrVideoStartTimes,
            imageTransfers,
            videoTransfers,
            debugDumpEnabled,
            debugDumpDir,
            hdrPerf,
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
            if (hdrPerf) hdrPerf.frames += 1;

            // Seek timeline
            let timingStart = Date.now();
            await domSession.page.evaluate((t: number) => {
              if (window.__hf && typeof window.__hf.seek === "function") window.__hf.seek(t);
            }, time);
            addHdrTiming(hdrPerf, "frameSeekMs", timingStart);

            // Inject SDR video frames into the DOM
            if (beforeCaptureHook) {
              timingStart = Date.now();
              await beforeCaptureHook(domSession.page, time);
              addHdrTiming(hdrPerf, "frameInjectMs", timingStart);
            }

            // Query ALL timed elements for z-order analysis
            timingStart = Date.now();
            const stackingInfo = await queryElementStacking(domSession.page, nativeHdrIds);
            addHdrTiming(hdrPerf, "stackingQueryMs", timingStart);

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
              if (hdrPerf) hdrPerf.transitionFrames += 1;
              const transitionTimingStart = Date.now();
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
              timingStart = Date.now();
              transBufferA.fill(0);
              transBufferB.fill(0);
              addHdrTiming(hdrPerf, "canvasClearMs", timingStart);

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
                timingStart = Date.now();
                await domSession.page.evaluate((t: number) => {
                  if (window.__hf && typeof window.__hf.seek === "function") window.__hf.seek(t);
                }, time);
                addHdrTiming(hdrPerf, "domLayerSeekMs", timingStart);
                if (beforeCaptureHook) {
                  timingStart = Date.now();
                  await beforeCaptureHook(domSession.page, time);
                  addHdrTiming(hdrPerf, "domLayerInjectMs", timingStart);
                }

                // Blit all HDR videos/images for this scene
                for (const el of stackingInfo) {
                  if (!el.isHdr || !sceneIds.has(el.id)) continue;
                  if (nativeHdrImageIds.has(el.id)) {
                    blitHdrImageLayer(
                      sceneBuf as Buffer,
                      el,
                      hdrImageBuffers,
                      hdrImageTransferCache,
                      width,
                      height,
                      log,
                      imageTransfers.get(el.id),
                      effectiveHdr?.transfer,
                      hdrPerf,
                    );
                  } else {
                    blitHdrVideoLayer(
                      sceneBuf as Buffer,
                      el,
                      time,
                      job.config.fps,
                      hdrVideoFrameSources,
                      hdrVideoStartTimes,
                      width,
                      height,
                      log,
                      videoTransfers.get(el.id),
                      effectiveHdr?.transfer,
                      hdrPerf,
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
                if (hdrPerf) hdrPerf.domLayerCaptures += 1;
                timingStart = Date.now();
                await applyDomLayerMask(domSession.page, showIds, hideIds);
                addHdrTiming(hdrPerf, "domMaskApplyMs", timingStart);
                timingStart = Date.now();
                const domPng = await captureAlphaPng(domSession.page, width, height);
                addHdrTiming(hdrPerf, "domScreenshotMs", timingStart);
                timingStart = Date.now();
                await removeDomLayerMask(domSession.page, hideIds);
                addHdrTiming(hdrPerf, "domMaskRemoveMs", timingStart);

                try {
                  timingStart = Date.now();
                  const { data: domRgba } = decodePng(domPng);
                  addHdrTiming(hdrPerf, "domPngDecodeMs", timingStart);
                  // Invariant: `hasHdrVideo` requires `effectiveHdr` to be set (see line ~919).
                  if (!effectiveHdr) {
                    throw new Error(
                      "Invariant violation: effectiveHdr is undefined inside hasHdrVideo branch",
                    );
                  }
                  timingStart = Date.now();
                  blitRgba8OverRgb48le(
                    domRgba,
                    sceneBuf as Buffer,
                    width,
                    height,
                    effectiveHdr.transfer,
                  );
                  addHdrTiming(hdrPerf, "domBlitMs", timingStart);
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
              addHdrTiming(hdrPerf, "transitionCompositeMs", transitionTimingStart);

              timingStart = Date.now();
              hdrEncoder.writeFrame(transOutput);
              addHdrTiming(hdrPerf, "encoderWriteMs", timingStart);
            } else {
              if (hdrPerf) hdrPerf.normalFrames += 1;
              // ── Normal frame: full layer composite (no transition) ─────────
              timingStart = Date.now();
              normalCanvas.fill(0);
              addHdrTiming(hdrPerf, "canvasClearMs", timingStart);
              timingStart = Date.now();
              await compositeHdrFrame(
                hdrCompositeCtx,
                normalCanvas,
                time,
                stackingInfo,
                undefined,
                i,
              );
              addHdrTiming(hdrPerf, "normalCompositeMs", timingStart);
              if (debugDumpEnabled && debugDumpDir && i % 30 === 0) {
                const previewPath = join(
                  debugDumpDir,
                  `frame_${String(i).padStart(4, "0")}_final_rgb48le.bin`,
                );
                writeFileSync(previewPath, normalCanvas);
              }
              timingStart = Date.now();
              hdrEncoder.writeFrame(normalCanvas);
              addHdrTiming(hdrPerf, "encoderWriteMs", timingStart);
            }

            // Clean up HDR raw frame sources for videos that have ended.
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
                    const frameSource = hdrVideoFrameSources.get(videoId);
                    if (frameSource) {
                      closeHdrVideoFrameSource(frameSource, log);
                      try {
                        rmSync(frameSource.dir, { recursive: true, force: true });
                      } catch (err) {
                        log.warn("Failed to clean up HDR raw frame directory", {
                          videoId,
                          frameDir: frameSource.dir,
                          rawPath: frameSource.rawPath,
                          error: err instanceof Error ? err.message : String(err),
                        });
                      }
                      hdrVideoFrameSources.delete(videoId);
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
        // Close any raw frame files that survived in-loop cleanup (early
        // failures, KEEP_TEMP=1, videos still active when the render exits).
        // The on-disk frames themselves are torn down with workDir.
        for (const frameSource of hdrVideoFrameSources.values()) {
          closeHdrVideoFrameSource(frameSource, log);
        }
        hdrVideoFrameSources.clear();
      }
    } else // ── Standard capture paths (SDR or DOM-only HDR) ──────────────────
    // Streaming encode mode: pipe frame buffers directly to FFmpeg stdin,
    // skipping disk writes and the separate Stage 5 encode step.
    {
      let streamingEncoder: StreamingEncoder | null = null;
      let streamingEncoderClosed = false;

      if (useStreamingEncode) {
        try {
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
        } catch (err) {
          if (abortSignal?.aborted) {
            if (streamingEncoder && !streamingEncoderClosed) {
              await streamingEncoder.close().catch(() => {});
              streamingEncoderClosed = true;
            }
            throw err;
          }
          useStreamingEncode = false;
          streamingEncoder = null;
          log.warn("[Render] Streaming encoder spawn failed; falling back to disk-frame encode.", {
            error: err instanceof Error ? err.message : String(err),
            outputFormat,
            workerCount,
            durationSeconds: job.duration,
          });
        }
      }

      try {
        if (useStreamingEncode && streamingEncoder) {
          // ── Streaming capture + encode (Stage 4 absorbs Stage 5) ──────────
          // Streaming encode is locked in here; capture retries may shrink
          // workerCount later, but must not grow a streaming render past one worker.
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
              buildCaptureOptions(),
              createRenderVideoFrameInjector,
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

            const videoInjector = createRenderVideoFrameInjector();
            const session =
              probeSession ??
              (await createCaptureSession(
                fileServer.url,
                framesDir,
                buildCaptureOptions(),
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
            const attempts = await executeDiskCaptureWithAdaptiveRetry({
              serverUrl: fileServer.url,
              workDir,
              framesDir,
              totalFrames: job.totalFrames,
              initialWorkerCount: workerCount,
              allowRetry: job.config.workers === undefined,
              frameExt: needsAlpha ? "png" : "jpg",
              captureOptions: buildCaptureOptions(),
              createBeforeCaptureHook: createRenderVideoFrameInjector,
              abortSignal,
              onProgress: (progress) => {
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
                    `Capturing frame ${progress.capturedFrames}/${progress.totalFrames} (${progress.activeWorkers} workers)`,
                    Math.round(progressPct),
                    onProgress,
                  );
                }
              },
              cfg,
              log,
            });
            captureAttempts.push(...attempts);
            const lastAttempt = attempts[attempts.length - 1];
            if (lastAttempt) {
              workerCount = lastAttempt.workers;
            }
            if (probeSession) {
              lastBrowserConsole = probeSession.browserConsoleBuffer;
              await closeCaptureSession(probeSession);
              probeSession = null;
            }
          } else {
            // Sequential capture

            const videoInjector = createRenderVideoFrameInjector();
            const session =
              probeSession ??
              (await createCaptureSession(
                fileServer.url,
                framesDir,
                buildCaptureOptions(),
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

          if (isPngSequence) {
            // ── Stage 5 (png-sequence): copy captured PNGs to outputDir ──────
            // No encoder, no mux, no faststart — captured frames already carry
            // alpha and are the deliverable. We rename to `frame_NNNNNN.png`
            // (zero-padded) so consumers (After Effects, Nuke, Fusion, ffmpeg
            // image2 demuxer) can globbed-import without surprises.
            const stage5Start = Date.now();
            updateJobStatus(job, "encoding", "Writing PNG sequence", 75, onProgress);
            if (!existsSync(outputPath)) mkdirSync(outputPath, { recursive: true });
            const captured = readdirSync(framesDir)
              .filter((name) => name.endsWith(".png"))
              .sort();
            if (captured.length === 0) {
              throw new Error(
                `[Render] png-sequence output requested but no PNGs were captured to ${framesDir}`,
              );
            }
            captured.forEach((name, i) => {
              const dst = join(outputPath, `frame_${String(i + 1).padStart(6, "0")}.png`);
              copyFileSync(join(framesDir, name), dst);
            });
            if (hasAudio && existsSync(audioOutputPath)) {
              // Sidecar audio for callers that need to re-mux later. png-sequence
              // has no container of its own, so this is the only place audio
              // can land alongside the frames.
              copyFileSync(audioOutputPath, join(outputPath, "audio.aac"));
              log.info(
                `[Render] png-sequence: audio.aac sidecar written to ${outputPath}/audio.aac`,
              );
            }
            perfStages.encodeMs = Date.now() - stage5Start;
          } else {
            // ── Stage 5: Encode ───────────────────────────────────────────────
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
    // Skipped for png-sequence — there is no encoded video to mux/faststart.
    // The frames were copied directly to outputPath in Stage 5.
    if (!isPngSequence) {
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
    }

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
      captureCalibration: captureCalibration
        ? {
            sampledFrames: captureCalibration.samples.map((sample) => sample.frameIndex),
            p95Ms: captureCalibration.estimate.p95Ms,
            multiplier: captureCalibration.estimate.multiplier,
            reasons: captureCalibration.estimate.reasons,
          }
        : undefined,
      captureAttempts: captureAttempts.length > 0 ? captureAttempts : undefined,
      hdrDiagnostics:
        hdrDiagnostics.videoExtractionFailures > 0 || hdrDiagnostics.imageDecodeFailures > 0
          ? { ...hdrDiagnostics }
          : undefined,
      hdrPerf: hdrPerf ? finalizeHdrPerf(hdrPerf) : undefined,
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
      // Copy output MP4 (or single-file alpha output) into the debug dir for
      // easy access. Skipped for png-sequence: outputPath is a directory, not
      // a single file — the captured frames already live in `framesDir` under
      // workDir during a debug run anyway.
      if (!isPngSequence && existsSync(outputPath)) {
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
