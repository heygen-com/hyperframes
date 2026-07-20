import {
  isVideoFrameFormat,
  resolveConfig,
  validateEngineConfigSnapshot,
  type EngineConfig,
  type VideoFrameFormat,
} from "@hyperframes/engine";
import { VALID_CANVAS_RESOLUTIONS, type CanvasResolution, type Fps } from "@hyperframes/core";
import type { ProducerLogger } from "./logger.js";
import type { RenderConfig } from "./services/renderOrchestrator.js";
import type { DistributedRenderConfig } from "./services/distributed/plan.js";
import {
  validateDistributedRenderConfig,
  validateJsonSafeValue,
  type SerializableDistributedRenderConfig,
} from "./services/distributed/renderConfigValidation.js";

export const RENDER_REQUEST_VERSION = 1 as const;

export interface DistributedRenderOptions {
  width: number;
  height: number;
  codec?: "h264" | "h265";
  chunkSize?: number;
  maxParallelChunks?: number;
  targetChunkFrames?: number;
  runtimeCap?: DistributedRenderConfig["runtimeCap"];
  rejectOnSystemFonts?: boolean;
  failClosedFontFetch?: boolean;
  cfr?: boolean;
  planDirSizeLimitBytes?: number;
}

/** JSON-safe render intent shared by local, Docker, server and cloud adapters. */
export interface RenderRequestOptions {
  fps: Fps;
  quality: "draft" | "standard" | "high";
  format: NonNullable<RenderConfig["format"]>;
  gifLoop?: number;
  workers?: number;
  useGpu?: boolean;
  debug?: boolean;
  strictness?: RenderConfig["strictness"];
  entryFile?: string;
  crf?: number;
  videoBitrate?: string;
  videoFrameFormat?: VideoFrameFormat;
  hdrMode?: RenderConfig["hdrMode"];
  variables?: Record<string, unknown>;
  outputResolution?: CanvasResolution;
  outputResolutionAspectAgnostic?: boolean;
  engineConfig: EngineConfig;
  distributed?: DistributedRenderOptions;
}

export interface RenderRequest {
  version: typeof RENDER_REQUEST_VERSION;
  projectDir: string;
  outputPath: string;
  options: RenderRequestOptions;
}

export interface CreateRenderRequestInput {
  projectDir: string;
  outputPath: string;
  options: Omit<RenderRequestOptions, "engineConfig">;
  engineConfig?: EngineConfig;
  engineOverrides?: Partial<EngineConfig>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertPositiveFps(options: Record<string, unknown>): void {
  const fps = options.fps;
  if (
    !isPlainObject(fps) ||
    typeof fps.num !== "number" ||
    typeof fps.den !== "number" ||
    !Number.isInteger(fps.num) ||
    !Number.isInteger(fps.den) ||
    fps.num <= 0 ||
    fps.den <= 0
  ) {
    throw new Error("Render request fps must be a positive rational");
  }
}

function assertOptionalBoolean(options: Record<string, unknown>, field: string): void {
  if (options[field] !== undefined && typeof options[field] !== "boolean") {
    throw new Error(`Render request ${field} must be a boolean`);
  }
}

function assertOptionalInteger(options: Record<string, unknown>, field: string, min = 0): void {
  const value = options[field];
  if (
    value !== undefined &&
    (typeof value !== "number" || !Number.isInteger(value) || value < min)
  ) {
    throw new Error(`Render request ${field} must be an integer >= ${min}`);
  }
}

function assertOptionalString(options: Record<string, unknown>, field: string): void {
  if (options[field] !== undefined && typeof options[field] !== "string") {
    throw new Error(`Render request ${field} must be a string`);
  }
}

function assertOptionalEnum(
  options: Record<string, unknown>,
  field: string,
  allowed: readonly string[],
): void {
  const value = options[field];
  if (value !== undefined && (typeof value !== "string" || !allowed.includes(value))) {
    throw new Error(`Render request ${field} is invalid`);
  }
}

function isCanvasResolution(value: unknown): value is CanvasResolution {
  return (
    typeof value === "string" && VALID_CANVAS_RESOLUTIONS.some((resolution) => resolution === value)
  );
}

function assertDistributedOptions(value: unknown): void {
  if (!isPlainObject(value)) throw new Error("Render request distributed must be an object");
  for (const field of ["width", "height"] as const) {
    if (typeof value[field] !== "number" || !Number.isInteger(value[field]) || value[field] <= 0) {
      throw new Error(`Render request distributed.${field} must be a positive integer`);
    }
  }
  assertOptionalEnum(value, "codec", ["h264", "h265"]);
  for (const field of [
    "chunkSize",
    "maxParallelChunks",
    "targetChunkFrames",
    "planDirSizeLimitBytes",
  ] as const) {
    assertOptionalInteger(value, field, 1);
  }
  assertOptionalEnum(value, "runtimeCap", [
    "lambda",
    "temporal",
    "cloud-run-job",
    "k8s-job",
    "none",
  ]);
  for (const field of ["rejectOnSystemFonts", "failClosedFontFetch", "cfr"] as const) {
    assertOptionalBoolean(value, field);
  }
}

function assertRequestOptionScalars(options: Record<string, unknown>): void {
  assertOptionalInteger(options, "gifLoop");
  assertOptionalInteger(options, "workers", 1);
  assertOptionalInteger(options, "crf");
  for (const field of ["useGpu", "debug", "outputResolutionAspectAgnostic"] as const) {
    assertOptionalBoolean(options, field);
  }
  for (const field of ["entryFile", "videoBitrate"] as const) {
    assertOptionalString(options, field);
  }
  assertOptionalEnum(options, "strictness", ["strict", "best-effort"]);
  assertOptionalEnum(options, "hdrMode", ["auto", "force-hdr", "force-sdr"]);
  if (options.videoFrameFormat !== undefined && !isVideoFrameFormat(options.videoFrameFormat)) {
    throw new Error("Render request videoFrameFormat is invalid");
  }
  if (options.outputResolution !== undefined && !isCanvasResolution(options.outputResolution)) {
    throw new Error("Render request outputResolution is invalid");
  }
}

function assertRequestOptionObjects(options: Record<string, unknown>): void {
  validateEngineConfigSnapshot(options.engineConfig);
  if (options.variables !== undefined && !isPlainObject(options.variables)) {
    throw new Error("Render request variables must be a JSON object");
  }
  if (options.distributed !== undefined) assertDistributedOptions(options.distributed);
}

function assertRequestOptions(options: unknown): asserts options is RenderRequestOptions {
  if (!isPlainObject(options)) throw new Error("Render request options must be an object");
  assertPositiveFps(options);
  if (!["draft", "standard", "high"].includes(String(options.quality))) {
    throw new Error("Render request quality is invalid");
  }
  if (!["mp4", "webm", "mov", "png-sequence", "gif"].includes(String(options.format))) {
    throw new Error("Render request format is invalid");
  }
  assertRequestOptionScalars(options);
  assertRequestOptionObjects(options);
}

function assertNonEmptyPath(value: unknown, field: "projectDir" | "outputPath"): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Render request ${field} must be a non-empty string`);
  }
}

function omitUndefinedProperties<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function assertRenderRequest(value: unknown): asserts value is RenderRequest {
  if (!isPlainObject(value) || value.version !== RENDER_REQUEST_VERSION) {
    const version = isPlainObject(value) ? value.version : undefined;
    throw new Error(`Unsupported render request version: ${String(version)}`);
  }
  assertNonEmptyPath(value.projectDir, "projectDir");
  assertNonEmptyPath(value.outputPath, "outputPath");
  assertRequestOptions(value.options);
  validateJsonSafeValue(value, "renderRequest");
}

export function parseRenderRequest(serialized: string | unknown): RenderRequest {
  const value = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
  assertRenderRequest(value);
  return value;
}

export function serializeRenderRequest(request: RenderRequest): string {
  assertRenderRequest(request);
  return JSON.stringify(request);
}

export function createRenderRequest(input: CreateRenderRequestInput): RenderRequest {
  const request = {
    version: RENDER_REQUEST_VERSION,
    projectDir: input.projectDir,
    outputPath: input.outputPath,
    options: {
      ...omitUndefinedProperties(input.options),
      engineConfig: input.engineConfig ?? resolveConfig(input.engineOverrides),
    },
  } satisfies RenderRequest;
  // Validate before serialization so JSON never silently drops or normalizes
  // caller data at this boundary, then detach it for asynchronous adapters.
  return parseRenderRequest(serializeRenderRequest(request));
}

export function renderConfigFromRequest(
  request: RenderRequest,
  runtime: { logger?: ProducerLogger } = {},
): RenderConfig {
  const { engineConfig, distributed: _distributed, ...options } = request.options;
  return {
    ...options,
    producerConfig: engineConfig,
    logger: runtime.logger,
  };
}

function distributedFps(fps: Fps): 24 | 30 | 60 {
  if (fps.den === 1 && (fps.num === 24 || fps.num === 30 || fps.num === 60)) return fps.num;
  throw new Error(`Distributed render does not support fps ${fps.num}/${fps.den}`);
}

export function distributedConfigFromRequest(
  request: RenderRequest,
  runtime: { logger?: ProducerLogger; abortSignal?: AbortSignal } = {},
): DistributedRenderConfig {
  const options = request.options;
  const distributed = options.distributed;
  if (!distributed) throw new Error("Render request is missing distributed options");
  if (options.format === "gif") throw new Error("Distributed render does not support gif");
  if (options.hdrMode === "force-hdr") {
    throw new Error("Distributed render does not support force-hdr");
  }
  return {
    fps: distributedFps(options.fps),
    width: distributed.width,
    height: distributed.height,
    format: options.format,
    codec: distributed.codec,
    quality: options.quality,
    crf: options.crf,
    bitrate: options.videoBitrate,
    videoFrameFormat: options.videoFrameFormat,
    outputResolution: options.outputResolution,
    outputResolutionAspectAgnostic: options.outputResolutionAspectAgnostic,
    chunkSize: distributed.chunkSize,
    maxParallelChunks: distributed.maxParallelChunks,
    targetChunkFrames: distributed.targetChunkFrames,
    runtimeCap: distributed.runtimeCap,
    rejectOnSystemFonts: distributed.rejectOnSystemFonts,
    failClosedFontFetch: distributed.failClosedFontFetch,
    hdrMode: options.hdrMode === "auto" ? "auto" : "force-sdr",
    cfr: distributed.cfr,
    logger: runtime.logger,
    engineConfig: options.engineConfig,
    entryFile: options.entryFile,
    strictness: options.strictness,
    abortSignal: runtime.abortSignal,
    planDirSizeLimitBytes: distributed.planDirSizeLimitBytes,
    variables: options.variables,
  };
}

function optionalProperty<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}

export function renderRequestFromDistributedConfig(input: {
  projectDir: string;
  outputPath: string;
  config: SerializableDistributedRenderConfig;
}): RenderRequest {
  const { config } = input;
  validateDistributedRenderConfig(config);
  const distributed = {
    width: config.width,
    height: config.height,
    ...optionalProperty("codec", config.codec),
    ...optionalProperty("chunkSize", config.chunkSize),
    ...optionalProperty("maxParallelChunks", config.maxParallelChunks),
    ...optionalProperty("targetChunkFrames", config.targetChunkFrames),
    ...optionalProperty("runtimeCap", config.runtimeCap),
    ...optionalProperty("rejectOnSystemFonts", config.rejectOnSystemFonts),
    ...optionalProperty("failClosedFontFetch", config.failClosedFontFetch),
    ...optionalProperty("cfr", config.cfr),
    ...optionalProperty("planDirSizeLimitBytes", config.planDirSizeLimitBytes),
  } satisfies DistributedRenderOptions;
  const options = {
    fps: { num: config.fps, den: 1 },
    quality: config.quality ?? "standard",
    format: config.format,
    distributed,
    ...optionalProperty("crf", config.crf),
    ...optionalProperty("videoBitrate", config.bitrate),
    ...optionalProperty("videoFrameFormat", config.videoFrameFormat),
    ...optionalProperty("outputResolution", config.outputResolution),
    ...optionalProperty("outputResolutionAspectAgnostic", config.outputResolutionAspectAgnostic),
    ...optionalProperty("hdrMode", config.hdrMode),
    ...optionalProperty("strictness", config.strictness),
    ...optionalProperty("entryFile", config.entryFile),
    ...optionalProperty("variables", config.variables),
  } satisfies CreateRenderRequestInput["options"];
  return createRenderRequest({
    projectDir: input.projectDir,
    outputPath: input.outputPath,
    engineConfig: config.engineConfig ?? resolveConfig(),
    options,
  });
}
