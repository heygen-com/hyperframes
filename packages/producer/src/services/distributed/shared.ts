/**
 * Helpers shared between the distributed activity scripts (`plan.ts`,
 * `renderChunk.ts`, `assemble.ts`). Kept module-local so the public surface
 * stays just the three activity functions plus their result types.
 */

import { execFile as execFileCallback } from "node:child_process";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { type Fps } from "@hyperframes/core";
import { type VideoElement, type VideoFrameFormat, type VideoMetadata } from "@hyperframes/engine";
import { type RenderConfig, type RenderJob, createRenderJob } from "../renderOrchestrator.js";
import { defaultLogger, type ProducerLogger } from "../../logger.js";

/**
 * Output container formats the distributed pipeline supports end-to-end.
 * Single source of truth for the format union — `plan()`, `renderChunk()`,
 * `assemble()`, the aws-lambda handler, and the harness all derive from
 * this type. Adding a new format starts here.
 */
export type DistributedFormat = "mp4" | "mov" | "png-sequence" | "webm";

/**
 * Filename of the per-video extraction manifest written by `plan()` into
 * `<planDir>/meta/` and consumed by `renderChunk()` to rebuild the
 * BeforeCaptureHook that injects pre-extracted frames into the page.
 * Absence is fine — compositions with no `<video>` elements never
 * produce the file.
 */
export const PLAN_VIDEOS_META_RELATIVE_PATH = "meta/videos.json";

/**
 * Relative path of the normalized audio artifact written into a distributed
 * plan. Keep writers and transport readers coupled through this contract
 * rather than duplicating a filename literal.
 */
export const PLAN_AUDIO_RELATIVE_PATH = "audio.aac";

/**
 * On-disk shape of `<planDir>/meta/videos.json`. The engine's
 * `ExtractedFrames` shape carries an absolute `outputDir`, a `framePaths`
 * Map, and potentially an open file descriptor — none of those survive
 * a serialize → re-deserialize round trip across processes. The
 * serialized form keeps only what plan-time produced; `renderChunk` re-
 * derives `outputDir` (always `<planDir>/video-frames/<videoId>`) and
 * `framePaths` (re-listed from that directory) when reconstructing the
 * `FrameLookupTable`.
 */
export interface PlanVideosJson {
  videos: VideoElement[];
  extracted: Array<{
    videoId: string;
    srcPath: string;
    framePattern: string;
    fps: number;
    totalFrames: number;
    metadata: VideoMetadata;
  }>;
}

export const INVALID_VIDEO_METADATA = "INVALID_VIDEO_METADATA" as const;

/**
 * Typed failure for the cross-process `meta/videos.json` contract.
 *
 * Plan v1 and Plan v2 share this metadata. Keeping the validation error in
 * this storage-neutral module lets the v1 chunk reader fail closed while the
 * v2 converter can wrap it in its own integrity-error contract.
 */
export class PlanVideosMetadataError extends Error {
  // Read by cloud adapters across the package boundary to classify retries.
  // fallow-ignore-next-line unused-class-member
  readonly code = INVALID_VIDEO_METADATA;

  constructor(message: string) {
    super(message);
    this.name = "PlanVideosMetadataError";
  }
}

function metadataError(field: string, expectation: string): never {
  throw new PlanVideosMetadataError(`${field} ${expectation}`);
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    metadataError(field, "must be an object");
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    metadataError(field, "must be a non-empty string");
  }
  return value;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    metadataError(field, "must be a string");
  }
  return value;
}

function readFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    metadataError(field, "must be a finite number");
  }
  return value;
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    metadataError(field, "must be boolean");
  }
  return value;
}

function readPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    metadataError(field, "must be a positive integer");
  }
  return value;
}

function readNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    metadataError(field, "must be a non-negative integer");
  }
  return value;
}

function readVideoMetadata(
  value: unknown,
  field: string,
): PlanVideosJson["extracted"][number]["metadata"] {
  const record = readRecord(value, field);
  let colorSpace: PlanVideosJson["extracted"][number]["metadata"]["colorSpace"] = null;
  if (record.colorSpace !== null) {
    const color = readRecord(record.colorSpace, `${field}.colorSpace`);
    colorSpace = {
      colorTransfer: readString(color.colorTransfer, `${field}.colorSpace.colorTransfer`),
      colorPrimaries: readString(color.colorPrimaries, `${field}.colorSpace.colorPrimaries`),
      colorSpace: readString(color.colorSpace, `${field}.colorSpace.colorSpace`),
    };
  }
  return {
    durationSeconds: readFiniteNumber(record.durationSeconds, `${field}.durationSeconds`),
    videoStreamDurationSeconds: readFiniteNumber(
      record.videoStreamDurationSeconds,
      `${field}.videoStreamDurationSeconds`,
    ),
    // Plans written before stream-start metadata existed implicitly used the
    // overwhelmingly common start-at-zero domain. Preserve that compatibility
    // while carrying non-zero edit-list/transport timestamps in new plans.
    videoStreamStartSeconds:
      record.videoStreamStartSeconds === undefined
        ? 0
        : readFiniteNumber(record.videoStreamStartSeconds, `${field}.videoStreamStartSeconds`),
    width: readPositiveInteger(record.width, `${field}.width`),
    height: readPositiveInteger(record.height, `${field}.height`),
    fps: readFiniteNumber(record.fps, `${field}.fps`),
    videoCodec: readNonEmptyString(record.videoCodec, `${field}.videoCodec`),
    hasAudio: readBoolean(record.hasAudio, `${field}.hasAudio`),
    isVFR: readBoolean(record.isVFR, `${field}.isVFR`),
    hasAlpha: readBoolean(record.hasAlpha, `${field}.hasAlpha`),
    colorSpace,
  };
}

/**
 * Parse the untrusted on-disk `meta/videos.json` shape used by both plan
 * protocols. In addition to field types, require a one-to-one relationship
 * between declared videos and extracted-frame metadata: a distributed render
 * cannot safely fall back to native remote video decoding when extraction
 * failed on the planner.
 */
export function parsePlanVideosJson(value: unknown): PlanVideosJson {
  const record = readRecord(value, "meta/videos.json");
  if (!Array.isArray(record.videos) || !Array.isArray(record.extracted)) {
    metadataError("meta/videos.json", "must contain videos and extracted arrays");
  }

  const videos = record.videos.map((value, index) => {
    const field = `meta/videos.json.videos[${index}]`;
    const video = readRecord(value, field);
    return {
      id: readNonEmptyString(video.id, `${field}.id`),
      src: readNonEmptyString(video.src, `${field}.src`),
      start: readFiniteNumber(video.start, `${field}.start`),
      end: readFiniteNumber(video.end, `${field}.end`),
      mediaStart: readFiniteNumber(video.mediaStart, `${field}.mediaStart`),
      loop: readBoolean(video.loop, `${field}.loop`),
      hasAudio: readBoolean(video.hasAudio, `${field}.hasAudio`),
    };
  });

  const extracted = record.extracted.map((value, index) => {
    const field = `meta/videos.json.extracted[${index}]`;
    const entry = readRecord(value, field);
    return {
      videoId: readNonEmptyString(entry.videoId, `${field}.videoId`),
      srcPath: readNonEmptyString(entry.srcPath, `${field}.srcPath`),
      framePattern: readNonEmptyString(entry.framePattern, `${field}.framePattern`),
      fps: readFiniteNumber(entry.fps, `${field}.fps`),
      totalFrames: readNonNegativeInteger(entry.totalFrames, `${field}.totalFrames`),
      metadata: readVideoMetadata(entry.metadata, `${field}.metadata`),
    };
  });

  const videoIds = new Set<string>();
  for (const video of videos) {
    if (videoIds.has(video.id)) {
      metadataError("meta/videos.json.videos", `contains duplicate id ${JSON.stringify(video.id)}`);
    }
    videoIds.add(video.id);
  }
  const extractedIds = new Set<string>();
  for (const entry of extracted) {
    if (extractedIds.has(entry.videoId)) {
      metadataError(
        "meta/videos.json.extracted",
        `contains duplicate videoId ${JSON.stringify(entry.videoId)}`,
      );
    }
    extractedIds.add(entry.videoId);
    if (!videoIds.has(entry.videoId)) {
      metadataError(
        "meta/videos.json.extracted",
        `references undeclared video ${JSON.stringify(entry.videoId)}`,
      );
    }
  }
  for (const video of videos) {
    if (!extractedIds.has(video.id)) {
      metadataError(
        "meta/videos.json.extracted",
        `is missing declared video ${JSON.stringify(video.id)}`,
      );
    }
  }

  return { videos, extracted };
}

/**
 * Build the shared v1/v2 video metadata contract.
 *
 * Successful extraction normally replaces an open-ended video's `Infinity`
 * with its finite natural source end. If duration probing/extraction could not
 * derive that natural end, the last safe timing boundary is the already
 * validated composition end. Authored finite ends are copied unchanged.
 */
export function buildPlanVideosJson(input: {
  videos: readonly VideoElement[];
  extracted: PlanVideosJson["extracted"];
  compositionEnd: number;
}): PlanVideosJson {
  const videos = input.videos.map((video, index) => {
    if (Number.isFinite(video.end)) return { ...video };
    if (
      !Number.isFinite(input.compositionEnd) ||
      input.compositionEnd <= 0 ||
      input.compositionEnd <= video.start
    ) {
      metadataError(
        `meta/videos.json.videos[${index}].end`,
        "cannot be resolved without a finite composition end after its start",
      );
    }
    return { ...video, end: input.compositionEnd };
  });
  return parsePlanVideosJson({ videos, extracted: input.extracted });
}

const execFile = promisify(execFileCallback);

/**
 * Cached first line of `ffmpeg -version` (e.g. `"ffmpeg version 6.1.1"`).
 * Cached because workers that fan out multiple `renderChunk()` calls in the
 * same process (Cloud Run Jobs, Temporal activity workers) would otherwise
 * spawn ffmpeg once per chunk just to read the version — ~20-50ms each.
 */
let cachedFfmpegVersion: string | null = null;

/**
 * Read `ffmpeg -version` first line. The string is opaque — `planHash`
 * mixes it in verbatim, so any drift across worker hosts trips a
 * `FFMPEG_VERSION_MISMATCH` rather than producing pixels that subtly
 * disagree with the plan's baked-in encoder args.
 */
export async function readFfmpegVersion(): Promise<string> {
  if (cachedFfmpegVersion !== null) return cachedFfmpegVersion;
  const { stdout } = await execFile("ffmpeg", ["-version"], { maxBuffer: 1024 * 1024 });
  const firstLine = stdout.split(/\r?\n/)[0]?.trim() ?? "";
  if (!firstLine) {
    throw new Error("ffmpeg -version returned empty output");
  }
  cachedFfmpegVersion = firstLine;
  return firstLine;
}

/** Test-only: clear the cached ffmpeg version so a fresh probe runs. */
function _resetFfmpegVersionCacheForTests(): void {
  cachedFfmpegVersion = null;
}

/**
 * Inputs for {@link buildSyntheticRenderJob}. The two distributed activity
 * scripts (`plan.ts`, `renderChunk.ts`) reach for slightly different
 * sources — caller config vs. frozen `LockedRenderConfig` — but the
 * resulting `RenderJob` shape is identical, so the helper accepts both.
 */
export interface SyntheticRenderJobInput {
  fps: Fps;
  format: RenderConfig["format"];
  quality: RenderConfig["quality"];
  crf?: number;
  bitrate?: string;
  videoFrameFormat?: VideoFrameFormat;
  outputResolution?: RenderConfig["outputResolution"];
  outputResolutionAspectAgnostic?: RenderConfig["outputResolutionAspectAgnostic"];
  hdrMode: RenderConfig["hdrMode"];
  strictness?: RenderConfig["strictness"];
  entryFile: string;
  logger?: ProducerLogger;
  producerConfig?: RenderConfig["producerConfig"];
  /** Render-time overrides consumed by the plan browser probe. */
  variables?: RenderConfig["variables"];
}

/**
 * Synthesize a `RenderJob` from a distributed-render config. The distributed
 * activities operate without a full `RenderJob` (they're stateless workers),
 * so we build one to feed the existing stage interfaces.
 */
export function buildSyntheticRenderJob(input: SyntheticRenderJobInput): RenderJob {
  const renderConfig: RenderConfig = {
    fps: input.fps,
    quality: input.quality,
    format: input.format,
    crf: input.crf,
    videoBitrate: input.bitrate,
    videoFrameFormat: input.videoFrameFormat,
    outputResolution: input.outputResolution,
    outputResolutionAspectAgnostic: input.outputResolutionAspectAgnostic,
    // Distributed mode hard-pins to software GPU. The plan-time validator
    // refuses to fan out otherwise.
    useGpu: false,
    debug: false,
    entryFile: input.entryFile,
    logger: input.logger ?? defaultLogger,
    hdrMode: input.hdrMode,
    strictness: input.strictness,
    producerConfig: input.producerConfig,
    variables: input.variables,
  };
  return createRenderJob(renderConfig);
}

/**
 * Resolve the producer package version by walking up from the calling
 * module until a `package.json` whose `name === "@hyperframes/producer"`
 * is found. Works for both the bundled `dist/index.js` (1 level up) and
 * the unbundled source tree (4 levels up).
 *
 * Cached at module load — the version is fixed for the life of the process,
 * and reading the package.json over and over wastes per-chunk syscalls.
 */
let cachedProducerVersion: string | null = null;
export function readProducerVersion(): string {
  if (cachedProducerVersion !== null) return cachedProducerVersion;
  const startDir = dirname(fileURLToPath(import.meta.url));
  let current = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(current, "package.json");
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === "@hyperframes/producer" && typeof pkg.version === "string") {
          cachedProducerVersion = pkg.version;
          return pkg.version;
        }
      } catch {
        // Fall through to the next ancestor.
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  cachedProducerVersion = "0.0.0-unknown";
  return cachedProducerVersion;
}
