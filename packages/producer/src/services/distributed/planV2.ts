/**
 * Content-addressed distributed plan transport.
 *
 * V2 deliberately separates transport from execution. The transport root is
 * a small immutable `plan.json` manifest plus sha256-addressed blobs. Workers
 * select and materialize only the dependencies for their role, then invoke
 * the existing v1 execution functions on the verified local layout.
 *
 * Video-frame dependencies are derived by evaluating the engine's own
 * FrameLookupTable at every captured global frame. If legacy video metadata
 * is absent, v2 explicitly falls back to the full-source pack.
 */

import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createFrameLookupTable, type ExtractedFrames } from "@hyperframes/engine";
import { recomputePlanHashFromPlanDir, type ChunkSliceJson } from "../render/stages/freezePlan.js";
import { canonicalJsonStringify, sha256Hex } from "../render/stages/planHash.js";
import { type DistributedRenderConfig, plan } from "./plan.js";
import {
  PLAN_PROTOCOL_V2,
  readPlanProtocolV1,
  type PlanProtocolV2Descriptor,
} from "./planProtocol.js";
import {
  LocalPlanV2ArtifactPublisher,
  type PlanV2ArtifactPublisher,
  type PlanV2PublishBlob,
} from "./planV2Publisher.js";
import { PLAN_V2_INTEGRITY_UNRECOVERABLE, PlanV2IntegrityError } from "./planV2Errors.js";
import { planV2BlobPath } from "./planV2Layout.js";
import {
  PLAN_AUDIO_RELATIVE_PATH,
  PLAN_VIDEOS_META_RELATIVE_PATH,
  type DistributedFormat,
  type PlanVideosJson,
} from "./shared.js";

const PLAN_V2_HASH_PREFIX = "hyperframes-plan-manifest-hash-v2\x00";
export const PLAN_V2_MATERIALIZATION_MARKER = ".hyperframes-plan-v2.json";
export { PLAN_V2_INTEGRITY_UNRECOVERABLE, PlanV2IntegrityError };

export type PlanV2MaterializationTarget =
  | Readonly<{ role: "chunk"; chunkIndex: number }>
  | Readonly<{ role: "assembler" }>;

export interface PlanV2Artifact {
  /** POSIX path in the materialized v1 execution directory. */
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  /** Chunk indexes that need this artifact, or `"all"` for shared dependencies. */
  readonly chunks: "all" | readonly number[];
  readonly assembler: boolean;
}

export interface PlanV2Manifest {
  readonly protocol: Readonly<PlanProtocolV2Descriptor>;
  /** V2 manifest digest; intentionally distinct from the v1 execution hash. */
  readonly planHash: string;
  /** Original execution-plan hash retained for output/replay correlation. */
  readonly sourcePlanV1Hash: string;
  readonly chunkCount: number;
  readonly totalFrames: number;
  readonly fps: 24 | 30 | 60;
  readonly width: number;
  readonly height: number;
  readonly format: DistributedFormat;
  readonly ffmpegVersion: string;
  readonly producerVersion: string;
  readonly limitations: Readonly<PlanV2Limitations>;
  readonly artifacts: readonly Readonly<PlanV2Artifact>[];
}

export interface PlanV2Limitations {
  readonly videoDependencyMode: "exact-rendered-frames" | "full-source-pack";
}

export interface PlanV2Result {
  readonly planDir: string;
  readonly manifestPath: string;
  readonly planProtocol: Readonly<PlanProtocolV2Descriptor>;
  readonly planHash: string;
  readonly sourcePlanV1Hash: string;
  readonly chunkCount: number;
  readonly totalFrames: number;
  readonly fps: 24 | 30 | 60;
  readonly width: number;
  readonly height: number;
  readonly format: DistributedFormat;
  readonly ffmpegVersion: string;
  readonly producerVersion: string;
  readonly limitations: Readonly<PlanV2Limitations>;
}

export interface PlanV2WithPublisherOptions {
  /**
   * Parent for the planner-private v1 staging directory. Remote adapters
   * normally leave this unset and use the OS temp directory. The local
   * compatibility wrapper keeps staging beside its destination so hard links
   * can avoid a second set of data blocks.
   */
  readonly stagingParentDir?: string;
}

export interface PlanV2MaterializationResult {
  readonly planDir: string;
  readonly target: PlanV2MaterializationTarget;
  readonly planHash: string;
  readonly sourcePlanV1Hash: string;
  readonly artifactCount: number;
  readonly sizeBytes: number;
  readonly audioPath: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isNonNegativeIntegerArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "number" && Number.isInteger(item) && item >= 0)
  );
}

function readJsonFile(path: string, label: string): unknown {
  const contents = readFileSync(path, "utf-8");
  try {
    const parsed: unknown = JSON.parse(contents);
    return parsed;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PlanV2IntegrityError(`${label} is not readable JSON: ${detail}`);
  }
}

function assertSafeRelativePath(path: string): void {
  const normalized = path.split(/[\\/]+/);
  if (
    path.length === 0 ||
    isAbsolute(path) ||
    normalized.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new PlanV2IntegrityError(`unsafe artifact path: ${JSON.stringify(path)}`);
  }
}

function listFiles(root: string): Array<{ path: string; absolutePath: string }> {
  const files: Array<{ path: string; absolutePath: string }> = [];
  const rootResolved = resolve(root);
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.isFile()) {
        files.push({
          path: relative(rootResolved, absolutePath).split(sep).join("/"),
          absolutePath,
        });
      } else {
        throw new PlanV2IntegrityError(
          `unsupported filesystem entry (symlinks and special files are not allowed): ${absolutePath}`,
        );
      }
    }
  }
  walk(rootResolved);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Hash large plan artifacts with bounded memory (important above the v1 2 GiB cap). */
function sha256File(path: string): string {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  // lgtm[js/insecure-temporary-file] — read-only open of a caller-owned regular file;
  // this call never creates a file, temporary or otherwise.
  const fd = openSync(path, "r");
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(fd, buffer, 0, buffer.byteLength, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

// This is the fail-safe policy table for every v1 artifact class. Keeping the
// branches together makes new artifact classes visibly fall through to both roles.
// fallow-ignore-next-line complexity
function artifactTargets(
  path: string,
  videoDependencies: ReadonlyMap<string, readonly number[]> | null,
): Pick<PlanV2Artifact, "chunks" | "assembler"> {
  if (path === PLAN_AUDIO_RELATIVE_PATH) return { chunks: [], assembler: true };
  if (path === "plan.json" || path === "meta/chunks.json" || path === "meta/encoder.json") {
    return { chunks: "all", assembler: true };
  }
  if (
    path === "meta/composition.json" ||
    path === "meta/videos.json" ||
    path.startsWith("compiled/")
  ) {
    return { chunks: "all", assembler: false };
  }
  if (path.startsWith("video-frames/")) {
    return {
      chunks: videoDependencies === null ? "all" : (videoDependencies.get(path) ?? []),
      assembler: false,
    };
  }
  // Unknown future v1 files go to both roles. Over-including is safe;
  // silently omitting a new execution dependency is not.
  return { chunks: "all", assembler: true };
}

function listVideoFramePaths(planV1Dir: string, videos: PlanVideosJson): ExtractedFrames[] {
  return videos.extracted.map((video) => {
    const outputDir = join(planV1Dir, "video-frames", video.videoId);
    const frameNames = readdirSync(outputDir).sort();
    const framePaths = new Map<number, string>();
    for (const frameName of frameNames) {
      // ffmpeg's image sequence starts at 1. Preserve sparse indexes so a
      // materialized chunk can carry only the frames it actually requests.
      const match = /(\d+)(?=\.[^.]+$)/.exec(frameName);
      if (!match) {
        throw new PlanV2IntegrityError(`cannot derive extracted frame index from ${frameName}`);
      }
      const oneBasedFrameNumber = Number(match[1]);
      if (!Number.isSafeInteger(oneBasedFrameNumber) || oneBasedFrameNumber < 1) {
        throw new PlanV2IntegrityError(
          `extracted frame filename must use a 1-based safe integer: ${frameName}`,
        );
      }
      const frameIndex = oneBasedFrameNumber - 1;
      if (framePaths.has(frameIndex)) {
        throw new PlanV2IntegrityError(
          `duplicate extracted frame index ${frameIndex} in ${outputDir}`,
        );
      }
      framePaths.set(frameIndex, join(outputDir, frameName));
    }
    return {
      ...video,
      outputDir,
      framePaths,
      ownedByLookup: false,
    };
  });
}

function readFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PlanV2IntegrityError(`${field} must be a finite number`);
  }
  return value;
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new PlanV2IntegrityError(`${field} must be boolean`);
  }
  return value;
}

function readVideoMetadata(
  value: unknown,
  field: string,
): PlanVideosJson["extracted"][number]["metadata"] {
  if (!isRecord(value)) {
    throw new PlanV2IntegrityError(`${field} must be an object`);
  }
  let colorSpace: PlanVideosJson["extracted"][number]["metadata"]["colorSpace"] = null;
  if (value.colorSpace !== null) {
    if (!isRecord(value.colorSpace)) {
      throw new PlanV2IntegrityError(`${field}.colorSpace must be an object or null`);
    }
    colorSpace = {
      colorTransfer: readString(value.colorSpace.colorTransfer, `${field}.colorTransfer`),
      colorPrimaries: readString(value.colorSpace.colorPrimaries, `${field}.colorPrimaries`),
      colorSpace: readString(value.colorSpace.colorSpace, `${field}.colorSpace`),
    };
  }
  return {
    durationSeconds: readFiniteNumber(value.durationSeconds, `${field}.durationSeconds`),
    videoStreamDurationSeconds: readFiniteNumber(
      value.videoStreamDurationSeconds,
      `${field}.videoStreamDurationSeconds`,
    ),
    width: readPositiveInteger(value.width, `${field}.width`),
    height: readPositiveInteger(value.height, `${field}.height`),
    fps: readFiniteNumber(value.fps, `${field}.fps`),
    videoCodec: readString(value.videoCodec, `${field}.videoCodec`),
    hasAudio: readBoolean(value.hasAudio, `${field}.hasAudio`),
    isVFR: readBoolean(value.isVFR, `${field}.isVFR`),
    hasAlpha: readBoolean(value.hasAlpha, `${field}.hasAlpha`),
    colorSpace,
  };
}

function parsePlanVideosJson(value: unknown): PlanVideosJson {
  if (!isRecord(value) || !Array.isArray(value.videos) || !Array.isArray(value.extracted)) {
    throw new PlanV2IntegrityError("meta/videos.json must contain videos and extracted arrays");
  }
  const videos = value.videos.map((video, index) => {
    const field = `meta/videos.json.videos[${index}]`;
    if (!isRecord(video)) throw new PlanV2IntegrityError(`${field} must be an object`);
    return {
      id: readString(video.id, `${field}.id`),
      src: readString(video.src, `${field}.src`),
      start: readFiniteNumber(video.start, `${field}.start`),
      end: readFiniteNumber(video.end, `${field}.end`),
      mediaStart: readFiniteNumber(video.mediaStart, `${field}.mediaStart`),
      loop: readBoolean(video.loop, `${field}.loop`),
      hasAudio: readBoolean(video.hasAudio, `${field}.hasAudio`),
    };
  });
  const extracted = value.extracted.map((entry, index) => {
    const field = `meta/videos.json.extracted[${index}]`;
    if (!isRecord(entry)) throw new PlanV2IntegrityError(`${field} must be an object`);
    return {
      videoId: readString(entry.videoId, `${field}.videoId`),
      srcPath: readString(entry.srcPath, `${field}.srcPath`),
      framePattern: readString(entry.framePattern, `${field}.framePattern`),
      fps: readFiniteNumber(entry.fps, `${field}.fps`),
      totalFrames: readNonNegativeInteger(entry.totalFrames, `${field}.totalFrames`),
      metadata: readVideoMetadata(entry.metadata, `${field}.metadata`),
    };
  });
  return { videos, extracted };
}

function parseChunkSlices(value: unknown): ChunkSliceJson[] {
  if (!Array.isArray(value)) {
    throw new PlanV2IntegrityError("meta/chunks.json must be an array");
  }
  const indexes = new Set<number>();
  return value.map((chunk, position) => {
    const field = `meta/chunks.json[${position}]`;
    if (!isRecord(chunk)) throw new PlanV2IntegrityError(`${field} must be an object`);
    const index = readNonNegativeInteger(chunk.index, `${field}.index`);
    const startFrame = readNonNegativeInteger(chunk.startFrame, `${field}.startFrame`);
    const endFrame = readPositiveInteger(chunk.endFrame, `${field}.endFrame`);
    if (endFrame <= startFrame) {
      throw new PlanV2IntegrityError(`${field}.endFrame must be greater than startFrame`);
    }
    if (indexes.has(index)) {
      throw new PlanV2IntegrityError(`meta/chunks.json contains duplicate chunk index ${index}`);
    }
    indexes.add(index);
    return { index, startFrame, endFrame };
  });
}

function buildVideoChunkDependencies(
  planV1Dir: string,
  dimensions: Record<string, unknown>,
): {
  mode: "exact-rendered-frames" | "full-source-pack";
  dependencies: ReadonlyMap<string, readonly number[]> | null;
} {
  const videoRoot = join(planV1Dir, "video-frames");
  const hasExtractedFrames = existsSync(videoRoot) && listFiles(videoRoot).length > 0;
  const videosPath = join(planV1Dir, PLAN_VIDEOS_META_RELATIVE_PATH);
  if (!existsSync(videosPath)) {
    return hasExtractedFrames
      ? { mode: "full-source-pack", dependencies: null }
      : { mode: "exact-rendered-frames", dependencies: new Map() };
  }
  const chunksPath = join(planV1Dir, "meta", "chunks.json");
  const videos = readJsonFile(videosPath, PLAN_VIDEOS_META_RELATIVE_PATH);
  const chunks = readJsonFile(chunksPath, "meta/chunks.json");
  const parsedVideos = parsePlanVideosJson(videos);
  const parsedChunks = parseChunkSlices(chunks);
  const extracted = listVideoFramePaths(planV1Dir, parsedVideos);
  const table = createFrameLookupTable(parsedVideos.videos, extracted);
  const fpsNum = readPositiveInteger(dimensions.fpsNum, "dimensions.fpsNum");
  const fpsDen = readPositiveInteger(dimensions.fpsDen, "dimensions.fpsDen");
  const mutable = new Map<string, Set<number>>();

  for (const chunk of parsedChunks) {
    for (let frame = chunk.startFrame; frame < chunk.endFrame; frame++) {
      const globalTime = (frame * fpsDen) / fpsNum;
      for (const payload of table.getActiveFramePayloads(globalTime).values()) {
        const path = relative(resolve(planV1Dir), payload.framePath).split(sep).join("/");
        assertSafeRelativePath(path);
        const indexes = mutable.get(path) ?? new Set<number>();
        indexes.add(chunk.index);
        mutable.set(path, indexes);
      }
    }
  }
  return {
    mode: "exact-rendered-frames",
    dependencies: new Map(
      [...mutable].map(([path, indexes]) => [path, [...indexes].sort((a, b) => a - b)]),
    ),
  };
}

function manifestPayload(
  manifest: Omit<PlanV2Manifest, "planHash">,
): Omit<PlanV2Manifest, "planHash"> {
  return manifest;
}

function computeManifestHash(manifest: Omit<PlanV2Manifest, "planHash">): string {
  return sha256Hex(`${PLAN_V2_HASH_PREFIX}${canonicalJsonStringify(manifestPayload(manifest))}`);
}

function writeBlob(sourcePath: string, destinationPath: string): void {
  if (existsSync(destinationPath)) return;
  mkdirSync(dirname(destinationPath), { recursive: true });
  const temporaryDir = mkdtempSync(join(dirname(destinationPath), ".plan-v2-blob-"));
  const temporaryPath = join(temporaryDir, "blob");
  try {
    copyFileSync(sourcePath, temporaryPath);
    renameSync(temporaryPath, destinationPath);
  } finally {
    rmSync(temporaryDir, { recursive: true, force: true });
  }
}

interface PlanV2Publication {
  readonly manifest: PlanV2Manifest;
  readonly blobs: readonly Readonly<PlanV2PublishBlob>[];
}

// Artifact classification intentionally keeps every fail-safe branch together.
// fallow-ignore-next-line complexity
function buildPlanV2Publication(planV1Dir: string): PlanV2Publication {
  const v1PlanPath = join(planV1Dir, "plan.json");
  if (!existsSync(v1PlanPath)) {
    throw new PlanV2IntegrityError(`v1 plan is missing plan.json: ${v1PlanPath}`);
  }
  const v1PlanValue = readJsonFile(v1PlanPath, "v1 plan.json");
  if (!isRecord(v1PlanValue)) {
    throw new PlanV2IntegrityError("v1 plan.json must be an object");
  }
  const v1Plan = v1PlanValue;
  readPlanProtocolV1(v1Plan);
  const sourcePlanV1Hash = v1Plan.planHash;
  if (!isSha256(sourcePlanV1Hash)) {
    throw new PlanV2IntegrityError("v1 plan.json.planHash must be a sha256 digest");
  }
  const recomputedSourcePlanV1Hash = recomputePlanHashFromPlanDir(planV1Dir);
  if (recomputedSourcePlanV1Hash !== sourcePlanV1Hash) {
    throw new PlanV2IntegrityError(
      `v1 plan content fingerprint does not match plan.json.planHash: ` +
        `expected ${sourcePlanV1Hash}, recomputed ${recomputedSourcePlanV1Hash}`,
    );
  }

  const artifacts: PlanV2Artifact[] = [];
  const blobs = new Map<string, PlanV2PublishBlob>();
  const dimensions = v1Plan.dimensions;
  if (!isRecord(dimensions)) {
    throw new PlanV2IntegrityError("v1 plan.json.dimensions must be an object");
  }
  const videoDependencyPlan = buildVideoChunkDependencies(planV1Dir, dimensions);
  for (const file of listFiles(planV1Dir)) {
    const targets = artifactTargets(file.path, videoDependencyPlan.dependencies);
    if (
      file.path.startsWith("video-frames/") &&
      targets.chunks !== "all" &&
      targets.chunks.length === 0 &&
      !targets.assembler
    ) {
      continue;
    }
    const sha256 = sha256File(file.absolutePath);
    const sizeBytes = statSync(file.absolutePath).size;
    if (!blobs.has(sha256)) {
      blobs.set(sha256, { sourcePath: file.absolutePath, sha256, sizeBytes });
    }
    artifacts.push({
      path: file.path,
      sha256,
      sizeBytes,
      ...targets,
    });
  }

  const base: Omit<PlanV2Manifest, "planHash"> = {
    protocol: PLAN_PROTOCOL_V2,
    sourcePlanV1Hash,
    chunkCount: readPositiveInteger(v1Plan.chunkCount, "chunkCount"),
    totalFrames: readPositiveInteger(v1Plan.totalFrames, "totalFrames"),
    fps: readV1PlanFps(dimensions),
    width: readPositiveInteger(dimensions.width, "dimensions.width"),
    height: readPositiveInteger(dimensions.height, "dimensions.height"),
    format: readDistributedFormat(dimensions.format),
    ffmpegVersion: readString(v1Plan.ffmpegVersion, "ffmpegVersion"),
    producerVersion: readString(v1Plan.producerVersion, "producerVersion"),
    limitations: { videoDependencyMode: videoDependencyPlan.mode },
    artifacts,
  };
  return {
    manifest: {
      ...base,
      planHash: computeManifestHash(base),
    },
    blobs: [...blobs.values()],
  };
}

/** Convert a frozen v1 execution directory into the immutable v2 transport. */
export function createPlanV2FromV1(planV1Dir: string, planV2Dir: string): PlanV2Result {
  if (existsSync(planV2Dir)) {
    throw new PlanV2IntegrityError(`output directory already exists: ${planV2Dir}`);
  }
  const publication = buildPlanV2Publication(planV1Dir);
  mkdirSync(dirname(planV2Dir), { recursive: true });
  const tempDir = mkdtempSync(join(dirname(planV2Dir), ".plan-v2-build-"));
  try {
    for (const blob of publication.blobs) {
      writeBlob(blob.sourcePath, planV2BlobPath(tempDir, blob.sha256));
    }
    writeFileSync(
      join(tempDir, "plan.json"),
      canonicalJsonStringify(publication.manifest),
      "utf-8",
    );
    renameSync(tempDir, planV2Dir);
    return resultFromManifest(planV2Dir, publication.manifest);
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

export async function publishPlanV2FromV1(
  planV1Dir: string,
  publisher: PlanV2ArtifactPublisher,
): Promise<PlanV2Manifest> {
  try {
    const publication = buildPlanV2Publication(planV1Dir);
    const concurrency = 16;
    for (let offset = 0; offset < publication.blobs.length; offset += concurrency) {
      const batch = publication.blobs.slice(offset, offset + concurrency);
      const results = await Promise.allSettled(batch.map((blob) => publisher.putBlob(blob)));
      for (const result of results) {
        if (result.status === "rejected") throw result.reason;
      }
    }
    await publisher.commitManifest(canonicalJsonStringify(publication.manifest));
    return publication.manifest;
  } catch (error) {
    try {
      await publisher.abort();
    } catch {
      // Preserve the publication failure; cleanup is best-effort.
    }
    throw error;
  }
}

/**
 * Plan into a storage-neutral publisher. Implementations may write to a local
 * directory, S3, GCS, or another durable CAS. Only the planner's private
 * staging directory is local; distributed workers receive adapter-owned
 * manifest and artifact locators.
 */
export async function planV2WithPublisher(
  projectDir: string,
  config: DistributedRenderConfig,
  publisher: PlanV2ArtifactPublisher,
  options: Readonly<PlanV2WithPublisherOptions> = {},
): Promise<PlanV2Manifest> {
  const stagingRoot = mkdtempSync(join(options.stagingParentDir ?? tmpdir(), ".plan-v2-source-"));
  try {
    await plan(
      projectDir,
      { ...config, planDirSizeLimitBytes: Number.MAX_SAFE_INTEGER },
      stagingRoot,
    );
    return await publishPlanV2FromV1(stagingRoot, publisher);
  } catch (error) {
    try {
      await publisher.abort();
    } catch {
      // Preserve the planning/publication failure; cleanup is best-effort.
    }
    throw error;
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

/**
 * Plan directly into v2. The large v1 directory exists only as local staging;
 * its historical 2 GiB transport cap is disabled because no monolithic
 * archive is emitted.
 */
export async function planV2(
  projectDir: string,
  config: DistributedRenderConfig,
  planV2Dir: string,
): Promise<PlanV2Result> {
  if (existsSync(planV2Dir)) {
    throw new PlanV2IntegrityError(`output directory already exists: ${planV2Dir}`);
  }
  const publisher = new LocalPlanV2ArtifactPublisher(planV2Dir);
  const manifest = await planV2WithPublisher(projectDir, config, publisher, {
    stagingParentDir: dirname(planV2Dir),
  });
  return resultFromManifest(planV2Dir, manifest);
}

function resultFromManifest(planV2Dir: string, manifest: PlanV2Manifest): PlanV2Result {
  return {
    planDir: planV2Dir,
    manifestPath: join(planV2Dir, "plan.json"),
    planProtocol: PLAN_PROTOCOL_V2,
    planHash: manifest.planHash,
    sourcePlanV1Hash: manifest.sourcePlanV1Hash,
    chunkCount: manifest.chunkCount,
    totalFrames: manifest.totalFrames,
    fps: manifest.fps,
    width: manifest.width,
    height: manifest.height,
    format: manifest.format,
    ffmpegVersion: manifest.ffmpegVersion,
    producerVersion: manifest.producerVersion,
    limitations: manifest.limitations,
  };
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new PlanV2IntegrityError(`${field} must be a non-empty string`);
  }
  return value;
}

function readPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new PlanV2IntegrityError(`${field} must be a positive integer`);
  }
  return value;
}

function readNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new PlanV2IntegrityError(`${field} must be a non-negative integer`);
  }
  return value;
}

function readSupportedFps(value: unknown): 24 | 30 | 60 {
  if (value !== 24 && value !== 30 && value !== 60) {
    throw new PlanV2IntegrityError("dimensions.fpsNum must be 24, 30, or 60");
  }
  return value;
}

function readV1PlanFps(dimensions: Record<string, unknown>): 24 | 30 | 60 {
  const fpsDen = readPositiveInteger(dimensions.fpsDen, "dimensions.fpsDen");
  if (fpsDen !== 1) {
    throw new PlanV2IntegrityError("dimensions.fpsDen must be 1 for plan v2");
  }
  return readSupportedFps(dimensions.fpsNum);
}

function readDistributedFormat(value: unknown): DistributedFormat {
  if (value !== "mp4" && value !== "mov" && value !== "webm" && value !== "png-sequence") {
    throw new PlanV2IntegrityError("dimensions.format is unsupported");
  }
  return value;
}

function parseArtifact(value: unknown, index: number): PlanV2Artifact {
  if (!isRecord(value)) throw new PlanV2IntegrityError(`artifacts[${index}] must be an object`);
  const path = readString(value.path, `artifacts[${index}].path`);
  assertSafeRelativePath(path);
  if (!isSha256(value.sha256)) {
    throw new PlanV2IntegrityError(`artifacts[${index}].sha256 must be a lowercase sha256`);
  }
  const sizeBytes = value.sizeBytes;
  if (typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes) || sizeBytes < 0) {
    throw new PlanV2IntegrityError(`artifacts[${index}].sizeBytes must be a non-negative integer`);
  }
  let chunks: "all" | readonly number[];
  if (value.chunks === "all") {
    chunks = "all";
  } else if (isNonNegativeIntegerArray(value.chunks)) {
    chunks = value.chunks;
  } else {
    throw new PlanV2IntegrityError(`artifacts[${index}].chunks is invalid`);
  }
  if (typeof value.assembler !== "boolean") {
    throw new PlanV2IntegrityError(`artifacts[${index}].assembler must be boolean`);
  }
  return {
    path,
    sha256: value.sha256,
    sizeBytes,
    chunks,
    assembler: value.assembler,
  };
}

// Manifest parsing deliberately validates every untrusted field in one boundary
// before any artifact path is used; splitting it would weaken that audit point.
// fallow-ignore-next-line complexity
function parsePlanV2Manifest(value: unknown): Readonly<PlanV2Manifest> {
  if (!isRecord(value)) throw new PlanV2IntegrityError("manifest must be an object");
  if (
    !isRecord(value.protocol) ||
    value.protocol.schemaVersion !== PLAN_PROTOCOL_V2.schemaVersion ||
    value.protocol.artifactLayout !== PLAN_PROTOCOL_V2.artifactLayout ||
    value.protocol.hashSchema !== PLAN_PROTOCOL_V2.hashSchema
  ) {
    throw new PlanV2IntegrityError("manifest protocol is not the supported v2 descriptor");
  }
  if (!isSha256(value.planHash) || !isSha256(value.sourcePlanV1Hash)) {
    throw new PlanV2IntegrityError("manifest hashes must be lowercase sha256 digests");
  }
  if (!Array.isArray(value.artifacts)) throw new PlanV2IntegrityError("artifacts must be an array");
  const artifacts = value.artifacts.map(parseArtifact);
  const paths = new Set<string>();
  for (const artifact of artifacts) {
    if (paths.has(artifact.path))
      throw new PlanV2IntegrityError(`duplicate artifact path: ${artifact.path}`);
    paths.add(artifact.path);
  }
  if (!paths.has("plan.json"))
    throw new PlanV2IntegrityError("manifest must include the v1 plan.json artifact");
  if (
    !isRecord(value.limitations) ||
    (value.limitations.videoDependencyMode !== "exact-rendered-frames" &&
      value.limitations.videoDependencyMode !== "full-source-pack")
  ) {
    throw new PlanV2IntegrityError("unsupported video dependency mode");
  }
  const parsed: PlanV2Manifest = {
    protocol: PLAN_PROTOCOL_V2,
    planHash: value.planHash,
    sourcePlanV1Hash: value.sourcePlanV1Hash,
    chunkCount: readPositiveInteger(value.chunkCount, "chunkCount"),
    totalFrames: readPositiveInteger(value.totalFrames, "totalFrames"),
    fps: readSupportedFps(value.fps),
    width: readPositiveInteger(value.width, "width"),
    height: readPositiveInteger(value.height, "height"),
    format: readDistributedFormat(value.format),
    ffmpegVersion: readString(value.ffmpegVersion, "ffmpegVersion"),
    producerVersion: readString(value.producerVersion, "producerVersion"),
    limitations: { videoDependencyMode: value.limitations.videoDependencyMode },
    artifacts,
  };
  const { planHash: _planHash, ...payload } = parsed;
  const expectedHash = computeManifestHash(payload);
  if (expectedHash !== parsed.planHash) {
    throw new PlanV2IntegrityError("manifest integrity hash mismatch");
  }
  for (const [index, artifact] of parsed.artifacts.entries()) {
    if (
      artifact.chunks !== "all" &&
      artifact.chunks.some((chunkIndex) => chunkIndex >= parsed.chunkCount)
    ) {
      throw new PlanV2IntegrityError(`artifacts[${index}].chunks contains an out-of-range index`);
    }
  }
  return parsed;
}

/** Strictly parse and integrity-check a v2 manifest before any blob access. */
export function readPlanV2Manifest(planV2Dir: string): Readonly<PlanV2Manifest> {
  const manifestPath = join(planV2Dir, "plan.json");
  if (!existsSync(manifestPath)) {
    throw new PlanV2IntegrityError(`missing v2 manifest: ${manifestPath}`);
  }
  const value = readJsonFile(manifestPath, "v2 manifest");
  return parsePlanV2Manifest(value);
}

export function listPlanV2ArtifactsForTarget(
  manifest: Readonly<PlanV2Manifest>,
  target: PlanV2MaterializationTarget,
): readonly Readonly<PlanV2Artifact>[] {
  if (target.role === "chunk") {
    if (
      !Number.isInteger(target.chunkIndex) ||
      target.chunkIndex < 0 ||
      target.chunkIndex >= manifest.chunkCount
    ) {
      throw new PlanV2IntegrityError(`chunkIndex ${String(target.chunkIndex)} is out of range`);
    }
    return manifest.artifacts.filter(
      (artifact) =>
        artifact.chunks === "all" ||
        artifact.chunks.some((chunkIndex) => chunkIndex === target.chunkIndex),
    );
  }
  return manifest.artifacts.filter((artifact) => artifact.assembler);
}

function verifyBlob(planV2Dir: string, artifact: Readonly<PlanV2Artifact>): string {
  const sourcePath = planV2BlobPath(planV2Dir, artifact.sha256);
  if (!existsSync(sourcePath)) {
    throw new PlanV2IntegrityError(`missing content-addressed artifact ${artifact.sha256}`);
  }
  const stats = statSync(sourcePath);
  if (!stats.isFile() || stats.size !== artifact.sizeBytes) {
    throw new PlanV2IntegrityError(`artifact size mismatch for ${artifact.path}`);
  }
  if (sha256File(sourcePath) !== artifact.sha256) {
    throw new PlanV2IntegrityError(`artifact hash mismatch for ${artifact.path}`);
  }
  return sourcePath;
}

/**
 * Verify every selected blob first, then atomically publish a v1-compatible
 * execution directory. The marker lets execution functions revalidate the
 * selected subset without requiring assembler-only audio in chunk workers.
 */
export function materializePlanV2Target(
  planV2Dir: string,
  target: PlanV2MaterializationTarget,
  destinationDir: string,
): PlanV2MaterializationResult {
  if (existsSync(destinationDir)) {
    throw new PlanV2IntegrityError(`materialization destination already exists: ${destinationDir}`);
  }
  const manifest = readPlanV2Manifest(planV2Dir);
  const artifacts = listPlanV2ArtifactsForTarget(manifest, target);
  const verified = artifacts.map((artifact) => ({
    artifact,
    sourcePath: verifyBlob(planV2Dir, artifact),
  }));
  mkdirSync(dirname(destinationDir), { recursive: true });
  const tempDir = mkdtempSync(join(dirname(destinationDir), ".plan-v2-materialize-"));
  try {
    for (const { artifact, sourcePath } of verified) {
      const destinationPath = join(tempDir, ...artifact.path.split("/"));
      mkdirSync(dirname(destinationPath), { recursive: true });
      copyFileSync(sourcePath, destinationPath);
    }
    writeFileSync(
      join(tempDir, PLAN_V2_MATERIALIZATION_MARKER),
      canonicalJsonStringify({ manifest, target }),
      "utf-8",
    );
    renameSync(tempDir, destinationDir);
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
  return {
    planDir: destinationDir,
    target,
    planHash: manifest.planHash,
    sourcePlanV1Hash: manifest.sourcePlanV1Hash,
    artifactCount: artifacts.length,
    sizeBytes: artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0),
    audioPath:
      target.role === "assembler" &&
      artifacts.some((artifact) => artifact.path === PLAN_AUDIO_RELATIVE_PATH)
        ? join(destinationDir, PLAN_AUDIO_RELATIVE_PATH)
        : null,
  };
}

/** Revalidate a materialized subset immediately before execution. */
export function validatePlanV2MaterializedTarget(
  planDir: string,
  expectedTarget: PlanV2MaterializationTarget,
): Readonly<PlanV2Manifest> | null {
  const markerPath = join(planDir, PLAN_V2_MATERIALIZATION_MARKER);
  if (!existsSync(markerPath)) return null;
  const marker = readJsonFile(markerPath, "materialization marker");
  if (!isRecord(marker) || !isRecord(marker.manifest) || !isRecord(marker.target)) {
    throw new PlanV2IntegrityError("malformed materialization marker");
  }
  const target = marker.target;
  if (
    target.role !== expectedTarget.role ||
    (expectedTarget.role === "chunk" && target.chunkIndex !== expectedTarget.chunkIndex)
  ) {
    throw new PlanV2IntegrityError(
      "materialization target does not match requested execution role",
    );
  }
  const manifest = parsePlanV2Manifest(marker.manifest);
  const required = listPlanV2ArtifactsForTarget(manifest, expectedTarget);
  for (const artifact of required) {
    const path = join(planDir, ...artifact.path.split("/"));
    if (!existsSync(path) || statSync(path).size !== artifact.sizeBytes) {
      throw new PlanV2IntegrityError(
        `materialized artifact missing or truncated: ${artifact.path}`,
      );
    }
    if (sha256File(path) !== artifact.sha256) {
      throw new PlanV2IntegrityError(`materialized artifact hash mismatch: ${artifact.path}`);
    }
  }
  return manifest;
}
