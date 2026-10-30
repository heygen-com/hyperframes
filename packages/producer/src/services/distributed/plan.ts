import { audioFailureDiagnostics } from "@hyperframes/engine";
/**
 * Activity A of the distributed render pipeline.
 *
 * `buildLocalExecutionPlan(projectDir, config, executionPlanDir)` composes the
 * existing render stages (compile → probe → extract videos → audio → freeze)
 * into a self-contained local execution directory that downstream chunk
 * workers consume:
 *
 *     <planDir>/
 *     ├── plan.json
 *     ├── compiled/                # compileForRender output (self-contained)
 *     ├── video-frames/            # per-video JPEG sequences (dereferenced)
 *     ├── audio.m4a                # only when composition has audio
 *     └── meta/
 *         ├── composition.json
 *         ├── encoder.json         # LockedRenderConfig
 *         └── chunks.json
 *
 * Pure function over local paths. No networking. Two invocations with the
 * same inputs produce the same execution-plan hash. Transport adapters use
 * that representation either through the legacy v1 `plan()` wrapper or the
 * v2 manifest/CAS publisher.
 *
 * Banned configurations (GPU encode, hardware browser GL, system primary
 * fonts) are rejected at plan time via `planValidation.ts` so chunk workers
 * never have to handle them.
 */

import {
  copyFileSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { extname, isAbsolute, join, relative, sep } from "node:path";
import {
  type CanvasResolution,
  type DistributedFps,
  fpsToNumber,
  HF_COLOR_GRADING_ATTR,
} from "@hyperframes/core";
import {
  type EngineConfig,
  type VideoFrameFormat,
  getEncoderPreset,
  type ProresProfile,
  keyframeIntervalToGopSize,
  normalizeVp9CpuUsed,
  resolveConfig,
  type AudioProcessingFailure,
  declareContentAddressedUrl,
  renameWithRetry,
  declareProbeFactsUrl,
} from "@hyperframes/engine";
import { defaultLogger, type ProducerLogger } from "../../logger.js";
import {
  applyRenderWarningPolicy,
  type RenderJob,
  type RenderStrictness,
} from "../renderOrchestrator.js";
import { closeFileServerSafely } from "../fileServer.js";
import { measurePlanSecondsPerFrame } from "./planFrameCost.js";
import {
  buildWeightedChunkSlices,
  planFrameWeights,
  withChunkCaptureCost,
} from "./chunkWeights.js";
import { runAudioStage } from "../render/stages/audioStage.js";
import { runCompileStage } from "../render/stages/compileStage.js";
import {
  appendVideoAudioFromProbe,
  assertVideoExtractionSucceeded,
  runExtractVideosStage,
} from "../render/stages/extractVideosStage.js";
import { runProbeStage } from "../render/stages/probeStage.js";
import {
  type ChunkSliceJson,
  type CompositionMetadataJson,
  freezePlan,
  type LockedRenderConfig,
  writePlanRemoteFiles,
  type PlanFileDigests,
  prehashPlanFiles,
} from "../render/stages/freezePlan.js";
import {
  canonicalJsonStringify,
  type PlanDimensions,
  sha256Hex,
} from "../render/stages/planHash.js";
import {
  validateDistributedDuration,
  validateNoGpuEncode,
  validateNoSystemFonts,
} from "../render/planValidation.js";
import { snapshotRuntimeEnv } from "../render/runtimeEnvSnapshot.js";
import { outputNeedsAlpha } from "../render/renderFormat.js";
import {
  buildSyntheticRenderJob,
  buildPlanVideosJson,
  type DistributedFormat,
  PLAN_AUDIO_RELATIVE_PATH,
  PLAN_VIDEOS_META_RELATIVE_PATH,
  type PlanVideosJson,
  readFfmpegVersion,
  readProducerVersion,
} from "./shared.js";
import type { RenderRequestOptions } from "../../renderRequest.js";
import { writeChunkAudioSlices } from "./chunkAudio.js";
import { PLAN_PROTOCOL_V1, type PlanProtocolV1Descriptor } from "./planProtocol.js";
import {
  measurePlanSizeBreakdown,
  type PlanSizeBreakdown,
  type PlanSizeRootKind,
} from "./planSize.js";

/**
 * Caller-supplied configuration for a distributed render. `fps`, `width`,
 * `height`, and `format` are required; everything else carries a default
 * sensible for AWS Lambda fan-out.
 */
export interface DistributedRenderConfig extends Pick<RenderRequestOptions, "pageMotionBlur"> {
  /** Integer frame rate. Distributed renders only accept integer fps; the in-process renderer's `Fps` rational handles NTSC. */
  fps: DistributedFps;
  width: number;
  height: number;
  /**
   * Output container format. HDR mp4 is not supported in distributed
   * mode — `plan()` refuses it up front with a typed
   * `FormatNotSupportedInDistributedError`. The in-process renderer
   * supports it.
   *
   * `"webm"` (VP9 + Opus) is distributed-supported via closed-GOP
   * concat-copy: `lockGopForChunkConcat=true` forces a keyframe at every
   * chunk boundary and disables libvpx-vp9's alt-ref frames so chunk
   * files stitch losslessly. See `chunkEncoder.ts` for the VP9 args and
   * `tests/distributed/_smoke/webm-concat-copy.test.ts` for the gating
   * experiment that proved the contract.
   */
  format: DistributedFormat;
  /**
   * Codec selection for `format: "mp4"`. `"h264"` (the default) → libx264 +
   * yuv420p; `"h265"` → libx265 + yuv420p with closed-GOP keyint params
   * (`min-keyint=N:scenecut=0:open-gop=0:repeat-headers=1`) so chunked
   * concat-copy round-trips losslessly the same way h264 does. Ignored for
   * `format: "mov"` (always ProRes 4444) and `format: "png-sequence"`
   * (no encoder). Passing `codec` with a non-mp4 format throws at plan
   * time so caller errors surface immediately rather than producing a
   * silently-wrong planDir.
   */
  codec?: "h264" | "h265";
  quality?: "draft" | "standard" | "high";
  /** Constant-rate-factor override; mutually exclusive with `bitrate`. */
  crf?: number;
  /** Target video bitrate (e.g. `"10M"`); mutually exclusive with `crf`. */
  bitrate?: string;
  /** Longest gap between keyframes, in seconds (mp4). Chunk joins add keyframes, so this is a maximum. */
  keyframeIntervalSeconds?: number;
  /** ProRes profile for `format: "mov"`; the 422 profiles have no alpha. Defaults to `4444`. */
  proresProfile?: ProresProfile;
  /** Peak bitrate cap (mp4), per chunk. */
  maxBitrate?: string;
  /** Rate-cap buffer; defaults to twice `maxBitrate`. */
  bufferSize?: string;
  /**
   * Source-video frame extraction format. Defaults to `"auto"`, matching the
   * in-process renderer: alpha/alpha-capable sources extract as PNG, other
   * sources extract as JPG unless the caller explicitly requests `"png"`.
   */
  videoFrameFormat?: VideoFrameFormat;
  /** Output resolution preset; engages Chrome `deviceScaleFactor` supersampling. */
  outputResolution?: CanvasResolution;
  /**
   * True when `outputResolution` was normalized from an aspect-agnostic alias
   * (`1080p`, `hd`, `4k`, `uhd`) — the compile stage re-targets the preset
   * to the composition's orientation.
   */
  outputResolutionAspectAgnostic?: boolean;

  /**
   * Frames per chunk. When explicitly set, that value is used and
   * `chunkCount = min(maxParallelChunks, ceil(totalFrames / chunkSize))`
   * — useful when the caller wants a specific per-chunk runtime
   * regardless of fan-out. When `undefined` (the default), `plan()`
   * auto-sizes from `maxParallelChunks` so the caller's fan-out
   * intent is honored: `effectiveChunkSize = max(MIN_CHUNK_SIZE,
   * ceil(totalFrames / maxParallelChunks))`. The auto-size floor
   * (`MIN_CHUNK_SIZE = 10`) keeps per-chunk fixed overhead from
   * swamping the parallelism gain on tiny renders.
   *
   * `effectiveChunkSize` also drives `LockedRenderConfig.gopSize` — every
   * chunk's first frame is an IDR keyframe, so smaller chunks mean a
   * tighter GOP and larger encoded files. Callers who optimize for
   * output bytes (rather than wall-clock parallelism) should pass an
   * explicit `chunkSize` matching their target GOP — e.g. `240` for the
   * old 8-second-GOP behavior.
   */
  chunkSize?: number;
  /**
   * Caps the chunk count. When omitted, chunks are sized from `workerConcurrency` and
   * `workerTimeoutSeconds` (see {@link resolveMaxParallelChunks}); without those, `16`.
   */
  maxParallelChunks?: number;
  /** Seconds a chunk worker may run before the platform kills it (Lambda: the function timeout). */
  workerTimeoutSeconds?: number;
  /** How many chunk workers can run at once (Lambda: reserved concurrency). */
  workerConcurrency?: number;
  /**
   * Upper bound on frames-per-chunk, in frames. Optional; when omitted (the
   * default) chunk sizing is unchanged. When set, chunking targets the fewest
   * chunks whose per-chunk frame count stays at or below this bound, still
   * capped by `maxParallelChunks`:
   *
   *     chunkCount = clamp(ceil(totalFrames / targetChunkFrames), 1, maxParallelChunks)
   *
   * This bounds per-chunk render *time* (which scales with frames-per-chunk) so
   * a single chunk can't exceed a downstream per-chunk timeout on a long video,
   * while short videos still collapse to few chunks. It is a ceiling, not a
   * fixed size: a video short enough to fit in fewer chunks gets fewer. Ignored
   * when `chunkSize` is set (an explicit fixed size already pins per-chunk
   * frames). Mutually exclusive with `chunkSize` in intent; if both are passed,
   * `chunkSize` wins and `targetChunkFrames` is a no-op.
   */
  targetChunkFrames?: number;
  /** Runtime hint; consumed by future per-runtime budget checks. The current implementation records the value but does not enforce. */
  runtimeCap?: "lambda" | "temporal" | "cloud-run-job" | "k8s-job" | "none";

  /**
   * Reject compositions whose primary font-family resolves to a host-OS /
   * generic family. Default `true` for distributed renders — overriding to
   * `false` is unsupported and exists only as an escape hatch for tests.
   */
  rejectOnSystemFonts?: boolean;
  /**
   * Threaded into the `injectDeterministicFontFaces` font loader. Default
   * `true` — distributed renders must not silently fall back to system fonts.
   */
  failClosedFontFetch?: boolean;

  /** HDR is not supported in distributed mode; `force-hdr` trips a `FormatNotSupportedInDistributedError`. Defaults to `force-sdr`. */
  hdrMode?: "auto" | "force-sdr";

  /**
   * Opt-in exact-CFR re-encode at the assemble stage. When `true`, the
   * stitched output is re-encoded once with `-fps_mode cfr -r <fps>` so
   * the stream-level `avg_frame_rate` matches the container's
   * `r_frame_rate` exactly (and the file duration is exact, not
   * PTS-derived). Useful for downstream consumers that strict-check
   * `avg_frame_rate` or ms-precision duration. Default `false` retains
   * the existing `-c copy` stitch path, which is faster and lossless.
   * mp4 only — webm / mov stream-copy paths already produce exact
   * avg_frame_rate. Consumed by `assemble`; does not affect `planHash`
   * (chunks render identically; only the final stitch step differs).
   */
  cfr?: boolean;

  logger?: ProducerLogger;
  /** JSON-safe engine snapshot carried across cloud/process boundaries. */
  engineConfig?: EngineConfig;
  /** Optional engine config override (env vars are not read when provided). */
  producerConfig?: EngineConfig;
  /** Entry HTML file relative to `projectDir`. Defaults to `"index.html"`. */
  entryFile?: string;
  /** Strict rejects correctness warnings; best-effort returns a qualified outcome. */
  strictness?: RenderStrictness;
  /** Caller-supplied AbortSignal. Threaded through compile / probe / extract / audio stages. */
  abortSignal?: AbortSignal;
  /**
   * Hard ceiling on `<planDir>/` size in bytes; trips a non-retryable
   * `PLAN_TOO_LARGE` error after freeze. Defaults to
   * {@link PLAN_DIR_SIZE_LIMIT_BYTES} (2 GB — fits inside AWS Lambda's
   * 10 GB `/tmp` budget alongside the chunk worker's frame buffer +
   * ffmpeg working set). Adapters that deploy onto storage with
   * tighter ceilings can pass a smaller cap; tests pass a tiny cap to
   * exercise the throw path. This applies to the monolithic v1 transport;
   * `planV2()` emits content-addressed role dependencies and bypasses it.
   */
  planDirSizeLimitBytes?: number;

  /**
   * Render-time variable overrides for the composition. Snapshotted into
   * `meta/encoder.json` at plan time and re-injected by every chunk
   * worker as `window.__hfVariables` before the first capture, mirroring
   * the in-process renderer's
   * `RenderConfig.variables` → `CaptureOptions.variables` path. The
   * runtime helper `getVariables()` merges these over the declared
   * defaults from `<html data-composition-variables="…">`.
   *
   * Folded into `planHash`: different variables produce different hashes
   * because rendered frames depend on the injected values. Must be a
   * JSON-serializable plain object — `freezePlan`'s canonical-JSON pass
   * throws on non-serializable values (functions, Symbols, BigInts) when
   * the variables reach this layer. Adapters that ship to Lambda (the
   * `@hyperframes/aws-lambda` SDK) also validate the shape client-side
   * before any AWS call so the rejection lands at the SDK boundary
   * rather than mid-plan; the producer-side throw is the fallback.
   */
  variables?: Record<string, unknown>;
}

/** Shared local representation consumed by both distributed plan transports. */
export interface LocalExecutionPlan {
  executionPlanDir: string;
  executionPlanHash: string;
  chunkCount: number;
  totalFrames: number;
  fps: DistributedFps;
  width: number;
  height: number;
  format: DistributedFormat;
  ffmpegVersion: string;
  producerVersion: string;
}

export interface BuildLocalExecutionPlanOptions {
  /**
   * Transport-specific size ceiling for the local execution representation.
   * Legacy v1 uses the monolithic plan-directory limit; v2 disables that
   * transport cap because it publishes role-scoped content-addressed objects.
   */
  readonly executionPlanSizeLimitBytes?: number;
  /**
   * Leave long constant-frame-rate video windows unextracted and ship their
   * sources, so each chunk extracts only the frames it renders. Plan v2 only:
   * chunks write those frames into their own work directory.
   */
  readonly deferVideoExtraction?: boolean;
  /** Project files absent locally: probe their URL and publish their existing digest. */
  readonly remoteFiles?: Readonly<Record<string, RemoteProjectFile>>;
  /** Shared with the publisher so each plan file is hashed once. */
  readonly digests?: PlanFileDigests;
  /** Runs while the audio mixes, once `compiled/` and the video trees are final. */
  readonly whileAudioMixes?: () => Promise<void>;
  /** mp4 chunks carry their plan-audio slice unless cfr re-encodes. */
  readonly chunksCarryAudio?: boolean;
  /** With `chunksCarryAudio`, also write each chunk's audio packets to their own file. Plan v2 only. */
  readonly sliceChunkAudio?: boolean;
  /** Leave the audio to {@link buildPlanAudio}; chunks render video only. mp4 without `cfr` only. */
  readonly deferAudio?: boolean;
}

export interface RemoteProjectFile {
  readonly url: string;
  /** A file of only this video's audio, when one was stored: the audio mix reads it, not the video. */
  readonly audioSidecarUrl?: string;
  /** The file's stored ffprobe JSON: the plan reads it instead of probing the file over the network. */
  readonly probeFactsUrl?: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export function logPlanStage(log: ProducerLogger, stage: string, startedAt: number): void {
  log.info("[plan] stage", { stage, ms: Date.now() - startedAt });
}

/**
 * Result of the legacy v1 {@link plan} wrapper. The `planHash` is the
 * content-addressed identifier that adapters key replay short-circuits off of.
 *
 * @deprecated Use `planV2()` or `planV2WithPublisher()` for new integrations.
 * The v1 result remains supported for existing transports.
 */
export interface PlanResult {
  planDir: string;
  planProtocol: Readonly<PlanProtocolV1Descriptor>;
  planHash: string;
  chunkCount: number;
  totalFrames: number;
  fps: DistributedFps;
  width: number;
  height: number;
  format: DistributedFormat;
  ffmpegVersion: string;
  producerVersion: string;
}

/** Applies the same audio correctness policy used by the in-process renderer. */
export function applyDistributedAudioWarningPolicy(
  job: RenderJob,
  audioError: string,
  audioFailures: readonly AudioProcessingFailure[] = [],
  log: ProducerLogger = defaultLogger,
): void {
  const failureOwner =
    audioFailures.length === 0
      ? undefined
      : audioFailures.some((failure) => failure.owner === "system")
        ? "system"
        : "user";
  const retryable =
    audioFailures.length === 0 ? undefined : audioFailures.every((failure) => failure.retryable);
  applyRenderWarningPolicy(
    job,
    [
      {
        code: "audio_processing_failed",
        message: `Audio mix failed; output would be video-only: ${audioError}`,
        details: {
          mediaType: "audio",
          audioFailures: audioFailureDiagnostics(audioFailures),
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

/**
 * Top-level directory names skipped by the `projectDir → planDir/compiled/`
 * pre-seed copy. Real projects often contain `node_modules/`, VCS metadata,
 * and harness artifacts that have no business in a planDir — they bloat
 * the 2 GB planDir cap and slow the S3/Lambda round-trip for no benefit.
 * Matched against the path relative to `projectDir` so a `projectDir`
 * whose absolute path happens to contain one of these names (e.g.
 * `~/work/output/comp/`) doesn't false-positive-skip the entire copy.
 */
export const PLAN_PROJECT_DIR_SKIP_SEGMENTS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".cache",
  "output",
  "failures",
  "dist",
  ".next",
  ".turbo",
]);

/**
 * Chunk size in frames (~8s @ 30fps) for callers that want a fixed GOP.
 * `plan()` never applies it on its own; an undefined `chunkSize` auto-sizes.
 */
export const DEFAULT_CHUNK_SIZE = 240;
/** Default cap on parallel chunks for operational fairness across renders. */
export const DEFAULT_MAX_PARALLEL_CHUNKS = 16;
/**
 * Floor for the auto-sized `chunkSize` when the caller leaves it
 * `undefined`. Anything smaller hits a per-chunk fixed-overhead wall
 * (worker boot + plan download + planHash recompute + ffmpeg init) that
 * outweighs the parallelism gain on tiny renders.
 */
export const MIN_CHUNK_SIZE = 10;
/** Largest `chunkSize`; `validateDistributedRenderConfig` enforces it, and cost-weighted chunks stay under it. */
export const MAX_CHUNK_SIZE = 3600;
/** Most chunks one render may plan; `validateDistributedRenderConfig` enforces it on `maxParallelChunks`. */
export const MAX_PARALLEL_CHUNKS_CEILING = 256;
// 0.11 s per megapixel-frame (~0.23 s per 1080p frame) was measured on one simple 1080p fixture on a
// 10 GB Lambda, fixed cost included; heavier compositions cost more, hence the margin and overhead.
const ESTIMATED_SECONDS_PER_MEGAPIXEL_FRAME = 0.11;
const ESTIMATED_CHUNK_OVERHEAD_SECONDS = 60;
/** Share of the worker time limit a chunk's predicted time may use. */
const WORKER_TIMEOUT_MARGIN = 0.75;

/** Seconds one frame is priced at: the per-pixel estimate, or the measured cost when it is higher. */
function estimateFrameSeconds(megapixels: number, measuredSecondsPerFrame = 0): number {
  return Math.max(ESTIMATED_SECONDS_PER_MEGAPIXEL_FRAME * megapixels, measuredSecondsPerFrame);
}

/** Predicted seconds for one chunk of `frames` frames at `megapixels` output pixels per frame. */
export function estimateChunkSeconds(
  frames: number,
  megapixels: number,
  measuredSecondsPerFrame?: number,
): number {
  return (
    ESTIMATED_CHUNK_OVERHEAD_SECONDS +
    frames * estimateFrameSeconds(megapixels, measuredSecondsPerFrame)
  );
}

/** Graded media runs a full-frame shader per frame, which the per-pixel estimate cannot see. */
export function planNeedsFrameCostMeasurement(html: string): boolean {
  return new RegExp(`\\b${HF_COLOR_GRADING_ATTR}=`, "i").test(html);
}

/** Whether {@link resolveMaxParallelChunks} sizes chunks from what a frame costs. */
export function chunkSizingUsesFrameCost(
  config: Pick<
    DistributedRenderConfig,
    | "maxParallelChunks"
    | "chunkSize"
    | "targetChunkFrames"
    | "workerTimeoutSeconds"
    | "workerConcurrency"
  >,
): boolean {
  return (
    config.maxParallelChunks === undefined &&
    config.chunkSize === undefined &&
    config.targetChunkFrames === undefined &&
    (config.workerTimeoutSeconds !== undefined || config.workerConcurrency !== undefined)
  );
}

/** Non-retryable: even {@link MAX_PARALLEL_CHUNKS_CEILING} chunks cannot fit the worker time limit. */
export const CHUNK_EXCEEDS_WORKER_TIMEOUT = "CHUNK_EXCEEDS_WORKER_TIMEOUT";

export class ChunkExceedsWorkerTimeoutError extends Error {
  readonly code: typeof CHUNK_EXCEEDS_WORKER_TIMEOUT = CHUNK_EXCEEDS_WORKER_TIMEOUT;
  constructor(predictedChunkSeconds: number, workerTimeoutSeconds: number) {
    super(
      `[plan] each chunk is predicted to take about ${predictedChunkSeconds} s even split ` +
        `${MAX_PARALLEL_CHUNKS_CEILING} ways, over the ${workerTimeoutSeconds * WORKER_TIMEOUT_MARGIN} s ` +
        `budget (${WORKER_TIMEOUT_MARGIN * 100}% of the ${workerTimeoutSeconds} s worker time limit) ` +
        `(${CHUNK_EXCEEDS_WORKER_TIMEOUT}). Shorten the video or lower its ` +
        `resolution, raise the worker time limit, or pass an explicit chunkSize or ` +
        `maxParallelChunks to override the estimate.`,
    );
    this.name = "ChunkExceedsWorkerTimeoutError";
  }
}

/** Frames one chunk can capture inside the worker time limit, after the per-chunk overhead. */
function framesWithinWorkerTimeout(workerTimeoutSeconds: number, secondsPerFrame: number): number {
  return Math.floor(
    (workerTimeoutSeconds * WORKER_TIMEOUT_MARGIN - ESTIMATED_CHUNK_OVERHEAD_SECONDS) /
      secondsPerFrame,
  );
}

/**
 * The `maxParallelChunks` a plan uses: an explicit value, else one wave across `workerConcurrency`
 * (16 if unknown), widened to fit `workerTimeoutSeconds` unless chunkSize/targetChunkFrames pin it.
 */
export function resolveMaxParallelChunks(
  config: Pick<
    DistributedRenderConfig,
    | "maxParallelChunks"
    | "chunkSize"
    | "targetChunkFrames"
    | "workerTimeoutSeconds"
    | "workerConcurrency"
  >,
  totalFrames: number,
  /** Output pixels per frame, after supersampling. */
  megapixels: number,
  log: ProducerLogger = defaultLogger,
  /** Measured capture seconds per frame; frames are priced at it when it beats the estimate. */
  measuredSecondsPerFrame?: number,
): number {
  if (config.maxParallelChunks !== undefined) return config.maxParallelChunks;
  const { workerTimeoutSeconds, workerConcurrency } = config;
  const wave = Math.min(
    workerConcurrency ?? DEFAULT_MAX_PARALLEL_CHUNKS,
    MAX_PARALLEL_CHUNKS_CEILING,
  );
  if (!chunkSizingUsesFrameCost(config)) return wave;
  const secondsPerFrame = estimateFrameSeconds(megapixels, measuredSecondsPerFrame);
  const minFramesPerChunk = Math.ceil(ESTIMATED_CHUNK_OVERHEAD_SECONDS / secondsPerFrame);
  const wide = Math.max(1, Math.min(wave, Math.floor(totalFrames / minFramesPerChunk)));
  if (workerTimeoutSeconds === undefined) return wide;

  const maxFramesPerChunk = framesWithinWorkerTimeout(workerTimeoutSeconds, secondsPerFrame);
  const needed = maxFramesPerChunk < 1 ? Infinity : Math.ceil(totalFrames / maxFramesPerChunk);
  if (needed > MAX_PARALLEL_CHUNKS_CEILING) {
    const framesAtCeiling = Math.ceil(totalFrames / MAX_PARALLEL_CHUNKS_CEILING);
    throw new ChunkExceedsWorkerTimeoutError(
      Math.ceil(estimateChunkSeconds(framesAtCeiling, megapixels, measuredSecondsPerFrame)),
      workerTimeoutSeconds,
    );
  }
  if (needed > wave) {
    log.warn(
      `[plan] ${needed} chunks are needed to keep each under the ${workerTimeoutSeconds} s ` +
        `worker time limit, but the plan assumes ${wave} workers at once, so the render runs ` +
        `in ${Math.ceil(needed / wave)} waves. Raise --concurrency to ${needed} to render in one ` +
        `wave (Lambda: hyperframes lambda deploy --concurrency ${needed}, or a higher account concurrency quota).`,
      { needed, workerConcurrency: wave, workerTimeoutSeconds },
    );
  }
  return Math.max(wide, needed);
}

/**
 * Default hard ceiling on `<planDir>/` size in bytes. 2 GB fits inside
 * AWS Lambda's 10 GB `/tmp` alongside the chunk worker's captured frames
 * and ffmpeg's temporary files. Compositions that exceed this can opt into
 * `planV2()` or fall back to the in-process renderer.
 */
export const PLAN_DIR_SIZE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Non-retryable error code raised when `plan()` produces a planDir whose
 * total size exceeds the configured limit. Workflow adapters key retry
 * policies off `code` — the planDir would fail the same way on every
 * retry, so the failure must not auto-retry.
 */
export const PLAN_TOO_LARGE = "PLAN_TOO_LARGE";

/** Typed error raised when the produced planDir exceeds {@link PLAN_DIR_SIZE_LIMIT_BYTES}. */
export class PlanTooLargeError extends Error {
  readonly code: typeof PLAN_TOO_LARGE = PLAN_TOO_LARGE;
  readonly sizeBytes: number;
  readonly limitBytes: number;
  readonly breakdown?: PlanSizeBreakdown;
  readonly observedAt?: string;
  constructor(
    sizeBytes: number,
    limitBytes: number,
    breakdown?: PlanSizeBreakdown,
    observedAt?: string,
  ) {
    const breakdownSuffix = breakdown
      ? ` Breakdown: video-frames=${formatBytes(breakdown.videoFramesBytes)}, ` +
        `compiled=${formatBytes(breakdown.compiledBytes)} ` +
        `(source-media=${formatBytes(breakdown.sourceMediaBytes)}), ` +
        `audio=${formatBytes(breakdown.audioBytes)}, metadata=${formatBytes(breakdown.metadataBytes)}, ` +
        `other=${formatBytes(breakdown.otherBytes)}, files=${breakdown.fileCount}.`
      : "";
    const observationSuffix = observedAt ? ` Observed at ${observedAt}.` : "";
    super(
      `[plan] planDir size ${formatBytes(sizeBytes)} exceeds the configured ceiling ` +
        `${formatBytes(limitBytes)} (PLAN_TOO_LARGE). The default 2 GB cap fits inside AWS ` +
        `Lambda's 10 GB /tmp budget alongside the chunk worker's frame buffer and ffmpeg's ` +
        `working set. To unblock: use the content-addressed \`planV2()\` transport, shorten ` +
        `the composition, lower the framerate, or use the in-process renderer ` +
        `(\`executeRenderJob\`), which has no planDir size cap.` +
        observationSuffix +
        breakdownSuffix,
    );
    this.name = "PlanTooLargeError";
    this.sizeBytes = sizeBytes;
    this.limitBytes = limitBytes;
    this.breakdown = breakdown;
    this.observedAt = observedAt;
  }
}

/**
 * Non-retryable error code raised when `plan()` is asked for an output
 * format that distributed mode doesn't support (currently: HDR mp4). The
 * same config would fail on every retry, so the failure must not
 * auto-retry.
 */
export const FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED = "FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED";

/**
 * Typed error raised by `plan()` for outputs that distributed mode
 * refuses to ship.
 *
 *   - mp4 + HDR (PQ / HLG) — chunked HDR pre-extract + HDR signaling
 *     re-apply on the assembled file is not implemented yet.
 *
 * The in-process renderer (`executeRenderJob`) handles it natively.
 *
 * WebM was previously refused here; v0.7+ supports it via closed-GOP
 * concat-copy. See {@link DistributedRenderConfig.format} for the
 * supported set and {@link rejectUnsupportedDistributedFormat} for the
 * gate.
 */
export class FormatNotSupportedInDistributedError extends Error {
  readonly code: typeof FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED = FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED;
  readonly format: string;
  readonly reason: string;
  constructor(format: string, reason: string) {
    super(
      `[plan] format ${JSON.stringify(format)} is not supported in distributed mode: ${reason}. ` +
        `Render with the in-process renderer (\`executeRenderJob\`), which has full format ` +
        `support, or pick a distributed-supported format: mp4 SDR, mov ProRes 4444, ` +
        `png-sequence, or webm VP9.`,
    );
    this.name = "FormatNotSupportedInDistributedError";
    this.format = format;
    this.reason = reason;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

/**
 * Reject formats the distributed pipeline cannot ship (HDR mp4 only —
 * webm is supported as of v0.7 via closed-GOP concat-copy).
 *
 * Throws {@link FormatNotSupportedInDistributedError} with a message
 * naming the rejected format. Runs at the very top of `plan()` so a
 * banned input never produces a partial planDir.
 *
 * Exported so adapters can call the same gate at their own input layer
 * (Step Functions input validation, Temporal workflow start) before the
 * activity even runs — the resulting non-retryable error then matches
 * what `plan()` would have thrown.
 */
export function rejectUnsupportedDistributedFormat(
  config: Pick<DistributedRenderConfig, "format" | "hdrMode">,
): void {
  if ((config.hdrMode as string) === "force-hdr") {
    throw new FormatNotSupportedInDistributedError(
      "mp4-hdr",
      "HDR (PQ / HLG) requires per-source HDR pre-extract + HDR signaling re-apply on the " +
        "assembled file; neither is implemented for the distributed pipeline",
    );
  }
}

/**
 * Walk `<planDir>/` depth-first and sum all regular file sizes. Symlinks
 * are not traversed — they shouldn't appear inside a planDir to begin with
 * (the extract stage materializes them), and following them could push the
 * walker outside the planDir.
 */
export function measurePlanDirBytes(planDir: string): number {
  return measurePlanSizeBreakdown(planDir).totalBytes;
}

function assertPlanSizeWithinLimit(input: {
  rootDir: string;
  rootKind: PlanSizeRootKind;
  limitBytes: number;
  observedAt: string;
  log: ProducerLogger;
}): PlanSizeBreakdown {
  const breakdown = measurePlanSizeBreakdown(input.rootDir, input.rootKind);
  if (breakdown.totalBytes <= input.limitBytes) return breakdown;
  input.log.warn("[plan] size budget exceeded", {
    observedAt: input.observedAt,
    sizeBytes: breakdown.totalBytes,
    limitBytes: input.limitBytes,
    fileCount: breakdown.fileCount,
    compiledBytes: breakdown.compiledBytes,
    sourceMediaBytes: breakdown.sourceMediaBytes,
    videoFramesBytes: breakdown.videoFramesBytes,
    videoFrameFileCount: breakdown.videoFrameFileCount,
    audioBytes: breakdown.audioBytes,
    metadataBytes: breakdown.metadataBytes,
    otherBytes: breakdown.otherBytes,
    topComponents: breakdown.topComponents,
  });
  throw new PlanTooLargeError(breakdown.totalBytes, input.limitBytes, breakdown, input.observedAt);
}

/**
 * Compute `(chunkCount, effectiveChunkSize)` from total frames and the
 * caller's chunking knobs. The operative chunk size is
 * `resolvedChunkSize` — equal to `configChunkSize` when the caller
 * passes one, otherwise auto-sized from `maxParallelChunks`:
 *
 *     resolvedChunkSize   = configChunkSize ?? max(MIN_CHUNK_SIZE, ceil(totalFrames / maxParallelChunks))
 *     chunkCount          = min(maxParallelChunks, ceil(totalFrames / resolvedChunkSize))
 *     effectiveChunkSize  = max(resolvedChunkSize, ceil(totalFrames / chunkCount))
 *     chunkCount          = min(chunkCount, ceil(totalFrames / effectiveChunkSize))  // drop empty trailing slice
 *
 * Long renders auto-rescale to fewer-but-longer chunks rather than
 * fragmenting infinitely. Returned `chunkCount >= 1` (`totalFrames === 0`
 * is rejected upstream); `effectiveChunkSize >= resolvedChunkSize`.
 *
 * The auto-sizer (triggered when `configChunkSize` is `undefined`) honors
 * the caller's fan-out intent: passing `maxParallelChunks=16` without
 * `chunkSize` produces 16 chunks (subject to the `MIN_CHUNK_SIZE` floor
 * on tiny renders). Explicit numbers, including `240`, take precedence.
 *
 * Optional `targetChunkFrames` caps per-chunk frames in the auto-sized path:
 * the auto-sizer then targets `clamp(ceil(totalFrames / targetChunkFrames), 1,
 * maxParallelChunks)` chunks, so short videos collapse to fewer chunks and long
 * videos add chunks (up to the cap) to keep each one under the bound. It is a
 * no-op when omitted, and ignored when `configChunkSize` is set.
 */
export function resolveChunkPlan(
  totalFrames: number,
  configChunkSize: number | undefined,
  maxParallelChunks: number,
  targetChunkFrames?: number,
): { chunkCount: number; effectiveChunkSize: number } {
  // Integer-only inputs: a fractional `totalFrames` (e.g. 10.5) would
  // otherwise produce a last chunk with non-integer `endFrame`, and the
  // chunk worker's `for (i = startFrame; i < endFrame; i++)` loop would
  // silently truncate.
  assertPositiveInteger("totalFrames", totalFrames);
  assertPositiveInteger("maxParallelChunks", maxParallelChunks);
  // Validate the caller-supplied value with its real name so the error
  // message points at the actual bad input. The auto-sized branch is
  // provably a positive integer (totalFrames and maxParallelChunks are
  // already validated above, MIN_CHUNK_SIZE is a positive integer
  // constant), so it doesn't need re-checking.
  if (configChunkSize !== undefined) {
    assertPositiveInteger("configChunkSize", configChunkSize);
  }
  if (targetChunkFrames !== undefined) {
    assertPositiveInteger("targetChunkFrames", targetChunkFrames);
  }
  // `targetChunkFrames` lowers the auto-sizer's effective parallelism so the
  // chosen chunk count keeps frames-per-chunk at or below the bound, without
  // ever exceeding `maxParallelChunks`. It only affects the auto-sized path
  // (`configChunkSize === undefined`); an explicit `chunkSize` already pins
  // per-chunk frames and takes precedence. When `targetChunkFrames` is
  // undefined, `autoSizeParallel === maxParallelChunks` and the auto-sized
  // chunk size is identical to the prior behavior.
  const autoSizeParallel =
    targetChunkFrames === undefined
      ? maxParallelChunks
      : Math.min(maxParallelChunks, Math.max(1, Math.ceil(totalFrames / targetChunkFrames)));
  const resolvedChunkSize =
    configChunkSize ?? Math.max(MIN_CHUNK_SIZE, Math.ceil(totalFrames / autoSizeParallel));
  const naiveCount = Math.ceil(totalFrames / resolvedChunkSize);
  const chunkCount = Math.min(maxParallelChunks, Math.max(1, naiveCount));
  const effectiveChunkSize = Math.max(resolvedChunkSize, Math.ceil(totalFrames / chunkCount));
  // Rounding effectiveChunkSize up can let the first (chunkCount - 1) chunks
  // already cover every frame, leaving an empty/inverted trailing slice that
  // buildChunkSlices would still emit and renderChunk would then reject
  // (framesInChunk <= 0), failing the whole distributed render. Tighten
  // chunkCount to the number of chunks effectiveChunkSize actually needs so the
  // union stays exactly [0, totalFrames) with no empty tail. This only ever
  // lowers chunkCount in the explicit-small-chunkSize case; the auto-sized and
  // large-chunkSize paths already satisfy ceil(totalFrames / effectiveChunkSize)
  // >= chunkCount, so it's a no-op there.
  const tightChunkCount = Math.min(chunkCount, Math.ceil(totalFrames / effectiveChunkSize));
  return { chunkCount: tightChunkCount, effectiveChunkSize };
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `[plan] resolveChunkPlan: ${name} must be a positive integer (received ${String(value)})`,
    );
  }
}

const FREEZE_OWNED_PLAN_FILES = [
  "plan.json",
  join("meta", "composition.json"),
  join("meta", "encoder.json"),
  join("meta", "chunks.json"),
] as const;

function removeFreezeOwnedPlanFiles(planDir: string): void {
  for (const relativePath of FREEZE_OWNED_PLAN_FILES) {
    rmSync(join(planDir, relativePath), { force: true });
  }
}

/**
 * Slice `totalFrames` into `chunkCount` consecutive ranges. Each chunk gets
 * `effectiveChunkSize` frames except the last, which absorbs the remainder
 * so the union is exactly `[0, totalFrames)`. `endFrame` is the EXCLUSIVE
 * upper bound — chunk workers iterate `i in [startFrame, endFrame)`.
 */
export function buildChunkSlices(
  totalFrames: number,
  chunkCount: number,
  effectiveChunkSize: number,
): ChunkSliceJson[] {
  const slices: ChunkSliceJson[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const startFrame = i * effectiveChunkSize;
    const endFrame =
      i === chunkCount - 1 ? totalFrames : Math.min(totalFrames, startFrame + effectiveChunkSize);
    slices.push({ index: i, startFrame, endFrame });
  }
  return slices;
}

/**
 * The plan's chunk cut: auto-sized plans re-cut the same chunk count by estimated capture cost;
 * explicit `chunkSize` or uniform cost keeps {@link buildChunkSlices}; `targetChunkFrames` and the time limit cap it.
 */
export function buildPlanChunkSlices(
  frameWeights: Float64Array,
  config: Pick<DistributedRenderConfig, "chunkSize" | "targetChunkFrames">,
  chunkCount: number,
  effectiveChunkSize: number,
  maxFramesPerChunk = Infinity,
): ChunkSliceJson[] {
  const weighted =
    config.chunkSize === undefined
      ? buildWeightedChunkSlices(
          frameWeights,
          chunkCount,
          MIN_CHUNK_SIZE,
          Math.min(config.targetChunkFrames ?? MAX_CHUNK_SIZE, MAX_CHUNK_SIZE, maxFramesPerChunk),
        )
      : null;
  return withChunkCaptureCost(
    weighted ?? buildChunkSlices(frameWeights.length, chunkCount, effectiveChunkSize),
    frameWeights,
  );
}

/**
 * Hash the deterministic-font bundle that ships inside `@hyperframes/producer`.
 * The compiled HTML already inlines per-family `@font-face` data URIs, so the
 * snapshot SHA exists primarily to detect cross-version font-bundle drift on
 * chunk workers. Mixed into `planHash`.
 *
 * Pulled lazily because the generated module is large and only the
 * distributed pipeline needs it.
 */
async function readFontSnapshotSha(): Promise<string> {
  const module = (await import("@hyperframes/core/fonts/embedded-data")) as {
    EMBEDDED_FONT_DATA?: unknown;
  };
  const data = module.EMBEDDED_FONT_DATA;
  if (!data || typeof data !== "object") {
    throw new Error(
      "[plan] EMBEDDED_FONT_DATA missing from @hyperframes/core/fonts/embedded-data. Was `bun run build:fonts` run?",
    );
  }
  // Hash a canonical key fingerprint, not the raw font bytes — the bytes are
  // already mixed in through `compositionHtml` (the @font-face data URIs the
  // compiler injects). What we really want to detect here is "the bundle on
  // worker B is a different version of the producer than on controller A",
  // which is fully captured by the sorted family names + per-family byte
  // lengths.
  const dataObj = data as Record<string, unknown>;
  const fingerprint: Record<string, number> = {};
  for (const key of Object.keys(dataObj).sort()) {
    const value = dataObj[key];
    fingerprint[key] =
      typeof value === "string" ? value.length : JSON.stringify(value ?? null).length;
  }
  return sha256Hex(canonicalJsonStringify(fingerprint));
}

/**
 * Build the `LockedRenderConfig` frozen into `meta/encoder.json`.
 * Captures everything chunk workers need to reproduce the controller's
 * encode decisions byte-for-byte. Validated by the chunk worker on boot —
 * the same input here must round-trip to an identical config.
 */
function buildLockedRenderConfig(input: {
  config: DistributedRenderConfig;
  forceScreenshot: boolean;
  deviceScaleFactor: number;
  ffmpegVersion: string;
  engineConfig: Pick<EngineConfig, "vp9CpuUsed">;
  effectiveChunkSize: number;
  chunkCount: number;
  runtimeEnv: Record<string, string>;
  chunksCarryAudio: boolean;
  separateAudio: boolean;
}): LockedRenderConfig {
  const { config, forceScreenshot, deviceScaleFactor, ffmpegVersion } = input;
  const { encoder, pixelFormat, preset } = resolveEncoderTriple(config);
  const locksVp9CpuUsed =
    encoder === "libvpx-vp9-software"
      ? { vp9CpuUsed: normalizeVp9CpuUsed(input.engineConfig.vp9CpuUsed) }
      : {};
  return {
    captureMode: forceScreenshot ? "screenshot" : "beginframe",
    forceScreenshot,
    deviceScaleFactor,
    useLayeredHdrComposite: false,
    browserGpuMode: "software",
    // Match `LOCKED_WARMUP_TICKS` in `frameCapture.ts` — kept as a literal so
    // a worker that ships a different value will trip `PLAN_HASH_MISMATCH`
    // (the locked config flows into planHash via the canonical JSON).
    warmupTicks: 60,
    encoder,
    quality: config.quality ?? "standard",
    ffmpegVersion,
    preset,
    crf: config.crf,
    bitrate: config.bitrate,
    maxBitrate: config.maxBitrate,
    bufferSize: config.bufferSize,
    keyframeIntervalFrames:
      config.keyframeIntervalSeconds === undefined
        ? undefined
        : keyframeIntervalToGopSize({ num: config.fps, den: 1 }, config.keyframeIntervalSeconds),
    ...locksVp9CpuUsed,
    // GOP === chunkSize so every chunk's first frame is an IDR keyframe and
    // ffmpeg concat-copy round-trips losslessly.
    gopSize: input.effectiveChunkSize,
    closedGop: true,
    forceKeyframes: "n=0",
    pixelFormat,
    // Omitted for the default so existing 4444 plans keep their planHash.
    ...(config.proresProfile && config.proresProfile !== "4444"
      ? { proresProfile: config.proresProfile }
      : {}),
    chunkSize: input.effectiveChunkSize,
    chunkCount: input.chunkCount,
    runtimeEnv: input.runtimeEnv,
    variables: config.variables,
    pageMotionBlur: config.pageMotionBlur,
    ...(input.chunksCarryAudio ? { chunksCarryAudio: true } : {}),
    ...(input.separateAudio ? { separateAudio: true } : {}),
  };
}

/** Only mp4 without `cfr` can skip the assemble-time join; `cfr` re-encodes the joined video. */
function carriesChunkAudio(
  config: Pick<DistributedRenderConfig, "format" | "cfr">,
  options: Pick<BuildLocalExecutionPlanOptions, "chunksCarryAudio">,
): boolean {
  return options.chunksCarryAudio === true && config.format === "mp4" && config.cfr !== true;
}

/**
 * Resolve the encoder + pixel-format + preset triple for a distributed
 * render. Distributed mode is SDR-only: H.264 or H.265 8-bit for mp4,
 * libvpx-vp9 + yuva420p (alpha) for webm, ProRes 4444 for mov, raw RGBA
 * for png-sequence.
 *
 * `config.codec` is consulted only when `config.format === "mp4"`. Passing
 * `codec` with a non-mp4 format throws at plan time — surfaces the
 * caller error immediately rather than producing a silently-wrong planDir
 * whose chunk worker would override the codec choice.
 */
type EncoderTriple = {
  encoder: LockedRenderConfig["encoder"];
  pixelFormat: string;
  preset: string;
};

function resolveEncoderTriple(config: DistributedRenderConfig): EncoderTriple {
  if (config.format === "mp4") {
    return resolveMp4EncoderTriple(config.codec);
  }
  if (config.codec !== undefined) {
    throw new Error(
      `[plan] DistributedRenderConfig.codec is only valid for format="mp4"; received ` +
        `codec=${JSON.stringify(config.codec)} with format=${JSON.stringify(config.format)}. ` +
        `Omit codec for non-mp4 formats: mov is always ProRes 4444, webm is always ` +
        `libvpx-vp9, and png-sequence has no encoder.`,
    );
  }
  return resolveNonMp4EncoderTriple(
    config.format,
    config.quality ?? "standard",
    config.proresProfile,
  );
}

function resolveMp4EncoderTriple(codec: DistributedRenderConfig["codec"]): EncoderTriple {
  const c = codec ?? "h264";
  // Explicit unknown-codec throw rather than silent fall-through to h264.
  // A JS caller building config from JSON who passes `codec: "h266"` or
  // `codec: "H265"` (typo / wrong case) would otherwise produce h264
  // output with no signal. The non-mp4-format branch already throws for
  // the symmetric "wrong combination" case — match that shape.
  if (c !== "h264" && c !== "h265") {
    throw new Error(
      `[plan] DistributedRenderConfig.codec must be "h264" or "h265" for format="mp4"; ` +
        `received ${JSON.stringify(c)}. Omit codec to default to h264.`,
    );
  }
  if (c === "h265") {
    return { encoder: "libx265-software", pixelFormat: "yuv420p", preset: "medium" };
  }
  return { encoder: "libx264-software", pixelFormat: "yuv420p", preset: "medium" };
}

function resolveNonMp4EncoderTriple(
  format: Exclude<DistributedFormat, "mp4">,
  quality: "draft" | "standard" | "high",
  proresProfile?: ProresProfile,
): EncoderTriple {
  if (format === "mov") {
    const { pixelFormat, preset } = getEncoderPreset(quality, "mov", undefined, proresProfile);
    return { encoder: "prores-software", pixelFormat, preset };
  }
  if (format === "webm") {
    // Defer to `getEncoderPreset` for the libvpx-vp9 preset string so the
    // draft tier maps to `-deadline realtime` instead of `-deadline good`;
    // hardcoding "good" here would silently override that mapping for
    // `quality: "draft"`.
    const enginePreset = getEncoderPreset(quality, "webm");
    return {
      encoder: "libvpx-vp9-software",
      pixelFormat: enginePreset.pixelFormat,
      preset: enginePreset.preset,
    };
  }
  return { encoder: "png-sequence", pixelFormat: "rgba", preset: "lossless" };
}

/** Test-visible construction of the engine config used by distributed planning. */
export function resolveDistributedEngineConfig(config: DistributedRenderConfig): EngineConfig {
  return {
    ...(config.producerConfig ?? config.engineConfig ?? resolveConfig()),
    browserGpuMode: "software",
    forceScreenshot: false,
    // Distributed rendering deliberately opts into deterministic BeginFrame
    // on Linux SwiftShader. Preserve the provenance bit consumed by the
    // engine's software-GPU screenshot clamp; assigning the boolean alone
    // loses the distinction between a default false and this explicit opt-out.
    forceScreenshotExplicitlyOptedOut: true,
  };
}

function pathInside(root: string, path: string): string | null {
  const rel = relative(root, path);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? null : rel;
}

/**
 * Name a video source without the planner's scratch folder, so `meta/videos.json`
 * (and the planHash over it) is the same on every run with the same inputs.
 */
function stableSourcePath(roots: ReadonlyArray<[root: string, prefix: string]>, srcPath: string) {
  for (const [root, prefix] of roots) {
    const rel = pathInside(root, srcPath);
    if (rel !== null) return [prefix, ...rel.split(sep)].filter(Boolean).join("/");
  }
  return srcPath;
}

/**
 * Return a planDir-relative path chunks can extract a deferred video from.
 * Sources the plan already ships under `compiled/` are reused; anything else
 * (downloads, files outside the project) is linked into `video-sources/`.
 * Call after the staged `compiled/` and `video-frames/` trees are promoted.
 */
function createVideoSourceShipper(input: {
  planDir: string;
  projectDir: string;
  workCompiledDir: string;
  workVideoFramesDir: string;
  isRemote: (srcPath: string) => boolean;
}): (srcPath: string) => string {
  const shipped = new Map<string, string>();
  return (srcPath) => {
    const known = shipped.get(srcPath);
    if (known) return known;
    // Downloads were staged under the frame tree, which now lives at video-frames/.
    const stagedRel = pathInside(input.workVideoFramesDir, srcPath);
    const current = stagedRel === null ? srcPath : join(input.planDir, "video-frames", stagedRel);
    let result: string | null = null;
    for (const root of stagedRel === null ? [input.workCompiledDir, input.projectDir] : []) {
      const rel = pathInside(root, srcPath);
      if (
        rel !== null &&
        (existsSync(join(input.planDir, "compiled", rel)) || input.isRemote(srcPath))
      ) {
        result = ["compiled", ...rel.split(sep)].join("/");
        break;
      }
    }
    if (result === null) {
      result = `video-sources/${shipped.size}${extname(current)}`;
      const destination = join(input.planDir, ...result.split("/"));
      mkdirSync(join(input.planDir, "video-sources"), { recursive: true });
      try {
        linkSync(current, destination);
      } catch {
        copyFileSync(current, destination);
      }
    }
    shipped.set(srcPath, result);
    return result;
  };
}

/**
 * Build the shared local execution representation used by both transport
 * protocols. See the module docstring for the directory layout.
 */
/** Whether the plan leaves its audio to {@link buildPlanAudio}. */
export function plansSeparateAudio(
  config: Pick<DistributedRenderConfig, "format" | "cfr">,
  options: Pick<BuildLocalExecutionPlanOptions, "deferAudio">,
): boolean {
  return options.deferAudio === true && config.format !== "png-sequence" && config.cfr !== true;
}

// The plan's copy, compile and probe, shared by the plan and by buildPlanAudio so both see the
// same composition.
// fallow-ignore-next-line complexity
async function compilePlanComposition(
  projectDir: string,
  config: DistributedRenderConfig,
  planDir: string,
  options: Pick<BuildLocalExecutionPlanOptions, "executionPlanSizeLimitBytes" | "remoteFiles">,
) {
  // Plan-time validation. Rejections here surface as typed errors with
  // non-retryable codes so workflow adapters don't waste retry budget on
  // banned configs. Runs BEFORE any directory creation so a banned input
  // never produces a partial planDir.
  rejectUnsupportedDistributedFormat(config);
  validateNoGpuEncode({
    useGpu: false,
    browserGpuMode: "software",
  });

  if (!existsSync(planDir)) mkdirSync(planDir, { recursive: true });

  const log = config.logger ?? defaultLogger;
  const sizeLimitBytes =
    options.executionPlanSizeLimitBytes ??
    config.planDirSizeLimitBytes ??
    PLAN_DIR_SIZE_LIMIT_BYTES;
  const abortSignal = config.abortSignal;
  const assertNotAborted = (): void => {
    if (abortSignal?.aborted) {
      throw new Error("[plan] render_cancelled");
    }
  };
  const cfg = resolveDistributedEngineConfig(config);

  const job = buildSyntheticRenderJob({
    fps: { num: config.fps, den: 1 },
    quality: config.quality ?? "standard",
    format: config.format,
    crf: config.crf,
    bitrate: config.bitrate,
    videoFrameFormat: config.videoFrameFormat,
    outputResolution: config.outputResolution,
    outputResolutionAspectAgnostic: config.outputResolutionAspectAgnostic,
    // HDR is banned in distributed mode. force-sdr keeps the
    // extract / encoder paths off the HDR branches entirely.
    hdrMode: config.hdrMode ?? "force-sdr",
    strictness: config.strictness,
    entryFile: config.entryFile ?? "index.html",
    logger: config.logger,
    producerConfig: cfg,
    variables: config.variables,
  });
  const entryFile = config.entryFile ?? "index.html";
  const htmlPath = join(projectDir, entryFile);
  if (!existsSync(htmlPath)) {
    throw new Error(`[plan] entry file not found: ${htmlPath}`);
  }

  const workDir = join(planDir, ".plan-work");
  // `.plan-work` is planner-owned scratch space. A prior attempt can fail
  // before the end-of-plan cleanup and leave compiled assets behind; cpSync
  // and compileStage both overlay their outputs, so reusing that directory
  // would let stale bytes contaminate the new plan and its size check.
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const compiledDir = join(workDir, "compiled");

  // Pre-seed the compiled directory with `projectDir`'s local assets
  // (style.css, script.js, images, etc.). The chunk worker's file server
  // serves ONLY from `<planDir>/compiled/`, so without this copy a
  // composition's `<link rel=stylesheet href=style.css>` 404s and the
  // first capture lands an unstyled fallback frame. `compileStage`
  // overwrites the entry HTML afterwards. `dereference: true` resolves
  // symlinks so the planDir survives S3 / Lambda /tmp round-trips.
  mkdirSync(compiledDir, { recursive: true });
  let stageStarted = Date.now();
  cpSync(projectDir, compiledDir, {
    recursive: true,
    dereference: true,
    filter: (src) => {
      // cpSync passes the absolute source path. Compare relative-to-projectDir
      // so a parent directory of projectDir matching a skip name doesn't
      // false-positive every descendant.
      const rel = relative(projectDir, src);
      if (rel === "" || rel.startsWith("..")) return true;
      const firstSegment = rel.split(sep, 1)[0];
      return firstSegment === undefined || !PLAN_PROJECT_DIR_SKIP_SEGMENTS.has(firstSegment);
    },
  });
  logPlanStage(log, "copy", stageStarted);

  // The compiled directory lives at `<planDir>/compiled/` in the final
  // layout. The stages write under `<planDir>/.plan-work/compiled/`; we
  // move the contents over once the staged work completes.
  const finalCompiledDir = join(planDir, "compiled");

  // Alpha-capable distributed formats flip force-screenshot so
  // compileStage takes the alpha-aware capture path (BeginFrame doesn't
  // preserve alpha on Linux headless-shell). Must match the in-process
  // renderer's needsAlpha logic in `renderOrchestrator.ts` so chunked
  // webm output preserves the same alpha plane the in-process baseline
  // does. Omitting webm here silently freezes `forceScreenshot: false`
  // into the planDir and every chunk worker captures opaque RGB — the
  // libvpx-vp9 alpha sub-stream then encodes either uniform alpha or
  // gets downgraded by the encoder, producing un-keyable webm output.
  const needsAlpha = outputNeedsAlpha(config.format);

  // ── Compile ──
  const remoteFiles = Object.entries(options.remoteFiles ?? {});
  const remoteLocalPath = (rel: string) => join(projectDir, ...rel.split("/"));
  for (const [, file] of remoteFiles) {
    declareContentAddressedUrl(file.url, file.sha256);
    if (file.probeFactsUrl) declareProbeFactsUrl(file.url, file.probeFactsUrl);
  }
  // Keyed by the path each file would have had, which is what every media resolver computes.
  const urlByAbsentLocalPath = new Map(
    remoteFiles.map(([rel, file]) => [remoteLocalPath(rel), file.url]),
  );
  const localPathByUrl = new Map(
    remoteFiles.map(([rel, file]) => [file.url, remoteLocalPath(rel)]),
  );
  const audioSidecarUrlByLocalPath = new Map(
    remoteFiles.flatMap(([rel, file]) =>
      file.audioSidecarUrl ? [[remoteLocalPath(rel), file.audioSidecarUrl] as const] : [],
    ),
  );

  stageStarted = Date.now();
  const compileResult = await runCompileStage({
    urlByAbsentLocalPath,
    projectDir,
    workDir,
    htmlPath,
    entryFile,
    job,
    cfg,
    needsAlpha,
    log,
    assertNotAborted,
    abortSignal,
    // Distributed renders fail closed on font-fetch errors so the planDir
    // is content-addressed against deterministic fonts only.
    failClosedFontFetch: config.failClosedFontFetch !== false,
    // Distributed renders must not capture host-specific system fonts —
    // the Lambda/worker filesystem won't have the same fonts installed.
    allowSystemFontCapture: false,
    variables: config.variables,
    pageMotionBlur: job.config.pageMotionBlur,
  });
  logPlanStage(log, "compile", stageStarted);
  let compiled = compileResult.compiled;
  const composition = compileResult.composition;
  const { deviceScaleFactor } = compileResult;
  // Apply the same low-memory mode bump that renderOrchestrator does at
  // renderOrchestrator.ts:1598-1606 — compileStage does not consult
  // cfg.lowMemoryMode, so the probe would otherwise see forceScreenshot:false
  // on a constrained host and launch in beginframe mode (the exact bug #1236
  // fixed for the in-process path).
  // TODO: move this bump into compileStage so both call sites simplify and
  // the rule lives in one place (follow-up; out of scope for #1236 fix).
  let forceScreenshot = compileResult.forceScreenshot;
  if (cfg.lowMemoryMode) forceScreenshot = true;
  // composition.{width,height} are the authored page dimensions. The
  // post-supersample output dims are `compileResult.outputWidth/outputHeight`
  // — chunks render at output dims, but planHash + composition.json record
  // the page dims so cross-machine consistency keys off the composition's
  // own intent rather than a knob the planner could tweak.
  const { width, height } = composition;

  // ── Reject system primary fonts ──
  // Runs against the post-compile HTML (which has @font-face declarations
  // injected) so we evaluate the same surface the chunk worker would render.
  if (config.rejectOnSystemFonts !== false) {
    validateNoSystemFonts(compiled.html);
  }

  // ── Probe ──
  // Browser probe runs only when needed. For statically-resolvable durations
  // this is a near-zero pass.
  stageStarted = Date.now();
  const probeResult = await runProbeStage({
    projectDir,
    workDir,
    job,
    cfg,
    forceScreenshot,
    log,
    assertNotAborted,
    abortSignal,
    compiled,
    composition,
    width,
    height,
    needsAlpha,
    deviceScaleFactor,
    subTimelineWaitMemo: {},
  });
  logPlanStage(log, "probe", stageStarted);
  compiled = probeResult.compiled;
  job.duration = probeResult.duration;
  job.totalFrames = probeResult.totalFrames;
  const totalFrames = probeResult.totalFrames;
  validateDistributedDuration({
    duration: probeResult.duration,
    totalFrames,
    fps: fpsToNumber(job.config.fps),
  });
  if (probeResult.fileServer) closeFileServerSafely(probeResult.fileServer, "plan", log);
  if (probeResult.probeSession) {
    // Close inside a try/catch — leaking a Chrome process here would mask
    // the original plan() result on cancellation paths.
    try {
      const { closeCaptureSession } = await import("@hyperframes/engine");
      await closeCaptureSession(probeResult.probeSession);
    } catch (err) {
      log.warn("[plan] probe session close failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return {
    projectDir,
    log,
    sizeLimitBytes,
    abortSignal,
    assertNotAborted,
    cfg,
    job,
    workDir,
    compiledDir,
    finalCompiledDir,
    remoteFiles,
    urlByAbsentLocalPath,
    audioSidecarUrlByLocalPath,
    localPathByUrl,
    compileResult,
    compiled,
    composition,
    deviceScaleFactor,
    forceScreenshot,
    width,
    height,
    totalFrames,
  };
}

type PlanComposition = Awaited<ReturnType<typeof compilePlanComposition>>;

/** The composition's audio fitted to the video frames by the shared audio stage. */
function mixPlanAudio(c: PlanComposition, compiledDir: string) {
  return runAudioStage({
    projectDir: c.projectDir,
    workDir: c.workDir,
    compiledDir,
    urlByAbsentLocalPath: c.urlByAbsentLocalPath,
    audioSidecarUrlByLocalPath: c.audioSidecarUrlByLocalPath,
    totalFrames: c.totalFrames,
    fps: c.job.config.fps,
    ffmpegProcessTimeout: c.cfg.ffmpegProcessTimeout,
    audioGain: c.cfg.audioGain,
    audios: c.composition.audios,
    masterFxChain: c.composition.masterFxChain,
    abortSignal: c.abortSignal,
    assertNotAborted: c.assertNotAborted,
    log: c.log,
  });
}

/** Extracts the composition's videos and adds the sound of each that carries one to its audios. */
async function extractPlanVideos(c: PlanComposition, deferRangeExtraction: boolean | undefined) {
  const extractResult = await runExtractVideosStage({
    projectDir: c.projectDir,
    compiledDir: c.compiledDir,
    job: c.job,
    cfg: c.cfg,
    composition: c.composition,
    abortSignal: c.abortSignal,
    assertNotAborted: c.assertNotAborted,
    materializeSymlinks: true,
    deferRangeExtraction,
    urlByAbsentLocalPath: c.urlByAbsentLocalPath,
  });
  if (extractResult.failureToEnforce) throw extractResult.failureToEnforce;
  if (extractResult.extractionResult) {
    // A chunk cannot fall back to decoding a source the planner held: a missing frame set
    // renders as a silent blank video, so every declared source must extract.
    assertVideoExtractionSucceeded(extractResult.extractionResult);
    c.log.info("[plan] extract phases", { ...extractResult.extractionResult.phaseBreakdown });
  }
  return extractResult;
}

export async function buildLocalExecutionPlan(
  projectDir: string,
  config: DistributedRenderConfig,
  executionPlanDir: string,
  options: Readonly<BuildLocalExecutionPlanOptions> = {},
): Promise<LocalExecutionPlan> {
  const planDir = executionPlanDir;
  const c = await compilePlanComposition(projectDir, config, planDir, options);
  const {
    log,
    sizeLimitBytes,
    cfg,
    job,
    workDir,
    compiledDir,
    finalCompiledDir,
    remoteFiles,
    urlByAbsentLocalPath,
    localPathByUrl,
    compileResult,
    compiled,
    composition,
    deviceScaleFactor,
    forceScreenshot,
    width,
    height,
    totalFrames,
  } = c;

  // ── Chunking decisions ── (before extraction so an impossible plan fails fast; graded
  // media is re-sized from its measured frame cost once its video frames exist)
  const megapixels = (compileResult.outputWidth * compileResult.outputHeight) / 1e6;
  let maxParallel = resolveMaxParallelChunks(config, totalFrames, megapixels, log);
  const measureFrameCost =
    chunkSizingUsesFrameCost(config) && planNeedsFrameCostMeasurement(compiled.html);

  // The compiled tree is now stable. If it already exceeds the final plan
  // budget, extraction/audio/freeze can only add retained bytes, so fail before
  // generating a multi-GiB frame tree.
  assertPlanSizeWithinLimit({
    rootDir: compiledDir,
    rootKind: "compiled",
    limitBytes: sizeLimitBytes,
    observedAt: "pre-extract",
    log,
  });

  // ── Extract videos ──
  // `materializeSymlinks: true` recursively copies frames so the planDir is
  // self-contained (symlinks don't survive S3/GCS round-trips).
  let stageStarted = Date.now();
  const extractResult = await extractPlanVideos(c, options.deferVideoExtraction);
  logPlanStage(log, "extract", stageStarted);
  // Skip `extractResult.frameLookup.cleanup()`: it would rm-rf each
  // video's outputDir, but in `plan()` those directories ARE the source
  // material the renames below move into `planDir/video-frames/`.

  // Promote staged artifacts from the temp work tree into the final planDir
  // shape. `workDir` is `<planDir>/.plan-work/` — always the same filesystem
  // as `planDir`, so `renameSync` succeeds without copying. Video frames
  // alone can be hundreds of MB; copying once instead of twice (the prior
  // approach left a duplicate under `compiled/__hyperframes_video_frames/`)
  // halves peak disk usage during `plan()`.
  const stagedVideoFrames = join(compiledDir, "__hyperframes_video_frames");
  const videoFramesDst = join(planDir, "video-frames");
  if (existsSync(videoFramesDst)) rmSync(videoFramesDst, { recursive: true, force: true });
  const videoSourcesDir = join(planDir, "video-sources");
  rmSync(videoSourcesDir, { recursive: true, force: true });
  if (existsSync(stagedVideoFrames)) {
    renameWithRetry(stagedVideoFrames, videoFramesDst);
  } else {
    mkdirSync(videoFramesDst, { recursive: true });
  }

  if (existsSync(finalCompiledDir)) rmSync(finalCompiledDir, { recursive: true, force: true });
  renameWithRetry(compiledDir, finalCompiledDir);

  // `meta/videos.json` is the contract that makes distributed renders
  // pixel-comparable to in-process for compositions with video sources —
  // without it, renderChunk can't rebuild the BeforeCaptureHook and the
  // page's native `<video>` element decodes the source mp4 ~1 frame
  // off the pre-extracted images the in-process baseline was captured
  // from.
  const shipVideoSource = createVideoSourceShipper({
    planDir,
    projectDir,
    workCompiledDir: compiledDir,
    workVideoFramesDir: stagedVideoFrames,
    isRemote: (srcPath) => urlByAbsentLocalPath.has(srcPath),
  });
  // Staged frames live inside compiledDir, so they must match first.
  const sourceRoots: Array<[string, string]> = [
    [stagedVideoFrames, "video-frames"],
    [compiledDir, "compiled"],
    [projectDir, ""],
  ];
  const planVideosJson: PlanVideosJson = buildPlanVideosJson({
    videos: composition.videos,
    compositionEnd: job.duration ?? Number.NaN,
    extracted: (extractResult.extractionResult?.extracted ?? []).map((ext) => {
      const sourcePath = localPathByUrl.get(ext.srcPath) ?? ext.srcPath;
      return {
        videoId: ext.videoId,
        srcPath: stableSourcePath(sourceRoots, sourcePath),
        framePattern: ext.framePattern,
        fps: ext.fps,
        totalFrames: ext.totalFrames,
        metadata: ext.metadata,
        ...(ext.deferredRange
          ? { deferredRange: { ...ext.deferredRange, sourcePath: shipVideoSource(sourcePath) } }
          : {}),
      };
    }),
  });
  mkdirSync(join(planDir, "meta"), { recursive: true });
  writePlanRemoteFiles(
    planDir,
    remoteFiles.map(([rel, { sha256, sizeBytes }]) => ({
      path: `compiled/${rel}`,
      sha256,
      sizeBytes,
    })),
  );
  writeFileSync(
    join(planDir, PLAN_VIDEOS_META_RELATIVE_PATH),
    JSON.stringify(planVideosJson, null, 2),
    "utf-8",
  );

  // ── Audio ──
  // Only the assembler reads the mix, so hashing and publishing the final
  // compiled and video trees run beside it instead of after it.
  const digests: PlanFileDigests = options.digests ?? new Map();
  const separateAudio = plansSeparateAudio(config, options);
  const chunksCarryAudio = !separateAudio && carriesChunkAudio(config, options);
  const frameWeights = planFrameWeights({
    videos: planVideosJson.videos,
    extracted: planVideosJson.extracted,
    totalFrames,
    fps: config.fps,
    width,
    height,
  });
  stageStarted = Date.now();
  const [audioOutcome, overlapOutcome, frameCostOutcome] = await Promise.allSettled([
    separateAudio
      ? null
      : mixPlanAudio(c, finalCompiledDir).finally(() => logPlanStage(log, "audio", stageStarted)),
    (async () => {
      for (const dir of [finalCompiledDir, videoFramesDst, videoSourcesDir]) {
        await prehashPlanFiles(dir, digests);
      }
      logPlanStage(log, "prehash", stageStarted);
      if (options.whileAudioMixes) {
        const prepublishStarted = Date.now();
        await options.whileAudioMixes();
        logPlanStage(log, "prepublish", prepublishStarted);
      }
    })(),
    measureFrameCost
      ? measurePlanSecondsPerFrame({
          planDir,
          workDir,
          html: compiled.html,
          planVideos: planVideosJson,
          totalFrames,
          fps: config.fps,
          width,
          height,
          format: config.format,
          quality: config.quality ?? "standard",
          deviceScaleFactor,
          variables: config.variables,
          cfg: { ...cfg, forceScreenshot, forceScreenshotExplicitlyOptedOut: !forceScreenshot },
          log,
        }).finally(() => logPlanStage(log, "frame-cost", stageStarted))
      : undefined,
  ]);
  if (audioOutcome.status === "rejected") throw audioOutcome.reason;
  if (overlapOutcome.status === "rejected") throw overlapOutcome.reason;
  if (frameCostOutcome.status === "rejected") throw frameCostOutcome.reason;
  if (frameCostOutcome.value !== undefined) {
    log.info("[plan] measured frame cost", { secondsPerFrame: frameCostOutcome.value });
    maxParallel = resolveMaxParallelChunks(
      config,
      totalFrames,
      megapixels,
      log,
      frameCostOutcome.value,
    );
  }
  const { chunkCount, effectiveChunkSize } = resolveChunkPlan(
    totalFrames,
    config.chunkSize,
    maxParallel,
    config.targetChunkFrames,
  );
  const chunks = buildPlanChunkSlices(
    frameWeights,
    config,
    chunkCount,
    effectiveChunkSize,
    chunkSizingUsesFrameCost(config) && config.workerTimeoutSeconds !== undefined
      ? framesWithinWorkerTimeout(
          config.workerTimeoutSeconds,
          estimateFrameSeconds(megapixels, frameCostOutcome.value),
        )
      : undefined,
  );
  const audioResult = audioOutcome.value;
  if (audioResult?.audioError) {
    applyDistributedAudioWarningPolicy(job, audioResult.audioError, audioResult.audioFailures, log);
  }

  const planAudioPath = join(planDir, PLAN_AUDIO_RELATIVE_PATH);
  if (audioResult?.hasAudio && existsSync(audioResult.audioOutputPath)) {
    renameWithRetry(audioResult.audioOutputPath, planAudioPath);
  }
  if (chunksCarryAudio && existsSync(planAudioPath)) {
    if (options.sliceChunkAudio) {
      stageStarted = Date.now();
      await writeChunkAudioSlices({
        audioPath: planAudioPath,
        planDir,
        chunks,
        fps: { num: config.fps, den: 1 },
      });
      logPlanStage(log, "audio-slices", stageStarted);
    }
  }

  // ── Locked config ──
  const ffmpegVersion = await readFfmpegVersion();
  const producerVersion = readProducerVersion();
  const fontSnapshotSha = await readFontSnapshotSha();
  const runtimeEnv = snapshotRuntimeEnv();
  const lockedConfig = buildLockedRenderConfig({
    config,
    forceScreenshot,
    deviceScaleFactor,
    ffmpegVersion,
    engineConfig: cfg,
    effectiveChunkSize,
    chunkCount,
    runtimeEnv,
    chunksCarryAudio,
    separateAudio,
  });

  // ── Freeze the plan ──
  // `freezePlan` writes meta/{composition,encoder,chunks}.json then walks
  // the planDir to compute planHash from the actual bytes the chunk worker
  // will read.
  const compositionJson: CompositionMetadataJson = {
    durationSeconds: job.duration ?? 0,
    width,
    height,
    fps: job.config.fps,
    videoCount: composition.videos.length,
    audioCount: composition.audios.length,
    imageCount: composition.images.length,
  };
  const dimensions: PlanDimensions = {
    fpsNum: config.fps,
    fpsDen: 1,
    width,
    height,
    format: config.format,
  };
  // Clean up the temp work tree BEFORE freezePlan. `.plan-work/` holds
  // intermediate compileStage + audio-mix artifacts (downloaded source
  // mp3s, scratch frames) that are now either promoted into `planDir/`
  // proper or no longer needed. Leaving it past freezePlan would:
  //   (1) inflate the planDir-size check below,
  //   (2) confuse chunk workers' file walks,
  //   (3) — load-bearing — pollute the planHash. freezePlan walks the
  //       planDir to compute the hash; chunk workers receive a planDir
  //       with `.plan-work/` already gone (the controller can also
  //       prune before transit), so their recomputed hash would not
  //       match if .plan-work/* were included on the controller side.
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch (err) {
    log.warn("[plan] failed to remove temp work dir", {
      workDir,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // A caller may reuse an existing planDir. freezePlan overwrites these four
  // files, so remove stale versions before the preliminary measurement; the
  // exact post-freeze check below still includes the newly written metadata.
  removeFreezeOwnedPlanFiles(planDir);

  // All retained heavy artifacts have been promoted and transient work files
  // removed. Reject before freezePlan performs its full content-hash read.
  assertPlanSizeWithinLimit({
    rootDir: planDir,
    rootKind: "plan",
    limitBytes: sizeLimitBytes,
    observedAt: "pre-freeze",
    log,
  });

  stageStarted = Date.now();
  const freezeResult = await freezePlan({
    planDir,
    composition: compositionJson,
    encoder: lockedConfig,
    chunks,
    dimensions,
    producerVersion,
    fontSnapshotSha,
    durationSeconds: job.duration ?? 0,
    totalFrames,
    hasAudio: audioResult?.hasAudio ?? false,
    digests,
  });
  logPlanStage(log, "freeze", stageStarted);
  const planHash = freezeResult.planHash;

  // 2 GB hard cap so the planDir fits inside Lambda's 10 GB /tmp budget
  // alongside the chunk worker's frame buffer + ffmpeg working set. The
  // check runs AFTER cleanup so the workDir tree doesn't double-count.
  // Non-retryable: the same planDir would trip the cap on every retry.
  assertPlanSizeWithinLimit({
    rootDir: planDir,
    rootKind: "plan",
    limitBytes: sizeLimitBytes,
    observedAt: "post-freeze",
    log,
  });

  return {
    executionPlanDir: planDir,
    executionPlanHash: planHash,
    chunkCount,
    totalFrames,
    fps: config.fps,
    width,
    height,
    format: config.format,
    ffmpegVersion,
    producerVersion,
  };
}

/**
 * The audio of a plan made with `deferAudio`: the mix and true-peak hold that plan would have
 * made, written to `outputPath` (on `workRoot`'s filesystem) at exactly the video's length.
 */
export async function buildPlanAudio(
  projectDir: string,
  config: DistributedRenderConfig,
  workRoot: string,
  outputPath: string,
  options: Pick<BuildLocalExecutionPlanOptions, "remoteFiles"> = {},
): Promise<{ hasAudio: boolean }> {
  const c = await compilePlanComposition(projectDir, config, workRoot, {
    ...options,
    executionPlanSizeLimitBytes: Number.MAX_SAFE_INTEGER,
  });
  try {
    let stageStarted = Date.now();
    await appendVideoAudioFromProbe(c);
    logPlanStage(c.log, "extract", stageStarted);
    stageStarted = Date.now();
    const mixed = await mixPlanAudio(c, c.compiledDir);
    logPlanStage(c.log, "audio", stageStarted);
    if (mixed.audioError) {
      applyDistributedAudioWarningPolicy(c.job, mixed.audioError, mixed.audioFailures, c.log);
    }
    if (!mixed.hasAudio || !existsSync(mixed.audioOutputPath)) return { hasAudio: false };
    renameWithRetry(mixed.audioOutputPath, outputPath);
    return { hasAudio: true };
  } finally {
    rmSync(c.workDir, { recursive: true, force: true });
  }
}

/**
 * Legacy v1 transport wrapper around {@link buildLocalExecutionPlan}.
 *
 * @deprecated Use `planV2()` or `planV2WithPublisher()` for new integrations.
 * This wrapper, its layout, and its result shape remain supported.
 */
export async function plan(
  projectDir: string,
  config: DistributedRenderConfig,
  planDir: string,
  options: Pick<BuildLocalExecutionPlanOptions, "chunksCarryAudio"> = {},
): Promise<PlanResult> {
  const executionPlan = await buildLocalExecutionPlan(projectDir, config, planDir, options);
  return {
    planDir: executionPlan.executionPlanDir,
    planProtocol: PLAN_PROTOCOL_V1,
    planHash: executionPlan.executionPlanHash,
    chunkCount: executionPlan.chunkCount,
    totalFrames: executionPlan.totalFrames,
    fps: executionPlan.fps,
    width: executionPlan.width,
    height: executionPlan.height,
    format: executionPlan.format,
    ffmpegVersion: executionPlan.ffmpegVersion,
    producerVersion: executionPlan.producerVersion,
  };
}
