/**
 * Experiment 2: Raw Pixel Pipe + Streaming Encode
 *
 * Eliminates two major inefficiencies in the baseline pipeline:
 *   1. Base64 encode/decode overhead on screenshot buffers (33% inflation + CPU)
 *   2. Sequential capture-then-encode (capture ALL frames, THEN encode)
 *
 * This experiment pipes JPEG buffers directly from Puppeteer's BeginFrame
 * capture into FFmpeg's stdin via image2pipe, so encoding happens concurrently
 * with capture. Total time ≈ max(capture, encode) instead of capture + encode.
 *
 * Uses the existing codebase building blocks:
 *   - spawnStreamingEncoder() from streamingEncoder.ts
 *   - captureFrameToBuffer() from frameCapture.ts
 *   - createFrameReorderBuffer() from streamingEncoder.ts
 */

import { mkdirSync, existsSync, readdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";

import {
  createCaptureSession,
  initializeSession,
  closeCaptureSession,
  captureFrame,
  captureFrameToBuffer,
  getCapturePerfSummary,
  type CaptureSession,
} from "../services/frameCapture.js";
import {
  spawnStreamingEncoder,
  createFrameReorderBuffer,
  type StreamingEncoder,
  type StreamingEncoderOptions,
} from "../services/streamingEncoder.js";
import {
  encodeFramesFromDir,
  type EncoderOptions,
} from "../services/chunkEncoder.js";
import {
  createFileServer,
  type FileServerHandle,
} from "../services/fileServer.js";
import { resolveConfig, type EngineConfig } from "../config.js";
import type { CaptureOptions } from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineTimings {
  totalMs: number;
  captureMs: number;
  encodeMs: number;
  /** Only meaningful for streaming: time from first frame written to encoder close */
  encoderActiveMs: number;
  /** Time spent waiting for FFmpeg to finish after last frame was written */
  encoderDrainMs: number;
  frameCount: number;
  avgCapturePerFrameMs: number;
  outputFileSize: number;
  outputPath: string;
}

export interface StreamingPipelineOptions {
  serverUrl: string;
  outputPath: string;
  fps: number;
  width: number;
  height: number;
  totalFrames: number;
  /** JPEG quality 1-100 (lower = faster, smaller buffers). Default: 80 */
  jpegQuality?: number;
  /** Number of capture workers (1 or 2). Default: 1 */
  workerCount?: number;
  /** Engine config overrides */
  config?: Partial<EngineConfig>;
}

// ---------------------------------------------------------------------------
// Baseline: Sequential capture-to-disk then encode (current pipeline)
// ---------------------------------------------------------------------------

export async function runBaselinePipeline(
  opts: StreamingPipelineOptions,
): Promise<PipelineTimings> {
  const {
    serverUrl,
    outputPath,
    fps,
    width,
    height,
    totalFrames,
    jpegQuality = 80,
    config: configOverrides,
  } = opts;

  const config = resolveConfig({
    ...configOverrides,
    forceScreenshot: configOverrides?.forceScreenshot ?? false,
  });

  const framesDir = join(dirname(outputPath), "baseline-frames");
  if (!existsSync(framesDir)) mkdirSync(framesDir, { recursive: true });

  const captureOptions: CaptureOptions = {
    width,
    height,
    fps,
    format: "jpeg",
    quality: jpegQuality,
  };

  // --- Phase 1: Capture all frames to disk ---
  const totalStart = Date.now();
  const captureStart = Date.now();

  const session = await createCaptureSession(
    serverUrl,
    framesDir,
    captureOptions,
    null,
    config,
  );
  await initializeSession(session);

  for (let i = 0; i < totalFrames; i++) {
    const time = i / fps;
    await captureFrame(session, i, time);
  }

  const capturePerf = getCapturePerfSummary(session);
  await closeCaptureSession(session);
  const captureMs = Date.now() - captureStart;

  // --- Phase 2: Encode frames from disk ---
  const encodeStart = Date.now();
  const encoderOptions: EncoderOptions = {
    fps,
    width,
    height,
    codec: "h264",
    preset: "ultrafast",
    quality: 23,
  };

  const encodeResult = await encodeFramesFromDir(
    framesDir,
    "frame_%06d.jpg",
    outputPath,
    encoderOptions,
    undefined,
    config,
  );
  const encodeMs = Date.now() - encodeStart;
  const totalMs = Date.now() - totalStart;

  if (!encodeResult.success) {
    throw new Error(`Baseline encode failed: ${encodeResult.error}`);
  }

  return {
    totalMs,
    captureMs,
    encodeMs,
    encoderActiveMs: encodeMs,
    encoderDrainMs: 0,
    frameCount: totalFrames,
    avgCapturePerFrameMs: capturePerf.avgTotalMs,
    outputFileSize: encodeResult.fileSize,
    outputPath,
  };
}

// ---------------------------------------------------------------------------
// Streaming: Capture + encode concurrently via pipe (single worker)
// ---------------------------------------------------------------------------

export async function runStreamingPipeline(
  opts: StreamingPipelineOptions,
): Promise<PipelineTimings> {
  const {
    serverUrl,
    outputPath,
    fps,
    width,
    height,
    totalFrames,
    jpegQuality = 80,
    workerCount = 1,
    config: configOverrides,
  } = opts;

  const config = resolveConfig({
    ...configOverrides,
    enableStreamingEncode: true,
    forceScreenshot: configOverrides?.forceScreenshot ?? false,
  });

  const workDir = join(dirname(outputPath), "streaming-work");
  if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });

  const captureOptions: CaptureOptions = {
    width,
    height,
    fps,
    format: "jpeg",
    quality: jpegQuality,
  };

  const streamingOpts: StreamingEncoderOptions = {
    fps,
    width,
    height,
    codec: "h264",
    preset: "ultrafast",
    quality: 23,
    imageFormat: "jpeg",
  };

  const totalStart = Date.now();

  // Spawn FFmpeg streaming encoder BEFORE starting capture
  const encoder = await spawnStreamingEncoder(outputPath, streamingOpts, undefined, config);
  const encoderSpawnedAt = Date.now();

  let captureMs = 0;
  let framesWritten = 0;

  if (workerCount <= 1) {
    // --- Single worker: capture frames sequentially, pipe each to FFmpeg ---
    const session = await createCaptureSession(
      serverUrl,
      workDir,
      captureOptions,
      null,
      config,
    );
    await initializeSession(session);

    const captureStart = Date.now();
    for (let i = 0; i < totalFrames; i++) {
      const time = i / fps;
      const { buffer } = await captureFrameToBuffer(session, i, time);

      // Write directly to FFmpeg stdin - no disk, no base64 re-encode
      const ok = encoder.writeFrame(buffer);
      if (!ok) {
        const status = encoder.getExitStatus();
        if (status === "error") {
          throw new Error("FFmpeg streaming encoder died during capture");
        }
        // Backpressure: wait for drain
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
        encoder.writeFrame(buffer);
      }
      framesWritten++;
    }
    captureMs = Date.now() - captureStart;

    await closeCaptureSession(session);
  } else {
    // --- Two workers with frame reorder buffer ---
    const reorder = createFrameReorderBuffer(0, totalFrames);
    const midFrame = Math.ceil(totalFrames / 2);

    const captureStart = Date.now();

    const workerFn = async (
      startFrame: number,
      endFrame: number,
      workerId: number,
    ) => {
      const workerDir = join(workDir, `worker-${workerId}`);
      if (!existsSync(workerDir)) mkdirSync(workerDir, { recursive: true });

      const session = await createCaptureSession(
        serverUrl,
        workerDir,
        captureOptions,
        null,
        config,
      );
      await initializeSession(session);

      for (let i = startFrame; i < endFrame; i++) {
        const time = i / fps;
        const { buffer } = await captureFrameToBuffer(session, i, time);

        // Wait for our turn in sequential order
        await reorder.waitForFrame(i);

        const ok = encoder.writeFrame(buffer);
        if (!ok) {
          await new Promise<void>((r) => setTimeout(r, 1));
          encoder.writeFrame(buffer);
        }
        framesWritten++;
        reorder.advanceTo(i + 1);
      }

      await closeCaptureSession(session);
    };

    await Promise.all([
      workerFn(0, midFrame, 0),
      workerFn(midFrame, totalFrames, 1),
    ]);
    captureMs = Date.now() - captureStart;
  }

  // Close encoder (signals end-of-stream to FFmpeg)
  const encodeCloseStart = Date.now();
  const encodeResult = await encoder.close();
  const encoderDrainMs = Date.now() - encodeCloseStart;
  const totalMs = Date.now() - totalStart;
  const encoderActiveMs = Date.now() - encoderSpawnedAt;

  if (!encodeResult.success) {
    throw new Error(`Streaming encode failed: ${encodeResult.error}`);
  }

  return {
    totalMs,
    captureMs,
    encodeMs: encodeResult.durationMs,
    encoderActiveMs,
    encoderDrainMs,
    frameCount: framesWritten,
    avgCapturePerFrameMs: Math.round(captureMs / Math.max(1, framesWritten)),
    outputFileSize: encodeResult.fileSize,
    outputPath,
  };
}

// ---------------------------------------------------------------------------
// Streaming with reduced JPEG quality (60 instead of 80)
// ---------------------------------------------------------------------------

export async function runStreamingPipelineLowQuality(
  opts: StreamingPipelineOptions,
): Promise<PipelineTimings> {
  return runStreamingPipeline({
    ...opts,
    jpegQuality: 60,
  });
}

// ---------------------------------------------------------------------------
// Streaming with 2 workers (parallel capture, reordered pipe)
// ---------------------------------------------------------------------------

export async function runStreamingPipeline2Workers(
  opts: StreamingPipelineOptions,
): Promise<PipelineTimings> {
  return runStreamingPipeline({
    ...opts,
    workerCount: 2,
  });
}
