import { join } from "node:path";
import {
  closeCaptureSession,
  createCaptureSession,
  createFrameLookupTable,
  type EngineConfig,
  initializeSession,
} from "@hyperframes/engine";
import type { ProducerLogger } from "../../logger.js";
import {
  buildVirtualTimeShim,
  closeFileServerSafely,
  createFileServer,
  resolveRenderFpsConfig,
} from "../fileServer.js";
import {
  createCaptureCalibrationConfig,
  measureCaptureCostFromSession,
  selectCaptureCalibrationFrames,
} from "../render/captureCost.js";
import {
  buildChunkCaptureOptions,
  createChunkVideoFrameInjectorFactory,
  extractDeferredVideoFramesForChunk,
  rebuildExtractedFramesFromPlanDir,
} from "./chunkFrames.js";
import type { DistributedFormat, PlanVideosJson } from "./shared.js";

/**
 * Captures the renderer's calibration frames in a session set up like a chunk
 * worker's (same capture options, engine config and video frames) and returns
 * the p95 capture seconds per frame.
 */
export async function measurePlanSecondsPerFrame(input: {
  planDir: string;
  workDir: string;
  html: string;
  planVideos: PlanVideosJson;
  totalFrames: number;
  fps: number;
  width: number;
  height: number;
  format: DistributedFormat;
  quality: "draft" | "standard" | "high";
  deviceScaleFactor: number;
  variables?: Record<string, unknown>;
  cfg: EngineConfig;
  log: ProducerLogger;
}): Promise<number> {
  const { planDir, workDir, planVideos, fps, log } = input;
  const fpsRatio = { num: fps, den: 1 };
  const sampled = selectCaptureCalibrationFrames(input.totalFrames);
  const extracted = [
    ...rebuildExtractedFramesFromPlanDir(
      planDir,
      planVideos.extracted.filter((video) => !video.deferredRange),
    ),
    ...(await extractDeferredVideoFramesForChunk({
      planDir,
      planVideos,
      frames: sampled,
      fps: fpsRatio,
      outputRoot: join(workDir, "frame-cost-video-frames"),
      cfg: input.cfg,
    })),
  ];
  const lookup =
    extracted.length > 0
      ? createFrameLookupTable(planVideos.videos, extracted, resolveRenderFpsConfig(fpsRatio).value)
      : null;
  const compiledDir = join(planDir, "compiled");
  const fileServer = await createFileServer({
    projectDir: compiledDir,
    compiledDir,
    port: 0,
    preHeadScripts: [buildVirtualTimeShim({ seedRandomFromFrame: true })],
    fps: fpsRatio,
  });
  let session: Awaited<ReturnType<typeof createCaptureSession>> | null = null;
  try {
    session = await createCaptureSession(
      fileServer.url,
      join(workDir, "frame-cost"),
      buildChunkCaptureOptions({
        dimensions: { ...input, fpsNum: fps, fpsDen: 1 },
        encoder: input,
        videoCount: planVideos.videos.length,
        html: input.html,
      }),
      createChunkVideoFrameInjectorFactory(lookup)(),
      createCaptureCalibrationConfig(input.cfg),
    );
    await initializeSession(session);
    const { estimate } = await measureCaptureCostFromSession(session, input.totalFrames, fps, log);
    return (estimate.p95Ms ?? 0) / 1000;
  } finally {
    if (session) await closeCaptureSession(session).catch(() => {});
    closeFileServerSafely(fileServer, "plan frame cost", log);
  }
}
