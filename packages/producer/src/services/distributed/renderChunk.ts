/**
 * Activity B of the distributed render pipeline.
 *
 * `renderChunk(planDir, chunkIndex, outputChunkPath)` validates the planDir
 * against the worker's environment, captures the chunk's frame range, and
 * encodes a single closed-GOP video chunk (or, for png-sequence, a directory
 * of PNGs). The output is byte-identical across retries on the same worker
 * and PSNR-equivalent across workers — that contract is what makes Temporal
 * activity retries safe.
 *
 * Pure function over local paths. No networking. Spins up its own headless
 * Chrome + file server scoped to the chunk; tears them down before
 * returning. The caller is responsible for moving `outputChunkPath` to its
 * orchestration-level storage (S3 / GCS / EFS / …).
 *
 * Hard contracts:
 *   - The worker re-applies `meta/encoder.json.runtimeEnv` into
 *     `process.env` BEFORE the file server starts so the served HTML's
 *     `RENDER_MODE_SCRIPT` sees the same env it would have seen on the
 *     controller.
 *   - Browser is launched with `browserGpuMode: "software"` and verified
 *     against `chrome://gpu` via `assertSwiftShader` — a non-SwiftShader
 *     backend trips a non-retryable `BROWSER_GPU_NOT_SOFTWARE`.
 *   - The file server serves with the seeded-random shim
 *     (`buildVirtualTimeShim({ seedRandomFromFrame: true })`) so any
 *     composition that uses `Math.random` / `crypto.getRandomValues`
 *     produces byte-identical pixels per `(planDir, chunkIndex)`.
 *   - No `lastFrameCache` priming: every frame seeks fresh DOM so the
 *     cache is never read, and priming would deadlock the compositor.
 *   - The chunk's encode runs with `lockGopForChunkConcat: true` and
 *     `gopSize === framesInChunk` so concat-copy at assemble time is safe.
 *
 * Every determinism toggle above is opt-in — only this primitive enables them.
 * In-process renders (`executeRenderJob`) leave them off.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertSwiftShader,
  BROWSER_GPU_NOT_SOFTWARE,
  calculateOptimalWorkers,
  classifyCaptureFailure,
  type CaptureOptions,
  type CaptureMode,
  type CapturePerfSummary,
  type CaptureSession,
  closeCaptureSession,
  createCaptureSession,
  createFrameLookupTable,
  deriveBeginFrameProbeTimeTicks,
  type EngineConfig,
  getEncoderPreset,
  initializeSession,
  measureVideoShownBoxes,
  probeBeginFrameLiveness,
  readWebGlVendorInfoFromCanvas,
  resolveConfig,
  type ShownBox,
} from "@hyperframes/engine";
import { defaultLogger } from "../../logger.js";
import { applyRenderWarningPolicy, collectVideoMetadataHints } from "../renderOrchestrator.js";
import { runEncodeStage } from "../render/stages/encodeStage.js";
import { frameCacheOptions } from "../render/frameCacheBudget.js";
import { runCaptureStage } from "../render/stages/captureStage.js";
import { createCapturePlan } from "../render/capturePlan.js";
import {
  type ChunkSliceJson,
  type LockedRenderConfig,
  recomputePlanHashFromPlanDir,
} from "../render/stages/freezePlan.js";
import { sha256Hex } from "../render/stages/planHash.js";
import { applyRuntimeEnvSnapshot } from "../render/runtimeEnvSnapshot.js";
import {
  buildVirtualTimeShim,
  closeFileServerSafely,
  createFileServer,
  resolveRenderFpsConfig,
  type FileServerHandle,
} from "../fileServer.js";
import {
  buildSyntheticRenderJob,
  INVALID_VIDEO_METADATA,
  parsePlanVideosJson,
  type DistributedFormat,
  PLAN_VIDEOS_META_RELATIVE_PATH,
  type PlanVideosJson,
  readFfmpegVersion,
} from "./shared.js";
import { chunkAudioSource, chunksWithSubRange, muxChunkWithAudio } from "./chunkAudio.js";
import { DISTRIBUTED_RENDER_CAPABILITIES, readPlanProtocolV1 } from "./planProtocol.js";
import { readValidatedPlanV2Materialization } from "./planV2.js";
import {
  buildChunkCaptureOptions,
  createChunkVideoFrameInjectorFactory,
  extractDeferredVideoFramesForChunk,
  MISSING_PLAN_ARTIFACT,
  PLAN_HASH_MISMATCH,
  FFMPEG_VERSION_MISMATCH,
  CHUNK_FRAME_RANGE_INVALID,
  CHUNK_INDEX_OUT_OF_RANGE,
  MISSING_RUNTIME_ENV_SNAPSHOT,
  rebuildExtractedFramesFromPlanDir,
  RenderChunkValidationError,
  shownDeferredFrameIndexes,
} from "./chunkFrames.js";

export {
  CHUNK_FRAME_RANGE_INVALID,
  CHUNK_INDEX_OUT_OF_RANGE,
  createChunkVideoFrameInjectorFactory,
  extractDeferredVideoFramesForChunk,
  FFMPEG_VERSION_MISMATCH,
  INVALID_VIDEO_METADATA,
  MISSING_PLAN_ARTIFACT,
  MISSING_RUNTIME_ENV_SNAPSHOT,
  PLAN_HASH_MISMATCH,
  rebuildExtractedFramesFromPlanDir,
  RenderChunkValidationError,
} from "./chunkFrames.js";

const LEGACY_DISTRIBUTED_VP9_CPU_USED = 2;

/** Validate the shared video contract before any v1 chunk can inject frames. */
export function validatePlanVideosForChunk(value: unknown): PlanVideosJson {
  try {
    return parsePlanVideosJson(value);
  } catch (err) {
    throw new RenderChunkValidationError(
      INVALID_VIDEO_METADATA,
      `[renderChunk] invalid meta/videos.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Result of {@link renderChunk}. The `sha256` field is the byte hash of the
 * primary output (the mp4/mov file, or, for png-sequence, the sorted-frame
 * fingerprint). Retries on the same `(planDir, chunkIndex)` MUST produce
 * the same `sha256` — that contract is the byte-identical-retry axis.
 */
export interface ChunkResult {
  /** Absolute path the encoded chunk was written to (file or directory). */
  outputPath: string;
  /** `"file"` for mp4/mov; `"frame-dir"` for png-sequence. */
  outputKind: "file" | "frame-dir";
  framesEncoded: number;
  frameRange?: ChunkFrameRange;
  sha256: string;
  durationMs: number;
  /**
   * Stage wall-clock split of `durationMs`, for separating per-chunk fixed
   * overhead from frame-proportional work in fleet cost models:
   *
   * - `planHashMs` — full planDir content-hash recomputation (validation).
   * - `sessionBootMs` — Chrome boot + SwiftShader assert + composition warmup
   *   for the reusable sequential session or parallel BeginFrame preflight.
   * - `captureStageMs` — the capture stage call; includes per-worker session
   *   boots in the parallel branch.
   * - `encodeStageMs` — the encode stage call (single ffmpeg invocation, or
   *   the frame-dir arrangement for png-sequence).
   *
   * The remainder of `durationMs` is validation + file-server setup + output
   * hashing + cleanup.
   */
  planHashMs: number;
  sessionBootMs: number;
  captureStageMs: number;
  encodeStageMs: number;
  /** Capture workers used for this chunk (`resolveChunkCaptureWorkers` result). */
  workers: number;
  /**
   * Effective engine mode used by every worker, after any browser fallback.
   *
   * Current first-party renderers always emit this field. It remains optional
   * so adapters can accept results from older or injected chunk renderers
   * without inventing an observed mode that may be false.
   */
  captureMode?: CaptureMode;
  /**
   * Path to a sidecar JSON containing per-chunk perf counters. Adapters
   * upload this alongside the chunk so per-chunk regressions are
   * inspectable without the workflow having to carry the payload.
   */
  perfPath: string;
}

/** Result returned by the built-in renderer, which always observes its mode. */
export interface EffectiveChunkResult extends ChunkResult {
  captureMode: CaptureMode;
  frameRange: ChunkFrameRange;
}

/** Absolute composition frame indices, end exclusive, like a chunk's slice. */
export interface ChunkFrameRange {
  startFrame: number;
  endFrame: number;
}

export interface RenderChunkOptions {
  /**
   * Render only these frames of the chunk, e.g. to retry a slow chunk as
   * parts rendered in parallel. Must be a non-empty range inside the chunk's
   * slice. Each part is a self-contained output (its own IDR keyframe, frame
   * names from zero, the audio packets it owns); pass the parts of a chunk,
   * in order, as one `chunkPaths` entry to `assemble`. Omitted renders the
   * whole slice.
   */
  frameRange?: ChunkFrameRange;
  /**
   * Capture browsers the runtime can host. Raises the machine-wide sizing up to
   * this many, one browser per 20 frames; never lowers it.
   */
  maxCaptureWorkers?: number;
}

/** A browser starts in about 3 s, a small share of 20 frames' capture. */
const MIN_FRAMES_PER_CHUNK_BROWSER = 20;

/** Capture browsers for a chunk: the machine-wide sizing, raised by the runtime's budget. */
export function resolveChunkCaptureWorkers(
  framesInChunk: number,
  machineSized: number,
  maxCaptureWorkers: number | undefined,
): number {
  if (maxCaptureWorkers === undefined) return machineSized;
  const byFrames = Math.floor(framesInChunk / MIN_FRAMES_PER_CHUNK_BROWSER);
  return Math.max(machineSized, Math.floor(Math.min(maxCaptureWorkers, byFrames)));
}

/** The frames a chunk renders: its slice, or a validated sub-range of it. */
export function resolveChunkFrameRange(
  slice: ChunkSliceJson,
  chunkIndex: number,
  frameRange: ChunkFrameRange | undefined,
): ChunkFrameRange {
  if (frameRange === undefined) return { startFrame: slice.startFrame, endFrame: slice.endFrame };
  const { startFrame, endFrame } = frameRange;
  if (
    !Number.isSafeInteger(startFrame) ||
    !Number.isSafeInteger(endFrame) ||
    startFrame < slice.startFrame ||
    endFrame > slice.endFrame ||
    endFrame <= startFrame
  ) {
    throw new RenderChunkValidationError(
      CHUNK_FRAME_RANGE_INVALID,
      `[renderChunk] frameRange ${JSON.stringify(frameRange)} must be a non-empty integer range ` +
        `inside chunk ${chunkIndex}'s slice [${slice.startFrame}, ${slice.endFrame})`,
    );
  }
  return { startFrame, endFrame };
}

/** Compatibility-safe adapter seam for built-in or injected chunk renderers. */
export type ChunkRenderer = (
  planDir: string,
  chunkIndex: number,
  outputChunkPath: string,
  options?: RenderChunkOptions,
) => Promise<ChunkResult>;

interface DistributedCaptureSessionDependencies {
  createCaptureSession: typeof createCaptureSession;
  assertSwiftShader: typeof assertSwiftShader;
  initializeSession: typeof initializeSession;
  closeCaptureSession: typeof closeCaptureSession;
  readWebGlVendorInfo: typeof readWebGlVendorInfoFromCanvas;
}

/** Mutable so tests can substitute a spy without a real browser; renderChunk() always calls through it. */
export const distributedCaptureSessionDependencies: DistributedCaptureSessionDependencies = {
  createCaptureSession,
  assertSwiftShader,
  initializeSession,
  closeCaptureSession,
  readWebGlVendorInfo: readWebGlVendorInfoFromCanvas,
};

/**
 * Every browser that can produce distributed frames must pass the software-GL
 * assertion, including fresh screenshot browsers created after a fallback.
 */
export async function createVerifiedDistributedCaptureSession(
  serverUrl: string,
  framesDir: string,
  captureOptions: CaptureOptions,
  cfg: EngineConfig,
  dependencies: DistributedCaptureSessionDependencies = distributedCaptureSessionDependencies,
): Promise<CaptureSession> {
  const session = await dependencies.createCaptureSession(
    serverUrl,
    framesDir,
    captureOptions,
    null,
    cfg,
  );
  try {
    await dependencies.assertSwiftShader(session.page, dependencies.readWebGlVendorInfo);
    await dependencies.initializeSession(session);
    return session;
  } catch (error) {
    await dependencies.closeCaptureSession(session).catch(() => {});
    throw error;
  }
}

function isCaptureMode(value: string): value is CaptureMode {
  return value === "beginframe" || value === "screenshot" || value === "drawelement";
}

/** Workers of one chunk launched in different modes: one worker's BeginFrame check failed and it fell back alone. */
export class MixedCaptureModesError extends Error {
  constructor(readonly modes: readonly string[]) {
    super(`[renderChunk] capture workers reported inconsistent modes: ${modes.join(",")}`);
    this.name = "MixedCaptureModesError";
  }
}

export function observedChunkCaptureMode(
  perfs: readonly Pick<CapturePerfSummary, "captureMode">[],
): CaptureMode {
  const modes = [...new Set(perfs.map((perf) => perf.captureMode))];
  if (modes.length > 1) throw new MixedCaptureModesError(modes);
  const [mode] = modes;
  if (!mode || !isCaptureMode(mode)) {
    throw new Error(`[renderChunk] capture workers reported an invalid mode: ${mode ?? "<none>"}`);
  }
  return mode;
}

/**
 * Only BeginFrame-specific failures are safe to retry in screenshot mode.
 * Cancellation, memory exhaustion, and unrelated authoring/IO failures must
 * keep their original classification instead of being hidden by a fallback.
 */
export function shouldRetryChunkCaptureWithScreenshot(error: unknown): boolean {
  const failure = classifyCaptureFailure(error);
  if (failure.kind === "cancelled" || failure.kind === "memory_exhaustion") return false;
  return (
    /HeadlessExperimental\.beginFrame/i.test(failure.message) ||
    /beginFrame probe timeout/i.test(failure.message) ||
    /Another frame is pending|Frame still pending/i.test(failure.message)
  );
}

/**
 * Execute capture with at most one whole-chunk screenshot retry. The caller's
 * reset hook must discard every partial frame and perf record before retrying.
 */
export async function runCaptureWithScreenshotFallback<T>(input: {
  forceScreenshot: boolean;
  run: (forceScreenshot: boolean) => Promise<T>;
  resetForScreenshotRetry: () => Promise<void> | void;
  onFallback?: (error: unknown) => void;
}): Promise<T> {
  try {
    return await input.run(input.forceScreenshot);
  } catch (error) {
    if (input.forceScreenshot || !shouldRetryChunkCaptureWithScreenshot(error)) throw error;
    input.onFallback?.(error);
    await input.resetForScreenshotRetry();
    return await input.run(true);
  }
}

/**
 * Probe an initialized distributed session at a monotonic tick between warmup
 * and frame zero. `true` means the entire chunk should use screenshot mode.
 */
export async function beginFrameSessionNeedsScreenshotFallback(
  session: Pick<
    CaptureSession,
    "page" | "launchCaptureMode" | "beginFrameTimeTicks" | "beginFrameIntervalMs"
  >,
  probe: typeof probeBeginFrameLiveness = probeBeginFrameLiveness,
): Promise<boolean> {
  if (session.launchCaptureMode !== "beginframe") return false;
  const timeoutMs =
    Number(process.env.PRODUCER_BEGINFRAME_PROBE_TIMEOUT_MS) > 0
      ? Number(process.env.PRODUCER_BEGINFRAME_PROBE_TIMEOUT_MS)
      : 30_000;
  const probeTick = deriveBeginFrameProbeTimeTicks(
    session.beginFrameTimeTicks,
    session.beginFrameIntervalMs,
  );
  return !(await probe(session.page, timeoutMs, probeTick, session.beginFrameIntervalMs));
}

/** Plan-time JSON manifest written by `freezePlan`. */
interface PlanJson {
  protocol?: unknown;
  planHash: string;
  producerVersion: string;
  ffmpegVersion: string;
  fontSnapshotSha: string;
  dimensions: {
    fpsNum: number;
    fpsDen: number;
    width: number;
    height: number;
    format: DistributedFormat;
  };
  chunkCount: number;
  totalFrames: number;
  duration: number;
  hasAudio: boolean;
}

/**
 * Re-export the runtime-env apply helper so adapters that import only
 * this subpath can prime `process.env` before instantiating their own
 * file server. Returns a `{ restore }` handle — adapters that fan out
 * multiple chunks per process MUST call `restore()` between chunks.
 */
export { applyRuntimeEnvSnapshot } from "../render/runtimeEnvSnapshot.js";

// `readWebGlVendorInfoFromCanvas` lives in `@hyperframes/engine` (it's
// used both here and by `parallelCoordinator.executeWorkerTask`). Re-exported
// from this subpath so downstream consumers that already import it from
// `@hyperframes/producer/distributed` keep working.
export { readWebGlVendorInfoFromCanvas } from "@hyperframes/engine";

/**
 * Compute a deterministic SHA-256 fingerprint for the chunk's output.
 *
 *   - file output (mp4/mov): straight hash of the file bytes.
 *   - frame-dir (png-sequence): hash the sorted list of `(name, sha256)`
 *     pairs. Avoids the cost of streaming every frame's contents through
 *     a single sha context while still detecting any byte-level drift in
 *     any individual frame.
 *
 * The fingerprint flows into the `ChunkResult.sha256` which adapters
 * compare across retries to enforce the byte-identical-retry contract.
 */
function hashChunkOutput(outputPath: string, kind: "file" | "frame-dir"): string {
  if (kind === "file") return sha256Hex(readFileSync(outputPath));
  const entries = readdirSync(outputPath)
    .filter((name) => /\.(png|jpg|jpeg)$/i.test(name))
    .sort();
  // Hash the sorted (name, perFileSha) list. Encoded as null-separated
  // utf-8 to keep concatenation unambiguous if a frame name ever contains
  // an unusual character.
  const lines = entries.map(
    (name) => `${name}\0${sha256Hex(readFileSync(join(outputPath, name)))}`,
  );
  return sha256Hex(lines.join("\0"));
}

/**
 * Apply the planDir's locked-encoder choice on top of an
 * `EncoderPreset` from `getEncoderPreset`. `getEncoderPreset` returns
 * h265 only on the HDR branch, but distributed mode is SDR-only — for
 * an `libx265-software` planDir we still need to flip the preset's
 * codec to h265 so `runEncodeStage` invokes libx265. Exported so a
 * unit test can pin the override independently of the heavyweight
 * Docker fixture: a refactor that moves the override (e.g. into
 * `getEncoderPreset` itself) shouldn't be able to silently regress
 * the contract without a fast-test signal.
 */
export function resolvePresetForLockedEncoder<
  P extends { codec: "h264" | "h265" | "vp9" | "prores" },
>(basePreset: P, lockedEncoder: LockedRenderConfig["encoder"]): P {
  if (lockedEncoder === "libx265-software") {
    return { ...basePreset, codec: "h265" as const };
  }
  return basePreset;
}

export function resolveLockedVp9CpuUsed(
  lockedEncoder: Pick<LockedRenderConfig, "encoder" | "vp9CpuUsed">,
): number | undefined {
  if (lockedEncoder.encoder !== "libvpx-vp9-software") return undefined;
  // Pre-vp9CpuUsed WebM planDirs used the old closed-GOP literal. Keep replay
  // bytes stable for those plans while new planDirs carry their resolved value.
  return lockedEncoder.vp9CpuUsed ?? LEGACY_DISTRIBUTED_VP9_CPU_USED;
}

/**
 * Activity B: render a single chunk of the planDir. The `outputChunkPath`
 * argument is a file for mp4/mov outputs and a directory for png-sequence
 * outputs — the caller picks the right shape based on `meta/encoder.json`.
 * `renderChunk` enforces the same choice via `outputKind` on the result.
 */
// fallow-ignore-next-line complexity
export async function renderChunk(
  planDir: string,
  chunkIndex: number,
  outputChunkPath: string,
  options?: RenderChunkOptions,
): Promise<EffectiveChunkResult> {
  const start = Date.now();
  const log = defaultLogger;

  // ── Read + validate the plan ──
  const planJsonPath = join(planDir, "plan.json");
  const encoderJsonPath = join(planDir, "meta", "encoder.json");
  const chunksJsonPath = join(planDir, "meta", "chunks.json");
  if (!existsSync(planJsonPath)) {
    throw new RenderChunkValidationError(
      MISSING_PLAN_ARTIFACT,
      `[renderChunk] planDir is missing required artifact: ${planJsonPath}`,
    );
  }
  const plan = JSON.parse(readFileSync(planJsonPath, "utf-8")) as PlanJson;
  readPlanProtocolV1(plan, DISTRIBUTED_RENDER_CAPABILITIES.roles.chunk);
  const planHashStarted = Date.now();
  const v2Materialization = readValidatedPlanV2Materialization(planDir, {
    role: "chunk",
    chunkIndex,
  });
  const v2Manifest = v2Materialization?.manifest ?? null;
  const remoteSources = v2Materialization?.remoteSources ?? {};
  for (const required of [encoderJsonPath, chunksJsonPath]) {
    if (!existsSync(required)) {
      throw new RenderChunkValidationError(
        MISSING_PLAN_ARTIFACT,
        `[renderChunk] planDir is missing required artifact: ${required}`,
      );
    }
  }
  const encoder = JSON.parse(readFileSync(encoderJsonPath, "utf-8")) as LockedRenderConfig;
  const chunks = JSON.parse(readFileSync(chunksJsonPath, "utf-8")) as ChunkSliceJson[];

  // `meta/videos.json` only exists when the composition has `<video>`
  // elements; absence means no injector is needed.
  const videosJsonPath = join(planDir, PLAN_VIDEOS_META_RELATIVE_PATH);
  let planVideos: PlanVideosJson | null = null;
  if (existsSync(videosJsonPath)) {
    try {
      planVideos = validatePlanVideosForChunk(JSON.parse(readFileSync(videosJsonPath, "utf-8")));
    } catch (err) {
      if (err instanceof RenderChunkValidationError) throw err;
      throw new RenderChunkValidationError(
        INVALID_VIDEO_METADATA,
        `[renderChunk] failed to parse ${videosJsonPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (chunkIndex < 0 || chunkIndex >= chunks.length) {
    throw new RenderChunkValidationError(
      CHUNK_INDEX_OUT_OF_RANGE,
      `[renderChunk] chunkIndex ${chunkIndex} is out of range [0, ${chunks.length})`,
    );
  }
  // The bounds check above guarantees this hits, but TS doesn't narrow
  // the indexed access — re-check explicitly.
  const slice = chunks[chunkIndex];
  if (slice === undefined) {
    throw new RenderChunkValidationError(CHUNK_INDEX_OUT_OF_RANGE, "[renderChunk] missing slice");
  }
  const sliceFrames = slice.endFrame - slice.startFrame;
  if (sliceFrames <= 0) {
    throw new RenderChunkValidationError(
      CHUNK_INDEX_OUT_OF_RANGE,
      `[renderChunk] chunk ${chunkIndex} has non-positive frame count: ${sliceFrames}`,
    );
  }
  // Every frame-bound below (capture, video frames, GOP, audio packets, perf)
  // reads `range`, so a sub-range renders exactly as a chunk of its own would.
  const range = resolveChunkFrameRange(slice, chunkIndex, options?.frameRange);
  const framesInChunk = range.endFrame - range.startFrame;

  const compiledDir = join(planDir, "compiled");
  if (!existsSync(compiledDir)) {
    throw new RenderChunkValidationError(
      MISSING_PLAN_ARTIFACT,
      `[renderChunk] planDir missing compiled/ directory: ${compiledDir}`,
    );
  }

  // ── Cross-version sanity ──
  const ffmpegVersion = await readFfmpegVersion();
  if (ffmpegVersion !== plan.ffmpegVersion) {
    throw new RenderChunkValidationError(
      FFMPEG_VERSION_MISMATCH,
      `[renderChunk] ffmpeg version on this worker does not match planDir. ` +
        `planDir: ${JSON.stringify(plan.ffmpegVersion)}; worker: ${JSON.stringify(ffmpegVersion)}. ` +
        `Distributed retries require byte-identical ffmpeg builds across workers. ` +
        `Re-plan from a worker matching this version, or run all renders on an image with the planDir's ffmpeg.`,
    );
  }
  if (encoder.browserGpuMode !== "software") {
    throw new RenderChunkValidationError(
      BROWSER_GPU_NOT_SOFTWARE,
      `[renderChunk] planDir requires browserGpuMode=software, got ${JSON.stringify(encoder.browserGpuMode)}.`,
    );
  }

  // Re-derive `planHash` from the on-disk bytes and compare to the value
  // the controller wrote into `plan.json`. Catches corrupted artifacts
  // (truncated meta files, partial S3 downloads, manual tampering) before
  // the chunk renders. Distinct from the other validation paths above
  // because `MISSING_PLAN_ARTIFACT` etc. are structural; this is purely
  // content-fingerprint drift.
  const recomputedPlanHash =
    v2Manifest === null ? recomputePlanHashFromPlanDir(planDir) : plan.planHash;
  const planHashMs = Date.now() - planHashStarted;
  if (recomputedPlanHash !== plan.planHash) {
    throw new RenderChunkValidationError(
      PLAN_HASH_MISMATCH,
      `[renderChunk] planDir content fingerprint does not match plan.json.planHash. ` +
        `plan.json: ${plan.planHash}; recomputed: ${recomputedPlanHash}. ` +
        `Likely a corrupted artifact (partial S3 download, manual tampering) or a planDir ` +
        `produced by an incompatible producer version. Re-plan and re-fan-out.`,
    );
  }

  // Distinct from the silent `?? {}` fallback we used before: missing
  // `runtimeEnv` means the planDir was produced by a controller that
  // forgot to snapshot, and the chunk's pixels would diverge silently.
  // Surface it as a typed validation error so the workflow can re-plan.
  if (!encoder.runtimeEnv || typeof encoder.runtimeEnv !== "object") {
    throw new RenderChunkValidationError(
      MISSING_RUNTIME_ENV_SNAPSHOT,
      "[renderChunk] planDir is missing meta/encoder.json.runtimeEnv snapshot. " +
        "Re-plan with the current producer.",
    );
  }

  // Apply the controller's runtime-env snapshot. Must happen BEFORE the
  // file server is created — RENDER_MODE_SCRIPT bakes env vars into
  // served HTML at module load. The `restore()` handle is invoked in
  // `finally` so multi-chunk workers (Cloud Run Jobs, Temporal activity
  // worker) don't leak chunk N's env into chunk N+1.
  const envRestore = applyRuntimeEnvSnapshot(encoder.runtimeEnv);

  try {
    // Synthesize a RenderJob the existing stages can consume. The chunk's
    // duration is its own frame count over fps — not the plan's full
    // duration — so the stages see this chunk as a self-contained render.
    const job = buildSyntheticRenderJob({
      fps: { num: plan.dimensions.fpsNum, den: plan.dimensions.fpsDen },
      quality: encoder.quality,
      format: plan.dimensions.format,
      crf: encoder.crf,
      bitrate: encoder.bitrate,
      hdrMode: "force-sdr",
      entryFile: "index.html",
    });
    job.totalFrames = framesInChunk;
    job.duration = (framesInChunk * plan.dimensions.fpsDen) / plan.dimensions.fpsNum;

    const cfg: EngineConfig = {
      ...resolveConfig(),
      browserGpuMode: "software",
      forceScreenshot: encoder.forceScreenshot,
      // `encoder.forceScreenshot=false` is a locked distributed-render
      // decision, not the engine default. Carry that explicit opt-out through
      // the software-GPU clamp so buildChromeArgs includes BeginFrameControl.
      forceScreenshotExplicitlyOptedOut: !encoder.forceScreenshot,
    };

    // ── Per-chunk work + frames directories ──
    // Suffix workDir with pid + random bytes so concurrent invocations on
    // the SAME `(planDir, chunkIndex)` (e.g. a scheduler that double-fires
    // due to heartbeat skew) don't race on the same tmp tree. The output
    // path itself is still the caller's contract — concurrent writers to
    // `outputChunkPath` produce undefined bytes, but we don't make it worse
    // by also deleting their workDirs out from under them.
    const workDir = `${outputChunkPath}.work.${process.pid}.${randomBytes(4).toString("hex")}`;
    mkdirSync(workDir, { recursive: true });
    const framesDir = join(workDir, "captured-frames");
    mkdirSync(framesDir, { recursive: true });
    // Beside workDir, not in it: a screenshot retry wipes workDir.
    const videoFramesDir = `${workDir}.video-frames`;

    const chunkFrameNumbers = Array.from({ length: framesInChunk }, (_, i) => range.startFrame + i);
    const chunkFps = { num: plan.dimensions.fpsNum, den: plan.dimensions.fpsDen };
    const deferredVideos = planVideos?.extracted.filter((video) => video.deferredRange) ?? [];
    const shownFrames = planVideos
      ? shownDeferredFrameIndexes(planVideos, chunkFrameNumbers, chunkFps)
      : new Map<string, Set<number>>();
    // The browser cannot load a source read by URL; size its <video> from the plan instead.
    const remoteVideoIds = new Set(
      planVideos?.extracted
        .filter(
          (video) =>
            video.deferredRange && Object.hasOwn(remoteSources, video.deferredRange.sourcePath),
        )
        .map((video) => video.videoId),
    );

    // ── File server with the seeded-random shim ──
    // `Math.random` / `crypto.getRandomValues` are seeded from virtual
    // time so retries are pixel-identical. Only distributed renders flip this.
    const fileServer: FileServerHandle = await createFileServer({
      projectDir: compiledDir,
      compiledDir,
      port: 0,
      preHeadScripts: [buildVirtualTimeShim({ seedRandomFromFrame: true })],
      // These dimensions are frozen by the controller from the render job, so
      // chunk runtime seek quantization stays on the same fps grid as capture.
      fps: { num: plan.dimensions.fpsNum, den: plan.dimensions.fpsDen },
    });

    const captureOptions = buildChunkCaptureOptions({
      dimensions: plan.dimensions,
      encoder,
      videoCount: planVideos?.videos.length ?? 0,
      html: readFileSync(join(compiledDir, "index.html"), "utf-8"),
      // The plan ships a deferred source only to chunks that show it; don't wait on the rest.
      skipReadinessVideoIds: deferredVideos
        .filter(
          (video) => !shownFrames.get(video.videoId)?.size || remoteVideoIds.has(video.videoId),
        )
        .map((video) => video.videoId),
      videoMetadataHints: collectVideoMetadataHints(
        deferredVideos.filter((video) => remoteVideoIds.has(video.videoId)),
      ),
    });

    // Resolve worker count up-front. Sequential capture reuses the initialized
    // session below. Parallel BeginFrame capture pays one bounded preflight
    // session so composition-specific compositor stalls are detected before
    // fan-out; the probe is closed before worker sessions start.
    //
    // Capture-cost calibration based on shader transitions / renderModeHints
    // is not threaded through to chunks yet; the in-process renderer's
    // `resolveRenderWorkerCount` wraps this with that reduction, but
    // `PlanJson` doesn't carry the compiled hints needed to call it
    // directly. The existing adaptive-retry path reduces workers if
    // compositor contention surfaces as CDP timeouts.
    const chunkWorkerCount = resolveChunkCaptureWorkers(
      framesInChunk,
      calculateOptimalWorkers(framesInChunk, undefined, cfg),
      options?.maxCaptureWorkers,
    );

    // ── Browser + warmup ──
    let session: CaptureSession | null = null;
    let outputKind: "file" | "frame-dir";
    let framesEncoded = 0;
    // Stage wall-clock split for the cost model: per-chunk fixed overhead
    // (boot, warmup, hash, IO) vs frame-proportional work. Consumed from the
    // perf sidecar / ChunkResult by the orchestration's telemetry.
    let sessionBootMs = 0;
    let captureStageMs = 0;
    let encodeStageMs = 0;
    let captureMode: CaptureMode | undefined;
    const capturePerfs: CapturePerfSummary[] = [];
    const captureAttempts: Parameters<typeof runCaptureStage>[0]["captureAttempts"] = [];
    let forceScreenshotForChunk = encoder.forceScreenshot;
    let shownBoxes: Map<string, ShownBox> | undefined;
    let extraction: Promise<unknown> | undefined;
    try {
      if (chunkWorkerCount === 1 || !forceScreenshotForChunk) {
        // Sequential capture reuses this session. Parallel BeginFrame capture
        // uses it only for the composition liveness preflight.
        // SwiftShader assertion runs BEFORE initializeSession (which
        // navigates to the composition); on failure we tear down without
        // ever touching the composition URL. We pass
        // `readWebGlVendorInfoFromCanvas` rather than letting
        // `assertSwiftShader` use its default `chrome://gpu` reader —
        // `chrome-headless-shell` serves chrome:// pages as empty documents,
        // which would trip a false-negative even when the GL backend is in
        // fact SwiftShader. The canvas + WEBGL_debug_renderer_info probe
        // works on any page (we navigate to about:blank inside the helper).
        const bootStarted = Date.now();
        session = await createVerifiedDistributedCaptureSession(
          fileServer.url,
          framesDir,
          captureOptions,
          cfg,
        );
        sessionBootMs = Date.now() - bootStarted;
        // Measured before extraction so each video is extracted at the size it is drawn.
        shownBoxes = await measureVideoShownBoxes(
          session.page,
          [...shownFrames.keys()],
          chunkFrameNumbers.map((frame) => (frame * chunkFps.den) / chunkFps.num),
        );
        // `discardWarmupCapture` is intentionally NOT called: every frame
        // seeks fresh DOM, so `lastFrameCache` is never read; priming it
        // would deadlock Chrome's compositor by issuing a second beginFrame
        // at a `frameTimeTicks` it had just advanced to.
        const browserSelectedScreenshot = session.launchCaptureMode === "screenshot";
        const beginFrameStalled =
          !browserSelectedScreenshot && (await beginFrameSessionNeedsScreenshotFallback(session));
        if (browserSelectedScreenshot) {
          forceScreenshotForChunk = true;
          log.warn(
            "[renderChunk] Browser capability probe selected screenshot capture for the entire chunk",
            { chunkIndex },
          );
          if (chunkWorkerCount > 1) {
            await closeCaptureSession(session);
            session = null;
          }
        } else if (beginFrameStalled) {
          forceScreenshotForChunk = true;
          log.warn(
            "[renderChunk] BeginFrame liveness probe failed; using screenshot capture for the entire chunk",
            { chunkIndex },
          );
          await closeCaptureSession(session).catch(() => {});
          session = null;
          if (chunkWorkerCount === 1) {
            const screenshotBootStarted = Date.now();
            const screenshotCfg: EngineConfig = {
              ...cfg,
              forceScreenshot: true,
              forceScreenshotExplicitlyOptedOut: false,
            };
            session = await createVerifiedDistributedCaptureSession(
              fileServer.url,
              framesDir,
              captureOptions,
              screenshotCfg,
            );
            sessionBootMs += Date.now() - screenshotBootStarted;
          }
        } else if (chunkWorkerCount > 1) {
          await closeCaptureSession(session);
          session = null;
        }
      }

      // Build the immutable frame lookup once. Each browser session/worker gets
      // its own injector hook because the hook remembers the last injected frame
      // per video; sharing that state across a fresh retry page can suppress the
      // first injection and produce a blank/stale frame.
      const deferredVideoFrames = planVideos
        ? extractDeferredVideoFramesForChunk({
            planDir,
            planVideos,
            frames: chunkFrameNumbers,
            fps: chunkFps,
            outputRoot: videoFramesDir,
            cfg,
            remoteSources,
            shownBoxes,
          })
        : Promise.resolve([]);
      extraction = deferredVideoFrames;
      const videoFrameLookup =
        planVideos && planVideos.extracted.length > 0
          ? deferredVideoFrames.then((deferred) =>
              createFrameLookupTable(
                planVideos.videos,
                [
                  ...rebuildExtractedFramesFromPlanDir(
                    planDir,
                    planVideos.extracted.filter((video) => !video.deferredRange),
                    v2Manifest === null ? "dense-v1" : "sparse-v2",
                  ),
                  ...deferred,
                ],
                resolveRenderFpsConfig(job.config.fps).value,
              ),
            )
          : null;
      // A capture can fail before any session reads it; the failure is rethrown below.
      videoFrameLookup?.catch(() => {});
      const createChunkVideoFrameInjector = createChunkVideoFrameInjectorFactory(
        videoFrameLookup,
        frameCacheOptions(cfg, chunkWorkerCount),
      );

      const captureStarted = Date.now();
      captureMode = await runCaptureWithScreenshotFallback({
        forceScreenshot: forceScreenshotForChunk,
        // fallow-ignore-next-line complexity
        run: async (forceScreenshot) => {
          const captureCfg: EngineConfig =
            cfg.forceScreenshot === forceScreenshot
              ? cfg
              : {
                  ...cfg,
                  forceScreenshot,
                  forceScreenshotExplicitlyOptedOut: !forceScreenshot,
                };
          if (chunkWorkerCount === 1 && session === null) {
            session = await createVerifiedDistributedCaptureSession(
              fileServer.url,
              framesDir,
              captureOptions,
              captureCfg,
            );
          }
          const capturePlan = createCapturePlan({
            workerCount: chunkWorkerCount,
            forceScreenshot,
            useStreamingEncode: false,
            useLayeredComposite: false,
            usePageSideCompositing: false,
            hasHdrContent: false,
            needsAlpha: plan.dimensions.format !== "mp4",
          });
          if (capturePlan.kind !== "sdr_disk") {
            throw new Error(`Distributed chunk requires sdr_disk plan; got ${capturePlan.kind}`);
          }

          // runCaptureStage owns and closes any probe session it receives,
          // including error paths. Clear our defensive handle before await.
          const captureSession = session;
          session = null;
          await runCaptureStage({
            fileServer,
            workDir,
            framesDir,
            job,
            totalFrames: framesInChunk,
            cfg: captureCfg,
            plan: capturePlan,
            log,
            probeSession: captureSession,
            captureAttempts,
            // This sink records each worker's effective capture mode so a
            // fallback remains observable to adapters and smoke tests.
            dedupPerfs: capturePerfs,
            buildCaptureOptions: () => captureOptions,
            createRenderVideoFrameInjector: createChunkVideoFrameInjector,
            abortSignal: undefined,
            assertNotAborted: () => {},
            frameRange: range,
          });

          return observedChunkCaptureMode(capturePerfs);
        },
        resetForScreenshotRetry: () => {
          // A mode switch is a whole-chunk retry. Do not allow successfully
          // captured BeginFrame files or attempt telemetry to mix with the
          // screenshot result.
          rmSync(workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          mkdirSync(framesDir, { recursive: true });
          capturePerfs.length = 0;
          captureAttempts.length = 0;
          job.framesRendered = 0;
        },
        onFallback: (error) => {
          log.warn(
            "[renderChunk] BeginFrame capture failed; retrying the entire chunk once in screenshot mode",
            {
              chunkIndex,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        },
      }).catch(async (captureError: unknown) => {
        await deferredVideoFrames;
        throw captureError;
      });
      await deferredVideoFrames;
      captureStageMs = Date.now() - captureStarted;
      applyRenderWarningPolicy(
        job,
        capturePerfs.flatMap((perf) => perf.warnings ?? []),
        log,
      );
      framesEncoded = framesInChunk;

      // ── Encode the chunk ──
      const isPngSequence = plan.dimensions.format === "png-sequence";
      outputKind = isPngSequence ? "frame-dir" : "file";
      // For mp4 / mov / webm we use the standard preset machinery; the
      // locked encoder values come from `meta/encoder.json` and the
      // `lockGopForChunkConcat` toggle is the only Phase-2 flag that flips
      // on at this site. png-sequence has no encoder, but `runEncodeStage`
      // still reads `preset.quality` for bookkeeping (it never reaches
      // ffmpeg on the pngseq branch). Fall back to the mp4 preset shape —
      // same trick `renderOrchestrator` plays.
      const presetFormat: "mp4" | "mov" | "webm" = isPngSequence
        ? "mp4"
        : (plan.dimensions.format as "mp4" | "mov" | "webm");
      const basePreset = getEncoderPreset(job.config.quality, presetFormat, undefined);
      const preset = resolvePresetForLockedEncoder(basePreset, encoder.encoder);
      const effectiveQuality = encoder.crf ?? preset.quality;
      const effectiveBitrate = encoder.crf != null ? undefined : encoder.bitrate;
      // For non-pngseq, encodeStage writes to `outputPath` when `isPngSequence`
      // is false. `videoOnlyPath` is the encoder's direct output: assemble muxes
      // the audio, or a chunk that carries audio muxes its own below.
      const videoOnlyPath = encoder.chunksCarryAudio
        ? `${outputChunkPath}.video.mp4`
        : outputChunkPath;
      if (isPngSequence) {
        if (!existsSync(outputChunkPath)) mkdirSync(outputChunkPath, { recursive: true });
      } else {
        const outDir = join(outputChunkPath, "..");
        if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      }

      const encodeStarted = Date.now();
      await runEncodeStage({
        job,
        log,
        outputPath: videoOnlyPath,
        framesDir,
        videoOnlyPath,
        width: Math.round(plan.dimensions.width * encoder.deviceScaleFactor),
        height: Math.round(plan.dimensions.height * encoder.deviceScaleFactor),
        needsAlpha: plan.dimensions.format !== "mp4",
        captureImageFormat: captureOptions.format ?? "jpeg",
        // The encoder writes video only; audio joins at assemble time or in the
        // chunk that carries audio. Suppressing `hasAudio` skips the png-sequence audio
        // sidecar AND the mp4 audio mux.
        hasAudio: false,
        isPngSequence,
        // `DistributedFormat` has no "gif" member — distributed chunks are
        // always video segments (gif renders in-process only).
        isGif: false,
        preset,
        effectiveQuality,
        effectiveBitrate,
        engineConfig: {
          ffmpegEncodeTimeout: cfg.ffmpegEncodeTimeout,
          vp9CpuUsed: resolveLockedVp9CpuUsed(encoder) ?? cfg.vp9CpuUsed,
        },
        // Distributed chunks emit a single ffmpeg call per chunk; the
        // in-process per-chunk-within-chunk path would re-split our
        // already-chunked work.
        enableChunkedEncode: false,
        chunkedEncodeSize: framesInChunk,
        abortSignal: undefined,
        assertNotAborted: () => {},
        // GOP === framesInChunk + force-keyframe at frame 0 → the chunk's
        // first frame is an IDR keyframe and concat-copy at assemble time
        // round-trips losslessly.
        lockGopForChunkConcat: !isPngSequence,
        gopSize: framesInChunk,
      });
      if (encoder.chunksCarryAudio) {
        const audioScratchPath = `${outputChunkPath}.audio.m4a`;
        // A sub-range muxes the packets it owns as if it were a chunk of its own.
        const audioChunks = options?.frameRange
          ? chunksWithSubRange(chunks, chunkIndex, range)
          : { chunks, index: chunkIndex };
        await muxChunkWithAudio({
          videoPath: videoOnlyPath,
          audioPath: chunkAudioSource(planDir, chunkIndex, audioScratchPath),
          outputPath: outputChunkPath,
          chunks: audioChunks.chunks,
          chunkIndex: audioChunks.index,
          fps: { num: plan.dimensions.fpsNum, den: plan.dimensions.fpsDen },
          timeoutMs: cfg.ffmpegProcessTimeout,
        });
        rmSync(videoOnlyPath, { force: true });
        rmSync(audioScratchPath, { force: true });
      }
      encodeStageMs = Date.now() - encodeStarted;
    } finally {
      // No ffmpeg left writing into a work dir the caller removes; its error surfaced above.
      await extraction?.catch(() => {});
      // Cleanest path: captureStage closed the session for us. The defensive
      // close handles error paths where we threw before delegating.
      if (session) {
        try {
          await closeCaptureSession(session);
        } catch (err) {
          log.warn("[renderChunk] error closing capture session in finally", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      closeFileServerSafely(fileServer, "renderChunk", log);
      // Leave the temp work dir on failure (helps debugging); remove it on
      // success below.
    }

    // ── Hash the output + write the perf sidecar ──
    if (!captureMode) {
      throw new Error("[renderChunk] capture stage completed without reporting a capture mode");
    }
    const sha256 = hashChunkOutput(outputChunkPath, outputKind);
    const durationMs = Date.now() - start;
    const perfPath = `${outputChunkPath}.perf.json`;
    const perfPayload = {
      planHash: plan.planHash,
      chunkIndex,
      startFrame: range.startFrame,
      endFrame: range.endFrame,
      framesEncoded,
      durationMs,
      planHashMs,
      sessionBootMs,
      captureStageMs,
      encodeStageMs,
      workers: chunkWorkerCount,
      captureMode,
      // Device-pixel box each video's frames were extracted to cover; a video not listed kept full size.
      videoShownBoxes: Object.fromEntries(shownBoxes ?? []),
      sha256,
      outputKind,
      producerVersion: plan.producerVersion,
      ffmpegVersion,
    };
    writeFileSync(perfPath, `${JSON.stringify(perfPayload, null, 2)}\n`, "utf-8");

    // Clean up only after the hash + perf sidecar landed. Any failure above
    // leaves the framesDir in place for inspection.
    try {
      rmSync(workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      rmSync(videoFramesDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (err) {
      log.warn("[renderChunk] failed to remove work dir", {
        workDir,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      outputPath: outputChunkPath,
      outputKind,
      framesEncoded,
      frameRange: range,
      sha256,
      durationMs,
      planHashMs,
      sessionBootMs,
      captureStageMs,
      encodeStageMs,
      workers: chunkWorkerCount,
      captureMode,
      perfPath,
    };
  } finally {
    // Restore the controller's runtime env even on the error path so the
    // next chunk on the same process boots from a clean env.
    envRestore.restore();
  }
}
