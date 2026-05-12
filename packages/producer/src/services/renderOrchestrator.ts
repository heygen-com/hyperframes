/**
 * Render Orchestrator Service
 *
 * `executeRenderJob` is the in-process entry point that composes the
 * pipeline's six stages. Each stage lives in its own module under
 * `./render/stages/` so the pure-function primitives can be reused by
 * the distributed render path without dragging the orchestrator's
 * cleanup and observability scaffolding with them.
 *
 *   Stage 1  compile         → services/render/stages/compileStage.ts
 *   Stage 1b probe           → services/render/stages/probeStage.ts
 *            (browser-driven duration discovery + media reconciliation;
 *            grouped with Stage 1 in the perf summary)
 *   Stage 2  extract videos  → services/render/stages/extractVideosStage.ts
 *   Stage 3  audio           → services/render/stages/audioStage.ts
 *   Stage 4  capture         → services/render/stages/captureStage.ts
 *                              services/render/stages/captureStreamingStage.ts
 *                              services/render/stages/captureHdrStage.ts
 *   Stage 5  encode          → services/render/stages/encodeStage.ts
 *   Stage 6  assemble        → services/render/stages/assembleStage.ts
 *
 * Resources spawned by stages (file server, capture sessions, streaming
 * encoders, raw HDR frame files) are tracked in the orchestrator's
 * `try/finally` so a stage throwing mid-pipeline doesn't leak Chrome
 * processes or ffmpeg subprocesses.
 *
 * Heavy observability: every stage records timing into `perfStages`,
 * errors carry full context, and failures produce a diagnostic summary
 * (browser console tail, memory peaks, capture attempts, HDR
 * diagnostics).
 */

import {
  existsSync,
  mkdirSync,
  rmSync,
  readFileSync,
  readSync,
  closeSync,
  readdirSync,
  statSync,
  writeFileSync,
  copyFileSync,
  appendFileSync,
  symlinkSync,
  cpSync,
} from "fs";
import { parseHTML } from "linkedom";
import { type CanvasResolution, type Fps, fpsToNumber } from "@hyperframes/core";
import {
  type EngineConfig,
  resolveConfig,
  type ExtractedFrames,
  type ExtractionPhaseBreakdown,
  type HdrTransfer,
  createCaptureSession,
  initializeSession,
  closeCaptureSession,
  captureFrameToBuffer,
  type CaptureOptions,
  type CaptureVideoMetadataHint,
  type CaptureSession,
  type BeforeCaptureHook,
  createVideoFrameInjector,
  getEncoderPreset,
  calculateOptimalWorkers,
  distributeFrames,
  executeParallelCapture,
  mergeWorkerFrames,
  type ParallelProgress,
  type WorkerTask,
  analyzeCompositionHdr,
  captureAlphaPng,
  applyDomLayerMask,
  removeDomLayerMask,
  decodePng,
  blitRgba8OverRgb48le,
  blitRgb48leRegion,
  groupIntoLayers,
  blitRgb48leAffine,
  parseTransformMatrix,
  convertTransfer,
  type ElementStackingInfo,
  type HfTransitionMeta,
} from "@hyperframes/engine";
import { join, dirname, resolve, relative, isAbsolute, basename } from "path";
import { randomUUID } from "crypto";
import { freemem } from "os";
import { fileURLToPath } from "url";
import { createFileServer, type FileServerHandle, VIRTUAL_TIME_SHIM } from "./fileServer.js";
import { type CompiledComposition } from "./htmlCompiler.js";
import { defaultLogger, type ProducerLogger } from "../logger.js";
import { isPathInside } from "../utils/paths.js";
import { type HdrImageTransferCache } from "./hdrImageTransferCache.js";
import { updateJobStatus } from "./render/shared.js";
import { runCompileStage } from "./render/stages/compileStage.js";
import { runProbeStage } from "./render/stages/probeStage.js";
import { runExtractVideosStage } from "./render/stages/extractVideosStage.js";
import { runAudioStage } from "./render/stages/audioStage.js";
import { runCaptureStage } from "./render/stages/captureStage.js";
import { runCaptureStreamingStage } from "./render/stages/captureStreamingStage.js";
import { runCaptureHdrStage } from "./render/stages/captureHdrStage.js";
import { runEncodeStage } from "./render/stages/encodeStage.js";
import { runAssembleStage } from "./render/stages/assembleStage.js";

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
export type HdrTransitionMeta = HfTransitionMeta;

/** Pre-computed frame range for an active transition. */
export interface TransitionRange extends HdrTransitionMeta {
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
  /**
   * Frame rate as an exact rational. Integer fps is `{ num: 30, den: 1 }`;
   * NTSC is `{ num: 30000, den: 1001 }`. This shape lets the orchestrator
   * pass the exact rational through to FFmpeg's `-r` / `-framerate` flags
   * without a decimal round-trip — see `fpsToFfmpegArg` in @hyperframes/core.
   *
   * Use `fpsToNumber(config.fps)` at any site that needs a `number` for
   * arithmetic (frame-index → time, telemetry, frame-interval ms). Decimal
   * precision at our scales is more than sufficient.
   */
  fps: Fps;
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
  /**
   * Render-time variable overrides for the composition. Injected as
   * `window.__hfVariables` before any page script runs and consumed by the
   * runtime helper `getVariables()`, which merges them over the declared
   * defaults from `<html data-composition-variables="...">`.
   *
   * Populated by the CLI from `--variables '<json>'` /
   * `--variables-file <path>`. Must be a JSON-serializable plain object.
   */
  variables?: Record<string, unknown>;
  /**
   * Override the output resolution via Chrome `deviceScaleFactor` (DPR).
   * The composition's authored dimensions are unchanged. See
   * {@link resolveDeviceScaleFactor} for the integer-scale, aspect, and
   * HDR constraints.
   */
  outputResolution?: CanvasResolution;
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

export type HdrPerfTimingKey =
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

export interface HdrPerfCollector {
  frames: number;
  normalFrames: number;
  transitionFrames: number;
  domLayerCaptures: number;
  hdrVideoLayerBlits: number;
  hdrImageLayerBlits: number;
  timings: Record<HdrPerfTimingKey, number>;
}

export function createHdrPerfCollector(): HdrPerfCollector {
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

export function addHdrTiming(
  perf: HdrPerfCollector | undefined,
  key: HdrPerfTimingKey,
  startMs: number,
) {
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
  cpSync: (src: string, dest: string, options: { recursive: true }) => unknown;
};

type MaterializeExtractedFramesOptions = {
  pathModule?: MaterializePathModule;
  fileSystem?: MaterializeFileSystem;
  /**
   * When `true`, recursively copy frames into `compiledDir` as real files
   * instead of creating a single symlink per video. Required for
   * distributed plan() output where the planDir must be self-contained
   * across machines (symlinks don't survive S3 / GCS round-trips).
   * Default `false` preserves the in-process renderer's symlink behavior.
   */
  materializeSymlinks?: boolean;
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
  cpSync,
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
      if (options.materializeSymlinks) {
        fileSystem.cpSync(resolvedOut, linkPath, { recursive: true });
      } else {
        fileSystem.symlinkSync(resolvedOut, linkPath);
      }
    }

    const remapped = new Map<number, string>();
    for (const [idx, framePath] of ext.framePaths) {
      remapped.set(idx, pathModule.join(linkPath, pathModule.basename(framePath)));
    }
    ext.framePaths = remapped;
    ext.outputDir = linkPath;
  }
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

export async function executeDiskCaptureWithAdaptiveRetry(options: {
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
export interface HdrVideoFrameSource {
  dir: string;
  rawPath: string;
  fd: number;
  width: number;
  height: number;
  frameSize: number;
  frameCount: number;
  scratch: Buffer;
}

export function closeHdrVideoFrameSource(source: HdrVideoFrameSource, log?: ProducerLogger): void {
  try {
    closeSync(source.fd);
  } catch (err) {
    log?.warn("Failed to close HDR raw frame file", {
      rawPath: source.rawPath,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function blitHdrVideoLayer(
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
export interface HdrImageBuffer {
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
export function blitHdrImageLayer(
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
type CompositeTransfer = HdrTransfer | "srgb";

export function shouldUseLayeredComposite(options: {
  hasHdrContent: boolean;
  hasShaderTransitions: boolean;
  isPngSequence: boolean;
}): boolean {
  return options.hasHdrContent || (options.hasShaderTransitions && !options.isPngSequence);
}

export function resolveCompositeTransfer(
  hasHdrContent: boolean,
  effectiveHdr: { transfer: HdrTransfer } | undefined,
): CompositeTransfer {
  return hasHdrContent && effectiveHdr ? effectiveHdr.transfer : "srgb";
}

export interface HdrCompositeContext {
  log: ProducerLogger;
  domSession: CaptureSession;
  beforeCaptureHook: BeforeCaptureHook | null;
  width: number;
  height: number;
  fps: number;
  compositeTransfer: CompositeTransfer;
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
export async function compositeHdrFrame(
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
    compositeTransfer,
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
      const hdrTargetTransfer = compositeTransfer === "srgb" ? undefined : compositeTransfer;
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
          hdrTargetTransfer,
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
          hdrTargetTransfer,
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
        blitRgba8OverRgb48le(domRgba, canvas, width, height, compositeTransfer);
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

/**
 * Render a `RenderJob` end-to-end: compile → probe → extract videos →
 * audio → capture → encode → assemble. The function body is a thin
 * sequencer over the eight stage modules in `./render/stages/`; the
 * orchestrator owns shared resources (work dir, file server, probe
 * session, browser console buffer, perf counters, peak-memory sampler)
 * and the `try/finally` cleanup. Returns once the final output exists at
 * `outputPath`; throws on cancellation, encoder failure, or a stage
 * error (with a diagnostic summary written to `perf-summary.json`).
 */
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

    const compileResult = await runCompileStage({
      projectDir,
      workDir,
      htmlPath,
      entryFile,
      job,
      cfg,
      needsAlpha,
      log,
      assertNotAborted,
    });
    let compiled = compileResult.compiled;
    const composition = compileResult.composition;
    const { deviceScaleFactor, outputWidth, outputHeight } = compileResult;
    const { width, height } = composition;
    perfStages.compileOnlyMs = compileResult.compileOnlyMs;

    const probeResult = await runProbeStage({
      projectDir,
      workDir,
      job,
      cfg,
      log,
      assertNotAborted,
      compiled,
      composition,
      width,
      height,
      needsAlpha,
      deviceScaleFactor,
    });
    compiled = probeResult.compiled;
    fileServer = probeResult.fileServer;
    probeSession = probeResult.probeSession;
    lastBrowserConsole = probeResult.lastBrowserConsole;
    // The probe stage produces `duration` / `totalFrames` values; the
    // sequencer owns the `RenderJob` and writes them onto it.
    job.duration = probeResult.duration;
    job.totalFrames = probeResult.totalFrames;
    const totalFrames = probeResult.totalFrames;
    perfStages.browserProbeMs = probeResult.browserProbeMs;
    perfStages.compileMs = Date.now() - stage1Start;

    // ── Stage 2: Video frame extraction ─────────────────────────────────
    updateJobStatus(job, "preprocessing", "Extracting video frames", 10, onProgress);

    const compiledDir = join(workDir, "compiled");
    const extractResult = await runExtractVideosStage({
      projectDir,
      compiledDir,
      job,
      cfg,
      composition,
      abortSignal,
      assertNotAborted,
    });
    const {
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
    } = extractResult;
    perfStages.videoExtractMs = extractResult.videoExtractMs;

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
    updateJobStatus(job, "preprocessing", "Processing audio tracks", 20, onProgress);

    const audioResult = await runAudioStage({
      projectDir,
      workDir,
      compiledDir,
      duration: job.duration,
      audios: composition.audios,
      abortSignal,
      assertNotAborted,
    });
    const { audioOutputPath, hasAudio } = audioResult;
    perfStages.audioProcessMs = audioResult.audioProcessMs;

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
      variables: job.config.variables,
      deviceScaleFactor,
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
        frameDataUriCacheBytesLimitMb: cfg.frameDataUriCacheBytesLimitMb,
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
          fpsToNumber(job.config.fps),
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
              fpsToNumber(job.config.fps),
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
    const hasHdrContent = Boolean(effectiveHdr && nativeHdrIds.size > 0);
    const useLayeredComposite = shouldUseLayeredComposite({
      hasHdrContent,
      hasShaderTransitions: compiled.hasShaderTransitions,
      isPngSequence,
    });
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

    // ── Z-ordered multi-layer compositing ─────────────────────────────────
    // Per frame: query all elements' z-order, group into layers (DOM or HDR),
    // composite bottom-to-top in Node.js memory. HDR layers use native
    // pre-extracted pixels; DOM layers use Chrome alpha screenshots converted
    // into the active rgb48le signal space. Shader transitions use this same
    // path for SDR compositions so the engine can apply transition math to
    // isolated scene buffers instead of recording plain DOM screenshots.
    if (useLayeredComposite) {
      const hdrRes = await runCaptureHdrStage({
        job,
        cfg,
        log,
        projectDir,
        compiledDir,
        framesDir,
        videoOnlyPath,
        width,
        height,
        totalFrames,
        composition,
        hasHdrContent,
        effectiveHdr,
        nativeHdrVideoIds,
        nativeHdrImageIds,
        videoTransfers,
        imageTransfers,
        hdrImageSrcPaths,
        preset,
        effectiveQuality,
        effectiveBitrate,
        fileServer,
        buildCaptureOptions,
        createRenderVideoFrameInjector,
        hdrDiagnostics,
        abortSignal,
        assertNotAborted,
        onProgress,
      });
      lastBrowserConsole = hdrRes.lastBrowserConsole;
      hdrPerf = hdrRes.hdrPerf;
      perfStages.captureMs = hdrRes.captureDurationMs;
      perfStages.encodeMs = hdrRes.encodeMs;
    } else {
      // ── Standard capture paths (SDR or DOM-only HDR) ──────────────────
      // Streaming encode mode pipes frame buffers directly to FFmpeg stdin,
      // skipping disk writes and the separate Stage 5 encode step. If the
      // streaming spawn fails (non-abort) the stage returns { success: false }
      // and we fall back to the disk path below.
      let streamingHandled = false;
      if (useStreamingEncode) {
        const streamingRes = await runCaptureStreamingStage({
          fileServer,
          workDir,
          framesDir,
          videoOnlyPath,
          job,
          totalFrames,
          cfg,
          log,
          workerCount,
          probeSession,
          outputFormat,
          streamingEncoderOptions: {
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
          buildCaptureOptions,
          createRenderVideoFrameInjector,
          abortSignal,
          assertNotAborted,
          onProgress,
        });
        if (streamingRes.success) {
          streamingHandled = true;
          workerCount = streamingRes.workerCount;
          probeSession = streamingRes.probeSession;
          lastBrowserConsole = streamingRes.lastBrowserConsole;
          perfStages.captureMs = Date.now() - stage4Start;
          perfStages.encodeMs = streamingRes.encodeMs; // Overlapped with capture
        } else {
          useStreamingEncode = false;
        }
      }

      if (!streamingHandled) {
        // ── Disk-based capture (original flow) ────────────────────────────
        const captureRes = await runCaptureStage({
          fileServer,
          workDir,
          framesDir,
          job,
          totalFrames,
          cfg,
          log,
          workerCount,
          probeSession,
          needsAlpha,
          captureAttempts,
          buildCaptureOptions,
          createRenderVideoFrameInjector,
          abortSignal,
          assertNotAborted,
          onProgress,
        });
        workerCount = captureRes.workerCount;
        probeSession = captureRes.probeSession;
        lastBrowserConsole = captureRes.lastBrowserConsole;

        perfStages.captureMs = Date.now() - stage4Start;

        const encodeRes = await runEncodeStage({
          job,
          log,
          outputPath,
          framesDir,
          videoOnlyPath,
          width,
          height,
          needsAlpha,
          hasAudio,
          audioOutputPath,
          isPngSequence,
          preset,
          effectiveQuality,
          effectiveBitrate,
          enableChunkedEncode,
          chunkedEncodeSize,
          abortSignal,
          assertNotAborted,
          onProgress,
        });
        perfStages.encodeMs = encodeRes.encodeMs;
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
      const assembleRes = await runAssembleStage({
        job,
        videoOnlyPath,
        audioOutputPath,
        outputPath,
        hasAudio,
        abortSignal,
        assertNotAborted,
        onProgress,
      });
      perfStages.assembleMs = assembleRes.assembleMs;
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
      // RenderPerfSummary surfaces fps as a decimal because it lands in JSON
      // payloads (CLI telemetry, regression-harness reports) where a single
      // number is friendlier than `{num,den}`. Callers needing the rational
      // back can read `job.config.fps`.
      fps: fpsToNumber(job.config.fps),
      quality: job.config.quality,
      workers: workerCount,
      chunkedEncode: enableChunkedEncode,
      chunkSizeFrames: enableChunkedEncode ? chunkedEncodeSize : null,
      compositionDurationSeconds: composition.duration,
      totalFrames: totalFrames,
      resolution: { width: outputWidth, height: outputHeight },
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
