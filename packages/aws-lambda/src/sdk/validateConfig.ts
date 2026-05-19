/**
 * Client-side validation of `SerializableDistributedRenderConfig` so the
 * SDK fails on shape errors with a typed `InvalidConfigError` *before* a
 * Step Functions execution starts.
 *
 * The producer's `plan` stage validates the same fields server-side, but a
 * caller staring at "ExecutionFailed: BROWSER_GPU_NOT_SOFTWARE" five
 * minutes after StartExecution has to dig through Step Functions history
 * to learn that the renderToLambda call passed an unsupported format.
 * Catching the obvious mistakes locally turns that wait into a synchronous
 * throw.
 *
 * The check is deliberately narrow — it covers the *shape* errors any
 * caller could have surfaced with `tsc` if they passed a literal, plus
 * the `force-hdr` rejection (HDR mp4 isn't supported in distributed
 * mode). webm was previously rejected here too; v0.7+ supports it via
 * closed-GOP concat-copy. Anything deeper (font availability, plan
 * size cap, GPU mode at runtime) needs the actual planner.
 */

import type { SerializableDistributedRenderConfig } from "../events.js";

/** Thrown for any client-side `SerializableDistributedRenderConfig` violation. */
export class InvalidConfigError extends Error {
  override readonly name = "InvalidConfigError";
  /** Dotted JSON-pointer-ish path to the offending field, e.g. `config.fps`. */
  readonly field: string;
  constructor(field: string, message: string) {
    super(`[validateConfig] ${field}: ${message}`);
    this.field = field;
  }
}

const ALLOWED_FPS = [24, 30, 60] as const;
const ALLOWED_FORMATS = ["mp4", "mov", "png-sequence", "webm"] as const;
const ALLOWED_CODECS = ["h264", "h265"] as const;
const ALLOWED_QUALITIES = ["draft", "standard", "high"] as const;
const ALLOWED_RUNTIME_CAPS = ["lambda", "temporal", "cloud-run-job", "k8s-job", "none"] as const;
const ALLOWED_HDR_MODES = ["auto", "force-sdr"] as const;

const MAX_DIMENSION = 7680;
const MIN_DIMENSION = 16;
const MAX_CHUNK_SIZE = 3600;
const MAX_PARALLEL_CHUNKS_CEILING = 256;

/**
 * Throw an `InvalidConfigError` if `config` is not a valid
 * `SerializableDistributedRenderConfig`. Returns the same reference on
 * success so the call site reads:
 *
 *     const validated = validateDistributedRenderConfig(input);
 */
export function validateDistributedRenderConfig(
  config: SerializableDistributedRenderConfig,
): SerializableDistributedRenderConfig {
  if (config === null || typeof config !== "object") {
    throw new InvalidConfigError("config", "must be an object");
  }

  if (!ALLOWED_FPS.includes(config.fps as 24 | 30 | 60)) {
    throw new InvalidConfigError(
      "config.fps",
      `must be one of ${ALLOWED_FPS.join(", ")}; got ${String(config.fps)}`,
    );
  }

  validateIntDimension("config.width", config.width);
  validateIntDimension("config.height", config.height);

  if (!ALLOWED_FORMATS.includes(config.format)) {
    throw new InvalidConfigError(
      "config.format",
      `must be one of ${ALLOWED_FORMATS.join(", ")}; got ${String(config.format)}`,
    );
  }

  if (config.codec !== undefined) {
    if (config.format !== "mp4") {
      throw new InvalidConfigError(
        "config.codec",
        `is only valid with format="mp4"; got format=${String(config.format)}`,
      );
    }
    if (!ALLOWED_CODECS.includes(config.codec)) {
      throw new InvalidConfigError(
        "config.codec",
        `must be one of ${ALLOWED_CODECS.join(", ")}; got ${String(config.codec)}`,
      );
    }
  }

  if (config.quality !== undefined && !ALLOWED_QUALITIES.includes(config.quality)) {
    throw new InvalidConfigError(
      "config.quality",
      `must be one of ${ALLOWED_QUALITIES.join(", ")}; got ${String(config.quality)}`,
    );
  }

  if (config.crf !== undefined && config.bitrate !== undefined) {
    throw new InvalidConfigError("config.crf", "is mutually exclusive with config.bitrate");
  }
  if (
    config.crf !== undefined &&
    (!Number.isInteger(config.crf) || config.crf < 0 || config.crf > 51)
  ) {
    throw new InvalidConfigError("config.crf", `must be an integer in [0, 51]; got ${config.crf}`);
  }
  if (config.bitrate !== undefined && !/^\d+(\.\d+)?[kKmM]?$/.test(config.bitrate)) {
    throw new InvalidConfigError(
      "config.bitrate",
      `must look like "10M" or "5000k"; got ${JSON.stringify(config.bitrate)}`,
    );
  }

  if (config.chunkSize !== undefined) {
    if (!Number.isInteger(config.chunkSize) || config.chunkSize < 1) {
      throw new InvalidConfigError(
        "config.chunkSize",
        `must be a positive integer; got ${config.chunkSize}`,
      );
    }
    if (config.chunkSize > MAX_CHUNK_SIZE) {
      throw new InvalidConfigError(
        "config.chunkSize",
        // Lambda 15-min cap leaves no useful headroom past ~3600 frames
        // at 4 fps capture-equivalent throughput; rejecting up front
        // avoids a 14-minute Plan-state retry storm.
        `must be ≤ ${MAX_CHUNK_SIZE} (Lambda 15-min cap); got ${config.chunkSize}`,
      );
    }
  }

  if (config.maxParallelChunks !== undefined) {
    if (!Number.isInteger(config.maxParallelChunks) || config.maxParallelChunks < 1) {
      throw new InvalidConfigError(
        "config.maxParallelChunks",
        `must be a positive integer; got ${config.maxParallelChunks}`,
      );
    }
    if (config.maxParallelChunks > MAX_PARALLEL_CHUNKS_CEILING) {
      throw new InvalidConfigError(
        "config.maxParallelChunks",
        `must be ≤ ${MAX_PARALLEL_CHUNKS_CEILING}; got ${config.maxParallelChunks}`,
      );
    }
  }

  if (config.runtimeCap !== undefined && !ALLOWED_RUNTIME_CAPS.includes(config.runtimeCap)) {
    throw new InvalidConfigError(
      "config.runtimeCap",
      `must be one of ${ALLOWED_RUNTIME_CAPS.join(", ")}; got ${String(config.runtimeCap)}`,
    );
  }

  if (config.hdrMode !== undefined && !ALLOWED_HDR_MODES.includes(config.hdrMode)) {
    // `force-hdr` is rejected here on top of the producer's plan-stage
    // rejection — it makes the typical typo (`"force-hdr"` from a copy-
    // paste of in-process config) surface synchronously instead of as a
    // typed Step Functions failure two minutes in.
    throw new InvalidConfigError(
      "config.hdrMode",
      `distributed mode supports only ${ALLOWED_HDR_MODES.join(", ")}; got ${String(config.hdrMode)}`,
    );
  }

  return config;
}

function validateIntDimension(field: string, value: unknown): void {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new InvalidConfigError(field, `must be an integer; got ${String(value)}`);
  }
  if (value < MIN_DIMENSION || value > MAX_DIMENSION) {
    throw new InvalidConfigError(
      field,
      `must be in [${MIN_DIMENSION}, ${MAX_DIMENSION}]; got ${value}`,
    );
  }
  if (value % 2 !== 0) {
    // libx264 / libx265 yuv420p require even dimensions; rejecting now
    // beats a Plan-stage ffmpeg crash on dimension parity.
    throw new InvalidConfigError(field, `must be even (yuv420p constraint); got ${value}`);
  }
}
