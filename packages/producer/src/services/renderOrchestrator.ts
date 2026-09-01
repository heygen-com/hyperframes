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
import { tmpdir } from "node:os";
import { parseHTML } from "linkedom";
import {
  type CanvasResolution,
  type Fps,
  type FpsInput,
  fpsToNumber,
  toFps,
} from "@hyperframes/core";
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
  type CaptureWarning,
  type SubTimelineWaitOutcome,
  type WorkerSizing,
  type StaticVerificationOutcome,
  resolveBrowserGpuMode,
  resolveHeadlessShellPath,
  applyConcreteGpuScreenshotClamp,
  explainDrawElementDisabled,
  scaleProtocolTimeoutForComposition,
  classifyCaptureFailure,
  cloneCaptureWarning,
  isMemoryExhaustionError,
  isDrawElementVerificationError,
  getDrawElementVerificationDetails,
  augmentProtocolTimeoutError,
  augmentPageNavigationTimeoutError,
} from "@hyperframes/engine";
import { join, dirname, resolve } from "path";
import { totalmem } from "node:os";
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
import {
  outputNeedsAlpha,
  outputSupportsPageSideShaderCompositing,
  type RenderOutputFormat,
} from "./render/renderFormat.js";
import { createMemorySampler, type MemorySampler, updateJobStatus } from "./render/shared.js";
import { buildRenderErrorDetails } from "./render/cleanup.js";
import { publishRenderFailure } from "./render/renderEventPublisher.js";
import { EncoderInterruptedError } from "./render/encoderInterruption.js";
import { RenderExecutionContext } from "./render/renderExecutionContext.js";
import { ArtifactTransaction } from "./render/artifactTransaction.js";
import {
  createCapturePlan,
  replanAfterFailure,
  type CapturePlan,
  type SdrDiskCapturePlan,
  type CaptureRouting,
} from "./render/capturePlan.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { formatCaptureFrameName } from "../utils/paths.js";
import { resolveEffectiveHdrMode } from "./render/hdrMode.js";
import {
  buildRenderPerfSummary,
  pushWorkerDedupPerfs,
  roundDb,
  worstSubTimelineWaitOutcome,
} from "./render/perfSummary.js";
import { getCaptureStageBrowserConsole } from "./render/captureStageError.js";
import { resolveVideoCaptureBeyondViewport } from "./render/captureBeyondViewport.js";
import {
  type CaptureCalibrationSample,
  type CaptureCostEstimate,
  buildHeapAdvisoryWarning,
  resolveRenderWorkerCount,
  runCaptureCalibration,
} from "./render/captureCost.js";
import {
  computeCompositionObservabilityHash,
  RenderObservabilityRecorder,
  observeRenderStage,
  type RenderCaptureObservability,
  type RenderExtractionObservability,
  type RenderObservationData,
  type RenderObservabilitySummary,
} from "./render/observability.js";
import { emitFallbackCaptureProfile } from "./render/fallbackCaptureProfile.js";
import { type HdrPerfCollector, type HdrPerfSummary } from "./render/hdrPerf.js";
import {
  assertVideoFrameCoverage,
  computeVideoFrameCoverage,
  countAuthoredTimedClips,
  resolveVideoCoverageThreshold,
  type VideoFrameCoverageReport,
} from "./render/videoFrameCoverage.js";
import { runCompileStage } from "./render/stages/compileStage.js";
import { runProbeStage } from "./render/stages/probeStage.js";
import { validateRenderDuration } from "./render/planValidation.js";
import {
  runExtractVideosStage,
  shouldCopyExtractedFrames,
} from "./render/stages/extractVideosStage.js";
import { runAudioStage } from "./render/stages/audioStage.js";
import { runCaptureStage } from "./render/stages/captureStage.js";
import {
  type CaptureStreamingStageResult,
  runCaptureStreamingStage,
} from "./render/stages/captureStreamingStage.js";
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
  coverageReports?: readonly VideoFrameCoverageReport[],
  authoredTimedClipCount?: number,
): RenderExtractionObservability {
  const extracted = extractionResult?.extracted ?? [];
  const totalFramesExtracted = extractionResult?.totalFramesExtracted ?? 0;
  const maxFramesPerVideo = extracted.reduce((max, item) => Math.max(max, item.totalFrames), 0);
  const phaseBreakdown = extractionResult?.phaseBreakdown;
  // Only surface the coverage gauges when we actually ran the gate — a
  // no-video render must not emit a spurious `minVideoFrameCoverageRatio`
  // that dashboards interpret as "coverage measured, was 0/0=1".
  const coverageGauges =
    coverageReports && coverageReports.length > 0
      ? {
          minVideoFrameCoverageRatio: coverageReports.reduce(
            (min, r) => Math.min(min, r.ratio),
            Number.POSITIVE_INFINITY,
          ),
        }
      : {};
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
    transientRetries: phaseBreakdown?.transientRetries,
    ...coverageGauges,
    authoredTimedClipCount,
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

export type RenderOutcome = "completed" | "completed_with_warnings" | "failed" | "cancelled";
export type RenderStrictness = "strict" | "best-effort";

export interface RenderWarning extends CaptureWarning {
  stage: "capture-readiness";
}

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
   * - `"gif"`: animated GIF encoded from captured RGBA frames with a two-pass
   *   FFmpeg palette (`palettegen` + `paletteuse`). Use for PRs, READMEs,
   *   and docs where inline autoplay matters more than file size. No audio
   *   stream; transparency is binary because GIF has no partial alpha.
   * - `"png-sequence"`: a directory of zero-padded RGBA PNGs
   *   (`frame_000001.png` …). Lossless alpha, largest on disk, no muxed
   *   audio (an `audio.m4a` sidecar is written alongside the PNGs when
   *   the composition has audio elements). Use for After Effects / Nuke
   *   / Fusion ingest, or when frames need post-processing before
   *   encoding. `outputPath` is treated as a directory; it is created if
   *   it doesn't exist.
   *
   * Alpha output (`"webm"`, `"mov"`, `"png-sequence"`, `"gif"`) automatically
   * forces screenshot capture (Chrome's BeginFrame compositor does not
   * preserve alpha on Linux headless-shell) and disables HDR — HDR +
   * alpha is not a supported combination, a warning is logged and HDR
   * falls back to SDR. The transparent-background CSS is injected by
   * the engine's `initTransparentBackground` helper, so authors should
   * not paint a fullscreen `body` / `#root` background in their
   * compositions when targeting alpha output.
   */
  format?: RenderOutputFormat;
  /** GIF Netscape loop count. 0 means infinite looping. Only used with `format: "gif"`. */
  gifLoop?: number;
  workers?: number;
  useGpu?: boolean;
  debug?: boolean;
  /** Strict rejects correctness warnings; best-effort returns a qualified outcome. */
  strictness?: RenderStrictness;
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
  /**
   * True when `outputResolution` was normalized from an aspect-agnostic alias
   * (`1080p`, `hd`, `4k`, `uhd`) rather than a preset that names its own
   * orientation (`landscape`, `portrait`, `1080p-portrait`, …). Set by the
   * CLI + server layers via `isAspectAgnosticResolutionAlias(rawInput)` at
   * flag/body parse time.
   *
   * When true, the compile stage adapts the preset to the composition's
   * orientation before calling `resolveDeviceScaleFactor` — a portrait
   * 1080×1920 composition with `--resolution 1080p` (normalized to
   * `landscape`) is re-mapped to `portrait`, honoring the user's intent
   * ("render at 1080p") without forcing them to know the aspect-suffixed
   * alias (`1080p-portrait`). Explicit orientation presets stay strict.
   */
  outputResolutionAspectAgnostic?: boolean;
}

export interface RenderPerfSummary {
  renderId: string;
  totalElapsedMs: number;
  fps: number;
  quality: string;
  workers: number;
  /**
   * Provenance of the auto worker-sizing decision (undefined when the
   * htmlInCanvas / low-memory pins short-circuited sizing). `boundBy` names
   * the binding constraint; the heap fields are the advisory budget being
   * validated by fleet telemetry before enforcement — see
   * `computeWorkerSizing` in @hyperframes/engine.
   */
  workerSizing?: WorkerSizing;
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
  /**
   * Median per-frame capture time from the engine's per-frame samples —
   * warmup-robust (first frames pay font/image decode) and free of stage
   * setup amortization, unlike `captureAvgMs`. From the session that
   * captured the most frames when parallel workers report separately.
   */
  captureP50Ms?: number;
  /** Worst sub-composition timeline wait outcome across sessions. */
  subTimelineWait?: SubTimelineWaitOutcome;
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
    verifiedFrames?: number;
    reusedFrames: number;
    skipReason?: string;
    verificationOutcomes?: StaticVerificationOutcome[];
    plannedRuns?: number;
    completedRuns?: number;
    screenshots?: number;
    seeks?: number;
    comparisons?: number;
    verificationElapsedMs?: number;
  };
  /**
   * BeginFrame no-damage reuse outcome for this render (Linux/Docker),
   * aggregated across the sequential session or all parallel workers: frames
   * Chrome reported unchanged (`hasDamage=false` → previous buffer reused via
   * the engine's lastFrameCache) vs frames freshly encoded. The BF counterpart
   * of `staticDedup` (predictive dedup never arms under beginframe); the
   * static-frame fraction is noDamageFrames / (noDamageFrames + hasDamageFrames).
   * Undefined when no session captured in beginframe mode.
   *
   * Like every metric aggregated from `dedupPerfs` (staticDedup, drawElement,
   * subTimelineWait), a partial-capture RETRY replaces the counters with the
   * final attempt's set (see the reset in executeDiskCaptureWithAdaptiveRetry)
   * — after a missing-range retry the counts cover only the recaptured ranges,
   * not the whole render, so noDamage + hasDamage may be < totalFrames.
   */
  beginFrameReuse?: {
    noDamageFrames: number;
    hasDamageFrames: number;
  };
  /**
   * drawElement fast-capture outcome for this render (default-on release
   * visibility). Undefined when no capture session ran.
   */
  drawElement?: {
    /** Final capture mode: "drawelement" | "screenshot" | "beginframe" (|-joined if workers diverge). */
    mode: string;
    /** Compile-time gate that disabled default DE: 3d | mix_blend_mode | shader_transitions. */
    compileGate?: string;
    /** Producer clamp that disabled default DE: parallel | disk_path. */
    clampReason?: string;
    /** Auto-parallel inversion outcome: "inverted" (fired, held), "reverted" (fired, self-verify retry rolled back), "none". */
    workerInversion?: string;
    /** Worker count the auto-resolution chose BEFORE the inversion pinned it to 1 — the parallel counterfactual for speedup math. Only set when the inversion fired. */
    preInversionWorkers?: number;
    /** Rough compiled-composition element count — the variable the short-comp inversion band is gated on. Always set. */
    compositionElementCount?: number;
    /** Rough compiled-composition element-count provenance: "live" (probe DOM) | "static" (source scan, not trusted to open the band). */
    compositionElementCountSource?: "live" | "static";
    /** Short-comp band attribution: "applied" | "skipped_elements" | "unmeasured"; unset when the frame count made the band irrelevant. */
    shortBand?: "applied" | "skipped_elements" | "unmeasured";
    /** DE parallel-router outcome: "routed" (fired, held), "reverted" (fired, self-verify retry rolled back), "none". Mutually exclusive with workerInversion. */
    parallelRouter?: string;
    /** Worker count the auto-resolution chose BEFORE the router pinned it to 3 — the single-worker-inversion counterfactual. Only set when the router fired. */
    preRouterWorkers?: number;
    /** Engine init-time gate: swiftshader | css_effect:* | at_risk_timeline | 3d_init_failed | supersampling | render_mode_hint. */
    gateReason?: string;
    /** Low-cardinality GPU bucket from DE session init (`<backend>/<vendor>`, e.g. `d3d11/nvidia`); |-joined across parallel sessions (bounded: one bucket per distinct backend on the host). */
    gpuRenderer?: string;
    /** Worker-encode drain (the verified path) was active. */
    workerEncode: boolean;
    /** Self-verification ground-truth samples armed at init. */
    verifyArmed: number;
    /** Samples actually compared at drain time. */
    verifyChecked: number;
    /** Minimum PSNR across checked samples (dB; margin above the 32dB threshold). */
    verifyMinDb?: number;
    /** Init cost of capturing ground truth (ms). */
    verifyInitMs: number;
    /**
     * SELF-VERIFICATION tripped (blank/PSNR) and the render re-ran via
     * screenshot. Narrowed since the pinned-fallback retry was widened
     * (review): OOM/generic-capture-error fallbacks report FALSE here —
     * `fallbackReason` being set is the "any fallback fired" signal.
     */
    selfVerifyFallback: boolean;
    /** What tripped the fallback retry: psnr | blank | oom | capture_error. */
    fallbackReason?: string;
    /** The failing PSNR (dB) when `fallbackReason === "psnr"`; undefined for blank/oom/capture_error (no score exists). */
    fallbackFailedDb?: number;
    /** Frame index the verification failure was detected at; set for both "psnr" and "blank" fallback reasons. */
    fallbackFrameIndex?: number;
    /** The HF_DE_VERIFY_MIN_DB threshold the failing dB breached; only set alongside fallbackFailedDb (psnr reason). */
    fallbackThresholdDb?: number;
    /** Blank-guard counters. */
    blankSuspects: number;
    blankDeterministicAccepts: number;
    blankRecaptures: number;
    /** Clip-cut boundary frames captured via per-frame screenshot. */
    boundaryFrames: number;
    /** Per-frame "No cached paint record" screenshot fallbacks. */
    ncprFallbacks: number;
  };
  /**
   * Render-host facts, captured from the orchestrator process. Lets fleet-wide
   * telemetry correlate render performance with the machine it ran on — most
   * importantly `cpuCount` vs the top-level `workers` (are we under-/over-
   * subscribing cores?) and `totalMemMb` (does `lowMemoryMode` / single-worker
   * collapse track real memory pressure?). `gpuDisabled` completes the GPU
   * picture alongside `observability.browserGpuMode`.
   *
   * Reflects the ORCHESTRATOR host. For distributed renders the chunk workers
   * may run on different machines; this is still the right signal for the
   * common single-machine render. Optional for back-compat with serialized
   * older summaries.
   */
  host?: {
    platform: string;
    arch: string;
    cpuCount: number;
    totalMemMb: number;
    nodeVersion: string;
    gpuDisabled: boolean;
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
  outcome?: RenderOutcome;
  warnings: RenderWarning[];
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
    /** Worst sub-composition timeline wait outcome across sessions captured before the failure. */
    subTimelineWait?: SubTimelineWaitOutcome;
  };
}

export type ProgressCallback = (job: RenderJob, message: string) => void | Promise<void>;

export class RenderQualityError extends Error {
  constructor(readonly warnings: readonly RenderWarning[]) {
    super(
      `Render blocked by ${warnings.length} correctness warning${warnings.length === 1 ? "" : "s"}: ` +
        warnings.map((warning) => warning.code).join(", "),
    );
    this.name = "RenderQualityError";
  }
}

export function applyRenderWarningPolicy(
  job: RenderJob,
  captureWarnings: readonly CaptureWarning[],
  log: ProducerLogger = defaultLogger,
): void {
  job.warnings ??= [];
  const existing = new Set(
    job.warnings.map((warning) => `${warning.code}:${JSON.stringify(warning.details ?? {})}`),
  );
  for (const warning of captureWarnings) {
    const key = `${warning.code}:${JSON.stringify(warning.details ?? {})}`;
    if (existing.has(key)) continue;
    existing.add(key);
    job.warnings.push({
      ...cloneCaptureWarning(warning),
      stage: "capture-readiness",
    });
  }
  if (job.warnings.length === 0) return;

  const strictness = job.config.strictness ?? "best-effort";
  const typedRetryability = job.warnings.flatMap((warning) =>
    warning.details?.retryable === undefined ? [] : [warning.details.retryable],
  );
  log.warn("Render completed capture with correctness warnings", {
    strictness,
    warningCodes: job.warnings.map((warning) => warning.code),
    warningReasons: job.warnings.flatMap((warning) => warning.details?.failureReasons ?? []),
    warningStages: job.warnings.flatMap((warning) => warning.details?.failureStages ?? []),
    warningOwners: job.warnings.flatMap((warning) =>
      warning.details?.failureOwner ? [warning.details.failureOwner] : [],
    ),
    warningRetryable:
      typedRetryability.length === 0
        ? undefined
        : typedRetryability.every((retryable) => retryable),
  });
  const hasAudioProcessingFailure = job.warnings.some(
    (warning) => warning.code === "audio_processing_failed",
  );
  // A script failure means the composition's GSAP timelines can never
  // register — the render produces a degenerate 2-frame output that looks
  // like a still image. Fail loudly rather than shipping garbage (#3352).
  const hasSubTimelineScriptFailure = job.warnings.some(
    (warning) => warning.code === "sub_timeline_script_failure",
  );
  if (strictness === "strict" || hasAudioProcessingFailure || hasSubTimelineScriptFailure) {
    throw new RenderQualityError(job.warnings);
  }
}

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

export function createRenderFileLogger(
  logPath: string,
  base: ProducerLogger = defaultLogger,
): ProducerLogger {
  const write = (prefix: string, args: unknown[]) => {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${prefix} ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`;
    try {
      appendFileSync(logPath, line);
    } catch (err) {
      base.debug("Debug log write failed", {
        logPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
  const wrap = (level: "error" | "warn" | "info" | "debug", prefix: string) => {
    return (message: string, meta?: Record<string, unknown>) => {
      write(prefix, meta ? [message, meta] : [message]);
      base[level](message, meta);
    };
  };
  return {
    error: wrap("error", "ERR"),
    warn: wrap("warn", "WRN"),
    info: wrap("info", "LOG"),
    debug: wrap("debug", "DBG"),
    isLevelEnabled: (level) => base.isLevelEnabled?.(level) ?? true,
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
    // A capture worker can leave a zero/one-byte placeholder behind when it
    // exits between creating the destination and writing the image. FFmpeg's
    // image2 demuxer treats that as end-of-sequence but still exits 0, which
    // used to let a truncated video be reported as successful. Real JPEG and
    // PNG captures are necessarily larger than their 8-byte file signatures.
    const missing = !existsSync(framePath) || statSync(framePath).size <= 8;
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

/**
 * The capture mode this render will REPORT, pre-capture.
 *
 * BeginFrame is Linux-only. Both real entry points enforce that —
 * `frameCapture`'s preMode (`headlessShell && isLinux && !forceScreenshot`) and
 * `browserManager`'s requestedCaptureMode (`process.platform === "linux"`) —
 * but the observability field derived the mode from `forceScreenshot` alone,
 * with no platform test. Every non-Linux render that did not force screenshot
 * therefore reported `beginframe` for a capture that was really screenshot:
 * 30,625 Windows renders over 14 days, a fifth of the fast-capture dashboard's
 * capture-mode data.
 *
 * `config.ts` documents this same failure for "darwin + software" and adds a
 * `forceScreenshot` clamp as defence-in-depth — but that clamp only fires on
 * software GPU, so Windows-on-hardware slipped straight past it (41,102 of the
 * mislabelled renders).
 *
 * NECESSARY, NOT SUFFICIENT — read this before trusting the value on Linux.
 * The platform test is the only condition modelled here. Linux BeginFrame
 * additionally requires a headless-shell binary, no supersampling, no
 * transparent drawElement route (`frameCapture.ts` preMode) and the
 * `--enable-begin-frame-control` flag (`browserManager.ts`). Any of those can
 * make the ACTUAL mode screenshot while this still reports `beginframe`, so a
 * Linux `beginframe` reading is an upper bound, not a fact. The authoritative
 * value is the session's own `launchCaptureMode` — the same field the runtime
 * video gate already falls back to. Deriving this field from the resolved
 * session instead of from config is the real fix and is deliberately NOT in
 * this change: it closes the Windows mislabel, which is platform-only and
 * needs no session plumbing.
 *
 * Pure; exported for tests.
 */
export function resolveObservedCaptureMode(
  forceScreenshot: boolean,
  platform: NodeJS.Platform = process.platform,
): "screenshot" | "beginframe" {
  return forceScreenshot || platform !== "linux" ? "screenshot" : "beginframe";
}

/**
 * Build the observability patcher, re-deriving `captureMode` on every patch.
 *
 * Extracted and exported because the previous inline closure was where the
 * Windows mislabel actually lived. Seeding `captureMode` correctly at
 * construction is NOT sufficient: this updater is invoked at 23 sites through
 * the pipeline, and one of them —
 * `updateCaptureObservability({ forceScreenshot: captureForceScreenshot })`
 * straight after compile — runs unconditionally on every render. The old body
 * re-derived from `forceScreenshot` alone, so the seeded value was overwritten
 * with `beginframe` again before capture began, and both the success and error
 * telemetry emits read the reverted object. A helper-only test cannot catch
 * that: it never round-trips through this closure. Hence the export.
 */
export function createCaptureObservabilityUpdater(
  observability: RenderCaptureObservability,
  platform: NodeJS.Platform = process.platform,
): (patch: Partial<RenderCaptureObservability>) => void {
  return (patch: Partial<RenderCaptureObservability>): void => {
    Object.assign(observability, patch);
    observability.captureMode = resolveObservedCaptureMode(
      Boolean(observability.forceScreenshot),
      platform,
    );
  };
}

export function getNextRetryWorkerCount(currentWorkers: number): number {
  return Math.max(1, Math.floor(currentWorkers / 2));
}

export function resolveRenderWorkDirPrefix(
  outputPath: string,
  jobId: string,
  platform: NodeJS.Platform = process.platform,
  systemTempDir: string = tmpdir(),
): string {
  if (platform === "win32") return join(systemTempDir, "hf-render-");
  return join(dirname(outputPath), `work-${jobId}-`);
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

export function resetCaptureAttemptProgress(job: { framesRendered?: number }): void {
  job.framesRendered = 0;
}

export function isRecoverableParallelCaptureError(error: unknown): boolean {
  const message = normalizeErrorMessage(error);
  if (!message.includes("[Parallel] Capture failed")) return false;
  const kind = classifyCaptureFailure(error).kind;
  return kind === "transient_browser" || kind === "protocol_timeout";
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
      const failure = classifyCaptureFailure(error, { signal: options.abortSignal });
      // A cancelled render tears the browser down, which surfaces as a
      // transient-looking `Target closed`. Rethrow immediately so cancellation
      // never burns a retry (or logs a misleading transient-failure warning) —
      // the caller's abort handling owns cancellation.
      if (failure.kind === "cancelled") {
        throw error;
      }
      // A drawElement self-verify breach (a parallel disk worker's sampled
      // frame diverged from its pre-injection ground truth) is a CORRECTNESS
      // failure, not a missing-frame one: the damaged frames are written
      // complete to disk, so the presence/size-only findMissingFrameRanges
      // below would count them present and wrongly return success — shipping
      // the exact compositor damage this verify exists to catch. Rethrow so
      // the orchestrator's disk-stage screenshot retry fires (mirrors the
      // `cancelled` guard; a worker-halving retry here would only re-run
      // drawElement and re-damage). Structural detection walks the aggregated
      // CaptureFailure → worker CaptureFailure → DrawElementVerificationError
      // cause chain.
      if (isDrawElementVerificationError(error)) {
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
        failure.kind === "transient_browser" &&
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
    config: {
      ...config,
      fps: toFps(config.fps),
      strictness: config.strictness ?? "best-effort",
    },
    status: "queued",
    progress: 0,
    currentStage: "Queued",
    createdAt: new Date(),
    warnings: [],
  };
}

function normalizeCompositionSrcPath(srcPath: string): string {
  return srcPath.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Read the `data-duration` off a scene file's `<template>` root — the scene's
 * own authored length. linkedom does not implement inert `<template>` content,
 * so we re-parse `template.innerHTML` (the pattern htmlBundler uses) to reach
 * the composition root inside it. Returns null when the file has no template
 * or the root declares no duration.
 */
function readSceneRootDuration(entryHtml: string | undefined): string | null {
  if (!entryHtml) return null;
  const { document } = parseHTML(entryHtml);
  const template = document.querySelector("template");
  const scope = template ? parseHTML(template.innerHTML).document : document;
  const root = scope.querySelector("[data-composition-id]") as Element | null;
  return root?.getAttribute("data-duration") ?? null;
}

function createStandaloneEntryRenderClone(
  root: Element,
  host: Element,
  sceneDuration: string | null,
): Element {
  // linkedom's cloneNode returns `any` (not `Node`), so the Element cast
  // is needed to access setAttribute/appendChild without losing type safety.
  const hostClone = host.cloneNode(true) as Element;
  hostClone.setAttribute("data-start", "0");

  if (root === host) return hostClone;

  const rootClone = root.cloneNode(false) as Element;
  // The standalone composition IS the mounted scene, not the master shell that
  // wraps it. A shallow clone of the master root otherwise keeps the master's
  // data-duration (the whole project's length), so `render -c <scene>` rendered
  // the scene for the entire project duration — or threw "Composition has zero
  // duration" when the master derived its length from siblings now removed.
  // Re-point the wrapper's duration at the scene's own; drop it (derive from the
  // single child) only when the scene declared none.
  if (sceneDuration != null) {
    rootClone.setAttribute("data-duration", sceneDuration);
  } else {
    rootClone.removeAttribute("data-duration");
  }
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
  cfg: Pick<EngineConfig, "enableStreamingEncode" | "streamingEncodeMaxDurationSeconds"> &
    Partial<Pick<EngineConfig, "lowMemoryMode">>,
  outputFormat: NonNullable<RenderConfig["format"]>,
  workerCount: number,
  // Composition timeline duration in seconds.
  durationSeconds: number,
  // Per-render override (set by the DE parallel router) — see
  // deParallelStreamForced's declaration in executeRenderJob for why this is
  // a parameter instead of an env-var read.
  forceParallelStream = false,
): boolean {
  if (!cfg.enableStreamingEncode) return false;
  if (outputFormat === "png-sequence") return false;
  if (outputFormat === "gif") return false;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
  // Low-memory mode already pins capture to one worker. Keep those renders on
  // the streaming path regardless of duration so captured frames are drained
  // directly into FFmpeg instead of accumulating hundreds of gigabytes of
  // data URIs / disk frames until Chrome OOMs.
  if (!cfg.lowMemoryMode && durationSeconds > cfg.streamingEncodeMaxDurationSeconds) return false;
  // HF_DE_PARALLEL_STREAM (manual opt-in) / forceParallelStream (router):
  // allow multi-worker streaming for the interleaved drawElement produce
  // path. Contiguous-chunk parallel streaming stalls (worker k+1's first
  // frame waits for ALL of worker k's), so this only makes sense with the
  // interleaved distribution the capture stage selects under the same
  // condition.
  if (forceParallelStream || process.env.HF_DE_PARALLEL_STREAM === "true") return true;
  return workerCount === 1;
}

/**
 * Integer tuning knob from the environment. Matches the convention the
 * surrounding DE thresholds already use: unset OR set-but-empty falls back to
 * the default (a blank var is not a kill switch), and so does anything
 * non-numeric — a typo must never silently disable a routing guard.
 */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  // Integer-only, per the name: a fractional threshold would compare
  // sensibly against integer counts but silently means something the knob
  // never promised, so treat it as a typo and fall back (review nit).
  return Number.isInteger(parsed) ? parsed : fallback;
}

/**
 * Rough element count for compiled composition HTML.
 *
 * Deliberately a string scan and not a `parseHTML` + `querySelectorAll` (the
 * `countAuthoredTimedClips` approach): this runs on EVERY render before the
 * routing decision, and a full linkedom parse of the exact documents that
 * matter here — the 20k-40k node ones — is the most expensive case. Precision
 * is not needed. It feeds a threshold whose measured crossover is ~3.9k and
 * whose default sits at 2500, so tag counting is comfortably inside the
 * margin — PROVIDED the count is not unboundedly low for some real content
 * shape. Three sources are counted, each catching a case the others miss:
 *
 *   1. Closing tags (`</div>`) — the base count for ordinary HTML.
 *   2. Named HTML void elements (`<img>`, `<br>`, …), bare or self-closed —
 *      voids matter because they skew EXPENSIVE to paint (images), and
 *      counting only closers would read an image gallery as a tiny comp and
 *      open the band on exactly the content most likely to lose it.
 *   3. Any self-closing tag (`<circle/>`, `<path d="…"/>`) — SVG's own
 *      elements are neither closing-tag-shaped nor in the void list, so
 *      without this a self-closing-SVG-heavy composition (`<circle/>` x 40k)
 *      counted as ZERO — an unbounded undercount, not a rounding error, and
 *      exactly the shape of comp the 1.8x regression case is made of
 *      (review finding: the ceiling cannot compensate for an error with no
 *      bound).
 *
 * Opening (non-self-closing, non-void) tags are deliberately NOT counted:
 * compiled comps embed inline scripts, and `a < b` or `x <breadth` would
 * false-positive on a bare `<letter` scan. All three counted forms require a
 * literal closing marker (`</`, a void name at a word boundary, or `/>`), so
 * ordinary JS comparisons and divisions don't qualify — verified by test.
 *
 * FALLBACK ONLY as of the live-DOM fix below — a string scan of the SOURCE
 * markup cannot see elements a composition's own script creates at runtime
 * (`document.createElement`), which is an unbounded undercount no regex can
 * close: `style-10-prod`'s per-transcript-word caption generator measures 2
 * source tags against thousands of live nodes after init (review finding).
 * `resolveCompositionElementCount` prefers the initialized probe session's
 * live count and uses this only when no such session exists.
 */
export function countElementTags(html: string): number {
  // Strip inline <script>/<style> bodies BEFORE matching. Every alternation
  // below can fire on ordinary JS text — `const html = "</div>"` or a
  // template literal building `</span>` inflates the count once per
  // occurrence — and compiled comps embed large inline scripts. That bias is
  // systematic, not noise, and it lands entirely on the ~83% of renders with
  // no probe session, for which this scan is the only element signal (review
  // finding). Removing the bodies also drops their own closing tags, which
  // costs 1-2 counts against a threshold in the thousands.
  // Looped to a fixed point rather than a single pass: one pass can REFORM
  // the pattern it just removed (`<scr<script>ipt>` leaves `<script>`), which
  // CodeQL flags as incomplete multi-character sanitization. The impact here
  // is nil — the stripped string is counted and discarded, never rendered —
  // but the incompleteness is real, and a stray reformed tag would perturb
  // the count this gate reads. Converges: every iteration strictly shortens
  // the string or changes nothing and exits.
  let markup = html;
  for (let previous = ""; markup !== previous; ) {
    previous = markup;
    markup = markup.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  }
  const matches = markup.match(
    /<\/[a-zA-Z]|<(?:img|br|hr|input|source|track|area|base|col|embed|link|meta|param|wbr)\b|<[a-zA-Z][-a-zA-Z0-9]*\b[^>]*\/>/gi,
  );
  return matches === null ? 0 : matches.length;
}

/**
 * Element count for the short-comp band's gate, WITH PROVENANCE.
 *
 * `live` — measured from the initialized probe session's real DOM. This is
 * the only trustworthy source: it sees elements a composition's own script
 * created after load, which no scan of the source markup can (the
 * caption-word-span pattern above builds thousands of nodes from two source
 * tags).
 *
 * `static` — the `countElementTags` fallback. Emitted for diagnostics, but
 * NOT trusted to open the band: the probe is conditional (see
 * `probeStage.ts`'s `needsBrowser` — only unknown duration, unresolved
 * compositions, or specific media cases launch one), so a known-duration,
 * media-free composition that builds 40k nodes in script gets no probe, and
 * a static count that says "2". Treating that as measured would admit
 * exactly the regression case the ceiling exists to exclude (review finding,
 * R4). The caller fails closed on anything but `live`.
 *
 * These semantics are FROZEN while the short-band baseline is being read —
 * the fleet distribution recorded by the baseline release must be measured
 * by the same resolver that later gates routing, or the baseline is invalid.
 */
export async function resolveCompositionElementCount(
  probeSession: Pick<CaptureSession, "isInitialized" | "page"> | null,
  html: string,
): Promise<{ count: number; source: "live" | "static" }> {
  if (probeSession?.isInitialized) {
    try {
      const liveCount = await probeSession.page.evaluate(
        // Live HTMLCollection length — avoids materializing a static NodeList
        // on the large-DOM comps this gate exists to catch (review nit).
        () => document.getElementsByTagName("*").length,
      );
      if (typeof liveCount === "number" && Number.isFinite(liveCount)) {
        return { count: liveCount, source: "live" };
      }
    } catch {
      // Probe page evaluate can fail (navigation mid-flight, detached frame,
      // page crash) — fall through to the static scan rather than block the
      // render on a routing-gate measurement.
    }
  }
  return { count: countElementTags(html), source: "static" };
}

/**
 * Max-merge init telemetry across per-worker capture perf summaries — the
 * success-path channel for PARALLEL renders, whose worker console buffers
 * (and so the `[FrameCapture:INIT]` line) only propagate on failure. Max
 * matches summarizeInitObservability's own multi-session semantics: keep the
 * worst observed startup cost for duration. Tween count is per-composition,
 * so workers should agree — max is a defensive read against a worker that
 * initializes before the timeline is fully wired, not an expected disagreement.
 */
export function mergeWorkerInitObservability(
  perfs: ReadonlyArray<{
    initDurationMs?: number;
    initTweenCount?: number;
    initElementCount?: number;
  }>,
): { initDurationMs?: number; tweenCount?: number; elementCount?: number } | undefined {
  let initDurationMs: number | undefined;
  let tweenCount: number | undefined;
  let elementCount: number | undefined;
  for (const perf of perfs) {
    if (perf.initDurationMs !== undefined) {
      initDurationMs =
        initDurationMs === undefined
          ? perf.initDurationMs
          : Math.max(initDurationMs, perf.initDurationMs);
    }
    if (perf.initTweenCount !== undefined) {
      tweenCount =
        tweenCount === undefined ? perf.initTweenCount : Math.max(tweenCount, perf.initTweenCount);
    }
    // Max across workers: every worker loads the same composition, so they
    // should agree — max is defensive against a worker sampled before its
    // init script finished populating the DOM.
    if (perf.initElementCount !== undefined) {
      elementCount =
        elementCount === undefined
          ? perf.initElementCount
          : Math.max(elementCount, perf.initElementCount);
    }
  }
  if (initDurationMs === undefined && tweenCount === undefined && elementCount === undefined) {
    return undefined;
  }
  return { initDurationMs, tweenCount, elementCount };
}

/**
 * The short-comp band's attribution decision, extracted as a pure function so
 * the gating fixes below are independently testable rather than living inline
 * where only a full render pipeline run could exercise them.
 *
 * A value is emitted ONLY when the band is DECISIVE — every other
 * inversion-eligibility condition already passed (both floor evaluations
 * agree on everything except which floor they used) and the band floor alone
 * flipped the answer. `bandEnabled` gates that decisiveness itself:
 * `HF_DE_SHORT_MAX_ELEMENTS=0` is a documented kill switch (symmetric with
 * `HF_DE_SHORT_MIN_FRAMES=0`, which already disables via the predicate's own
 * `minFrames > 0` guard), and without this gate a fired kill switch left
 * every in-band render decisive against a real floor comparison — reporting
 * "skipped_elements" (comp too large) instead of undefined (band disabled)
 * and corrupting the DiD control cohort with kill-switched renders (review
 * finding).
 *
 * Three decisive outcomes, and the distinction between the last two is the
 * point:
 *   "applied"          — measured LIVE and under the ceiling. Only this
 *                        routes (once HF_DE_SHORT_BAND_ROUTE is on) and only
 *                        this joins the treatment cohort.
 *   "skipped_elements" — measured live, over the ceiling. A real oversize
 *                        observation; the DiD control group.
 *   "unmeasured"       — no live DOM count available (no probe session ran;
 *                        see `resolveCompositionElementCount`). FAILS CLOSED:
 *                        never routes, and kept out of BOTH cohorts so a
 *                        static undercount cannot masquerade as a small comp
 *                        (review finding, R4). Emitted rather than dropped
 *                        because its fleet rate sizes the population a
 *                        future conditional-probe-launch would unlock.
 */
export function resolveDeShortBand(args: {
  invertAtBaseFloor: boolean;
  invertAtBandFloor: boolean;
  bandEnabled: boolean;
  bandOpen: boolean;
  elementCountSource: "live" | "static";
}): "applied" | "skipped_elements" | "unmeasured" | undefined {
  const decisive = args.bandEnabled && args.invertAtBandFloor && !args.invertAtBaseFloor;
  if (!decisive) return undefined;
  if (args.elementCountSource !== "live") return "unmeasured";
  return args.bandOpen ? "applied" : "skipped_elements";
}

/**
 * DE priority inversion predicate: should an AUTO-resolved multi-worker render
 * drop to single-worker verified drawElement streaming?
 *
 * Benchmarked 2026-07-08: above ~900 frames DE-single beats screenshot-parallel
 * at every worker count (2,380f: 66s vs 109–127s at W2–W5); below it DE's fixed
 * init cost (verify + dedup arming) loses by a small margin. Only fires for the
 * exact benchmarked configuration: default-on DE, mp4, streaming-eligible,
 * no compile gate, no forced screenshot, workers not explicitly requested.
 */
export function shouldPreferSingleWorkerDrawElement(args: {
  workerCount: number;
  /** job.config.workers — a number means the user explicitly chose. */
  requestedWorkers: number | "auto" | undefined;
  useDrawElement: boolean;
  deCompileGate: string | undefined;
  forceScreenshot: boolean;
  outputFormat: NonNullable<RenderConfig["format"]>;
  totalFrames: number;
  /** Amortization threshold; <=0 disables the inversion. */
  minFrames: number;
  /** shouldUseStreamingEncode(cfg, format, 1, duration) at the call site. */
  singleWorkerStreamingOk: boolean;
  /**
   * Comp routes to the layered-composite / page-side-compositing paths
   * (HDR content or shader transitions) — those force screenshots and never
   * run drawElement or streaming, so an inversion would only mislabel
   * telemetry and keep the probe session alive through the heaviest stage.
   */
  layeredOrEffectRoute: boolean;
  /** deviceScaleFactor > 1 — the engine's supersampling gate blocks DE. */
  supersampling: boolean;
  /**
   * The probe session already ran the engine's init-time DE gates and DE did
   * NOT engage (not drawelement mode, not a deferred video comp) — inverting
   * would pin a known-screenshot render to one worker.
   */
  probeDeGated: boolean;
  /**
   * PRODUCER_EXPERIMENTAL_FAST_CAPTURE=true is an explicit opt-in that
   * deliberately allows parallel drawElement (bypassing the downstream
   * clamp) — honor it like an explicit --workers request.
   */
  experimentalParallelDeOptIn: boolean;
}): boolean {
  return (
    args.workerCount > 1 &&
    typeof args.requestedWorkers !== "number" &&
    args.useDrawElement &&
    !args.deCompileGate &&
    !args.forceScreenshot &&
    args.outputFormat === "mp4" &&
    args.minFrames > 0 &&
    args.totalFrames >= args.minFrames &&
    args.singleWorkerStreamingOk &&
    !args.layeredOrEffectRoute &&
    !args.supersampling &&
    !args.probeDeGated &&
    !args.experimentalParallelDeOptIn
  );
}

/**
 * Plan the self-verify retry for an inverted render: the inversion bet on
 * drawElement and lost, so the re-render returns to the pre-inversion parallel
 * screenshot path (streaming re-resolved for that worker count — multi-worker
 * routes to the disk stage). Returns null when the render was not inverted.
 *
 * On OOM specifically, the retry drops to a single worker regardless of the
 * pre-inversion count — an actual memory remedy (one Chrome page instead of
 * N), not just a different capture mode at the same parallelism the host
 * already choked on. The pre-inversion count can be higher than what the DE
 * path used (calibration's own pick), so reusing it unmodified on an
 * OOM-triggered retry would re-run at equal or greater parallelism than the
 * failure, worsening the odds for this render and anything sharing the host.
 */
export function resolveInversionRetryPlan(args: {
  deWorkerInversion: "inverted" | "reverted" | undefined;
  preInversionWorkerCount: number;
  cfg: Pick<EngineConfig, "enableStreamingEncode" | "streamingEncodeMaxDurationSeconds">;
  outputFormat: NonNullable<RenderConfig["format"]>;
  durationSeconds: number;
  isMemoryExhaustion: boolean;
}): {
  workerCount: number;
  useStreamingEncode: boolean;
  deWorkerInversion: "reverted";
} | null {
  if (args.deWorkerInversion !== "inverted") return null;
  const workerCount = args.isMemoryExhaustion ? 1 : args.preInversionWorkerCount;
  return {
    workerCount,
    useStreamingEncode: shouldUseStreamingEncode(
      args.cfg,
      args.outputFormat,
      workerCount,
      args.durationSeconds,
    ),
    deWorkerInversion: "reverted",
  };
}

/**
 * DE parallel-router predicate: should an AUTO-resolved multi-worker render
 * use VERIFIED PARALLEL drawElement streaming (HF_DE_PARALLEL_STREAM) instead
 * of the #2026 single-worker inversion?
 *
 * Benchmarked 2026-07-08 (clean, quiet-machine re-run): par3/single 1.16–1.36x
 * on real-work comps ≥2,000 frames (2,381f GSAP graphics 1.36x, 3,245f rAF
 * high-variance 1.29x, 915f crossover probe 1.27x); the one comp that didn't
 * clear 1.25x (3,600f, 39% static/dedup-heavy) still didn't LOSE to single-
 * worker (1.16x) — dedup already skips the capture work parallelism would
 * split, so there's mechanically less headroom, not a regression. No comp
 * anywhere showed par3 < single. Default ON since 2026-07-27
 * (HF_DE_PARALLEL_ROUTER=false is the kill switch): the default-off soak
 * proved the safety half (zero shipped damage, 100% revert recovery), so the
 * flip trades an accepted ~2.3% revert rate for parallelizing the ≥700f
 * band. This promotes the opt-in mechanism from #2056 into the auto-routing
 * decision.
 * Takes priority over the single-worker inversion when both would fire.
 * Re-calibrated 2026-07-27: a controlled crossover sweep (three content
 * profiles including a genuinely init-expensive 24-sub-composition comp;
 * worker counts and capture modes verified per run) found par3 > single at
 * every size from 350f up in every profile — workers init concurrently, so
 * per-worker init duplication costs CPU, not wall-clock. minFrames therefore
 * dropped below the inversion's threshold (700 vs 900): where both fire,
 * parallel wins over the inversion's single-worker pick (+17–21% at 700f).
 */
/**
 * Is the DE parallel router enabled for this process?
 *
 * Default ON since 2026-07-27; `HF_DE_PARALLEL_ROUTER` is the kill switch.
 * Every conventional spelling of "off" disables it — a naive
 * `!== "false"` would silently ignore `0`, `off`, `no`, `FALSE`, and an
 * exported-but-empty var, i.e. an opt-out that FAILS OPEN and hands the user
 * 3-worker parallel DE anyway (review finding). A set-but-empty value means
 * "unset" here, matching how the sibling HF_DE_* numeric knobs treat it.
 *
 * The CLI's circuit breaker relies on this accepting an explicit "false":
 * once an install trips the breaker it writes that value rather than
 * unsetting the var, because under a default-ON flag unsetting means ON.
 * Pure; exported for tests.
 */
export function isDeParallelRouterEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const raw = env.HF_DE_PARALLEL_ROUTER?.trim().toLowerCase();
  if (raw === undefined || raw === "") return true;
  return !(raw === "false" || raw === "0" || raw === "off" || raw === "no");
}

export function shouldPreferParallelDrawElement(args: {
  workerCount: number;
  /** job.config.workers — a number means the user explicitly chose. */
  requestedWorkers: number | "auto" | undefined;
  useDrawElement: boolean;
  deCompileGate: string | undefined;
  forceScreenshot: boolean;
  outputFormat: NonNullable<RenderConfig["format"]>;
  totalFrames: number;
  /** Amortization threshold; <=0 disables the router. */
  minFrames: number;
  layeredOrEffectRoute: boolean;
  supersampling: boolean;
  probeDeGated: boolean;
  experimentalParallelDeOptIn: boolean;
  /** HF_DE_PARALLEL_ROUTER !== "false" — default ON since 2026-07-27; env var is the kill switch. */
  routerEnabled: boolean;
  /**
   * Whether verified parallel DE STREAMING can actually run for this render
   * (`shouldUseStreamingEncode` at the router's worker count with
   * forceParallelStream). The router's entire value is that path; without it
   * firing would pin workerCount to 3 and skip calibration while delivering
   * none of the benefit — e.g. a composition longer than
   * `streamingEncodeMaxDurationSeconds` (240 s default), where the duration
   * cap disables streaming before the router's force flag is consulted.
   */
  parallelStreamingAvailable: boolean;
  /** Machine RAM (os.totalmem, MB). */
  totalMemoryMb: number;
  /** RAM floor for routing; <=0 disables the guard. */
  minMemoryMb: number;
}): boolean {
  return (
    args.routerEnabled &&
    args.parallelStreamingAvailable &&
    args.workerCount > 1 &&
    typeof args.requestedWorkers !== "number" &&
    args.useDrawElement &&
    !args.deCompileGate &&
    !args.forceScreenshot &&
    args.outputFormat === "mp4" &&
    args.minFrames > 0 &&
    args.totalFrames >= args.minFrames &&
    !args.layeredOrEffectRoute &&
    !args.supersampling &&
    !args.probeDeGated &&
    !args.experimentalParallelDeOptIn &&
    // RAM floor: routed parallel DE runs 3 concurrent hardware-GPU Chrome
    // instances. On a 16 GB machine that produced vertical black slabs in the
    // final MP4 (wild report, CLI 0.7.52) — compositor tiles evicted under
    // GPU/memory pressure, and sampled self-verify can miss partial-frame
    // damage. Single-worker DE (the inversion) stays available below the
    // floor; only the parallel bet is withheld.
    (args.minMemoryMb <= 0 || args.totalMemoryMb >= args.minMemoryMb)
  );
}

/**
 * Plan the self-verify retry for a router-routed render: the bet on verified
 * parallel drawElement streaming lost, so the re-render falls back to the
 * pre-router worker count on the ordinary (non-DE) parallel path. Unlike
 * `resolveInversionRetryPlan`, the caller must also clear the router's
 * `deParallelStreamForced` local BEFORE calling this — `shouldUseStreamingEncode`
 * takes it as a direct argument, so a stale `true` would keep resolving to
 * the parallel-streaming shape on the retry instead of the well-tested
 * parallel-disk fallback. Returns null when the render was not router-routed.
 *
 * On OOM specifically, the retry drops to a single worker regardless of the
 * pre-router count — see `resolveInversionRetryPlan`'s doc for why (the
 * pre-router count is calibration's own pick and can exceed the router's
 * pin, e.g. calibration wanting 5 while the router pinned to 3 — reusing it
 * unmodified on an OOM retry would run the fallback at MORE parallelism than
 * what just failed).
 */
export function resolveParallelRouterRetryPlan(args: {
  deParallelRouter: "routed" | "reverted" | undefined;
  preRouterWorkerCount: number;
  cfg: Pick<EngineConfig, "enableStreamingEncode" | "streamingEncodeMaxDurationSeconds">;
  outputFormat: NonNullable<RenderConfig["format"]>;
  durationSeconds: number;
  isMemoryExhaustion: boolean;
}): {
  workerCount: number;
  useStreamingEncode: boolean;
  deParallelRouter: "reverted";
} | null {
  if (args.deParallelRouter !== "routed") return null;
  const workerCount = args.isMemoryExhaustion ? 1 : args.preRouterWorkerCount;
  return {
    workerCount,
    useStreamingEncode: shouldUseStreamingEncode(
      args.cfg,
      args.outputFormat,
      workerCount,
      args.durationSeconds,
    ),
    deParallelRouter: "reverted",
  };
}

/**
 * Should a capture-stage error retry via the pinned-worker-count fallback
 * (the same "well-tested parallel-disk / single-worker screenshot" path
 * `resolveInversionRetryPlan`/`resolveParallelRouterRetryPlan` reroute to)
 * instead of failing the render outright?
 *
 * True for the drawElement self-verify failures this retry path was
 * originally built for (blank frame / PSNR breach), AND for any OTHER
 * capture-stage failure (host-contention timeout, worker crash, OOM) while a
 * worker count was PINNED by the inversion or router — those pin regardless
 * of calibration, so a generic capture failure on that pinned count is
 * exactly the scenario the pin itself introduced risk for.
 *
 * Includes OOM (previously excluded — see PR history): every worker's
 * `executeWorkerTask` closes its capture session in a `finally` that awaits
 * `closeCaptureSession` → `releaseBrowser`, which SIGKILLs the Chrome process
 * via `forceReleaseBrowser` if a graceful `page.close()` hangs
 * (`browserManager.ts`). `Promise.all` in `executeParallelCapture` waits for
 * every worker's `finally` before this error is even thrown, so by the time
 * we're deciding whether to retry, the failed attempt's Chrome processes are
 * already gone — there's no lingering memory to retry into. And the
 * fallback itself is structurally lighter than what OOM'd: parallel DE
 * forces `enableBrowserPool: false` (N separate Chrome processes — required,
 * not incidental, to avoid a co-tenant-page compositor-starvation bug), while
 * the parallel-SS fallback uses the default pooled browser (one shared
 * process). Retrying at a possibly-higher worker count is still fewer total
 * Chrome processes than what just failed.
 *
 * Excludes cancellation (review): a user-initiated abort must propagate
 * immediately, not detour through spawning a fresh encoder/capture session
 * before the outer catch's `RenderCancelledError` branch ends the render —
 * that would delay honoring "stop" with a pointless resource spin-up/
 * tear-down cycle.
 */
export function shouldRetryViaPinnedFallback(args: {
  isVerifyError: boolean;
  isCancellation: boolean;
  isEncoderInterrupted?: boolean;
  deWorkerInversion: "inverted" | "reverted" | undefined;
  deParallelRouter: "routed" | "reverted" | undefined;
}): boolean {
  if (args.isCancellation || args.isEncoderInterrupted) return false;
  if (args.isVerifyError) return true;
  return args.deWorkerInversion === "inverted" || args.deParallelRouter === "routed";
}

/**
 * When a self-verify (or pinned-fallback) retry is triggered mid-capture, the
 * caller may still hold a live probe session that the failed stage was passed
 * but did not (or could not) close in its own `finally` before it threw. Left
 * behind, that session's Chrome process orphans until the containing render
 * exits — precisely when we are recovering from GPU/memory pressure and can
 * least afford an unaccounted Chrome. Close it before the caller clears its
 * reference; swallow any close error with a warn so the retry itself is never
 * derailed by a shutdown hiccup.
 */
export async function closeOrphanedProbeForRetry(
  probe: CaptureSession,
  closer: (session: CaptureSession) => Promise<void>,
  log: Pick<ProducerLogger, "warn">,
  retryContext: string,
): Promise<void> {
  try {
    await closer(probe);
  } catch (closeErr) {
    log.warn(`[Render] probe close before ${retryContext} retry failed; continuing with retry`, {
      error: closeErr instanceof Error ? closeErr.message : String(closeErr),
    });
  }
}

/**
 * Parallel-streaming router for NON-drawElement capture (screenshot on
 * macOS/Windows/forced-screenshot, BeginFrame on Linux): should this
 * multi-worker render stream captured frame buffers straight into the single
 * ffmpeg stdin encoder (interleaved distribution + ordered reorder-buffer
 * writer — the PR #2056 machinery) instead of the parallel disk path (workers
 * write JPEGs, a separate sequential encode pass reads them back)?
 *
 * Measured motivation (2026-07-10, macOS SS W3): the disk path's encode is a
 * purely additive tail (~27% of wall clock on a 3,600-frame comp). Streaming
 * overlapped it for 1.29x on a uniform-cost comp and was a wash (not a
 * regression) on a 39%-static bimodal comp — the interleaved writer's
 * near-lockstep coupling eats the encode win when frame costs are bimodal.
 * v1 accepts the wash; static-aware routing is a documented follow-up.
 *
 * Unlike the DE router this deliberately does NOT require auto-resolved
 * workers: streaming doesn't change the worker count, so an explicit
 * `--workers 3` should benefit too. It requires !useDrawElement
 * (post-resolveConfig — always true on Linux): DE parallel renders belong to
 * the DE parallel router (HF_DE_PARALLEL_ROUTER) with its self-verify
 * machinery; both DE predicates independently require useDrawElement, making
 * the two routers mutually exclusive by construction.
 */
export function shouldStreamParallelCapture(args: {
  /** HF_CAPTURE_PARALLEL_STREAM === "true" — kill switch, default OFF. */
  routerEnabled: boolean;
  workerCount: number;
  /** cfg.useDrawElement AFTER resolveConfig clamps. */
  useDrawElement: boolean;
  outputFormat: NonNullable<RenderConfig["format"]>;
  /** shouldUseStreamingEncode(cfg, format, 1, duration) at the call site —
   * carries the enableStreamingEncode/format/duration-cap gates. */
  streamingOk: boolean;
  /** HDR layered composite or shader transitions — bespoke pipelines
   * (including page-side compositing, which only engages when
   * hasShaderTransitions) that never stream. */
  layeredOrEffectRoute: boolean;
}): boolean {
  return (
    args.routerEnabled &&
    args.workerCount > 1 &&
    !args.useDrawElement &&
    args.outputFormat === "mp4" &&
    args.streamingOk &&
    !args.layeredOrEffectRoute
  );
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
  entryHtml?: string,
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

  // The scene file is the source of truth for its own duration; fall back to the
  // mount's data-duration (its window in the master timeline) when the scene
  // file content isn't supplied.
  const sceneDuration = readSceneRootDuration(entryHtml) ?? host.getAttribute("data-duration");

  const renderClone = createStandaloneEntryRenderClone(root, host, sceneDuration);
  replaceBodyWithRenderClone(body, renderClone);

  return document.toString();
}

/**
 * Telemetry fields a drawElement self-verify failure contributes to the
 * fallback record. Shared by the streaming and parallel-disk verify catches
 * so the `verifyDetails` → `de_fallback_*` mapping lives in one place — a new
 * field is added once, not once per capture path. `kind` is read structurally
 * off the error (never from message text), so a reworded/translated/
 * cross-module-serialized error can't flip "blank" into "psnr".
 */
function deVerifyFallbackTelemetry(err: unknown): {
  reason: "psnr" | "blank";
  failedDb?: number;
  frameIndex?: number;
  thresholdDb?: number;
} {
  const details = getDrawElementVerificationDetails(err);
  return {
    reason: details?.kind ?? "psnr",
    failedDb: roundDb(details?.failedDb),
    frameIndex: details?.frameIndex,
    thresholdDb: roundDb(details?.verifyThresholdDb),
  };
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
  progressSink?: ProgressCallback,
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
    : mkdtempSync(resolveRenderWorkDirPrefix(outputPath, job.id));
  const pipelineStart = Date.now();
  const baseLog = job.config.logger ?? defaultLogger;
  const logPath = job.config.debug ? join(workDir, "render.log") : null;
  const execution = new RenderExecutionContext({
    request: { renderJobId: job.id, projectDir, outputPath },
    logger: logPath ? createRenderFileLogger(logPath, baseLog) : baseLog,
    progressSink,
    signal: abortSignal,
  });
  const log = execution.logger;
  execution.defer("remove workDir", () => {
    if (job.config.debug) return;
    if (job.status === "complete" && process.env.KEEP_TEMP === "1") {
      log.info("KEEP_TEMP=1 — leaving workDir on disk for inspection", { workDir });
      return;
    }
    rmSync(workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  try {
    await executeRenderPipeline({
      job,
      projectDir,
      outputPath,
      workDir,
      logPath,
      pipelineStart,
      execution,
    });
  } finally {
    await execution.dispose();
  }
}

async function executeRenderPipeline(input: {
  job: RenderJob;
  projectDir: string;
  outputPath: string;
  workDir: string;
  logPath: string | null;
  pipelineStart: number;
  execution: RenderExecutionContext;
}): Promise<void> {
  const { job, projectDir, outputPath, workDir, logPath, pipelineStart, execution } = input;
  const log = execution.logger;
  const eventPublisher = execution.events;
  const onProgress = execution.onProgress;
  const executionSignal = execution.signal;
  let fileServer: FileServerHandle | null = null;
  let probeSession: CaptureSession | null = null;
  let lastBrowserConsole: string[] = [];
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
  const isPngSequence = outputFormat === "png-sequence";
  const isGif = outputFormat === "gif";
  const artifactTransaction = new ArtifactTransaction(
    outputPath,
    isPngSequence ? "directory" : "file",
  );
  const stagedOutputPath = artifactTransaction.stagingPath;
  const needsAlpha = outputNeedsAlpha(outputFormat);
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
    captureMode: resolveObservedCaptureMode(Boolean(cfg.forceScreenshot)),
    browserGpuMode: cfg.browserGpuMode,
    protocolTimeoutMs: cfg.protocolTimeout,
    pageNavigationTimeoutMs: cfg.pageNavigationTimeout,
    playerReadyTimeoutMs: cfg.playerReadyTimeout,
  };
  let extractionObservability: RenderExtractionObservability | undefined;
  let compositionHash: string | undefined;
  const updateCaptureObservability = createCaptureObservabilityUpdater(captureObservability);
  // Function-scoped (not inside the try) so both the success path AND the catch
  // can read it — the catch records transient-retry burn on renders that still
  // failed, which is the more actionable signal for tuning the retry cap.
  const captureAttempts: CaptureAttemptSummary[] = [];
  // Static-dedup perf, appended per sequential session / per parallel worker
  // by the capture stage. Also function-scoped so the catch block can read
  // the sub-timeline-wait outcome for a render that fails downstream of a
  // fail-fast (aggregated into the success-path perf summary below too).
  const dedupPerfs: CapturePerfSummary[] = [];
  const layeredCaptureWarnings: CaptureWarning[] = [];
  const recordTransientRetryObservability = (): void => {
    const count = captureAttempts.filter((a) => a.reason === "transient-retry").length;
    if (count > 0) updateCaptureObservability({ transientRetries: count });
  };
  // The execution context's dynamic disposer reads this binding, so any
  // sampler acquired by the pipeline is stopped by the unconditional outer
  // finally even when setup or terminal reporting throws.
  let memSampler: MemorySampler | null = null;
  // "routed" = the parallel router fired and held; "reverted" = fired but
  // the self-verify retry rolled back; undefined = never fired.
  let deParallelRouter: "routed" | "reverted" | undefined;
  let workerSizing: WorkerSizing | undefined;

  execution.defer("rollback staged artifact", () => artifactTransaction.rollback());
  execution.defer("close file server", () => {
    if (!fileServer) return;
    closeFileServerSafely(fileServer, "renderExecutionContext", log);
    fileServer = null;
  });
  execution.defer("close probe session", async () => {
    if (!probeSession) return;
    const session = probeSession;
    probeSession = null;
    await closeCaptureSession(session);
  });
  execution.defer("stop memory sampler", () => {
    memSampler?.stop();
    memSampler = null;
  });

  try {
    memSampler = createMemorySampler();
    const assertNotAborted = () => {
      execution.assertActive(() => new RenderCancelledError("render_cancelled"));
    };

    job.startedAt = new Date();
    assertNotAborted();
    assertConfiguredFfmpegBinariesExist();

    if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });

    if (job.config.debug) {
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
        rawEntry,
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
        variables: job.config.variables,
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
    // drawElement release telemetry: why default DE disengaged (if it did),
    // whether self-verify fell back, and the drain-side counters.
    const deCompileGate = compileResult.deCompileGate;
    // Seed with the CONFIG-TIME refusal, if there was one. The clamp further
    // down only runs `if (cfg.useDrawElement && ...)`, so a render that never
    // became a drawElement candidate at all could never acquire a reason —
    // it reached telemetry with every DE field empty and landed in the
    // dashboard's `other` bucket (56,507 renders / 14d, second-largest bar on
    // "Why not drawElement", explaining nothing). Re-derived from the same
    // inputs `resolveConfig` used, so it cannot disagree with the decision.
    // Later clamps overwrite this: a more specific reason always wins.
    let deClampReason: string | undefined = cfg.useDrawElement
      ? undefined
      : explainDrawElementDisabled({
          platform: process.platform,
          browserGpuMode: cfg.browserGpuMode,
          workerEncode: cfg.enableDrawElementWorkerEncode,
        });
    // "inverted" = fired and held; "reverted" = fired but the self-verify
    // retry rolled back to the parallel path; undefined = never fired.
    let deWorkerInversion: "inverted" | "reverted" | undefined;
    // deParallelRouter is mutually exclusive with deWorkerInversion — the
    // router takes priority when both would be eligible (see
    // shouldPreferParallelDrawElement).
    //
    // Per-render (not process-global) signal that the router wants parallel
    // drawElement streaming. `HF_DE_PARALLEL_STREAM` env var stays as the
    // manual opt-in for local testing (read directly by
    // shouldUseStreamingEncode / the capture stage), but the router itself
    // must NOT mutate process.env: the producer server runs concurrent
    // renders in one process (PRODUCER_MAX_CONCURRENT_RENDERS), and a global
    // flag set by one render's router decision would leak into an unrelated
    // render already executing in the same process. Threading this as a
    // local instead closes that cross-talk, not just the sequential leak.
    let deParallelStreamForced = false;
    // Per-render (not process-global) signal that the NON-DE parallel-stream
    // router fired — same threading discipline as deParallelStreamForced
    // (see that flag's comment for why this must never be an env mutation).
    let captureParallelStreamForced = false;
    let deSelfVerifyFallback = false;
    let deFallbackReason: string | undefined;
    // Structured detail behind deFallbackReason's "blank"/"psnr" bucket — the
    // failing dB and frame index otherwise only exist as text inside the
    // thrown error's message, unavailable to telemetry. Rounded once here
    // (roundDb) so both downstream consumers — the render_complete
    // perfSummary path and the crash-survival RenderCaptureObservability
    // mirror — report the identical dB, not two different precisions for
    // the same underlying score (review finding).
    let deFallbackFailedDb: number | undefined;
    let deFallbackFrameIndex: number | undefined;
    let deFallbackThresholdDb: number | undefined;
    let deDrainStats: import("./render/stages/captureStreamingStage.js").DeDrainStats | undefined;
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
      { forceScreenshot: captureForceScreenshot, stagePhase: "calibrating" },
      () =>
        runProbeStage({
          projectDir,
          workDir,
          job,
          cfg,
          forceScreenshot: captureForceScreenshot,
          log,
          assertNotAborted,
          abortSignal: executionSignal,
          compiled,
          composition,
          width,
          height,
          needsAlpha,
          deviceScaleFactor,
        }),
      // Browser probe is pre-capture; report `browser calibrating` so a
      // slow probe (~64s SwiftShader warm-up on Windows was the reported
      // shape) doesn't read as a zero-frame stall. Field signal ts=1784019503.
      { heartbeatMessage: "browser calibrating (frames not started)" },
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
    validateRenderDuration({
      duration: probeResult.duration,
      totalFrames,
      fps: fpsToNumber(job.config.fps),
    });

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
          abortSignal: executionSignal,
          assertNotAborted,
          // Copy (don't symlink) extracted frames on Windows — symlinkSync throws
          // EPERM there without Developer Mode/admin, which failed local renders.
          materializeSymlinks: shouldCopyExtractedFrames(process.platform),
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
      failureToEnforce,
    } = extractResult;
    perfStages.videoExtractMs = extractResult.videoExtractMs;

    // ── Parity gate: per-clip captured-vs-expected-frame coverage ───────
    // Fail loudly BEFORE encode if any clip's delivered frames fall below
    // the threshold — check/snapshot passes on individual frames while the
    // encoded MP4 silently renders the clip blank (field signal
    // ts=1784139267: 15-injection later-clip drop; see videoFrameCoverage.ts).
    // Also count authored `[data-start]` clip windows as a coarse proxy
    // for the ts=1784144554 authored-clip-count-scaled failure shape.
    const coverageReports: VideoFrameCoverageReport[] = extractionResult
      ? computeVideoFrameCoverage(composition.videos, extractionResult.extracted, job.config.fps)
      : [];
    const coverageThreshold = resolveVideoCoverageThreshold();
    const authoredTimedClipCount = countAuthoredTimedClips(compiled.html);
    extractionObservability = summarizeExtractionObservability(
      extractionResult,
      composition.videos.length,
      coverageReports,
      authoredTimedClipCount,
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
      transientRetries: extractionObservability.transientRetries ?? null,
      minVideoFrameCoverageRatio: extractionObservability.minVideoFrameCoverageRatio ?? null,
      authoredTimedClipCount: extractionObservability.authoredTimedClipCount ?? null,
    });
    if (failureToEnforce) throw failureToEnforce;
    // Gate AFTER the checkpoint so a coverage-failed render still emits
    // the observability row (partial telemetry is still worth having).
    // `assertVideoFrameCoverage` no-ops on an empty report list AND on a
    // null threshold, so the gate is inert for no-video + opted-out
    // renders alike.
    assertVideoFrameCoverage(coverageReports, coverageThreshold);

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
          ffmpegProcessTimeout: cfg.ffmpegProcessTimeout,
          audioGain: cfg.audioGain,
          audios: composition.audios,
          abortSignal: executionSignal,
          assertNotAborted,
          log,
        }),
    );
    const { audioOutputPath, hasAudio } = audioResult;
    perfStages.audioProcessMs = audioResult.audioProcessMs;
    if (audioResult.audioError) {
      const audioFailures = audioResult.audioFailures ?? [];
      const failureOwner =
        audioFailures.length === 0
          ? undefined
          : audioFailures.some((failure) => failure.owner === "system")
            ? "system"
            : "user";
      const retryable =
        audioFailures.length === 0
          ? undefined
          : audioFailures.every((failure) => failure.retryable);
      applyRenderWarningPolicy(
        job,
        [
          {
            code: "audio_processing_failed",
            message: `Audio mix failed; output would be video-only: ${audioResult.audioError}`,
            details: {
              mediaType: "audio",
              failureReasons: [...new Set(audioFailures.map((failure) => failure.reason))],
              failureStages: [...new Set(audioFailures.map((failure) => failure.stage))],
              failureOwner,
              retryable,
            },
          },
        ],
        log,
      );
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
    // Apply the software-GPU→screenshot clamp to the AUTHORITATIVE local
    // `captureForceScreenshot` (not just the observability copy) so all
    // downstream strategy + telemetry code reads the corrected value.
    // Otherwise: `frameCapture.ts` clamps its own local and routes
    // screenshot, but the still-`false` orchestrator local (a) mislabels the
    // parallel-stream logging as "beginframe" below and (b) overwrites the
    // earlier observability correction back to BeginFrame at the
    // capture_strategy telemetry site. `resolveConfig` couldn't see
    // `browserGpuMode:"auto"` resolving to software at config time, so
    // `captureForceScreenshot` was still `compileResult.forceScreenshot === false`
    // on that path. Both env and programmatic opt-outs preserved via
    // `applyConcreteGpuScreenshotClamp` (the programmatic one carried on the
    // config as `forceScreenshotExplicitlyOptedOut`).
    captureForceScreenshot = applyConcreteGpuScreenshotClamp(
      captureForceScreenshot,
      resolvedBrowserGpuMode,
      cfg,
    );
    updateCaptureObservability({
      browserGpuMode: resolvedBrowserGpuMode,
      forceScreenshot: captureForceScreenshot,
    });
    const videoCaptureBeyondViewport = resolveVideoCaptureBeyondViewport(composition.videos.length);

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
    // Only use the HDR encoder preset when there's HDR content to pass through —
    // either native HDR videos OR native HDR images. For SDR-only compositions,
    // auto mode stays SDR since H.265 10-bit causes browser color management
    // issues (orange shift) with no quality benefit. (Computed here, ahead of
    // worker resolution, because the DE inversion below must not fire for
    // comps that route to the layered/HDR paths.)
    const nativeHdrIds = new Set([...nativeHdrVideoIds, ...nativeHdrImageIds]);
    const hasHdrContent = Boolean(effectiveHdr && nativeHdrIds.size > 0);
    // DE priority inversion eligibility — evaluated BEFORE capture calibration
    // because when every multi-worker resolution would be inverted to 1 anyway,
    // the calibration stage (a throwaway Chrome launch + timeline-spread sample
    // captures, seconds of wall clock) buys nothing and is skipped.
    // Threshold override: HF_DE_SINGLE_MIN_FRAMES (0 disables the inversion;
    // a set-but-empty var falls back to the default, it is NOT the kill switch).
    const deSingleMinFramesRaw = process.env.HF_DE_SINGLE_MIN_FRAMES;
    const deSingleMinFramesNum =
      deSingleMinFramesRaw === undefined || deSingleMinFramesRaw.trim() === ""
        ? 900
        : Number(deSingleMinFramesRaw);
    const deSingleMinFrames = Number.isFinite(deSingleMinFramesNum) ? deSingleMinFramesNum : 900;
    // Short-comp band: 31% of fleet renders (24h, 0.7.78+) are DE-eligible
    // comps clamped to parallel screenshot purely because they sit under this
    // floor. A controlled sweep (fixed synthetic content, {250,400,600,900}f,
    // single-DE vs parallel-screenshot-W4, 3 reps, capture modes verified per
    // run) showed single-DE winning 1.16-1.24x at EVERY size — but only for
    // content in constant motion. A follow-up 2x2 (movers x static DOM nodes)
    // found the two variables pull in opposite directions: motion favours DE,
    // DOM size punishes it, and DE's wall-clock scales ~0.50ms/node against
    // parallel screenshot's ~0.22ms (drawElement repaints the whole tree per
    // frame; fan-out amortizes it). At 24 movers / 400f the measured curve is
    // +5% for DE at 0 nodes, -4% at 7k, -41% at 20k, -80% at 40k — crossover
    // near ~3.9k. Since motion only ever helps DE, a node ceiling calibrated
    // at the LOWEST-motion case is safe for every motion level, so the short
    // band opens only below `deShortBandMaxElements`. Above it the original
    // 900 floor stands, unchanged.
    const deShortBandMinFrames = envInt("HF_DE_SHORT_MIN_FRAMES", 250);
    const deShortBandMaxElements = envInt("HF_DE_SHORT_MAX_ELEMENTS", 2500);
    // `source` is load-bearing, not diagnostic: the probe is CONDITIONAL
    // (probeStage's `needsBrowser` — unknown duration, unresolved
    // compositions, or specific media cases), so a known-duration media-free
    // comp that builds its DOM in script has no live count available and the
    // static scan reads it as tiny. Only a `live` count may open the band.
    const { count: compositionElementCount, source: compositionElementCountSource } =
      await resolveCompositionElementCount(probeSession, compiled.html);
    // HF_DE_SHORT_MAX_ELEMENTS=0 is the documented kill switch (symmetric
    // with HF_DE_SHORT_MIN_FRAMES=0, which disables via the predicate's own
    // minFrames > 0 guard). Gated explicitly here too — without it, a fired
    // max-elements kill switch left every in-band render decisive against a
    // real floor comparison, so it reported "skipped_elements" (comp too
    // large) instead of undefined (band disabled), corrupting the DiD
    // control cohort with kill-switched renders (review finding).
    const deShortBandEnabled = deShortBandMaxElements > 0;
    const deShortBandOpen =
      deShortBandEnabled &&
      deShortBandMinFrames > 0 &&
      compositionElementCountSource === "live" &&
      compositionElementCount <= deShortBandMaxElements;
    // Baseline-first sequencing: this release EVALUATES the band on every
    // render and emits the decision, but only routes on it when
    // HF_DE_SHORT_BAND_ROUTE=true (flipped by default in a follow-up release).
    // The point is a difference-in-differences read: the cohort selector
    // (`de_short_band`) is computed identically before and after the flip —
    // "applied" is counterfactual in the baseline release and factual after —
    // and the skipped/oversize renders in the same frame band form a
    // concurrent control that absorbs secular drift (content mix, version-
    // correlated populations, hardware). A plain before/after cannot
    // attribute a fleet perf shift to this change; this can.
    const deShortBandRoute = process.env.HF_DE_SHORT_BAND_ROUTE === "true";
    // "Would ANY multi-worker resolution be inverted?" — if workers resolve
    // to 1 naturally the outcome is identical either way.
    const WOULD_RESOLVE_MULTI_WORKER = 2;
    const deInversionArgs = {
      workerCount: WOULD_RESOLVE_MULTI_WORKER,
      requestedWorkers: job.config.workers,
      useDrawElement: cfg.useDrawElement,
      deCompileGate,
      forceScreenshot: captureForceScreenshot,
      outputFormat,
      totalFrames,
      minFrames: deSingleMinFrames,
      singleWorkerStreamingOk: shouldUseStreamingEncode(cfg, outputFormat, 1, job.duration),
      layeredOrEffectRoute: hasHdrContent || compiled.hasShaderTransitions,
      supersampling: deviceScaleFactor > 1,
      probeDeGated:
        probeSession !== null &&
        probeSession.captureMode !== "drawelement" &&
        !probeSession.deInitDeferred,
      experimentalParallelDeOptIn:
        process.env.PRODUCER_EXPERIMENTAL_FAST_CAPTURE === "true" ||
        // Verified parallel DE streaming (opt-in) wants its parallelism kept.
        process.env.HF_DE_PARALLEL_STREAM === "true",
    };
    const invertAtBaseFloor = shouldPreferSingleWorkerDrawElement(deInversionArgs);
    // Same render, same eligibility, band floor instead of 900. Math.min so a
    // user override of HF_DE_SINGLE_MIN_FRAMES below the band floor keeps
    // winning; HF_DE_SHORT_MIN_FRAMES=0 disables via the predicate's own
    // minFrames > 0 check.
    const invertAtBandFloor = shouldPreferSingleWorkerDrawElement({
      ...deInversionArgs,
      minFrames: Math.min(deSingleMinFrames, deShortBandMinFrames),
    });
    // Attribution runs even when routing is OFF — that is the whole point of
    // the baseline release: "applied" is the counterfactual "would have
    // inverted", and emitting it now is what establishes the DiD cohort
    // before the flip. Do not short-circuit this block behind
    // `deShortBandRoute` (review nit).
    const deShortBand = resolveDeShortBand({
      invertAtBaseFloor,
      invertAtBandFloor,
      bandEnabled: deShortBandEnabled,
      bandOpen: deShortBandOpen,
      elementCountSource: compositionElementCountSource,
    });
    const deInversionEligible =
      deShortBandRoute && deShortBand === "applied" ? invertAtBandFloor : invertAtBaseFloor;
    // The floor that actually decided this render — for the human-facing log
    // below, so it never claims e.g. "400 frames >= 900" for a band-routed
    // inversion (review finding).
    const deInversionEffectiveMinFrames =
      deShortBandRoute && deShortBand === "applied"
        ? Math.min(deSingleMinFrames, deShortBandMinFrames)
        : deSingleMinFrames;
    // DE parallel-router eligibility — see shouldPreferParallelDrawElement.
    // Default ON since 2026-07-27 (kill switch: HF_DE_PARALLEL_ROUTER=false).
    // The soak that gated this flip answered the safety question: zero
    // damaged frames shipped across the entire default-off window — every
    // revert was the self-verify net catching a bad frame and recovering via
    // screenshot. The residual metric (revert rate ~2.3% vs the 2% goal) is
    // an efficiency cost (a revert forfeits the speedup, never correctness),
    // accepted in exchange for parallelizing the ≥700-frame band (~80% of
    // all DE capture wall-clock). Post-flip tripwire on dashboard 1807532:
    // sustained revert >10% or any verify-missed damage rolls this back —
    // one env default, decoupled from the floor change one release earlier.
    // HF_DE_PARALLEL_MIN_FRAMES default
    // 700, re-calibrated 2026-07-27 from the original safe-high 2000. A
    // controlled frame-count sweep (fixed content-per-frame, three synthetic
    // profiles × {350..3000f} × {single,par2,par3} × 3 reps, worker counts +
    // capture modes verified per run) showed par3 beating single at EVERY
    // size in every profile — +17–21% at 700f rising to +28–34% at 3000f —
    // including a 24-sub-composition profile built to reproduce the
    // "workers re-pay init" failure (92k tweens, ~2.5s
    // pollSubCompositionTimelines per worker): workers init CONCURRENTLY, so
    // duplicated init costs CPU, not wall-clock. Below ~700f the win thins
    // toward ~+10% while still paying 3 hardware-GPU browsers, so the floor
    // stays. Harness: plans/drawelement-fast-capture/de-crossover-bench.sh.
    const deParallelRouterEnabled = isDeParallelRouterEnabled(process.env);
    const deParallelMinFramesRaw = process.env.HF_DE_PARALLEL_MIN_FRAMES;
    const deParallelMinFramesNum =
      deParallelMinFramesRaw === undefined || deParallelMinFramesRaw.trim() === ""
        ? 700
        : Number(deParallelMinFramesRaw);
    const deParallelMinFrames = Number.isFinite(deParallelMinFramesNum)
      ? deParallelMinFramesNum
      : 700;
    // RAM floor default 24 GB: the wild black-slab report was a 16 GB
    // machine; every clean routed cohort in telemetry so far is >=24 GB.
    // HF_DE_PARALLEL_MIN_MEM_MB overrides (0 disables the guard).
    const deParallelMinMemRaw = process.env.HF_DE_PARALLEL_MIN_MEM_MB;
    const deParallelMinMemNum =
      deParallelMinMemRaw === undefined || deParallelMinMemRaw.trim() === ""
        ? 24576
        : Number(deParallelMinMemRaw);
    const deParallelMinMemoryMb = Number.isFinite(deParallelMinMemNum)
      ? deParallelMinMemNum
      : 24576;
    const deParallelRouterEligible = shouldPreferParallelDrawElement({
      workerCount: WOULD_RESOLVE_MULTI_WORKER,
      requestedWorkers: job.config.workers,
      useDrawElement: cfg.useDrawElement,
      deCompileGate,
      forceScreenshot: captureForceScreenshot,
      outputFormat,
      totalFrames,
      minFrames: deParallelMinFrames,
      layeredOrEffectRoute: hasHdrContent || compiled.hasShaderTransitions,
      supersampling: deviceScaleFactor > 1,
      probeDeGated:
        probeSession !== null &&
        probeSession.captureMode !== "drawelement" &&
        !probeSession.deInitDeferred,
      experimentalParallelDeOptIn:
        process.env.PRODUCER_EXPERIMENTAL_FAST_CAPTURE === "true" ||
        process.env.HF_DE_PARALLEL_STREAM === "true",
      routerEnabled: deParallelRouterEnabled,
      // Router pins 3 workers for the streaming path; don't pin when the
      // duration cap (or any other streaming gate) would turn that path off.
      parallelStreamingAvailable: shouldUseStreamingEncode(
        cfg,
        outputFormat,
        3,
        job.duration,
        true,
      ),
      totalMemoryMb: Math.round(totalmem() / (1024 * 1024)),
      minMemoryMb: deParallelMinMemoryMb,
    });
    // Declared ahead of resolution (assigned below, after calibration) so
    // captureStageObservationData can close over it for the calibration
    // stage itself — reads as undefined until resolveRenderWorkerCount runs.
    let workerCount: number;
    // Default `stagePhase` — spread FIRST so a caller can override via
    // `extra` (the calibration call site passes `stagePhase: "calibrating"`
    // to distinguish healthy pre-capture waits from actual zero-frame stalls
    // during capture; heartbeats in `capture_calibration` otherwise emit
    // `framesCompleted: 0` and read as broken). Field signal ts=1784019503.
    const captureStageObservationData = (
      extra: RenderObservationData = {},
    ): RenderObservationData => ({
      stagePhase: "capturing",
      ...extra,
      get workerCount() {
        return workerCount;
      },
      get forceScreenshot() {
        return captureForceScreenshot;
      },
      get totalFrames() {
        return totalFrames;
      },
      get framesCompleted() {
        return job.framesRendered ?? 0;
      },
      get captureMode() {
        return (
          probeSession?.captureMode ??
          (captureForceScreenshot
            ? "screenshot"
            : cfg.useDrawElement
              ? "drawelement"
              : "beginframe")
        );
      },
      get captureOperation() {
        if ((job.framesRendered ?? 0) >= totalFrames) return "encode";
        const mode =
          probeSession?.captureMode ??
          (captureForceScreenshot
            ? "screenshot"
            : cfg.useDrawElement
              ? "drawelement"
              : "beginframe");
        if (mode === "screenshot") return "captureScreenshot";
        if (mode === "drawelement") return "drawElement";
        return "beginFrame";
      },
    });

    if (
      job.config.workers === undefined &&
      totalFrames >= 60 &&
      !htmlInCanvasDetected &&
      !cfg.lowMemoryMode &&
      !deInversionEligible &&
      !deParallelRouterEligible
    ) {
      const outcome = await observeRenderStage(
        observability,
        "capture_calibration",
        captureStageObservationData({
          forceScreenshot: captureForceScreenshot,
          // Override the default `capturing` — calibration writes probe
          // frames only, not `job.framesRendered`, so heartbeats reporting
          // `framesCompleted: 0` misread as broken. Field signal
          // ts=1784019503.
          stagePhase: "calibrating",
        }),
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
        { heartbeatMessage: "browser calibrating (frames not started)" },
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
        deInversionEligible,
        deParallelRouterEligible,
      });
    }

    // Low-memory safe-mode's single-worker pin lives inside
    // resolveRenderWorkerCount so its "why workers=N" logging stays coherent.
    workerCount = resolveRenderWorkerCount(
      totalFrames,
      job.config.workers,
      cfg,
      compiled,
      log,
      captureCalibration?.estimate,
      (sizing) => {
        workerSizing = sizing;
        const heapAdvisory = buildHeapAdvisoryWarning(sizing, job.config.workers);
        if (heapAdvisory) {
          log.warn(heapAdvisory, {
            heapLimitMb: sizing.heapLimitMb,
            heapBasedWorkers: sizing.heapBasedWorkers,
          });
        }
      },
    );
    // DE priority inversion — see shouldPreferSingleWorkerDrawElement for the
    // policy and benchmark rationale (eligibility resolved above, before
    // calibration). Comps that pass every static check but hit an engine
    // INIT-time gate at capture (css-effects / at-risk, ~1.5% of local
    // renders) render single-worker screenshot streaming — slower than
    // parallel would have been, accepted for the routing win everywhere else.
    // `preRoutingWorkerCount` lets the self-verify retry return to the
    // parallel path when the drawElement bet loses — shared by both the
    // inversion and the router below, whichever fires (mutually exclusive).
    const preRoutingWorkerCount = workerCount;
    // Router takes priority over the single-worker inversion when both would
    // fire — its higher frame threshold means this only ever picks up long-
    // tail comps the inversion's own benchmark didn't cover (see
    // shouldPreferParallelDrawElement). Pins to a fixed worker count exactly
    // like the inversion pins to 1 — calibration is skipped for both (see
    // the capture_calibration gate above), so this deliberately overrides
    // whatever a calibrated resolution would have chosen (e.g. 2, on a
    // resource-constrained host): the benchmark validated par3 specifically,
    // not "whatever calibration picks above 1", and the self-verify retry is
    // the safety net if 3 workers tips a given host over.
    if (deParallelRouterEligible && workerCount > 1) {
      deParallelRouter = "routed";
      // Fixed at 3, not calibration-derived: the benchmark validated exactly
      // this worker count (par3 beat par2 consistently; W4/W5 unmeasured for
      // this path), same shape as the single-worker inversion pinning to a
      // fixed 1 rather than a calibrated count.
      const ROUTER_WORKER_COUNT = 3;
      log.info(
        "[Render] Fast capture: verified parallel drawElement streaming preferred over " +
          `single-worker inversion (${totalFrames} frames >= ${deParallelMinFrames}; ` +
          "benchmark-validated at 3 workers, pinned regardless of calibration). " +
          "Set HF_DE_PARALLEL_ROUTER=false or --workers N to override.",
      );
      workerCount = ROUTER_WORKER_COUNT;
      deParallelStreamForced = true;
    } else if (deInversionEligible && workerCount > 1) {
      deWorkerInversion = "inverted";
      log.info(
        "[Render] Fast capture: single-worker drawElement streaming preferred over " +
          `${workerCount}-worker screenshot capture (${totalFrames} frames >= ` +
          `${deInversionEffectiveMinFrames}; verified path, measured faster at every worker count). ` +
          "Set HF_DE_SINGLE_MIN_FRAMES=0 or --workers N to override.",
      );
      workerCount = 1;
    }
    updateCaptureObservability({
      workerCount,
      deWorkerInversion,
      deParallelRouter,
      // Recorded here (not just in the success-path perfSummary) so a hard
      // failure while routed/inverted still tells us what worker count the
      // resolver would have used absent the experiment — the DE-router pin
      // to 3 workers regardless of calibration is the leading suspect for
      // any resource-pressure failure unique to this cohort.
      dePreInversionWorkers: deWorkerInversion ? preRoutingWorkerCount : undefined,
      dePreRouterWorkers: deParallelRouter ? preRoutingWorkerCount : undefined,
      // Short-comp band attribution — see the field docs. Emitted on every
      // render so the fleet element-count distribution is readable, and so a
      // perf shift can be split into "the new band did it" vs "unchanged".
      compositionElementCount,
      compositionElementCountSource,
      deShortBand,
      // Same rationale as the counters above: carried on live capture
      // observability, not only the success-path perfSummary, so a crash /
      // OOM / timeout still reports which GPU backend it happened on. That
      // is the cohort the win32 D3D11 rollout most needs to attribute.
      deGpuRenderer: probeSession?.gpuRenderer,
    });
    observability.checkpoint("worker_resolution", "resolved", {
      workerCount,
      deWorkerInversion: deWorkerInversion ?? "none",
      deParallelRouter: deParallelRouter ?? "none",
    });

    // Non-DE parallel-streaming router — see shouldStreamParallelCapture.
    // Mutually exclusive with the DE inversion/router above by construction
    // (both DE predicates require useDrawElement; this requires its negation).
    const captureParallelStreamRouterEnabled = process.env.HF_CAPTURE_PARALLEL_STREAM === "true";
    const captureParallelStreamArgs = {
      workerCount,
      useDrawElement: cfg.useDrawElement,
      outputFormat,
      streamingOk: shouldUseStreamingEncode(cfg, outputFormat, 1, job.duration),
      layeredOrEffectRoute: hasHdrContent || compiled.hasShaderTransitions,
    };
    const captureParallelStreamEligible = shouldStreamParallelCapture({
      routerEnabled: captureParallelStreamRouterEnabled,
      ...captureParallelStreamArgs,
    });
    if (captureParallelStreamEligible) {
      captureParallelStreamForced = true;
      // Which mode will stream: the engine picks beginframe only on Linux with
      // headless-shell and no forced screenshot (frameCapture.ts preMode);
      // everything else is screenshot. Recorded for telemetry cohorting.
      // Same predicate as the observability field — use the one helper so the
      // two cannot drift if the router's modes ever change.
      const captureParallelStream = resolveObservedCaptureMode(captureForceScreenshot);
      log.info(
        `[Render] Parallel ${captureParallelStream} capture will stream to the encoder ` +
          `(interleaved, ${workerCount} workers) instead of the disk path. ` +
          "Set HF_CAPTURE_PARALLEL_STREAM=false to disable.",
      );
      updateCaptureObservability({ captureParallelStream });
      // NOTE: no string data on the checkpoint — RenderObservationData string
      // values are dropped unless the key is in observability.ts's
      // ALLOWED_STRING_DATA_KEYS allow-list. The message carries the detail.
      observability.checkpoint(
        "worker_resolution",
        `parallel ${captureParallelStream} capture routed to streaming`,
      );
    } else if (shouldStreamParallelCapture({ routerEnabled: true, ...captureParallelStreamArgs })) {
      // The kill switch is the ONLY failed gate: emit a passive cohort-sizing
      // signal (capture_parallel_stream = "eligible_off") so the default-off
      // soak can measure how many fleet renders WOULD route before anyone
      // enables the flag. Observability-only — no behavior change, no log
      // noise on the default path.
      updateCaptureObservability({ captureParallelStream: "eligible_off" });
    }

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
    let useStreamingEncode = shouldUseStreamingEncode(
      cfg,
      outputFormat,
      workerCount,
      job.duration,
      deParallelStreamForced || captureParallelStreamForced,
    );
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
    // HF_DE_PARALLEL_STREAM: multi-worker STREAMING renders now carry the
    // full drain-time self-verification (per-worker ground truth + the shared
    // drain guard), so the confinement rule is satisfied and the parallel
    // clamp does not apply. The disk path stays clamped.
    const deParallelStreamVerified =
      (deParallelStreamForced || process.env.HF_DE_PARALLEL_STREAM === "true") &&
      useStreamingEncode &&
      workerCount > 1;
    if (
      cfg.useDrawElement &&
      process.env.PRODUCER_EXPERIMENTAL_FAST_CAPTURE !== "true" &&
      (!useStreamingEncode || workerCount > 1) &&
      !deParallelStreamVerified
    ) {
      cfg.useDrawElement = false;
      deClampReason = workerCount > 1 ? "parallel" : "disk_path";
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
    // (nativeHdrIds / hasHdrContent are computed above, ahead of worker
    // resolution, for the DE inversion eligibility check.)
    // Page-side compositing opt-in: when the engine is configured to run the
    // shader blend inside Chrome via a page-side WebGL canvas, the layered
    // Node-side composite path is unnecessary for SDR shader transitions.
    // MP4's streaming path takes one opaque RGB screenshot per output frame.
    // GIF takes the same page-side composite through its RGBA PNG disk-frame
    // path so the palette encoder can preserve transparency. HDR content still
    // forces the layered path (HDR layers need per-layer alpha + native HDR raw
    // frame compositing in Node; that's out of scope for this opt-in).
    const usePageSideCompositingForTransitions =
      (cfg.enablePageSideCompositing || isGif) &&
      compiled.hasShaderTransitions &&
      !hasHdrContent &&
      outputSupportsPageSideShaderCompositing(outputFormat);
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
          `shader-blend path. Engine will capture one ${needsAlpha ? "RGBA PNG" : "opaque RGB"} ` +
          "screenshot per output frame.",
      );
    }
    const useLayeredComposite =
      !usePageSideCompositingForTransitions &&
      shouldUseLayeredComposite({
        hasHdrContent,
        hasShaderTransitions: compiled.hasShaderTransitions && !isGif,
        isPngSequence,
      });
    const inversionFallback = resolveInversionRetryPlan({
      deWorkerInversion,
      preInversionWorkerCount: preRoutingWorkerCount,
      cfg,
      outputFormat,
      durationSeconds: job.duration,
      isMemoryExhaustion: false,
    });
    const inversionMemoryExhaustionFallback = resolveInversionRetryPlan({
      deWorkerInversion,
      preInversionWorkerCount: preRoutingWorkerCount,
      cfg,
      outputFormat,
      durationSeconds: job.duration,
      isMemoryExhaustion: true,
    });
    const parallelRouterFallback = resolveParallelRouterRetryPlan({
      deParallelRouter,
      preRouterWorkerCount: preRoutingWorkerCount,
      cfg,
      outputFormat,
      durationSeconds: job.duration,
      isMemoryExhaustion: false,
    });
    const parallelRouterMemoryExhaustionFallback = resolveParallelRouterRetryPlan({
      deParallelRouter,
      preRouterWorkerCount: preRoutingWorkerCount,
      cfg,
      outputFormat,
      durationSeconds: job.duration,
      isMemoryExhaustion: true,
    });
    const captureRouting: CaptureRouting =
      inversionFallback && inversionMemoryExhaustionFallback
        ? {
            kind: "worker_inversion",
            state: "active",
            fallback: {
              kind: inversionFallback.useStreamingEncode ? "sdr_streaming" : "sdr_disk",
              workerCount: inversionFallback.workerCount,
              forceParallelStream: false,
            },
            memoryExhaustionFallback: {
              kind: inversionMemoryExhaustionFallback.useStreamingEncode
                ? "sdr_streaming"
                : "sdr_disk",
              workerCount: inversionMemoryExhaustionFallback.workerCount,
              forceParallelStream: false,
            },
          }
        : parallelRouterFallback && parallelRouterMemoryExhaustionFallback
          ? {
              kind: "parallel_router",
              state: "active",
              fallback: {
                kind: parallelRouterFallback.useStreamingEncode ? "sdr_streaming" : "sdr_disk",
                workerCount: parallelRouterFallback.workerCount,
                forceParallelStream: false,
              },
              memoryExhaustionFallback: {
                kind: parallelRouterMemoryExhaustionFallback.useStreamingEncode
                  ? "sdr_streaming"
                  : "sdr_disk",
                workerCount: parallelRouterMemoryExhaustionFallback.workerCount,
                forceParallelStream: false,
              },
            }
          : { kind: "default" };
    let capturePlan: CapturePlan = createCapturePlan({
      workerCount,
      forceScreenshot: captureForceScreenshot,
      forceParallelStream: deParallelStreamForced || captureParallelStreamForced,
      useStreamingEncode,
      useLayeredComposite,
      usePageSideCompositing: usePageSideCompositingForTransitions,
      hasHdrContent,
      needsAlpha,
      routing: captureRouting,
    });
    const syncCapturePlan = (): void => {
      workerCount = capturePlan.workerCount;
      captureForceScreenshot = capturePlan.forceScreenshot;
      useStreamingEncode = capturePlan.kind === "sdr_streaming";
      deParallelStreamForced =
        capturePlan.kind === "sdr_streaming" && capturePlan.forceParallelStream;
      if (capturePlan.routing.kind === "worker_inversion") {
        deWorkerInversion = capturePlan.routing.state === "active" ? "inverted" : "reverted";
      }
      if (capturePlan.routing.kind === "parallel_router") {
        deParallelRouter = capturePlan.routing.state === "active" ? "routed" : "reverted";
      }
    };
    syncCapturePlan();
    updateCaptureObservability({
      workerCount: capturePlan.workerCount,
      useStreamingEncode: capturePlan.kind === "sdr_streaming",
      useLayeredComposite: capturePlan.kind === "hdr_layered",
      usePageSideCompositing: capturePlan.usePageSideCompositing,
      hasHdrContent: capturePlan.hasHdrContent,
      forceScreenshot: capturePlan.forceScreenshot,
      // Re-recorded here because `syncCapturePlan` above is where routing is
      // actually decided — including "reverted", which the earlier update
      // could not know. Without this, capture observability keeps whatever
      // was true before the plan resolved, so a render that failed while
      // routed reports no routing state at all: `de_parallel_router` was
      // present on 95% of render_complete events and 0.8% of render_error.
      // The failure path is the one the rollout is watching.
      deWorkerInversion,
      deParallelRouter,
    });
    observability.checkpoint("capture_strategy", "resolved", {
      plan: capturePlan.kind,
      workerCount: capturePlan.workerCount,
      forceScreenshot: capturePlan.forceScreenshot,
      captureBeyondViewport: resolvedCaptureBeyondViewport ?? null,
      useStreamingEncode: capturePlan.kind === "sdr_streaming",
      useLayeredComposite: capturePlan.kind === "hdr_layered",
      usePageSideCompositing: capturePlan.usePageSideCompositing,
      hasHdrContent: capturePlan.hasHdrContent,
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

    resetCaptureAttemptProgress(job);

    // ── Z-ordered multi-layer compositing ─────────────────────────────────
    // Per frame: query all elements' z-order, group into layers (DOM or HDR),
    // composite bottom-to-top in Node.js memory. HDR layers use native
    // pre-extracted pixels; DOM layers use Chrome alpha screenshots converted
    // into the active rgb48le signal space. Shader transitions use this same
    // path for SDR compositions so the engine can apply transition math to
    // isolated scene buffers instead of recording plain DOM screenshots.
    if (capturePlan.kind === "hdr_layered") {
      const layeredPlan = capturePlan;
      // Layered composite always runs in screenshot mode — keep
      // `captureForceScreenshot` in sync so the perf summary and any
      // post-HDR diagnostic that reads the boolean see the same value
      // the stage uses internally.
      updateCaptureObservability({ forceScreenshot: layeredPlan.forceScreenshot });
      const hdrRes = await observeRenderStage(
        observability,
        "capture_hdr_layered",
        captureStageObservationData({ hasHdrContent }),
        () =>
          runCaptureHdrStage({
            job,
            cfg,
            plan: layeredPlan,
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
            abortSignal: executionSignal,
            assertNotAborted,
            onProgress,
          }),
      );
      lastBrowserConsole = hdrRes.lastBrowserConsole;
      layeredCaptureWarnings.push(...hdrRes.warnings);
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
      if (capturePlan.kind === "sdr_streaming") {
        const captureFrameStart = Date.now();
        const invokeStreaming = () => {
          if (capturePlan.kind !== "sdr_streaming") {
            throw new Error(`Cannot invoke streaming stage with ${capturePlan.kind} plan`);
          }
          const streamingPlan = capturePlan;
          resetCaptureAttemptProgress(job);
          return observeRenderStage(
            observability,
            "capture_streaming",
            captureStageObservationData(),
            () =>
              runCaptureStreamingStage({
                fileServer: activeFileServer,
                workDir,
                framesDir,
                videoOnlyPath,
                job,
                totalFrames,
                cfg,
                plan: streamingPlan,
                log,
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
                abortSignal: executionSignal,
                assertNotAborted,
                onProgress,
                dedupPerfs,
              }),
          );
        };
        let streamingRes;
        try {
          streamingRes = await invokeStreaming();
        } catch (err) {
          // drawElement self-verification tripped (blank frame or PSNR breach
          // vs the pre-injection ground truth), OR — when the inversion/router
          // pinned a fixed worker count regardless of calibration — any other
          // capture-stage failure (host contention timeout, worker crash, OOM)
          // on that pinned path. Both restart the whole render on the same
          // tested screenshot/parallel-SS baseline: slower, never wrong. The
          // failed attempt's session was closed by the stage's finally;
          // probeSession (if any) was consumed by it, so a fresh session
          // spawns on retry. See shouldRetryViaPinnedFallback for exactly
          // which errors qualify.
          const isVerifyError = isDrawElementVerificationError(err);
          const isCancellation =
            err instanceof RenderCancelledError || executionSignal?.aborted === true;
          if (
            !shouldRetryViaPinnedFallback({
              isVerifyError,
              isCancellation,
              isEncoderInterrupted: err instanceof EncoderInterruptedError,
              deWorkerInversion,
              deParallelRouter,
            })
          )
            throw err;
          const isMemoryExhaustion = !isVerifyError && isMemoryExhaustionError(err);
          deSelfVerifyFallback = isVerifyError;
          if (isVerifyError) {
            const t = deVerifyFallbackTelemetry(err);
            deFallbackReason = t.reason;
            deFallbackFailedDb = t.failedDb;
            deFallbackFrameIndex = t.frameIndex;
            deFallbackThresholdDb = t.thresholdDb;
          } else {
            deFallbackReason = isMemoryExhaustion ? "oom" : "capture_error";
          }
          log.warn(
            isVerifyError
              ? "[Render] drawElement self-verification failed; re-rendering via screenshot"
              : "[Render] capture failed on the pinned worker count; re-rendering via screenshot",
            { error: err instanceof Error ? err.message : String(err) },
          );
          observability.checkpoint(
            "capture_streaming",
            isVerifyError
              ? "drawElement self-verify failed; retrying with forceScreenshot"
              : "capture failed on pinned worker count; retrying with forceScreenshot",
          );
          const failedRouting = capturePlan.routing.kind;
          capturePlan = replanAfterFailure(
            capturePlan,
            isVerifyError
              ? { kind: "draw_element_verification" }
              : { kind: "capture_failure", memoryExhaustion: isMemoryExhaustion },
          );
          syncCapturePlan();
          updateCaptureObservability({
            forceScreenshot: capturePlan.forceScreenshot,
            deSelfVerifyFallback,
            deFallbackReason,
            deFallbackFailedDb,
            deFallbackFrameIndex,
            deFallbackThresholdDb,
            workerCount: capturePlan.workerCount,
            useStreamingEncode: capturePlan.kind === "sdr_streaming",
            deWorkerInversion,
            deParallelRouter,
          });
          // Streaming stage aims to close the probe in its own finally; if it
          // threw before doing so, the Chrome process would orphan through the
          // pinned-fallback retry. Close defensively before we release the
          // reference — see closeOrphanedProbeForRetry.
          if (probeSession) {
            lastBrowserConsole = probeSession.browserConsoleBuffer;
            const orphaned = probeSession;
            probeSession = null;
            await closeOrphanedProbeForRetry(orphaned, closeCaptureSession, log, "streaming");
          }
          if (failedRouting === "worker_inversion") {
            // The inversion bet on drawElement and lost — re-render on the
            // pre-inversion parallel screenshot path instead of single-worker
            // screenshot streaming (the slowest capture shape for this size).
            // "reverted" (not cleared) so telemetry keeps the lost-inversion
            // cohort distinguishable from renders that never inverted.
            log.info(
              `[Render] Reverting worker inversion for the retry: ${capturePlan.workerCount} workers, ` +
                `plan=${capturePlan.kind}.`,
            );
          } else if (failedRouting === "parallel_router") {
            // The router's bet on verified parallel streaming lost — re-render
            // on the ordinary (non-DE) parallel path at the pre-router worker
            // count, same "reverted, not cleared" telemetry contract as the
            // inversion above.
            log.info(
              `[Render] Reverting parallel router for the retry: ${capturePlan.workerCount} workers, ` +
                `plan=${capturePlan.kind}.`,
            );
          }
          if (capturePlan.kind === "sdr_streaming") {
            streamingRes = await invokeStreaming();
          } else {
            // Parallel retry goes through the disk path below.
            streamingRes = { success: false } satisfies CaptureStreamingStageResult;
          }
          // The first attempt's error marked the phase failed; the retry
          // recovered it (or was rerouted to disk) — don't brand the render
          // as failed in telemetry.
          observability.clearFailure("capture_streaming");
        }
        const captureFrameMs = Date.now() - captureFrameStart;
        if (streamingRes.success) {
          streamingHandled = true;
          deDrainStats = streamingRes.deDrainStats;
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
          if (capturePlan.kind === "sdr_streaming") {
            capturePlan = replanAfterFailure(capturePlan, { kind: "streaming_unavailable" });
            syncCapturePlan();
          }
          // The disk path has no drain-time self-verification — clamp
          // default-on drawElement here exactly like the pre-capture clamp
          // (verified-path confinement). Skipped when screenshots are already
          // forced (nothing to clamp) or under the explicit experimental
          // opt-in, mirroring the clamp above.
          if (
            cfg.useDrawElement &&
            !capturePlan.forceScreenshot &&
            process.env.PRODUCER_EXPERIMENTAL_FAST_CAPTURE !== "true"
          ) {
            cfg.useDrawElement = false;
            deClampReason = deClampReason ?? "disk_path";
            log.info(
              "[Render] Fast capture: drawElement disabled for the disk fallback — " +
                "streaming encoder spawn failed and the disk path has no runtime " +
                "self-verification.",
            );
            if (probeSession && probeSession.captureMode === "drawelement") {
              lastBrowserConsole = probeSession.browserConsoleBuffer;
              await closeCaptureSession(probeSession);
              probeSession = null;
            }
          }
          updateCaptureObservability({ useStreamingEncode: false });
          observability.checkpoint("capture_streaming", "spawn failed; falling back to disk");
        }
      }

      if (!streamingHandled) {
        if (capturePlan.kind !== "sdr_disk") {
          throw new Error(`Disk capture requires sdr_disk plan; got ${capturePlan.kind}`);
        }
        // ── Disk-based capture (original flow) ────────────────────────────
        resetCaptureAttemptProgress(job);
        const captureFrameStart = Date.now();
        const invokeDiskCapture = (diskPlan: SdrDiskCapturePlan) =>
          observeRenderStage(
            observability,
            "capture_disk",
            captureStageObservationData({ needsAlpha: diskPlan.needsAlpha }),
            () =>
              runCaptureStage({
                fileServer: activeFileServer,
                workDir,
                framesDir,
                job,
                totalFrames,
                cfg,
                plan: diskPlan,
                log,
                probeSession,
                captureAttempts,
                dedupPerfs,
                buildCaptureOptions,
                createRenderVideoFrameInjector,
                abortSignal: executionSignal,
                assertNotAborted,
                onProgress,
              }),
          );
        let captureRes;
        try {
          captureRes = await invokeDiskCapture(capturePlan);
        } catch (err) {
          // Disk-path drawElement self-verification tripped (a parallel disk
          // worker's sampled frame diverged from its pre-injection ground
          // truth — reachable only under the explicit fast-capture opt-in).
          // Same recovery contract as the streaming drain: re-render on the
          // screenshot baseline. Anything else keeps its existing semantics.
          if (
            !isDrawElementVerificationError(err) ||
            err instanceof RenderCancelledError ||
            executionSignal?.aborted === true
          ) {
            throw err;
          }
          deSelfVerifyFallback = true;
          const t = deVerifyFallbackTelemetry(err);
          deFallbackReason = t.reason;
          deFallbackFailedDb = t.failedDb;
          deFallbackFrameIndex = t.frameIndex;
          deFallbackThresholdDb = t.thresholdDb;
          log.warn(
            "[Render] drawElement self-verification failed on the parallel disk path; " +
              "re-rendering via screenshot",
            { error: err instanceof Error ? err.message : String(err) },
          );
          observability.checkpoint(
            "capture_disk",
            "drawElement self-verify failed; retrying with forceScreenshot",
          );
          // The failed attempt's frames are untrusted BUT satisfy the
          // completeness check — wipe them so the retry re-captures everything
          // instead of silently keeping damaged files.
          rmSync(framesDir, { recursive: true, force: true });
          mkdirSync(framesDir, { recursive: true });
          resetCaptureAttemptProgress(job);
          dedupPerfs.length = 0;
          cfg.useDrawElement = false;
          // Same shape as the streaming retry above: `runCaptureStage` was
          // passed the probe and threw before it could close it, so we must
          // release the Chrome process ourselves before starting the
          // screenshot-baseline retry — otherwise it orphans until render
          // exit. See closeOrphanedProbeForRetry.
          if (probeSession) {
            lastBrowserConsole = probeSession.browserConsoleBuffer;
            const orphaned = probeSession;
            probeSession = null;
            await closeOrphanedProbeForRetry(orphaned, closeCaptureSession, log, "disk verify");
          }
          capturePlan = replanAfterFailure(capturePlan, { kind: "draw_element_verification" });
          syncCapturePlan();
          updateCaptureObservability({
            forceScreenshot: capturePlan.forceScreenshot,
            deSelfVerifyFallback,
            deFallbackReason,
            deFallbackFailedDb,
            deFallbackFrameIndex,
            deFallbackThresholdDb,
          });
          if (capturePlan.kind !== "sdr_disk") {
            throw new Error(`Disk verify retry requires sdr_disk plan; got ${capturePlan.kind}`);
          }
          captureRes = await invokeDiskCapture(capturePlan);
          // The first attempt's error marked the phase failed; the retry
          // recovered it — don't brand the render as failed in telemetry.
          observability.clearFailure("capture_disk");
        }
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
          captureStageObservationData({
            hasAudio,
            isPngSequence,
            isGif,
            chunkedEncode: enableChunkedEncode,
          }),
          () =>
            runEncodeStage({
              job,
              log,
              outputPath: stagedOutputPath,
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
              abortSignal: executionSignal,
              assertNotAborted,
              onProgress,
            }),
        );
        perfStages.encodeMs = encodeRes.encodeMs;
      }
    } // end SDR capture paths block

    // Opt-in per-frame timing summary for the fast-capture fallback path
    // (drawElement → screenshot when composition uses filter:blur,
    // filter:drop-shadow, clip-path, backdrop-filter, or hits any other
    // fallback gate). Emits a `capture_fallback_profile` observability
    // checkpoint per fallback-engaged session behind
    // `HF_PROFILE_FALLBACK_CAPTURE=true`. No-op otherwise, and no-op
    // when no session's capture engaged the fallback path — healthy
    // (drawElement) renders pay zero overhead. See
    // `fallbackCaptureProfile.ts` for the framing rationale.
    emitFallbackCaptureProfile(observability, dedupPerfs);

    applyRenderWarningPolicy(
      job,
      [...layeredCaptureWarnings, ...dedupPerfs.flatMap((perf) => perf.warnings ?? [])],
      log,
    );

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
      const assembleRes = await observeRenderStage(
        observability,
        "assemble",
        captureStageObservationData({ hasAudio }),
        () =>
          runAssembleStage({
            job,
            videoOnlyPath,
            audioOutputPath,
            outputPath: stagedOutputPath,
            hasAudio,
            abortSignal: executionSignal,
            assertNotAborted,
            onProgress,
          }),
      );
      perfStages.assembleMs = assembleRes.assembleMs;
    } else {
      observability.checkpoint("assemble", `skipped for ${outputFormat}`);
    }

    await artifactTransaction.validate(
      !isPngSequence && !isGif && Number.isFinite(job.duration) && job.duration > 0
        ? {
            expectedDurationSeconds: job.duration,
            fps: fpsToNumber(job.config.fps),
            expectedFrames: captureTotalFrames,
          }
        : undefined,
    );

    const totalElapsed = Date.now() - pipelineStart;

    const tmpPeakBytes = existsSync(workDir) ? sampleDirectoryBytes(workDir) : 0;
    // Record transient-tab-death retry burn (recovered case) so it's visible on
    // dashboard 1783183, not just logs. The catch mirrors this for the failed case.
    recordTransientRetryObservability();
    observability.checkpoint("pipeline", "artifact validated", { totalElapsedMs: totalElapsed });
    const observabilitySummary = observability.summary({
      lastBrowserConsole,
      capture: captureObservability,
      initFallback: mergeWorkerInitObservability(dedupPerfs),
      extraction: extractionObservability,
      compositionHash,
    });

    const perfSummary = buildRenderPerfSummary({
      job,
      workerCount,
      workerSizing,
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
      drawElement: {
        compileGate: deCompileGate,
        clampReason: deClampReason,
        workerInversion: deWorkerInversion,
        preInversionWorkers: deWorkerInversion ? preRoutingWorkerCount : undefined,
        compositionElementCount,
        compositionElementCountSource,
        shortBand: deShortBand,
        parallelRouter: deParallelRouter,
        preRouterWorkers: deParallelRouter ? preRoutingWorkerCount : undefined,
        selfVerifyFallback: deSelfVerifyFallback,
        fallbackReason: deFallbackReason,
        fallbackFailedDb: deFallbackFailedDb,
        fallbackFrameIndex: deFallbackFrameIndex,
        fallbackThresholdDb: deFallbackThresholdDb,
        drainStats: deDrainStats,
      },
      hdrDiagnostics,
      hdrPerf,
      observability: observabilitySummary,
      peakRssBytes: memSampler.peakRssBytes(),
      peakHeapUsedBytes: memSampler.peakHeapUsedBytes(),
      gpuDisabled: cfg.disableGpu,
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

    if (job.config.debug) {
      // Copy output MP4 (or single-file alpha output) into the debug dir for
      // easy access. Skipped for png-sequence: outputPath is a directory, not
      // a single file — the captured frames already live in `framesDir` under
      // workDir during a debug run anyway.
      if (!isPngSequence && existsSync(stagedOutputPath)) {
        const debugOutput = join(workDir, `output${videoExt}`);
        copyFileSync(stagedOutputPath, debugOutput);
      }
    }

    await artifactTransaction.commit();
    job.outputPath = outputPath;
    updateJobStatus(job, "complete", "Render complete", 100, onProgress);
    await eventPublisher.flush();
  } catch (error) {
    if (error instanceof RenderCancelledError || executionSignal?.aborted) {
      job.error = error instanceof Error ? error.message : "render_cancelled";
      updateJobStatus(job, "cancelled", "Render cancelled", job.progress, onProgress);
      await eventPublisher.flush();
      throw error instanceof RenderCancelledError
        ? error
        : new RenderCancelledError("render_cancelled");
    }
    if (error instanceof EncoderInterruptedError) {
      log.warn("[Render] encoder process interrupted by host lifecycle", {
        code: error.code,
        diagnostic: error.diagnosticMessage.slice(-2_000),
      });
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
    // Surface HyperFrames' PRODUCER_PUPPETEER_PROTOCOL_TIMEOUT_MS env +
    // --protocol-timeout CLI in Puppeteer CDP protocol-timeout errors. Puppeteer's
    // stock "Runtime.callFunctionOn timed out. Increase the 'protocolTimeout'
    // setting" text doesn't name the HyperFrames knob and doesn't state the
    // effective timeout that was already applied (300000 ms base + auto-scaling
    // via `scaleProtocolTimeoutForComposition`). Field signal ts=1784047847
    // reporter gave up on HF and switched to FFmpeg because the error didn't
    // point them at the lever. `augmentProtocolTimeoutError` returns the input
    // unchanged when the message doesn't match, so non-timeout failures (memory
    // exhaustion, other CDP errors) flow through with no change.
    const protocolTimeoutError = augmentProtocolTimeoutError(error, cfg.protocolTimeout);
    // Surface HyperFrames' PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS env +
    // --browser-timeout CLI + HYPERFRAMES_BROWSER_PATH escape hatch in
    // Puppeteer `page.goto` navigation-timeout errors. Puppeteer's stock
    // "Navigation timeout of 60000 ms exceeded" text names none of these
    // levers. Field signal ts=1784146416 (darwin/arm64, CLI 0.7.58): host
    // page.goto hit Navigation timeout twice on a CSS 3D + audio composition;
    // Docker rendered the same composition successfully. Mirrors #2443's
    // HYPERFRAMES_BROWSER_PATH surfacing at the runtime-navigation layer
    // (vs download-time). `augmentPageNavigationTimeoutError` returns the
    // input unchanged when the message doesn't match the Nav-timeout regex,
    // so protocol-timeout / memory / other CDP errors flow through unchanged.
    // hasCss3D + hasAudio are both left undefined here — no compile-time
    // CSS-3D signal is currently threaded through the render pipeline, and
    // `hasAudio` from the audio_process stage is block-scoped inside the
    // try. Per the helper's fallback docs, unknown flags route to the
    // generic env + browser-path hints (Docker compound hint suppressed).
    // A future compile-time CSS-3D scan (e.g. htmlCompiler.ts pass over
    // `transform-style: preserve-3d`, `perspective:`, `rotateX(`, etc.) can
    // thread both flags here to enable the full compound Docker hint.
    const navigationTimeoutError = augmentPageNavigationTimeoutError(
      protocolTimeoutError,
      cfg.pageNavigationTimeout,
    );
    const errorMessage = memoryGuidance ?? normalizeErrorMessage(navigationTimeoutError);
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
    // Use the RESOLVED worker count (auto renders — and inverted ones — may
    // have run single-worker even though job.config.workers is unset), so the
    // "--workers 1" advisory never points at the configuration that just failed.
    const wasParallel =
      (captureObservability.workerCount ?? (job.config.workers === 1 ? 1 : 2)) > 1;
    if (isTimeoutError && wasParallel) {
      log.warn(
        `Parallel capture timed out with ${captureObservability.workerCount ?? "auto"} workers. ` +
          `Video-heavy compositions often need sequential capture. Retry with --workers 1`,
      );
    }

    const failedStage = job.currentStage || "pipeline";
    const observabilitySummary = observability.summary({
      lastBrowserConsole,
      capture: captureObservability,
      initFallback: mergeWorkerInitObservability(dedupPerfs),
      extraction: extractionObservability,
      compositionHash,
    });
    const errorDetails = buildRenderErrorDetails({
      error,
      pipelineStartMs: pipelineStart,
      lastBrowserConsole,
      perfStages,
      hdrDiagnostics,
      observability: observabilitySummary,
      subTimelineWait: worstSubTimelineWaitOutcome(dedupPerfs),
    });
    publishRenderFailure(
      job,
      {
        error: errorMessage,
        failedStage,
        errorDetails,
      },
      onProgress,
    );
    await eventPublisher.flush();

    log.info("[Render] Failure summary", {
      failedStage,
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

    throw error;
  }
}
