/**
 * Cloud-agnostic validation of a serializable `DistributedRenderConfig`.
 *
 * The distributed-render adapters (`@hyperframes/aws-lambda`,
 * `@hyperframes/gcp-cloud-run`, …) all need to fail fast on shape errors
 * *before* they start a cloud execution — a caller staring at a runtime
 * failure minutes into a Step Functions / Cloud Workflows run shouldn't have
 * to dig through execution history to learn they passed an unsupported
 * format. The shape validation is identical across adapters, so it lives
 * here; each adapter layers only its own wire-format size cap (Step
 * Functions' 256 KiB vs Cloud Workflows' 512 KiB) on top.
 *
 * The check is deliberately narrow — it covers the *shape* errors any caller
 * could have surfaced with `tsc` if they passed a literal, plus the
 * `force-hdr` rejection (HDR mp4 isn't supported in distributed mode).
 * Anything deeper (font availability, plan size cap, GPU mode at runtime)
 * needs the actual planner.
 */

import { type DistributedFormat } from "./shared.js";
import { type DistributedRenderConfig } from "./plan.js";

/**
 * `DistributedRenderConfig` minus the runtime-only fields (`logger`,
 * `abortSignal`, `producerConfig`) that can't cross a JSON wire boundary.
 * The shape adapters serialize into their execution input.
 */
export type SerializableDistributedRenderConfig = Omit<
  DistributedRenderConfig,
  "logger" | "abortSignal" | "producerConfig"
>;

/** Thrown for any client-side `SerializableDistributedRenderConfig` violation. */
export class InvalidConfigError extends Error {
  // Read via Error.prototype.toString; fallow can't see it.
  // fallow-ignore-next-line unused-class-member
  override readonly name = "InvalidConfigError";
  /** Dotted JSON-pointer-ish path to the offending field, e.g. `config.fps`. */
  readonly field: string;
  constructor(field: string, message: string) {
    super(`[validateConfig] ${field}: ${message}`);
    this.field = field;
  }
}

const ALLOWED_FPS = [24, 30, 60] as const;
const ALLOWED_FORMATS = [
  "mp4",
  "mov",
  "png-sequence",
  "webm",
] as const satisfies readonly DistributedFormat[];
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
// fallow-ignore-next-line complexity
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
        `must be <= ${MAX_CHUNK_SIZE}; got ${config.chunkSize}`,
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
        `must be <= ${MAX_PARALLEL_CHUNKS_CEILING}; got ${config.maxParallelChunks}`,
      );
    }
  }

  if (config.targetChunkFrames !== undefined) {
    if (!Number.isInteger(config.targetChunkFrames) || config.targetChunkFrames < 1) {
      throw new InvalidConfigError(
        "config.targetChunkFrames",
        `must be a positive integer; got ${config.targetChunkFrames}`,
      );
    }
    if (config.targetChunkFrames > MAX_CHUNK_SIZE) {
      throw new InvalidConfigError(
        "config.targetChunkFrames",
        `must be <= ${MAX_CHUNK_SIZE}; got ${config.targetChunkFrames}`,
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
    // `force-hdr` is rejected on top of the producer's plan-stage rejection —
    // it makes the typical typo (`"force-hdr"` copy-pasted from in-process
    // config) surface synchronously instead of as a typed failure minutes in.
    throw new InvalidConfigError(
      "config.hdrMode",
      `distributed mode supports only ${ALLOWED_HDR_MODES.join(", ")}; got ${String(config.hdrMode)}`,
    );
  }

  if (config.variables !== undefined) {
    validateVariablesPayload(config.variables);
  }

  return config;
}

/**
 * Validate that `variables` is a plain JSON-safe object — no functions,
 * Symbols, `undefined` leaves, BigInts, non-finite numbers, or non-plain
 * objects (Dates, Maps, Sets, class instances). Rejected values would either
 * round-trip incorrectly through the execution input (`undefined` is silently
 * dropped by `JSON.stringify`) or throw at the wire boundary (`bigint`), so
 * we surface the offending path synchronously.
 *
 * The check is purely structural — semantic constraints (e.g. "is this
 * variable declared in `data-composition-variables`?") belong to the CLI
 * layer where the project's HTML is on disk.
 */
export function validateVariablesPayload(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidConfigError(
      "config.variables",
      `must be a plain JSON object (got ${describeValue(value)})`,
    );
  }
  walkVariables(value, "config.variables", new WeakSet());
}

/** Per-typeof rejection messages for JSON-unsafe leaves. */
const LEAF_REJECTIONS: Partial<Record<string, string>> = {
  undefined:
    "undefined leaves are silently dropped by JSON.stringify — use null if you mean an absent value",
  function: "functions are not JSON-serializable",
  symbol: "Symbols are not JSON-serializable",
  bigint: "BigInt values throw at JSON.stringify — encode as a string if you need 64-bit integers",
};

// fallow-ignore-next-line complexity
function walkVariables(value: unknown, path: string, seen: WeakSet<object>): void {
  const t = typeof value;
  if (value === null || t === "string" || t === "boolean") return;
  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new InvalidConfigError(
        path,
        `non-finite numbers (NaN / Infinity) are not JSON-serializable; got ${String(value)}`,
      );
    }
    return;
  }
  const leafReject = LEAF_REJECTIONS[t];
  if (leafReject !== undefined) {
    throw new InvalidConfigError(path, leafReject);
  }
  // t === "object" from here on. Reject circular refs up front — recursing
  // through a back-edge would stack-overflow with no actionable error.
  if (seen.has(value as object)) {
    throw new InvalidConfigError(
      path,
      "circular reference detected — JSON.stringify cannot serialize cycles",
    );
  }
  seen.add(value as object);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walkVariables(value[i], `${path}[${i}]`, seen);
    }
    return;
  }
  // Reject non-plain objects (Date, Map, Set, class instances) up front.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new InvalidConfigError(
      path,
      `non-plain objects are not supported (got ${describeValue(value)}); use a plain {…} object`,
    );
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    walkVariables((value as Record<string, unknown>)[key], `${path}.${key}`, seen);
  }
}

// fallow-ignore-next-line complexity
function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value !== "object") return typeof value;
  const ctorName = (value as { constructor?: { name?: string } }).constructor?.name ?? "Object";
  return ctorName === "Object" ? "object" : ctorName;
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
    // libx264 / libx265 yuv420p require even dimensions; rejecting now beats a
    // Plan-stage ffmpeg crash on dimension parity.
    throw new InvalidConfigError(field, `must be even (yuv420p constraint); got ${value}`);
  }
}
