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
import {
  type EngineConfig,
  type VideoFrameFormat,
  getEncoderPreset,
  resolveConfig,
} from "@hyperframes/engine";
import { defaultLogger, type ProducerLogger } from "../../logger.js";
import { closeFileServerSafely } from "../fileServer.js";
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
  type DistributedFormat,
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
  /**
   * Source-video frame extraction format. Defaults to `"auto"`, matching the
   * in-process renderer: alpha/alpha-capable sources extract as PNG, other
   * sources extract as JPG unless the caller explicitly requests `"png"`.
   */
  videoFrameFormat?: VideoFrameFormat;
  /** Output resolution preset; engages Chrome `deviceScaleFactor` supersampling. */
  outputResolution?: CanvasResolution;

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
  /** Default `16`. Caps long renders to fewer-but-longer chunks for operational fairness. */
  maxParallelChunks?: number;
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
  format: DistributedFormat;
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

/**
 * Default chunk size in frames (~8s @ 30fps; fits Lambda's 15-min cap).
 * Used when the caller explicitly passes this value. When `chunkSize` is
 * `undefined`, `plan()` auto-sizes from `maxParallelChunks` instead.
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
        `Render with the in-process renderer (\`executeRenderJob\`) — it has full format ` +
        `support — or pick a distributed-supported format: mp4 SDR, mov ProRes 4444, ` +
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
    variables: config.variables,
  };
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
        `Omit codec for non-mp4 formats — mov is always ProRes 4444, webm is always ` +
        `libvpx-vp9, and png-sequence has no encoder.`,
    );
  }
  return resolveNonMp4EncoderTriple(config.format, config.quality ?? "standard");
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
): EncoderTriple {
  if (format === "mov") {
    return { encoder: "prores-software", pixelFormat: "yuva444p10le", preset: "4444" };
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
    videoFrameFormat: config.videoFrameFormat,
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

  // webm + mov + png-sequence carry alpha — flip force-screenshot so
  // compileStage takes the alpha-aware capture path (BeginFrame doesn't
  // preserve alpha on Linux headless-shell). Must match the in-process
  // renderer's needsAlpha logic in `renderOrchestrator.ts` so chunked
  // webm output preserves the same alpha plane the in-process baseline
  // does. Omitting webm here silently freezes `forceScreenshot: false`
  // into the planDir and every chunk worker captures opaque RGB — the
  // libvpx-vp9 alpha sub-stream then encodes either uniform alpha or
  // gets downgraded by the encoder, producing un-keyable webm output.
  const needsAlpha =
    config.format === "png-sequence" || config.format === "mov" || config.format === "webm";

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
    // Distributed renders must not capture host-specific system fonts —
    // the Lambda/worker filesystem won't have the same fonts installed.
    allowSystemFontCapture: false,
  });
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
  const probeResult = await runProbeStage({
    projectDir,
    workDir,
    job,
    cfg,
    forceScreenshot,
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
  const maxParallel = config.maxParallelChunks ?? DEFAULT_MAX_PARALLEL_CHUNKS;
  const { chunkCount, effectiveChunkSize } = resolveChunkPlan(
    totalFrames,
    config.chunkSize,
    maxParallel,
    config.targetChunkFrames,
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
