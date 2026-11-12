// What a chunk capture session is built from, shared with the planner's frame-cost measurement.
import { existsSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import {
  type BeforeCaptureHook,
  BROWSER_GPU_NOT_SOFTWARE,
  compositionRequiresWebGpu,
  type CaptureOptions,
  createVideoFrameInjector,
  type EngineConfig,
  type ExtractedFrames,
  type FrameLookupTable,
  mediaIdPathSegment,
  type ShownBox,
} from "@hyperframes/engine";
import { resolveVideoCaptureBeyondViewport } from "../render/captureBeyondViewport.js";
import { resolveCaptureJpegQuality } from "../render/captureImageFormat.js";
import type { LockedRenderConfig } from "../render/stages/freezePlan.js";
import { extractDeferredFrames, shownDeferredFrameIndexes } from "../render/deferredVideoFrames.js";
import { defaultLogger } from "../../logger.js";
import type { PlanV2RemoteSources } from "./planV2.js";
import { type DistributedFormat, INVALID_VIDEO_METADATA, type PlanVideosJson } from "./shared.js";

/** Distinct codes so adapters route retries per cause: a missing artifact may heal, a hash mismatch never. */
export const FFMPEG_VERSION_MISMATCH = "FFMPEG_VERSION_MISMATCH";
export const PLAN_HASH_MISMATCH = "PLAN_HASH_MISMATCH";
export const MISSING_PLAN_ARTIFACT = "MISSING_PLAN_ARTIFACT";
export const CHUNK_INDEX_OUT_OF_RANGE = "CHUNK_INDEX_OUT_OF_RANGE";
export const CHUNK_FRAME_RANGE_INVALID = "CHUNK_FRAME_RANGE_INVALID";
export const MISSING_RUNTIME_ENV_SNAPSHOT = "MISSING_RUNTIME_ENV_SNAPSHOT";
export { INVALID_VIDEO_METADATA };

export type RenderChunkValidationCode =
  | typeof FFMPEG_VERSION_MISMATCH
  | typeof PLAN_HASH_MISMATCH
  | typeof MISSING_PLAN_ARTIFACT
  | typeof CHUNK_INDEX_OUT_OF_RANGE
  | typeof CHUNK_FRAME_RANGE_INVALID
  | typeof MISSING_RUNTIME_ENV_SNAPSHOT
  | typeof INVALID_VIDEO_METADATA
  | typeof BROWSER_GPU_NOT_SOFTWARE;

/** A malformed planDir or a worker that does not match the plan's fingerprint; adapters key retries off `code`. */
export class RenderChunkValidationError extends Error {
  readonly code: RenderChunkValidationCode;
  constructor(code: RenderChunkValidationCode, message: string) {
    super(message);
    this.name = "RenderChunkValidationError";
    this.code = code;
  }
}

export const chunkFrameInjectorDependencies = { createVideoFrameInjector };

/** One injector per browser session: a hook reused on a fresh page can skip its first injection. */
export function createChunkVideoFrameInjectorFactory(
  frameLookup: FrameLookupTable | Promise<FrameLookupTable> | null,
  options?: Parameters<typeof createVideoFrameInjector>[1],
): () => BeforeCaptureHook | null {
  if (!(frameLookup instanceof Promise))
    return () => chunkFrameInjectorDependencies.createVideoFrameInjector(frameLookup, options);
  return () => {
    let hook: BeforeCaptureHook | null | undefined;
    return async (page, time, heldVideoTime) => {
      hook ??= chunkFrameInjectorDependencies.createVideoFrameInjector(await frameLookup, options);
      await hook?.(page, time, heldVideoTime);
    };
  };
}

function frameNumberFromFileName(name: string): number | null {
  const match = /(\d+)(?=\.[^.]+$)/.exec(name);
  if (!match) return null;
  const frameNumber = Number(match[1]);
  return Number.isSafeInteger(frameNumber) ? frameNumber : null;
}

/**
 * Rebuilds `ExtractedFrames[]` from `<planDir>/video-frames/<videoId>/`. `framePaths` keys are 0-based
 * frame indexes (what `getFrameAtTime` reads); any other key drops every video's first-paint frame.
 */
export function rebuildExtractedFramesFromPlanDir(
  planDir: string,
  videos: PlanVideosJson["extracted"],
  indexMode: "dense-v1" | "sparse-v2" = "dense-v1",
): ExtractedFrames[] {
  const result: ExtractedFrames[] = [];
  for (const v of videos) {
    const outputDir = join(planDir, "video-frames", mediaIdPathSegment(v.videoId));
    if (!existsSync(outputDir)) {
      throw new Error(
        `[renderChunk] planDir missing extracted video frames for ${JSON.stringify(v.videoId)}: ` +
          `${outputDir} not present. plan() should have written frames here; the planDir is malformed.`,
      );
    }
    // Numeric order: past the padding width, lexical order puts frame_100000 before frame_10001.
    const ext = (extname(v.framePattern) || ".jpg").toLowerCase();
    const frames = readdirSync(outputDir)
      .filter((name) => name.toLowerCase().endsWith(ext))
      .sort((left, right) => {
        const leftNumber = frameNumberFromFileName(left);
        const rightNumber = frameNumberFromFileName(right);
        if (leftNumber === null || rightNumber === null) return left.localeCompare(right);
        return leftNumber - rightNumber || left.localeCompare(right);
      });
    const framePaths = new Map<number, string>();
    for (let i = 0; i < frames.length; i++) {
      const frameName = frames[i];
      if (!frameName) continue;
      // v2 materialization is sparse, so only v2 reads the index from ffmpeg's 1-based name.
      const frameNumber = indexMode === "sparse-v2" ? frameNumberFromFileName(frameName) : null;
      const frameIndex = frameNumber === null ? i : frameNumber - 1;
      framePaths.set(frameIndex, join(outputDir, frameName));
    }
    result.push({
      videoId: v.videoId,
      srcPath: v.srcPath,
      outputDir,
      framePattern: v.framePattern,
      fps: v.fps,
      totalFrames: v.totalFrames,
      metadata: v.metadata,
      framePaths,
      // The planDir is shared read-only across workers; cleanup must not delete its frames.
      ownedByLookup: false,
    });
  }
  return result;
}

/** Capture options a chunk session uses; the planner measures frame cost with the same ones. */
export function buildChunkCaptureOptions(input: {
  dimensions: {
    width: number;
    height: number;
    fpsNum: number;
    fpsDen: number;
    format: DistributedFormat;
  };
  encoder: Pick<
    LockedRenderConfig,
    "quality" | "deviceScaleFactor" | "variables" | "pageMotionBlur"
  >;
  videoCount: number;
  html: string;
  skipReadinessVideoIds?: string[];
  videoMetadataHints?: CaptureOptions["videoMetadataHints"];
}): CaptureOptions {
  const { dimensions, encoder } = input;
  const videoCaptureBeyondViewport = resolveVideoCaptureBeyondViewport(input.videoCount);
  return {
    width: dimensions.width,
    height: dimensions.height,
    fps: { num: dimensions.fpsNum, den: dimensions.fpsDen },
    format: dimensions.format === "mp4" ? "jpeg" : "png",
    quality: dimensions.format === "mp4" ? resolveCaptureJpegQuality(encoder.quality) : undefined,
    deviceScaleFactor: encoder.deviceScaleFactor,
    // The controller's snapshot, so the first capture sees the in-process renderer's `__hfVariables`.
    variables: encoder.variables,
    subTimelineWaitMemo: {},
    skipReadinessVideoIds: input.skipReadinessVideoIds,
    videoMetadataHints: input.videoMetadataHints,
    ...(videoCaptureBeyondViewport !== undefined
      ? { captureBeyondViewport: videoCaptureBeyondViewport }
      : {}),
    pageMotionBlur: encoder.pageMotionBlur,
    // A fixed warmup count keeps `beginFrameTimeTicks` host-independent.
    lockWarmupTicks: true,
    requiresWebGpu: compositionRequiresWebGpu(input.html),
  };
}

function planExtractedFrames(planVideos: PlanVideosJson): ExtractedFrames[] {
  return planVideos.extracted.map((video) => ({
    ...video,
    outputDir: "",
    framePaths: new Map<number, string>(),
  }));
}

export function shownPlanFrameIndexes(
  planVideos: PlanVideosJson,
  frames: Iterable<number>,
  fps: { num: number; den: number },
): Map<string, Set<number>> {
  return shownDeferredFrameIndexes(
    { videos: planVideos.videos, extracted: planExtractedFrames(planVideos) },
    frames,
    fps,
  );
}

export async function extractDeferredVideoFramesForChunk(input: {
  planDir: string;
  planVideos: PlanVideosJson;
  frames: Iterable<number>;
  fps: { num: number; den: number };
  outputRoot: string;
  cfg: Pick<EngineConfig, "ffmpegProcessTimeout">;
  remoteSources?: PlanV2RemoteSources;
  shownBoxes?: ReadonlyMap<string, ShownBox>;
}): Promise<ExtractedFrames[]> {
  const deferred = input.planVideos.extracted.filter((video) => video.deferredRange);
  const remoteSources = input.remoteSources ?? {};
  for (const path of Object.keys(remoteSources)) {
    if (!deferred.some((video) => video.deferredRange!.sourcePath === path)) {
      throw new RenderChunkValidationError(
        MISSING_PLAN_ARTIFACT,
        `[renderChunk] ${path} is read by URL but no deferred video uses it`,
      );
    }
    // The query carries the URL's signature; keep it out of logs.
    defaultLogger.info("[renderChunk] reading video by URL", {
      path,
      url: remoteSources[path]!.split("?")[0],
    });
  }
  const planned = new Map(input.planVideos.extracted.map((video) => [video.videoId, video]));
  return extractDeferredFrames({
    videos: input.planVideos.videos,
    extracted: planExtractedFrames(input.planVideos),
    frames: input.frames,
    fps: input.fps,
    outputRoot: input.outputRoot,
    cfg: input.cfg,
    shownBoxes: input.shownBoxes,
    sourceOf: (video) => {
      const range = planned.get(video.videoId)!.deferredRange!;
      const remoteUrl = remoteSources[range.sourcePath];
      const sourcePath = remoteUrl ?? join(input.planDir, ...range.sourcePath.split("/"));
      if (remoteUrl === undefined && !existsSync(sourcePath)) {
        throw new RenderChunkValidationError(
          MISSING_PLAN_ARTIFACT,
          `[renderChunk] planDir is missing the source for video ${JSON.stringify(video.videoId)}: ${range.sourcePath}`,
        );
      }
      return sourcePath;
    },
    onMissingFrame: (video, index) =>
      new RenderChunkValidationError(
        INVALID_VIDEO_METADATA,
        `[renderChunk] video ${JSON.stringify(video.videoId)} has no frame ${index}; ` +
          `the plan expected ${video.totalFrames} frames from ${planned.get(video.videoId)!.deferredRange!.sourcePath}.`,
      ),
  });
}
