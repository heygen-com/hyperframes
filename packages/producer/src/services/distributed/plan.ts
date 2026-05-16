/**
 * Activity A of the distributed render pipeline.
 *
 * `plan(projectDir, config, planDir)` composes the existing render stages
 * (compile → probe → extract videos → audio → freeze) into a self-contained
 * `<planDir>/` directory tree that downstream chunk workers consume:
 *
 *     <planDir>/
 *     ├── plan.json
 *     ├── compiled/                # compileForRender output (self-contained)
 *     ├── video-frames/            # per-video JPEG sequences (dereferenced)
 *     ├── audio.aac                # only when composition has audio
 *     └── meta/
 *         ├── composition.json
 *         ├── encoder.json         # LockedRenderConfig
 *         └── chunks.json
 *
 * Pure function over local paths. No networking. Two invocations with the
 * same inputs produce the same `planHash` — adapters use that contract to
 * short-circuit `plan()` on workflow replay.
 *
 * Banned configurations (GPU encode, hardware browser GL, system primary
 * fonts) are rejected at plan time via `planValidation.ts` so chunk workers
 * never have to handle them.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { type CanvasResolution } from "@hyperframes/core";
import { type EngineConfig, resolveConfig } from "@hyperframes/engine";
import { defaultLogger, type ProducerLogger } from "../../logger.js";
import { runAudioStage } from "../render/stages/audioStage.js";
import { runCompileStage } from "../render/stages/compileStage.js";
import { runExtractVideosStage } from "../render/stages/extractVideosStage.js";
import { runProbeStage } from "../render/stages/probeStage.js";
import {
  type ChunkSliceJson,
  type CompositionMetadataJson,
  freezePlan,
  type LockedRenderConfig,
} from "../render/stages/freezePlan.js";
import {
  canonicalJsonStringify,
  type PlanDimensions,
  sha256Hex,
} from "../render/stages/planHash.js";
import { validateNoGpuEncode, validateNoSystemFonts } from "../render/planValidation.js";
import { snapshotRuntimeEnv } from "../render/runtimeEnvSnapshot.js";
import {
  buildSyntheticRenderJob,
  PLAN_VIDEOS_META_RELATIVE_PATH,
  type PlanVideosJson,
  readFfmpegVersion,
  readProducerVersion,
} from "./shared.js";

/**
 * Caller-supplied configuration for a distributed render. `fps`, `width`,
 * `height`, and `format` are required; everything else carries a default
 * sensible for AWS Lambda fan-out.
 */
export interface DistributedRenderConfig {
  /** Integer frame rate. Distributed renders only accept integer fps; the in-process renderer's `Fps` rational handles NTSC. */
  fps: 24 | 30 | 60;
  width: number;
  height: number;
  /**
   * Output container format. webm and HDR mp4 are not supported in
   * distributed mode — `plan()` refuses them up front with a typed
   * `FormatNotSupportedInDistributedError`. The in-process renderer
   * supports both.
   */
  format: "mp4" | "mov" | "png-sequence";
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
  /** Output resolution preset; engages Chrome `deviceScaleFactor` supersampling. */
  outputResolution?: CanvasResolution;

  /** Default `240` frames (~8s @ 30fps; fits Lambda's 15-min cap). */
  chunkSize?: number;
  /** Default `16`. Caps long renders to fewer-but-longer chunks for operational fairness. */
  maxParallelChunks?: number;
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

  logger?: ProducerLogger;
  /** Optional engine config override (env vars are not read when provided). */
  producerConfig?: EngineConfig;
  /** Entry HTML file relative to `projectDir`. Defaults to `"index.html"`. */
  entryFile?: string;
  /** Caller-supplied AbortSignal. Threaded through compile / probe / extract / audio stages. */
  abortSignal?: AbortSignal;
  /**
   * Hard ceiling on `<planDir>/` size in bytes; trips a non-retryable
   * `PLAN_TOO_LARGE` error after freeze. Defaults to
   * {@link PLAN_DIR_SIZE_LIMIT_BYTES} (2 GB — fits inside AWS Lambda's
   * 10 GB `/tmp` budget alongside the chunk worker's frame buffer +
   * ffmpeg working set). Adapters that deploy onto storage with
   * tighter ceilings can pass a smaller cap; tests pass a tiny cap to
   * exercise the throw path.
   */
  planDirSizeLimitBytes?: number;
}

/**
 * Result of {@link plan}. The `planHash` is the content-addressed identifier
 * that adapters key replay short-circuits off of.
 */
export interface PlanResult {
  planDir: string;
  planHash: string;
  chunkCount: number;
  totalFrames: number;
  fps: 24 | 30 | 60;
  width: number;
  height: number;
  format: "mp4" | "mov" | "png-sequence";
  ffmpegVersion: string;
  producerVersion: string;
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

/** Default chunk size in frames (~8s @ 30fps; fits Lambda's 15-min cap). */
export const DEFAULT_CHUNK_SIZE = 240;
/** Default cap on parallel chunks for operational fairness across renders. */
export const DEFAULT_MAX_PARALLEL_CHUNKS = 16;
/**
 * Default hard ceiling on `<planDir>/` size in bytes. 2 GB fits inside
 * AWS Lambda's 10 GB `/tmp` alongside the chunk worker's captured frames
 * and ffmpeg's temporary files. Compositions that exceed this have to
 * fall back to the in-process renderer until per-chunk video-frame
 * slicing lands.
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
  constructor(sizeBytes: number, limitBytes: number) {
    super(
      `[plan] planDir size ${formatBytes(sizeBytes)} exceeds the configured ceiling ` +
        `${formatBytes(limitBytes)} (PLAN_TOO_LARGE). The default 2 GB cap fits inside AWS ` +
        `Lambda's 10 GB /tmp budget alongside the chunk worker's frame buffer and ffmpeg's ` +
        `working set. To unblock: shorten the composition, lower the framerate, or use the ` +
        `in-process renderer (\`executeRenderJob\`) — it has no planDir size cap.`,
    );
    this.name = "PlanTooLargeError";
    this.sizeBytes = sizeBytes;
    this.limitBytes = limitBytes;
  }
}

/**
 * Non-retryable error code raised when `plan()` is asked for an output
 * format that distributed mode doesn't support (webm, HDR mp4). The same
 * config would fail on every retry, so the failure must not auto-retry.
 */
export const FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED = "FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED";

/**
 * Typed error raised by `plan()` for outputs that distributed mode
 * refuses to ship.
 *
 *   - webm — VP9 + matroska concat-copy is fragile across libvpx-vp9
 *     builds, and the chunked pipeline can't guarantee bit-identical
 *     concat output across worker versions.
 *   - mp4 + HDR (PQ / HLG) — chunked HDR pre-extract + HDR signaling
 *     re-apply on the assembled file is not implemented yet.
 *
 * The in-process renderer (`executeRenderJob`) handles both natively.
 */
export class FormatNotSupportedInDistributedError extends Error {
  readonly code: typeof FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED = FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED;
  readonly format: string;
  readonly reason: string;
  constructor(format: string, reason: string) {
    super(
      `[plan] format ${JSON.stringify(format)} is not supported in distributed mode: ${reason}. ` +
        `Render with the in-process renderer (\`executeRenderJob\`) — it has full format ` +
        `support — or pick a distributed-supported format: mp4 SDR, mov ProRes 4444, or ` +
        `png-sequence.`,
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
 * Reject formats the distributed pipeline cannot ship (webm + HDR mp4).
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
  // The TypeScript type for `DistributedRenderConfig.format` already
  // excludes webm, but a JS caller (or a caller that built the config
  // dynamically from JSON) can still pass it. Belt-and-suspenders runtime
  // check at the gate.
  if ((config.format as string) === "webm") {
    throw new FormatNotSupportedInDistributedError(
      "webm",
      "VP9 + matroska concat-copy is fragile across libvpx-vp9 builds, so chunked output " +
        "can't be guaranteed byte-identical across workers",
    );
  }
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
  let total = 0;
  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        try {
          total += statSync(full).size;
        } catch {
          // Ignore — a file disappearing during the walk shouldn't crash
          // the measurement.
        }
      }
    }
  }
  walk(planDir);
  return total;
}

/**
 * Compute `(chunkCount, effectiveChunkSize)` from total frames and the
 * caller's chunking knobs:
 *
 *     chunkCount = min(maxParallelChunks, ceil(totalFrames / chunkSize))
 *     effectiveChunkSize = max(configChunkSize, ceil(totalFrames / maxParallelChunks))
 *
 * Long renders auto-rescale to fewer-but-longer chunks rather than
 * fragmenting infinitely. Returned `chunkCount >= 1` (`totalFrames === 0`
 * is rejected upstream); `effectiveChunkSize >= configChunkSize`.
 */
export function resolveChunkPlan(
  totalFrames: number,
  configChunkSize: number,
  maxParallelChunks: number,
): { chunkCount: number; effectiveChunkSize: number } {
  // Integer-only inputs: a fractional `totalFrames` (e.g. 10.5) would
  // otherwise produce a last chunk with non-integer `endFrame`, and the
  // chunk worker's `for (i = startFrame; i < endFrame; i++)` loop would
  // silently truncate.
  assertPositiveInteger("totalFrames", totalFrames);
  assertPositiveInteger("configChunkSize", configChunkSize);
  assertPositiveInteger("maxParallelChunks", maxParallelChunks);
  const naiveCount = Math.ceil(totalFrames / configChunkSize);
  const chunkCount = Math.min(maxParallelChunks, Math.max(1, naiveCount));
  const effectiveChunkSize = Math.max(configChunkSize, Math.ceil(totalFrames / chunkCount));
  return { chunkCount, effectiveChunkSize };
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `[plan] resolveChunkPlan: ${name} must be a positive integer (received ${String(value)})`,
    );
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
 * Hash the deterministic-font bundle that ships inside `@hyperframes/producer`.
 * The compiled HTML already inlines per-family `@font-face` data URIs, so the
 * snapshot SHA exists primarily to detect cross-version font-bundle drift on
 * chunk workers. Mixed into `planHash`.
 *
 * Pulled lazily because the generated module is large and only the
 * distributed pipeline needs it.
 */
async function readFontSnapshotSha(): Promise<string> {
  const module = (await import("../fontData.generated.js")) as {
    EMBEDDED_FONT_DATA?: unknown;
  };
  const data = module.EMBEDDED_FONT_DATA;
  if (!data || typeof data !== "object") {
    throw new Error(
      "[plan] EMBEDDED_FONT_DATA missing from fontData.generated.js — was `bun run build:fonts` run?",
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
  effectiveChunkSize: number;
  chunkCount: number;
  runtimeEnv: Record<string, string>;
}): LockedRenderConfig {
  const { config, forceScreenshot, deviceScaleFactor, ffmpegVersion } = input;
  const { encoder, pixelFormat, preset } = resolveEncoderTriple(config);
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
    // GOP === chunkSize so every chunk's first frame is an IDR keyframe and
    // ffmpeg concat-copy round-trips losslessly.
    gopSize: input.effectiveChunkSize,
    closedGop: true,
    forceKeyframes: "n=0",
    pixelFormat,
    chunkSize: input.effectiveChunkSize,
    chunkCount: input.chunkCount,
    runtimeEnv: input.runtimeEnv,
  };
}

/**
 * Resolve the encoder + pixel-format + preset triple for a distributed
 * render. Distributed mode is SDR-only: H.264 or H.265 8-bit for mp4,
 * ProRes 4444 for mov, raw RGBA for png-sequence.
 *
 * `config.codec` is consulted only when `config.format === "mp4"`. Passing
 * `codec` with a non-mp4 format throws at plan time — surfaces the
 * caller error immediately rather than producing a silently-wrong planDir
 * whose chunk worker would override the codec choice.
 */
function resolveEncoderTriple(config: DistributedRenderConfig): {
  encoder: LockedRenderConfig["encoder"];
  pixelFormat: string;
  preset: string;
} {
  if (config.format === "mp4") {
    const codec = config.codec ?? "h264";
    // Explicit unknown-codec throw rather than silent fall-through to h264.
    // A JS caller building config from JSON who passes `codec: "h266"` or
    // `codec: "H265"` (typo / wrong case) would otherwise produce h264
    // output with no signal. The non-mp4-format branch below already throws
    // for the symmetric "wrong combination" case — match that shape.
    if (codec !== "h264" && codec !== "h265") {
      throw new Error(
        `[plan] DistributedRenderConfig.codec must be "h264" or "h265" for format="mp4"; ` +
          `received ${JSON.stringify(codec)}. Omit codec to default to h264.`,
      );
    }
    if (codec === "h265") {
      return { encoder: "libx265-software", pixelFormat: "yuv420p", preset: "medium" };
    }
    return { encoder: "libx264-software", pixelFormat: "yuv420p", preset: "medium" };
  }
  if (config.codec !== undefined) {
    throw new Error(
      `[plan] DistributedRenderConfig.codec is only valid for format="mp4"; received ` +
        `codec=${JSON.stringify(config.codec)} with format=${JSON.stringify(config.format)}. ` +
        `Omit codec for non-mp4 formats — mov is always ProRes 4444 and png-sequence has no encoder.`,
    );
  }
  if (config.format === "mov") {
    return { encoder: "prores-software", pixelFormat: "yuva444p10le", preset: "4444" };
  }
  return { encoder: "png-sequence", pixelFormat: "rgba", preset: "lossless" };
}

/**
 * Activity A of the distributed render pipeline. Produces a self-contained
 * `<planDir>/` from a project + config. See module docstring for the
 * directory layout.
 */
export async function plan(
  projectDir: string,
  config: DistributedRenderConfig,
  planDir: string,
): Promise<PlanResult> {
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
  const abortSignal = config.abortSignal;
  const assertNotAborted = (): void => {
    if (abortSignal?.aborted) {
      throw new Error("[plan] render_cancelled");
    }
  };
  const cfg: EngineConfig = {
    ...(config.producerConfig ?? resolveConfig()),
    browserGpuMode: "software",
    forceScreenshot: false,
  };

  const job = buildSyntheticRenderJob({
    fps: { num: config.fps, den: 1 },
    quality: config.quality ?? "standard",
    format: config.format,
    crf: config.crf,
    bitrate: config.bitrate,
    outputResolution: config.outputResolution,
    // HDR is banned in distributed mode. force-sdr keeps the
    // extract / encoder paths off the HDR branches entirely.
    hdrMode: config.hdrMode ?? "force-sdr",
    entryFile: config.entryFile ?? "index.html",
    logger: config.logger,
    producerConfig: config.producerConfig,
  });
  const entryFile = config.entryFile ?? "index.html";
  const htmlPath = join(projectDir, entryFile);
  if (!existsSync(htmlPath)) {
    throw new Error(`[plan] entry file not found: ${htmlPath}`);
  }

  const workDir = join(planDir, ".plan-work");
  if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });
  const compiledDir = join(workDir, "compiled");

  // Pre-seed the compiled directory with `projectDir`'s local assets
  // (style.css, script.js, images, etc.). The chunk worker's file server
  // serves ONLY from `<planDir>/compiled/`, so without this copy a
  // composition's `<link rel=stylesheet href=style.css>` 404s and the
  // first capture lands an unstyled fallback frame. `compileStage`
  // overwrites the entry HTML afterwards. `dereference: true` resolves
  // symlinks so the planDir survives S3 / Lambda /tmp round-trips.
  mkdirSync(compiledDir, { recursive: true });
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

  // The compiled directory lives at `<planDir>/compiled/` in the final
  // layout. The stages write under `<planDir>/.plan-work/compiled/`; we
  // move the contents over once the staged work completes.
  const finalCompiledDir = join(planDir, "compiled");

  // mov + png-sequence carry alpha — flip force-screenshot so compileStage
  // takes the alpha-aware capture path (BeginFrame doesn't preserve alpha
  // on Linux headless-shell).
  const needsAlpha = config.format === "png-sequence" || config.format === "mov";

  // ── Compile ──
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
    // Distributed renders fail closed on font-fetch errors so the planDir
    // is content-addressed against deterministic fonts only.
    failClosedFontFetch: config.failClosedFontFetch !== false,
  });
  let compiled = compileResult.compiled;
  const composition = compileResult.composition;
  const { deviceScaleFactor, forceScreenshot } = compileResult;
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
  job.duration = probeResult.duration;
  job.totalFrames = probeResult.totalFrames;
  const totalFrames = probeResult.totalFrames;
  if (probeResult.fileServer) probeResult.fileServer.close();
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

  // ── Extract videos ──
  // `materializeSymlinks: true` recursively copies frames so the planDir is
  // self-contained (symlinks don't survive S3/GCS round-trips).
  const extractResult = await runExtractVideosStage({
    projectDir,
    compiledDir,
    job,
    cfg,
    composition,
    abortSignal,
    assertNotAborted,
    materializeSymlinks: true,
  });
  // Skip `extractResult.frameLookup.cleanup()`: it would rm-rf each
  // video's outputDir, but in `plan()` those directories ARE the source
  // material the renames below move into `planDir/video-frames/`.

  // ── Audio ──
  const audioResult = await runAudioStage({
    projectDir,
    workDir,
    compiledDir,
    duration: job.duration,
    audios: composition.audios,
    abortSignal,
    assertNotAborted,
  });

  // Promote staged artifacts from the temp work tree into the final planDir
  // shape. `workDir` is `<planDir>/.plan-work/` — always the same filesystem
  // as `planDir`, so `renameSync` succeeds without copying. Video frames
  // alone can be hundreds of MB; copying once instead of twice (the prior
  // approach left a duplicate under `compiled/__hyperframes_video_frames/`)
  // halves peak disk usage during `plan()`.
  const stagedVideoFrames = join(compiledDir, "__hyperframes_video_frames");
  const videoFramesDst = join(planDir, "video-frames");
  if (existsSync(videoFramesDst)) rmSync(videoFramesDst, { recursive: true, force: true });
  if (existsSync(stagedVideoFrames)) {
    renameSync(stagedVideoFrames, videoFramesDst);
  } else {
    mkdirSync(videoFramesDst, { recursive: true });
  }

  if (existsSync(finalCompiledDir)) rmSync(finalCompiledDir, { recursive: true, force: true });
  renameSync(compiledDir, finalCompiledDir);

  // `meta/videos.json` is the contract that makes distributed renders
  // pixel-comparable to in-process for compositions with video sources —
  // without it, renderChunk can't rebuild the BeforeCaptureHook and the
  // page's native `<video>` element decodes the source mp4 ~1 frame
  // off the pre-extracted images the in-process baseline was captured
  // from.
  const planVideosJson: PlanVideosJson = {
    videos: composition.videos,
    extracted: (extractResult.extractionResult?.extracted ?? []).map((ext) => ({
      videoId: ext.videoId,
      srcPath: ext.srcPath,
      framePattern: ext.framePattern,
      fps: ext.fps,
      totalFrames: ext.totalFrames,
      metadata: ext.metadata,
    })),
  };
  mkdirSync(join(planDir, "meta"), { recursive: true });
  writeFileSync(
    join(planDir, PLAN_VIDEOS_META_RELATIVE_PATH),
    JSON.stringify(planVideosJson, null, 2),
    "utf-8",
  );

  const planAudioPath = join(planDir, "audio.aac");
  if (audioResult.hasAudio && existsSync(audioResult.audioOutputPath)) {
    renameSync(audioResult.audioOutputPath, planAudioPath);
  }

  // ── Chunking decisions + locked config ──
  const configChunkSize = config.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const maxParallel = config.maxParallelChunks ?? DEFAULT_MAX_PARALLEL_CHUNKS;
  const { chunkCount, effectiveChunkSize } = resolveChunkPlan(
    totalFrames,
    configChunkSize,
    maxParallel,
  );
  const chunks = buildChunkSlices(totalFrames, chunkCount, effectiveChunkSize);

  const ffmpegVersion = await readFfmpegVersion();
  const producerVersion = readProducerVersion();
  const fontSnapshotSha = await readFontSnapshotSha();
  const runtimeEnv = snapshotRuntimeEnv();
  const lockedConfig = buildLockedRenderConfig({
    config,
    forceScreenshot,
    deviceScaleFactor,
    ffmpegVersion,
    effectiveChunkSize,
    chunkCount,
    runtimeEnv,
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
    hasAudio: audioResult.hasAudio,
  });
  const planHash = freezeResult.planHash;

  // 2 GB hard cap so the planDir fits inside Lambda's 10 GB /tmp budget
  // alongside the chunk worker's frame buffer + ffmpeg working set. The
  // check runs AFTER cleanup so the workDir tree doesn't double-count.
  // Non-retryable: the same planDir would trip the cap on every retry.
  const sizeLimitBytes = config.planDirSizeLimitBytes ?? PLAN_DIR_SIZE_LIMIT_BYTES;
  const planDirBytes = measurePlanDirBytes(planDir);
  if (planDirBytes > sizeLimitBytes) {
    throw new PlanTooLargeError(planDirBytes, sizeLimitBytes);
  }

  return {
    planDir,
    planHash,
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
