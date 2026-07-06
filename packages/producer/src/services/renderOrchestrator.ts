// fallow-ignore-file unused-type circular-dependency code-duplication complexity
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
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync,
  appendFileSync,
} from "fs";
import { parseHTML } from "linkedom";
import { type CanvasResolution, type Fps, type FpsInput, toFps } from "@hyperframes/core";
import {
  type EngineConfig,
  resolveConfig,
  type ExtractionResult,
  type ExtractionPhaseBreakdown,
  type VideoFrameFormat,
  closeCaptureSession,
  type CaptureOptions,
  type CaptureVideoMetadataHint,
  type CaptureSession,
  type BeforeCaptureHook,
  createVideoFrameInjector,
  getEncoderPreset,
  distributeFrames,
  executeParallelCapture,
  mergeWorkerFrames,
  type ParallelProgress,
  type WorkerTask,
  getSystemTotalMb,
  LOW_MEMORY_TOTAL_MB_THRESHOLD,
  assertConfiguredFfmpegBinariesExist,
  type CapturePerfSummary,
  resolveBrowserGpuMode,
  resolveHeadlessShellPath,
  scaleProtocolTimeoutForComposition,
  isMemoryExhaustionError,
  isTransientBrowserError,
  isDrawElementVerificationError,
} from "@hyperframes/engine";
import { join, dirname, resolve } from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import {
  closeFileServerSafely,
  createFileServer,
  type FileServerHandle,
  HF_PAGE_SIDE_COMPOSITING_STUB,
  VIRTUAL_TIME_SHIM,
} from "./fileServer.js";
import { defaultLogger, type ProducerLogger } from "../logger.js";
import { createMemorySampler, type MemorySampler, updateJobStatus } from "./render/shared.js";
import { buildRenderErrorDetails, cleanupRenderResources, safeCleanup } from "./render/cleanup.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { formatCaptureFrameName } from "../utils/paths.js";
import { resolveEffectiveHdrMode } from "./render/hdrMode.js";
import { buildRenderPerfSummary, pushWorkerDedupPerfs } from "./render/perfSummary.js";
import { getCaptureStageBrowserConsole } from "./render/captureStageError.js";
import { resolveVideoCaptureBeyondViewport } from "./render/captureBeyondViewport.js";
import {
  type CaptureCalibrationSample,
  type CaptureCostEstimate,
  resolveRenderWorkerCount,
  runCaptureCalibration,
} from "./render/captureCost.js";
import {
  computeCompositionObservabilityHash,
  RenderObservabilityRecorder,
  observeRenderStage,
  type RenderCaptureObservability,
  type RenderExtractionObservability,
  type RenderObservabilitySummary,
} from "./render/observability.js";
import { type HdrPerfCollector, type HdrPerfSummary } from "./render/hdrPerf.js";
import { runCompileStage } from "./render/stages/compileStage.js";
import { runProbeStage } from "./render/stages/probeStage.js";
import { runExtractVideosStage } from "./render/stages/extractVideosStage.js";
import { runAudioStage } from "./render/stages/audioStage.js";
import { runCaptureStage } from "./render/stages/captureStage.js";
import { runCaptureStreamingStage } from "./render/stages/captureStreamingStage.js";
import { runCaptureHdrStage } from "./render/stages/captureHdrStage.js";
import { runEncodeStage } from "./render/stages/encodeStage.js";
import { runAssembleStage } from "./render/stages/assembleStage.js";
import { shouldUseLayeredComposite } from "./hdrCompositor.js";

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

// fallow-ignore-next-line complexity
function summarizeExtractionObservability(
  extractionResult: ExtractionResult | null,
  videoCount: number,
): RenderExtractionObservability {
  const extracted = extractionResult?.extracted ?? [];
  const totalFramesExtracted = extractionResult?.totalFramesExtracted ?? 0;
  const maxFramesPerVideo = extracted.reduce((max, item) => Math.max(max, item.totalFrames), 0);
  const phaseBreakdown = extractionResult?.phaseBreakdown;
  return {
    videoCount,
    extractedVideoCount: extracted.length,
    totalFramesExtracted,
    maxFramesPerVideo,
    avgFramesPerExtractedVideo:
      extracted.length > 0 ? Math.round(totalFramesExtracted / extracted.length) : undefined,
    vfrProbeMs: phaseBreakdown?.vfrProbeMs,
    vfrPreflightMs: phaseBreakdown?.vfrPreflightMs,
    vfrPreflightCount: phaseBreakdown?.vfrPreflightCount,
    cacheHits: phaseBreakdown?.cacheHits,
    cacheMisses: phaseBreakdown?.cacheMisses,
  };
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
   * - `"gif"`: animated GIF encoded from captured frames with a two-pass
   *   FFmpeg palette (`palettegen` + `paletteuse`). Use for PRs, READMEs,
   *   and docs where inline autoplay matters more than file size. No audio
   *   stream and no alpha channel.
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
  format?: "mp4" | "webm" | "mov" | "png-sequence" | "gif";
  /** GIF Netscape loop count. 0 means infinite looping. Only used with `format: "gif"`. */
  gifLoop?: number;
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
  /**
   * Source-video frame extraction format. Defaults to `"auto"`, which preserves
   * the historical behavior: alpha/alpha-capable sources extract as PNG, all
   * other videos extract as JPG. Set to `"png"` for lossless source-frame
   * extraction on UI recordings, screen captures, or other color-sensitive
   * videos.
   */
  videoFrameFormat?: VideoFrameFormat;
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
  /**
   * Average wall-clock capture time per output frame.
   *
   * Uses `stages.captureFrameMs` when present so fixed Stage 4 setup costs
   * (file server creation, calibration, readiness/session init, strategy
   * resolution) do not get amortized into a per-frame metric. Older summaries
   * without the split fall back to `stages.captureMs`.
   */
  captureAvgMs?: number;
  capturePeakMs?: number;
  captureCalibration?: {
    sampledFrames: number[];
    p95Ms?: number;
    multiplier: number;
    reasons: string[];
  };
  captureAttempts?: CaptureAttemptSummary[];
  observability?: RenderObservabilitySummary;
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
  /**
   * Static-frame dedup outcome for this render (opt-out HF_STATIC_DEDUP=false),
   * aggregated across the sequential session or all parallel workers. `enabled`
   * is the adoption signal; `armed` means it passed every gate + verification;
   * `skipReason` says why it didn't arm; `reusedFrames`/`predictedFrames` measure
   * effectiveness (reuse % = reusedFrames / totalFrames). Undefined when no
   * capture session ran (e.g. layered-HDR-only paths).
   */
  staticDedup?: {
    enabled: boolean;
    armed: boolean;
    predictedFrames: number;
    reusedFrames: number;
    skipReason?: string;
  };
}

export interface HdrDiagnostics {
  videoExtractionFailures: number;
  imageDecodeFailures: number;
}

export interface FrameRange {
  startFrame: number;
  endFrame: number;
}

export interface CaptureAttemptSummary {
  attempt: number;
  workers: number;
  frameCount: number;
  /**
   * `"transient-retry"` is a same-worker-count retry after a transient browser
   * death (Target closed / tab crash); `"retry"` is the worker-halving retry
   * after a recoverable timeout. Distinguished so transient-retry burn is
   * countable for telemetry (dashboard 1783183).
   */
  reason: "initial" | "retry" | "transient-retry";
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
    observability?: RenderObservabilitySummary;
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

export function findMissingFrameRanges(
  totalFrames: number,
  framesDir: string,
  frameExt: "jpg" | "png",
): FrameRange[] {
  const ranges: FrameRange[] = [];
  let rangeStart: number | null = null;

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    const framePath = join(framesDir, formatCaptureFrameName(frameIndex, frameExt));
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
  rangeStart: number = 0,
): WorkerTask[][] {
  const workersPerBatch = Math.max(1, Math.floor(maxWorkers));
  const batches: WorkerTask[][] = [];

  // `ranges` are 0-indexed within the chunk's frame range (or full timeline
  // when `rangeStart === 0`); translate to absolute composition indices so
  // `WorkerTask`'s per-frame time math lands on the page's actual virtual
  // clock, and propagate `outputFrameOffset` so the retry captures back at
  // the same local file name `findMissingFrameRanges` was looking for.
  for (let i = 0; i < ranges.length; i += workersPerBatch) {
    const batchIndex = batches.length;
    const batch = ranges.slice(i, i + workersPerBatch).map((range, workerId) => ({
      workerId,
      startFrame: rangeStart + range.startFrame,
      endFrame: rangeStart + range.endFrame,
      outputDir: join(workDir, `retry-${attempt}-batch-${batchIndex}-worker-${workerId}`),
      outputFrameOffset: rangeStart,
    }));
    batches.push(batch);
  }

  return batches;
}

export function getNextRetryWorkerCount(currentWorkers: number): number {
  return Math.max(1, Math.floor(currentWorkers / 2));
}

/**
 * Bounded number of retries for transient browser deaths (a `Target closed` /
 * `Page crashed` — the tab died, not the composition). Distinct from the
 * worker-count-halving retry: a transient death is often a one-off (contended
 * host, OOM-killed tab, flaky CDP session) that clears on a fresh session, so
 * we retry ONCE at the SAME worker count before falling through to the
 * halving/structural-failure logic. Capped at 1 so a deterministically-dying
 * tab can't loop.
 */
export const MAX_TRANSIENT_CAPTURE_RETRIES = 1;

/**
 * A retry only pays off if the attempt that just finished captured at least one
 * frame toward its target. When it captured nothing (frames still missing >=
 * frames it set out to capture), the composition is structurally broken — a
 * never-ready page, zero duration, or unparseable HTML — not a flaky worker.
 * Re-running it at lower parallelism just burns another full readiness/protocol
 * timeout per worker, turning a render that can never succeed into a long hang.
 * A partially-captured attempt still retries, so genuine flaky-worker gaps are
 * unaffected.
 */
export function captureAttemptMadeProgress(
  attemptTargetFrameCount: number,
  remainingFrameCount: number,
): boolean {
  return remainingFrameCount < attemptTargetFrameCount;
}

export function isRecoverableParallelCaptureError(error: unknown): boolean {
  const message = normalizeErrorMessage(error);
  return (
    message.includes("[Parallel] Capture failed") &&
    /Runtime\.callFunctionOn timed out|HeadlessExperimental\.beginFrame timed out|Waiting failed|timeout exceeded|timed out|Navigation timeout|Protocol error|Target closed/i.test(
      message,
    )
  );
}

/**
 * Turn a cryptic memory-exhaustion failure (V8 `Set maximum size exceeded`,
 * heap-limit abort, oversized allocation) into an actionable message. These
 * come from oversized compositions — very high resolution, very long duration,
 * or a huge frame count — not composition-logic bugs, and a retry re-hits the
 * same ceiling. The guidance points at the levers that actually reduce memory
 * pressure. Returns the original message unchanged for non-OOM errors.
 */
export function describeMemoryExhaustion(
  error: unknown,
  ctx: { width?: number; height?: number; totalFrames?: number },
): string | null {
  if (!isMemoryExhaustionError(error)) return null;
  const raw = normalizeErrorMessage(error);
  const dims =
    ctx.width && ctx.height
      ? ` (${ctx.width}×${ctx.height}${ctx.totalFrames ? `, ${ctx.totalFrames} frames` : ""})`
      : "";
  return (
    `Render ran out of memory${dims}: ${raw}\n` +
    "The composition is too large for the available memory. To reduce memory pressure:\n" +
    "  - Lower the output resolution or split the composition into shorter scenes.\n" +
    "  - Reduce the frame count (shorter duration or lower fps).\n" +
    "  - Run with fewer parallel workers (`--workers 1`).\n" +
    "  - Set PRODUCER_LOW_MEMORY_MODE=true (or `--low-memory-mode`) to use the low-memory render profile."
  );
}

function countCapturedFrames(
  totalFrames: number,
  framesDir: string,
  frameExt: "jpg" | "png",
): number {
  let captured = 0;
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    const framePath = join(framesDir, formatCaptureFrameName(frameIndex, frameExt));
    if (existsSync(framePath)) captured++;
  }
  return captured;
}

function countFrameRanges(ranges: FrameRange[]): number {
  return ranges.reduce((sum, range) => sum + (range.endFrame - range.startFrame), 0);
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
  /**
   * Forwarded to each `WorkerTask`'s `outputFrameOffset` and to the
   * `buildMissingFrameRetryBatches` translation. Default 0 (in-process
   * contract: `[0, totalFrames)`). See `WorkerTask.outputFrameOffset`.
   */
  frameRangeStart?: number;
  /** Mutated in place — replaced each attempt so only the final attempt's worker perf survives (see retry reset below). */
  dedupPerfs: CapturePerfSummary[];
}): Promise<CaptureAttemptSummary[]> {
  const attempts: CaptureAttemptSummary[] = [];
  let currentWorkers = options.initialWorkerCount;
  let missingRanges: FrameRange[] | null = null;
  let attempt = 0;
  let transientRetriesUsed = 0;
  // Set when the *previous* iteration retried after a transient browser death,
  // so the attempt it spawns is tagged `"transient-retry"` (vs the worker-halving
  // `"retry"`) for telemetry. Reset after each attempt is recorded.
  let pendingTransientRetry = false;
  const rangeStart = options.frameRangeStart ?? 0;

  while (true) {
    const frameCount = missingRanges ? countFrameRanges(missingRanges) : options.totalFrames;
    attempts.push({
      attempt,
      workers: currentWorkers,
      frameCount,
      reason: attempt === 0 ? "initial" : pendingTransientRetry ? "transient-retry" : "retry",
    });
    pendingTransientRetry = false;

    const attemptWorkDir = join(options.workDir, `capture-attempt-${attempt}`);
    const batches = missingRanges
      ? buildMissingFrameRetryBatches(
          missingRanges,
          currentWorkers,
          attemptWorkDir,
          attempt,
          rangeStart,
        )
      : [distributeFrames(options.totalFrames, currentWorkers, attemptWorkDir, rangeStart)];

    // Reset before each attempt so a retry REPLACES (not accumulates) worker perf —
    // otherwise a frame captured in attempt 0 AND re-captured on retry would be counted
    // twice, inflating reused/predicted past totalFrames. The common no-retry path keeps
    // exactly one attempt's perf; a retry reports only the final attempt's set.
    options.dedupPerfs.length = 0;
    try {
      for (const tasks of batches) {
        const capturedBeforeBatch = countCapturedFrames(
          options.totalFrames,
          options.framesDir,
          options.frameExt,
        );
        try {
          const workerResults = await executeParallelCapture(
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
          pushWorkerDedupPerfs(workerResults, options.dedupPerfs);
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
      const remainingCount = countFrameRanges(remaining);
      const madeProgress = captureAttemptMadeProgress(frameCount, remainingCount);
      if (!madeProgress) {
        options.log.warn(
          "[Render] Capture attempt made no forward progress; composition is likely structurally broken — not retrying.",
          { attempt, frameCount, remainingCount, workers: currentWorkers },
        );
      }
      if (!options.allowRetry || currentWorkers <= 1 || !madeProgress) {
        throw new Error(`[Render] Capture completed but ${remainingCount} frame(s) are missing`);
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
      // A cancelled render tears the browser down, which surfaces as a
      // transient-looking `Target closed`. Rethrow immediately so cancellation
      // never burns a retry (or logs a misleading transient-failure warning) —
      // the caller's abort handling owns cancellation.
      if (options.abortSignal?.aborted) {
        throw error;
      }
      const remaining = findMissingFrameRanges(
        options.totalFrames,
        options.framesDir,
        options.frameExt,
      );
      if (remaining.length === 0) {
        return attempts;
      }
      const remainingCount = countFrameRanges(remaining);
      const madeProgress = captureAttemptMadeProgress(frameCount, remainingCount);

      // Single bounded retry for a transient browser death (`Target closed` /
      // `Page crashed` / `Session closed`): the tab died mid-capture, not the
      // composition. Unlike the worker-halving retry below, this keeps the same
      // worker count (parallelism isn't the problem) and does NOT require
      // forward progress — a tab that dies before frame 0 is the exact case we
      // want to recover. Bounded by MAX_TRANSIENT_CAPTURE_RETRIES so a
      // deterministically-dying tab still fails instead of looping.
      //
      // Scope: this covers the parallel disk-capture path (the multi-worker
      // renders where a contended host most often drops a tab). The sequential
      // and streaming capture paths run a single stateful session/encoder and
      // don't route through here; probeStage already has its own transient
      // retry for the session-init phase they share.
      if (
        options.allowRetry &&
        isTransientBrowserError(error) &&
        transientRetriesUsed < MAX_TRANSIENT_CAPTURE_RETRIES
      ) {
        transientRetriesUsed++;
        options.log.warn(
          "[Render] Transient browser failure during capture; retrying once with a fresh session.",
          {
            attempt,
            workers: currentWorkers,
            missingFrames: remainingCount,
            transientRetriesUsed,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        missingRanges = remaining;
        attempt++;
        pendingTransientRetry = true;
        continue;
      }

      if (!madeProgress) {
        options.log.warn(
          "[Render] Capture attempt made no forward progress; composition is likely structurally broken — not retrying.",
          { attempt, frameCount, remainingCount, workers: currentWorkers },
        );
      }
      if (
        !options.allowRetry ||
        currentWorkers <= 1 ||
        !isRecoverableParallelCaptureError(error) ||
        !madeProgress
      ) {
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

export type RenderConfigInput = Omit<RenderConfig, "fps"> & { fps: FpsInput };

export function createRenderJob(config: RenderConfigInput): RenderJob {
  return {
    id: randomUUID(),
    config: { ...config, fps: toFps(config.fps) },
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
  // linkedom's cloneNode returns `any` (not `Node`), so the Element cast
  // is needed to access setAttribute/appendChild without losing type safety.
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
  if (outputFormat === "gif") return false;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
  if (durationSeconds > cfg.streamingEncodeMaxDurationSeconds) return false;
  return workerCount === 1;
}

export function resolveCaptureForceScreenshotForPageSideCompositing(args: {
  forceScreenshot: boolean;
  usePageSideCompositing: boolean;
}): boolean {
  return args.usePageSideCompositing ? true : args.forceScreenshot;
}

export function shouldDiscardProbeSessionForPageSideCompositing(args: {
  hasProbeSession: boolean;
  usePageSideCompositing: boolean;
}): boolean {
  return args.hasProbeSession && args.usePageSideCompositing;
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

  // linkedom's querySelectorAll returns `any` on Document and `NodeList` on
  // the ParentNode mixin. Neither types the elements as `Element`, so the
  // cast is required to call getAttribute / hasAttribute without `any`.
  const hosts = Array.from(document.querySelectorAll("[data-composition-src]")) as Element[];
  const host = hosts.find(
    (candidate) =>
      normalizeCompositionSrcPath(candidate.getAttribute("data-composition-src") || "") ===
      normalizedEntryFile,
  );
  if (!host) return null;

  // linkedom's `children` is typed as `NodeList` (not `HTMLCollection<Element>`),
  // so the Element[] cast is needed.
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
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const workDir = job.config.debug
    ? join(debugDir, job.id)
    : mkdtempSync(join(outputDir, `work-${job.id}-`));
  const pipelineStart = Date.now();
  const log = job.config.logger ?? defaultLogger;
  let fileServer: FileServerHandle | null = null;
  let probeSession: CaptureSession | null = null;
  let lastBrowserConsole: string[] = [];
  let restoreLogger: (() => void) | null = null;
  // Composition dimensions captured for the error path (OOM guidance). Assigned
  // once the composition metadata / frame count are resolved inside the try.
  let captureCompositionWidth: number | undefined;
  let captureCompositionHeight: number | undefined;
  let captureTotalFrames: number | undefined;
  const perfStages: Record<string, number> = {};
  const hdrDiagnostics: HdrDiagnostics = {
    videoExtractionFailures: 0,
    imageDecodeFailures: 0,
  };
  let hdrPerf: HdrPerfCollector | undefined;
  const perfOutputPath = join(workDir, "perf-summary.json");
  const cfg = { ...(job.config.producerConfig ?? resolveConfig()) };
  const observability = new RenderObservabilityRecorder({
    pipelineStartMs: pipelineStart,
    log,
    renderJobId: job.id,
  });
  const outputFormat = job.config.format ?? ("mp4" as const);
  const isWebm = outputFormat === "webm";
  const isMov = outputFormat === "mov";
  const isPngSequence = outputFormat === "png-sequence";
  const isGif = outputFormat === "gif";
  const needsAlpha = isWebm || isMov || isPngSequence;
  // `forceScreenshot` is resolved exactly once inside `compileStage` (alpha
  // output + composition `renderModeHints` are folded together there) and
  // returned on `compileResult.forceScreenshot`. The sequencer stores it
  // in a local `captureForceScreenshot` below; the BeginFrame calibration
  // fallback updates the local — not `cfg` — and capture stages receive
  // the value as an explicit parameter. This keeps `cfg` immutable for
  // the rest of the pipeline.
  const enableChunkedEncode = cfg.enableChunkedEncode;
  const chunkedEncodeSize = cfg.chunkSizeFrames;
  const captureObservability: RenderCaptureObservability = {
    forceScreenshot: Boolean(cfg.forceScreenshot),
    captureMode: cfg.forceScreenshot ? "screenshot" : "beginframe",
    browserGpuMode: cfg.browserGpuMode,
    protocolTimeoutMs: cfg.protocolTimeout,
    pageNavigationTimeoutMs: cfg.pageNavigationTimeout,
    playerReadyTimeoutMs: cfg.playerReadyTimeout,
  };
  let extractionObservability: RenderExtractionObservability | undefined;
  let compositionHash: string | undefined;
  const updateCaptureObservability = (patch: Partial<RenderCaptureObservability>): void => {
    Object.assign(captureObservability, patch);
    captureObservability.captureMode = captureObservability.forceScreenshot
      ? "screenshot"
      : "beginframe";
  };
  // Function-scoped (not inside the try) so both the success path AND the catch
  // can read it — the catch records transient-retry burn on renders that still
  // failed, which is the more actionable signal for tuning the retry cap.
  const captureAttempts: CaptureAttemptSummary[] = [];
  const recordTransientRetryObservability = (): void => {
    const count = captureAttempts.filter((a) => a.reason === "transient-retry").length;
    if (count > 0) updateCaptureObservability({ transientRetries: count });
  };
  // Declared outside the try so `finally` can stop the interval, but
  // the sampler is created INSIDE the try so a synchronous throw
  // between declaration and the try-block (currently impossible, but
  // defensible if more setup ever lands here) can't leak the interval.
  let memSampler: MemorySampler | null = null;

  try {
    memSampler = createMemorySampler();
    const assertNotAborted = () => {
      if (abortSignal?.aborted) {
        throw new RenderCancelledError("render_cancelled");
      }
    };

    job.startedAt = new Date();
    assertNotAborted();
    assertConfiguredFfmpegBinariesExist();

    if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });

    if (job.config.debug) {
      const logPath = join(workDir, "render.log");
      restoreLogger = installDebugLogger(logPath, log);
      log.info("[Render] Debug artifacts enabled", { workDir, logPath });
    }

    log.info("[Render] Pipeline started", {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      fps: job.config.fps,
      format: outputFormat,
      quality: job.config.quality,
      browserGpuMode: cfg.browserGpuMode,
      forceScreenshot: cfg.forceScreenshot,
      protocolTimeout: cfg.protocolTimeout,
      browserTimeout: cfg.browserTimeout,
      pageNavigationTimeout: cfg.pageNavigationTimeout,
      playerReadyTimeout: cfg.playerReadyTimeout,
    });
    observability.checkpoint("pipeline", "started", {
      format: outputFormat,
      quality: job.config.quality,
      browserGpuMode: cfg.browserGpuMode,
      forceScreenshot: Boolean(cfg.forceScreenshot),
      protocolTimeoutMs: cfg.protocolTimeout,
      pageNavigationTimeoutMs: cfg.pageNavigationTimeout,
      playerReadyTimeoutMs: cfg.playerReadyTimeout,
      requestedWorkers: job.config.workers ?? "auto",
    });

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

    const compileResult = await observeRenderStage(observability, "compile", { needsAlpha }, () =>
      runCompileStage({
        projectDir,
        workDir,
        htmlPath,
        entryFile,
        job,
        cfg,
        needsAlpha,
        log,
        assertNotAborted,
      }),
    );
    let compiled = compileResult.compiled;
    compositionHash = computeCompositionObservabilityHash(compiled.html);
    const composition = compileResult.composition;
    const { deviceScaleFactor, outputWidth, outputHeight } = compileResult;
    const { width, height } = composition;
    // Capture the *output* (device-scaled) dimensions for the OOM error path —
    // memory is allocated at output resolution, so the guidance must report the
    // real pixel size that exhausted memory, not the smaller CSS composition.
    captureCompositionWidth = outputWidth;
    captureCompositionHeight = outputHeight;
    perfStages.compileOnlyMs = compileResult.compileOnlyMs;
    // Snapshot of `cfg.forceScreenshot` resolved by compileStage. The
    // BeginFrame auto-worker calibration may flip this to `true` at
    // runtime if the calibration session times out under BeginFrame
    // (see fallback below); subsequent capture stages receive the value
    // via the explicit `forceScreenshot` parameter rather than reading
    // `cfg.forceScreenshot` directly.
    let captureForceScreenshot = compileResult.forceScreenshot;
    updateCaptureObservability({ forceScreenshot: captureForceScreenshot });
    observability.checkpoint("compile", "composition metadata resolved", {
      width,
      height,
      videoCount: composition.videos.length,
      audioCount: composition.audios.length,
      imageCount: composition.images.length,
      deviceScaleFactor,
      forceScreenshot: captureForceScreenshot,
      compositionHash,
    });

    // Low-memory safe profile: on memory-constrained hosts the default render
    // shape (probe Chrome + a throwaway calibration Chrome + N capture
    // workers) thrashes — concurrent Chrome instances drive memory pressure
    // that slows every CDP call and spikes V8 GC, surfacing as the slow/stuck
    // renders in heygen-com/hyperframes#1218 / #1219. Collapse to the cheapest
    // shape: skip auto-worker calibration (the gate below), pin to a single
    // worker (resolved below), and prefer screenshot capture over BeginFrame
    // (which avoids the BeginFrame protocol-timeout → relaunch churn on slow
    // hardware). Auto-detected from total RAM; opt out with
    // `--no-low-memory-mode` / PRODUCER_LOW_MEMORY_MODE=false. An explicit
    // `--workers N` still gets screenshot capture + skipped calibration; only
    // the single-worker pin is bypassed.
    if (cfg.lowMemoryMode) {
      captureForceScreenshot = true;
      updateCaptureObservability({ forceScreenshot: captureForceScreenshot });
      log.info(
        "[Render] Low-memory render profile active — " +
          "screenshot capture, auto-worker calibration skipped" +
          (job.config.workers === undefined ? ", pinned to 1 worker" : "") +
          ". Override with --no-low-memory-mode or PRODUCER_LOW_MEMORY_MODE=false.",
        { totalMemMb: getSystemTotalMb(), thresholdMb: LOW_MEMORY_TOTAL_MB_THRESHOLD },
      );
    }

    // Scale the CDP protocol timeout up for oversized compositions BEFORE the
    // probe launches its browser. `protocolTimeout` is a Puppeteer
    // connection-level setting baked in at `ppt.launch()` and immutable
    // afterwards — and the probe browser is reused for capture on the common
    // single-worker path — so this must be applied before the first launch, not
    // after probe. A single CDP seek+capture call scales with *output* pixel
    // area (device-scaled), so the fixed default intermittently kills
    // legitimate slow-but-valid large renders with `Runtime.callFunctionOn
    // timed out`. Only ever raises; small compositions keep the configured base.
    const scaledProtocolTimeout = scaleProtocolTimeoutForComposition(cfg.protocolTimeout, {
      width: outputWidth,
      height: outputHeight,
    });
    if (scaledProtocolTimeout > cfg.protocolTimeout) {
      log.info("[Render] Scaled CDP protocol timeout up for large composition.", {
        from: cfg.protocolTimeout,
        to: scaledProtocolTimeout,
        outputWidth,
        outputHeight,
        deviceScaleFactor,
      });
      cfg.protocolTimeout = scaledProtocolTimeout;
      updateCaptureObservability({ protocolTimeoutMs: scaledProtocolTimeout });
    }

    const probeResult = await observeRenderStage(
      observability,
      "browser_probe",
      { forceScreenshot: captureForceScreenshot },
      () =>
        runProbeStage({
          projectDir,
          workDir,
          job,
          cfg,
          forceScreenshot: captureForceScreenshot,
          log,
          assertNotAborted,
          compiled,
          composition,
          width,
          height,
          needsAlpha,
          deviceScaleFactor,
        }),
    );
    compiled = probeResult.compiled;
    compositionHash = computeCompositionObservabilityHash(compiled.html);
    fileServer = probeResult.fileServer;
    probeSession = probeResult.probeSession;
    lastBrowserConsole = probeResult.lastBrowserConsole;
    let resolvedCaptureBeyondViewport = probeSession?.options.captureBeyondViewport;
    if (resolvedCaptureBeyondViewport !== undefined) {
      updateCaptureObservability({ captureBeyondViewport: resolvedCaptureBeyondViewport });
    }
    // The probe stage produces `duration` / `totalFrames` values; the
    // sequencer owns the `RenderJob` and writes them onto it.
    job.duration = probeResult.duration;
    job.totalFrames = probeResult.totalFrames;
    const totalFrames = probeResult.totalFrames;
    captureTotalFrames = totalFrames;

    perfStages.browserProbeMs = probeResult.browserProbeMs;
    perfStages.compileMs = Date.now() - stage1Start;
    // BeginFrame liveness: the probe stage already relaunched its session in
    // screenshot mode when the first BeginFrame stalled (SwiftShader
    // heavy-layer comps) — flip the sequencer's capture routing to match so
    // calibration and capture stages never issue another BeginFrame.
    if (probeResult.beginFrameStalled && !captureForceScreenshot) {
      captureForceScreenshot = true;
      updateCaptureObservability({ forceScreenshot: captureForceScreenshot });
    }
    observability.checkpoint("browser_probe", "duration resolved", {
      durationSeconds: probeResult.duration,
      totalFrames,
      compositionHash,
      beginFrameStalled: probeResult.beginFrameStalled,
    });

    // ── Stage 2: Video frame extraction ─────────────────────────────────
    updateJobStatus(job, "preprocessing", "Extracting video frames", 10, onProgress);

    const compiledDir = join(workDir, "compiled");
    const extractResult = await observeRenderStage(
      observability,
      "video_extract",
      { videoCount: composition.videos.length },
      () =>
        runExtractVideosStage({
          projectDir,
          compiledDir,
          job,
          cfg,
          log,
          composition,
          abortSignal,
          assertNotAborted,
        }),
    );
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
    extractionObservability = summarizeExtractionObservability(
      extractionResult,
      composition.videos.length,
    );
    observability.checkpoint("video_extract", "frames resolved", {
      videoCount: extractionObservability.videoCount,
      extractedVideoCount: extractionObservability.extractedVideoCount,
      totalFramesExtracted: extractionObservability.totalFramesExtracted,
      maxFramesPerVideo: extractionObservability.maxFramesPerVideo,
      avgFramesPerExtractedVideo: extractionObservability.avgFramesPerExtractedVideo ?? null,
      vfrPreflightCount: extractionObservability.vfrPreflightCount ?? null,
      vfrPreflightMs: extractionObservability.vfrPreflightMs ?? null,
      cacheHits: extractionObservability.cacheHits ?? null,
      cacheMisses: extractionObservability.cacheMisses ?? null,
    });

    // ── HDR auto-detection ──────────────────────────────────────────────
    const effectiveHdr = resolveEffectiveHdrMode({
      hdrMode: job.config.hdrMode,
      outputFormat,
      extractionResult,
      imageColorSpaces,
      log,
    });
    observability.checkpoint("hdr_detection", "resolved", {
      requestedHdrMode: job.config.hdrMode ?? "auto",
      effectiveHdr: effectiveHdr ? effectiveHdr.transfer : "sdr",
      nativeHdrVideoCount: nativeHdrVideoIds.size,
      nativeHdrImageCount: nativeHdrImageIds.size,
    });

    // ── Stage 3: Audio processing ───────────────────────────────────────
    updateJobStatus(job, "preprocessing", "Processing audio tracks", 20, onProgress);

    const audioResult = await observeRenderStage(
      observability,
      "audio_process",
      { audioCount: composition.audios.length },
      () =>
        runAudioStage({
          projectDir,
          workDir,
          compiledDir,
          duration: probeResult.duration,
          audios: composition.audios,
          abortSignal,
          assertNotAborted,
        }),
    );
    const { audioOutputPath, hasAudio } = audioResult;
    perfStages.audioProcessMs = audioResult.audioProcessMs;
    if (audioResult.audioError) {
      log.warn(`[Render] Audio mix failed — output will be video-only: ${audioResult.audioError}`);
    }

    // ── Stage 4: Frame capture ──────────────────────────────────────────
    const stage4Start = Date.now();
    updateJobStatus(job, "rendering", "Starting frame capture", 25, onProgress);

    // Start file server (may already be running from duration discovery).
    // The page-side compositing stub is injected later (after hasHdrContent
    // is known) via addPreHeadScript — see usePageSideCompositingForTransitions.
    if (!fileServer) {
      const fileServerStart = observability.stageStart("file_server", { reused: false });
      try {
        fileServer = await createFileServer({
          projectDir,
          compiledDir: join(workDir, "compiled"),
          port: 0,
          preHeadScripts: [VIRTUAL_TIME_SHIM],
          fps: job.config.fps,
        });
        assertNotAborted();
        observability.stageEnd("file_server", fileServerStart);
      } catch (error) {
        observability.stageError("file_server", fileServerStart, error);
        throw error;
      }
    } else {
      observability.checkpoint("file_server", "reused probe file server");
    }
    const activeFileServer = fileServer;
    if (!activeFileServer) {
      throw new Error("File server failed to initialize before frame capture");
    }

    const framesDir = join(workDir, "captured-frames");
    if (!existsSync(framesDir)) mkdirSync(framesDir, { recursive: true });

    const resolvedBrowserGpuMode = await resolveBrowserGpuMode(cfg.browserGpuMode, {
      chromePath: resolveHeadlessShellPath(cfg),
      browserTimeout: cfg.browserTimeout,
    });
    updateCaptureObservability({ browserGpuMode: resolvedBrowserGpuMode });
    const videoCaptureBeyondViewport = resolveVideoCaptureBeyondViewport(
      composition.videos.length,
      resolvedBrowserGpuMode,
    );

    const captureOptions: CaptureOptions = {
      width,
      height,
      fps: job.config.fps,
      format: needsAlpha ? "png" : "jpeg",
      quality: needsAlpha ? undefined : job.config.quality === "draft" ? 80 : 95,
      variables: job.config.variables,
      deviceScaleFactor,
      ...(videoCaptureBeyondViewport !== undefined
        ? { captureBeyondViewport: videoCaptureBeyondViewport }
        : {}),
    };
    resolvedCaptureBeyondViewport =
      captureOptions.captureBeyondViewport ?? resolvedCaptureBeyondViewport;
    if (resolvedCaptureBeyondViewport !== undefined) {
      updateCaptureObservability({ captureBeyondViewport: resolvedCaptureBeyondViewport });
    }

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
      // Probe-resolved duration: drawElement self-verification derives its
      // sample frame indices from this so they land inside the drained range.
      compositionDurationSeconds: job.duration,
    });
    // The URL-served frame path (PR #596) hands each injected `<img>` a
    // fileServer URL instead of a base64 data URI, on the theory that
    // shipping a short URL through `page.evaluate` beats shipping a
    // multi-MB base64 string per frame. That holds when the fileServer
    // is otherwise idle — but on video-heavy compositions, the same
    // fileServer also serves every `<video>.src`. The runtime's
    // drift-recovery branch (`runtime/media.ts:294-302`) issues
    // `el.load()` on the underlying `<video>` during seeks, kicking off
    // full-file downloads that occupy the fileServer's single Node
    // event loop (it uses `readFileSync` and offers no `Accept-Ranges`).
    // The injector's `<img>.decode()` then queues behind those video
    // fetches and is never serviced before puppeteer's protocol timeout
    // fires (`Runtime.callFunctionOn timed out`).
    //
    // Repro: synth 30 × 32 MB videos / 90 s comp on an 8-core / 30 GB
    // host = 537 s wall (broken corpus) / 428 s (corpus-fixed), every
    // render fails. Disabling the resolver (force base64-inline) gives
    // 1:59 (119 s) wall and a clean MP4 on the same comp, with no
    // regression on the 30 × 1.6 MB control corpus (137 s vs 135 s
    // baseline).
    //
    // Until this is properly gated (e.g. only enable URL-served when the
    // page has zero fileServer-bound `<video>.src` traffic), the inline
    // path is the safe default. The cache memory ceiling
    // (`frameDataUriCacheBytesLimitMb`, default 1500 MB above 8 GB
    // hosts) already bounds the cost. `createCompiledFrameSrcResolver`
    // and the `frameSrcResolver` option remain in their respective
    // modules (`packages/producer/src/services/render/shared.ts`,
    // `packages/engine/src/services/videoFrameInjector.ts`); the gating
    // PR will re-import the builder here.
    const createRenderVideoFrameInjector = (): BeforeCaptureHook | null =>
      createVideoFrameInjector(frameLookup, {
        frameDataUriCacheLimit: cfg.frameDataUriCacheLimit,
        frameDataUriCacheBytesLimitMb: cfg.frameDataUriCacheBytesLimitMb,
      });

    let captureCalibration:
      | {
          estimate: CaptureCostEstimate;
          samples: CaptureCalibrationSample[];
        }
      | undefined;

    const htmlInCanvasDetected = compiled.renderModeHints.reasons.some(
      (r) => r.code === "htmlInCanvas",
    );
    if (
      job.config.workers === undefined &&
      totalFrames >= 60 &&
      !htmlInCanvasDetected &&
      !cfg.lowMemoryMode
    ) {
      const outcome = await observeRenderStage(
        observability,
        "capture_calibration",
        { forceScreenshot: captureForceScreenshot },
        () =>
          runCaptureCalibration({
            cfg,
            fileServer: activeFileServer,
            workDir,
            log,
            job,
            totalFrames,
            forceScreenshot: captureForceScreenshot,
            probeSession,
            buildCaptureOptions,
            createRenderVideoFrameInjector,
            assertNotAborted,
          }),
      );
      captureCalibration = outcome.calibration;
      captureForceScreenshot = outcome.forceScreenshot;
      updateCaptureObservability({ forceScreenshot: captureForceScreenshot });
      probeSession = outcome.probeSession;
      if (outcome.lastBrowserConsole.length > 0) {
        lastBrowserConsole = outcome.lastBrowserConsole;
      }
      observability.checkpoint("capture_calibration", "resolved", {
        forceScreenshot: captureForceScreenshot,
        multiplier: outcome.calibration?.estimate.multiplier ?? null,
        p95Ms: outcome.calibration?.estimate.p95Ms ?? null,
      });
    } else {
      observability.checkpoint("capture_calibration", "skipped", {
        requestedWorkers: job.config.workers ?? "auto",
        totalFrames,
        htmlInCanvasDetected,
        lowMemoryMode: Boolean(cfg.lowMemoryMode),
      });
    }

    // Low-memory safe-mode's single-worker pin lives inside
    // resolveRenderWorkerCount so its "why workers=N" logging stays coherent.
    let workerCount = resolveRenderWorkerCount(
      totalFrames,
      job.config.workers,
      cfg,
      compiled,
      log,
      captureCalibration?.estimate,
    );
    updateCaptureObservability({ workerCount });
    observability.checkpoint("worker_resolution", "resolved", { workerCount });

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
    // Default-on drawElement is only safe where the runtime self-verification
    // net actually runs: the single-worker streaming worker-encode drain. The
    // disk path (png-sequence / over the streaming duration cap) and parallel
    // capture ship frames no drain verifies — route those renders to the
    // screenshot baseline unless drawElement was explicitly opted into.
    if (
      cfg.useDrawElement &&
      process.env.PRODUCER_EXPERIMENTAL_FAST_CAPTURE !== "true" &&
      (!useStreamingEncode || workerCount > 1)
    ) {
      cfg.useDrawElement = false;
      log.info(
        "[Render] Fast capture: default-on drawElement disabled for this render — " +
          (workerCount > 1 ? "parallel capture" : "the disk capture path") +
          " has no runtime self-verification. Set PRODUCER_EXPERIMENTAL_FAST_CAPTURE=true to override.",
      );
      // The probe session already initialized in drawElement mode (canvas
      // injected); it must not be reused by the unverified path.
      if (probeSession && probeSession.captureMode === "drawelement") {
        await closeCaptureSession(probeSession);
        probeSession = null;
      }
    }

    // `captureAttempts` is declared at function scope above (shared with the
    // catch block). Static-dedup perf, appended per sequential session / per
    // parallel worker by the capture stage, aggregated into the perf summary below.
    const dedupPerfs: CapturePerfSummary[] = [];

    // png-sequence is "no container" — outputPath is treated as a directory and
    // the encode/mux/faststart stages are skipped entirely. The empty extension
    // keeps `videoOnlyPath` (which is constructed below) sensible even though
    // it will not be written.
    const FORMAT_EXT: Record<string, string> = {
      mp4: ".mp4",
      webm: ".webm",
      mov: ".mov",
      "png-sequence": "",
      gif: ".gif",
    };
    const videoExt = FORMAT_EXT[outputFormat] ?? ".mp4";
    const videoOnlyPath = join(workDir, `video-only${videoExt}`);
    // Only use the HDR encoder preset when there's HDR content to pass through —
    // either native HDR videos OR native HDR images. For SDR-only compositions,
    // auto mode stays SDR since H.265 10-bit causes browser color management
    // issues (orange shift) with no quality benefit.
    const nativeHdrIds = new Set([...nativeHdrVideoIds, ...nativeHdrImageIds]);
    const hasHdrContent = Boolean(effectiveHdr && nativeHdrIds.size > 0);
    // Page-side compositing opt-in: when the engine is configured to run the
    // shader blend inside Chrome via a page-side WebGL canvas, the layered
    // Node-side composite path is unnecessary for SDR shader transitions.
    // The streaming path takes ONE opaque RGB screenshot per output frame —
    // exactly the single capture the page-side compositor produces. HDR
    // content still forces the layered path (HDR layers need per-layer
    // alpha + native HDR raw frame compositing in Node; that's out of scope
    // for this opt-in). GIF also uses this path for shader transitions
    // because its two-pass palette encoder needs disk frames, not the
    // layered path's streaming raw-video encoder.
    const usePageSideCompositingForTransitions =
      (cfg.enablePageSideCompositing || isGif) &&
      compiled.hasShaderTransitions &&
      !hasHdrContent &&
      !isPngSequence &&
      !needsAlpha;
    if (usePageSideCompositingForTransitions) {
      activeFileServer.addPreHeadScript(HF_PAGE_SIDE_COMPOSITING_STUB);
      if (
        shouldDiscardProbeSessionForPageSideCompositing({
          hasProbeSession: probeSession !== null,
          usePageSideCompositing: true,
        }) &&
        probeSession
      ) {
        lastBrowserConsole = probeSession.browserConsoleBuffer;
        await closeCaptureSession(probeSession);
        probeSession = null;
        log.info(
          "[Render] Recreating capture session so page-side compositing pre-head script is loaded.",
        );
      }
      captureForceScreenshot = resolveCaptureForceScreenshotForPageSideCompositing({
        forceScreenshot: captureForceScreenshot,
        usePageSideCompositing: true,
      });
      updateCaptureObservability({ forceScreenshot: captureForceScreenshot });
      log.info(
        "[Render] Page-side compositing enabled — bypassing Node-side layered " +
          "shader-blend path. Engine will capture one opaque RGB screenshot per output frame.",
      );
    }
    const useLayeredComposite =
      !usePageSideCompositingForTransitions &&
      shouldUseLayeredComposite({
        hasHdrContent,
        hasShaderTransitions: compiled.hasShaderTransitions && !isGif,
        isPngSequence,
      });
    updateCaptureObservability({
      workerCount,
      useStreamingEncode,
      useLayeredComposite,
      usePageSideCompositing: usePageSideCompositingForTransitions,
      hasHdrContent,
      forceScreenshot: captureForceScreenshot,
    });
    observability.checkpoint("capture_strategy", "resolved", {
      workerCount,
      forceScreenshot: captureForceScreenshot,
      captureBeyondViewport: resolvedCaptureBeyondViewport ?? null,
      useStreamingEncode,
      useLayeredComposite,
      usePageSideCompositing: usePageSideCompositingForTransitions,
      hasHdrContent,
      hasShaderTransitions: compiled.hasShaderTransitions,
      isPngSequence,
    });
    const encoderHdr = hasHdrContent ? effectiveHdr : undefined;
    // png-sequence has no encoder, but the rest of the orchestrator still
    // reads `preset.quality` for `effectiveQuality` and `preset.codec` for
    // unrelated bookkeeping. Fall back to the mp4 preset shape — its values
    // are never written to ffmpeg in the png-sequence path.
    const presetFormat: "mp4" | "webm" | "mov" =
      outputFormat === "webm" || outputFormat === "mov" ? outputFormat : "mp4";
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
      // Layered composite always runs in screenshot mode — keep
      // `captureForceScreenshot` in sync so the perf summary and any
      // post-HDR diagnostic that reads the boolean see the same value
      // the stage uses internally.
      captureForceScreenshot = true;
      updateCaptureObservability({ forceScreenshot: captureForceScreenshot });
      const hdrRes = await observeRenderStage(
        observability,
        "capture_hdr_layered",
        { workerCount, forceScreenshot: captureForceScreenshot, hasHdrContent },
        () =>
          runCaptureHdrStage({
            job,
            cfg,
            forceScreenshot: captureForceScreenshot,
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
            fileServer: activeFileServer,
            buildCaptureOptions,
            createRenderVideoFrameInjector,
            hdrDiagnostics,
            abortSignal,
            assertNotAborted,
            onProgress,
          }),
      );
      lastBrowserConsole = hdrRes.lastBrowserConsole;
      hdrPerf = hdrRes.hdrPerf;
      perfStages.captureMs = hdrRes.captureDurationMs;
      perfStages.captureFrameMs = hdrRes.captureDurationMs;
      perfStages.captureSetupMs = Math.max(0, Date.now() - stage4Start - hdrRes.captureDurationMs);
      perfStages.encodeMs = hdrRes.encodeMs;
    } else {
      // ── Standard capture paths (SDR or DOM-only HDR) ──────────────────
      // Streaming encode mode pipes frame buffers directly to FFmpeg stdin,
      // skipping disk writes and the separate Stage 5 encode step. If the
      // streaming spawn fails (non-abort) the stage returns { success: false }
      // and we fall back to the disk path below.
      let streamingHandled = false;
      if (useStreamingEncode) {
        const captureFrameStart = Date.now();
        const invokeStreaming = () =>
          observeRenderStage(
            observability,
            "capture_streaming",
            { workerCount, forceScreenshot: captureForceScreenshot },
            () =>
              runCaptureStreamingStage({
                fileServer: activeFileServer,
                workDir,
                framesDir,
                videoOnlyPath,
                job,
                totalFrames,
                cfg,
                forceScreenshot: captureForceScreenshot,
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
                  vp9CpuUsed: cfg.vp9CpuUsed,
                  useGpu: job.config.useGpu,
                  imageFormat: captureOptions.format || "jpeg",
                  hdr: preset.hdr,
                },
                buildCaptureOptions,
                createRenderVideoFrameInjector,
                abortSignal,
                assertNotAborted,
                onProgress,
                dedupPerfs,
              }),
          );
        let streamingRes;
        try {
          streamingRes = await invokeStreaming();
        } catch (err) {
          // drawElement self-verification tripped (blank frame or PSNR breach
          // vs the pre-injection ground truth). The whole render restarts on
          // the screenshot path — slower, never wrong. The failed attempt's
          // session was closed by the stage's finally; probeSession (if any)
          // was consumed by it, so a fresh session spawns on retry.
          if (!isDrawElementVerificationError(err)) throw err;
          log.warn("[Render] drawElement self-verification failed; re-rendering via screenshot", {
            error: err instanceof Error ? err.message : String(err),
          });
          observability.checkpoint(
            "capture_streaming",
            "drawElement self-verify failed; retrying with forceScreenshot",
          );
          captureForceScreenshot = true;
          updateCaptureObservability({
            forceScreenshot: true,
            deSelfVerifyFallback: true,
          });
          probeSession = null;
          streamingRes = await invokeStreaming();
          // The first attempt's error marked the phase failed; the retry
          // recovered it — don't brand the render as failed in telemetry.
          observability.clearFailure("capture_streaming");
        }
        const captureFrameMs = Date.now() - captureFrameStart;
        if (streamingRes.success) {
          streamingHandled = true;
          workerCount = streamingRes.workerCount;
          updateCaptureObservability({ workerCount });
          if (streamingRes.captureBeyondViewport !== undefined) {
            updateCaptureObservability({
              captureBeyondViewport: streamingRes.captureBeyondViewport,
            });
          }
          probeSession = streamingRes.probeSession;
          lastBrowserConsole = streamingRes.lastBrowserConsole;
          perfStages.captureMs = Date.now() - stage4Start;
          perfStages.captureFrameMs = captureFrameMs;
          perfStages.captureSetupMs = Math.max(0, perfStages.captureMs - captureFrameMs);
          perfStages.encodeMs = streamingRes.encodeMs; // Overlapped with capture
        } else {
          useStreamingEncode = false;
          updateCaptureObservability({ useStreamingEncode });
          observability.checkpoint("capture_streaming", "spawn failed; falling back to disk");
        }
      }

      if (!streamingHandled) {
        // ── Disk-based capture (original flow) ────────────────────────────
        const captureFrameStart = Date.now();
        const captureRes = await observeRenderStage(
          observability,
          "capture_disk",
          { workerCount, forceScreenshot: captureForceScreenshot, needsAlpha },
          () =>
            runCaptureStage({
              fileServer: activeFileServer,
              workDir,
              framesDir,
              job,
              totalFrames,
              cfg,
              forceScreenshot: captureForceScreenshot,
              log,
              workerCount,
              probeSession,
              needsAlpha,
              captureAttempts,
              dedupPerfs,
              buildCaptureOptions,
              createRenderVideoFrameInjector,
              abortSignal,
              assertNotAborted,
              onProgress,
            }),
        );
        const captureFrameMs = Date.now() - captureFrameStart;
        workerCount = captureRes.workerCount;
        updateCaptureObservability({ workerCount });
        if (captureRes.captureBeyondViewport !== undefined) {
          updateCaptureObservability({
            captureBeyondViewport: captureRes.captureBeyondViewport,
          });
        }
        probeSession = captureRes.probeSession;
        lastBrowserConsole = captureRes.lastBrowserConsole;

        perfStages.captureMs = Date.now() - stage4Start;
        perfStages.captureFrameMs = captureFrameMs;
        perfStages.captureSetupMs = Math.max(0, perfStages.captureMs - captureFrameMs);

        const encodeRes = await observeRenderStage(
          observability,
          "encode",
          { hasAudio, isPngSequence, isGif, chunkedEncode: enableChunkedEncode },
          () =>
            runEncodeStage({
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
              isGif,
              preset,
              effectiveQuality,
              effectiveBitrate,
              enableChunkedEncode,
              chunkedEncodeSize,
              engineConfig: cfg,
              abortSignal,
              assertNotAborted,
              onProgress,
            }),
        );
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
    closeFileServerSafely(fileServer, "renderOrchestrator", log);
    fileServer = null;

    // ── Stage 6: Assemble ───────────────────────────────────────────────
    // Skipped for formats with no mux/faststart step. png-sequence is a
    // directory deliverable, and gif is written directly to outputPath by the
    // two-pass palette encoder.
    if (!isPngSequence && !isGif) {
      const assembleRes = await observeRenderStage(observability, "assemble", { hasAudio }, () =>
        runAssembleStage({
          job,
          videoOnlyPath,
          audioOutputPath,
          outputPath,
          hasAudio,
          abortSignal,
          assertNotAborted,
          onProgress,
        }),
      );
      perfStages.assembleMs = assembleRes.assembleMs;
    } else {
      observability.checkpoint("assemble", `skipped for ${outputFormat}`);
    }

    // ── Complete ─────────────────────────────────────────────────────────
    job.outputPath = outputPath;
    updateJobStatus(job, "complete", "Render complete", 100, onProgress);

    const totalElapsed = Date.now() - pipelineStart;

    const tmpPeakBytes = existsSync(workDir) ? sampleDirectoryBytes(workDir) : 0;
    // Record transient-tab-death retry burn (recovered case) so it's visible on
    // dashboard 1783183, not just logs. The catch mirrors this for the failed case.
    recordTransientRetryObservability();
    observability.checkpoint("pipeline", "completed", { totalElapsedMs: totalElapsed });
    const observabilitySummary = observability.summary({
      lastBrowserConsole,
      capture: captureObservability,
      extraction: extractionObservability,
      compositionHash,
    });

    const perfSummary = buildRenderPerfSummary({
      job,
      workerCount,
      enableChunkedEncode,
      chunkedEncodeSize,
      compositionDurationSeconds: composition.duration,
      totalFrames,
      outputWidth,
      outputHeight,
      videoCount: composition.videos.length,
      audioCount: composition.audios.length,
      totalElapsedMs: totalElapsed,
      perfStages,
      videoExtractBreakdown: extractionResult?.phaseBreakdown,
      tmpPeakBytes,
      captureCalibration,
      captureAttempts,
      dedupPerfs,
      hdrDiagnostics,
      hdrPerf,
      observability: observabilitySummary,
      peakRssBytes: memSampler.peakRssBytes(),
      peakHeapUsedBytes: memSampler.peakHeapUsedBytes(),
    });
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
          rmSync(workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        },
        log,
      );
    }

    if (restoreLogger) restoreLogger();
  } catch (error) {
    if (error instanceof RenderCancelledError || abortSignal?.aborted) {
      job.error = error instanceof Error ? error.message : "render_cancelled";
      updateJobStatus(job, "cancelled", "Render cancelled", job.progress, onProgress);
      await cleanupRenderResources({
        fileServer,
        probeSession,
        workDir,
        debug: Boolean(job.config.debug),
        log,
        label: "cancel",
      });
      if (restoreLogger) restoreLogger();
      throw error instanceof RenderCancelledError
        ? error
        : new RenderCancelledError("render_cancelled");
    }
    const memoryGuidance = describeMemoryExhaustion(error, {
      width: captureCompositionWidth,
      height: captureCompositionHeight,
      totalFrames: captureTotalFrames,
    });
    // Flag OOM-classified failures so the "is OOM the dominant tail?" question is
    // answerable from a metric (dashboard 1783183), not just the error string.
    if (memoryGuidance) {
      updateCaptureObservability({ memoryExhaustionDetected: true });
    }
    // Retry burn on a render that STILL failed — the actionable signal for tuning
    // MAX_TRANSIENT_CAPTURE_RETRIES (mirrors the success-path record above).
    recordTransientRetryObservability();
    const errorMessage = memoryGuidance ?? normalizeErrorMessage(error);
    const carriedBrowserConsole = getCaptureStageBrowserConsole(error);
    if (carriedBrowserConsole.length > 0) {
      lastBrowserConsole = [...lastBrowserConsole, ...carriedBrowserConsole].slice(-200);
    }
    if (!observability.hasFailure()) {
      const failureStart = Date.now();
      observability.stageError(job.currentStage || "pipeline", failureStart, error);
    }

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
    job.failedStage = job.currentStage;
    const observabilitySummary = observability.summary({
      lastBrowserConsole,
      capture: captureObservability,
      extraction: extractionObservability,
      compositionHash,
    });
    job.errorDetails = buildRenderErrorDetails({
      error,
      pipelineStartMs: pipelineStart,
      lastBrowserConsole,
      perfStages,
      hdrDiagnostics,
      observability: observabilitySummary,
    });

    log.info("[Render] Failure summary", {
      failedStage: job.currentStage,
      error: errorMessage,
      elapsedMs: Date.now() - pipelineStart,
      stageTimings: perfStages,
      isTimeout: isTimeoutError,
      workers: job.config.workers ?? "auto",
      protocolTimeout: cfg.protocolTimeout,
      observedFailedPhase: observabilitySummary.failedPhase,
      observedLastPhase: observabilitySummary.lastEvent?.phase,
      observedLastStatus: observabilitySummary.lastEvent?.status,
      browserDiagnostics: observabilitySummary.browserDiagnostics,
      extraction: observabilitySummary.extraction,
      browserConsoleErrors: lastBrowserConsole
        .filter(
          (l) =>
            l.includes("ERROR") ||
            l.includes("PAGEERROR") ||
            l.includes("REQUESTFAILED") ||
            l.includes("[FrameCapture:NAV]") ||
            /\[Browser:HTTP\d{3}\]/.test(l),
        )
        .slice(-5),
    });

    await cleanupRenderResources({
      fileServer,
      probeSession,
      workDir,
      debug: Boolean(job.config.debug),
      log,
      label: "error",
    });

    if (restoreLogger) restoreLogger();
    throw error;
  } finally {
    memSampler?.stop();
  }
}
