/**
 * Streaming Encoder Service
 *
 * Pipes frame screenshot buffers directly to FFmpeg's stdin instead of writing
 * them to disk and reading them back in a separate encode stage.  Follows the
 * Remotion pattern of image2pipe → FFmpeg.
 *
 * Two building blocks:
 *   1. Frame reorder buffer – ensures out-of-order parallel workers feed
 *      frames to FFmpeg stdin in sequential order.
 *   2. Streaming FFmpeg encoder – spawns FFmpeg with `-f image2pipe` and
 *      exposes a `writeFrame(buffer)` + `close()` API.
 */

import { spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, statSync } from "fs";
import { dirname } from "path";

import { type GpuEncoder, getCachedGpuEncoder, getGpuEncoderName } from "../utils/gpuEncoder.js";
import { type EncoderOptions } from "./chunkEncoder.types.js";
import { DEFAULT_CONFIG, type EngineConfig } from "../config.js";

// Re-export EncoderOptions so callers can reference the type via this module.
export type { EncoderOptions } from "./chunkEncoder.types.js";

// ---------------------------------------------------------------------------
// 1. Frame reorder buffer (based on Remotion's ensure-frames-in-order.ts)
// ---------------------------------------------------------------------------

export interface FrameReorderBuffer {
  waitForFrame: (frame: number) => Promise<void>;
  advanceTo: (frame: number) => void;
  waitForAllDone: () => Promise<void>;
}

export function createFrameReorderBuffer(startFrame: number, endFrame: number): FrameReorderBuffer {
  let nextFrame = startFrame;
  let waiters: Array<{ frame: number; resolve: () => void }> = [];

  const resolveWaiters = () => {
    for (const waiter of waiters.slice()) {
      if (waiter.frame === nextFrame) {
        waiter.resolve();
        waiters = waiters.filter((w) => w !== waiter);
      }
    }
  };

  return {
    waitForFrame: (frame: number) =>
      new Promise<void>((resolve) => {
        waiters.push({ frame, resolve });
        resolveWaiters();
      }),
    advanceTo: (frame: number) => {
      nextFrame = frame;
      resolveWaiters();
    },
    waitForAllDone: () =>
      new Promise<void>((resolve) => {
        waiters.push({ frame: endFrame, resolve });
        resolveWaiters();
      }),
  };
}

// ---------------------------------------------------------------------------
// 2. Streaming FFmpeg encoder
// ---------------------------------------------------------------------------

export interface StreamingEncoderOptions {
  fps: number;
  width: number;
  height: number;
  codec?: "h264" | "h265" | "vp9" | "prores";
  preset?: string;
  quality?: number;
  bitrate?: string;
  pixelFormat?: string;
  useGpu?: boolean;
  imageFormat?: "jpeg" | "png";
}

export interface StreamingEncoderResult {
  success: boolean;
  durationMs: number;
  fileSize: number;
  error?: string;
}

export interface StreamingEncoder {
  writeFrame: (buffer: Buffer) => boolean;
  close: () => Promise<StreamingEncoderResult>;
  getExitStatus: () => "running" | "success" | "error";
}

/**
 * Build FFmpeg args for streaming (image2pipe) input.
 * Reuses the same codec/quality/GPU logic as chunkEncoder's buildEncoderArgs
 * but with `-f image2pipe` instead of `-i <pattern>`.
 */
function buildStreamingArgs(
  options: StreamingEncoderOptions,
  outputPath: string,
  gpuEncoder: GpuEncoder = null,
): string[] {
  const {
    fps,
    codec = "h264",
    preset = "medium",
    quality = 23,
    bitrate,
    pixelFormat = "yuv420p",
    useGpu = false,
    imageFormat = "jpeg",
  } = options;

  // Input args: pipe from stdin
  const inputCodec = imageFormat === "png" ? "png" : "mjpeg";
  const args: string[] = [
    "-f",
    "image2pipe",
    "-vcodec",
    inputCodec,
    "-framerate",
    String(fps),
    "-i",
    "-",
    "-r",
    String(fps),
  ];

  const shouldUseGpu = useGpu && gpuEncoder !== null;

  if (codec === "h264" || codec === "h265") {
    if (shouldUseGpu) {
      const encoderName = getGpuEncoderName(gpuEncoder, codec);
      args.push("-c:v", encoderName);

      switch (gpuEncoder) {
        case "nvenc":
          args.push("-preset", preset);
          if (bitrate) args.push("-b:v", bitrate);
          else args.push("-cq", String(quality));
          break;
        case "videotoolbox":
          if (bitrate) args.push("-b:v", bitrate);
          else {
            const vtQuality = Math.max(0, Math.min(100, 100 - quality * 2));
            args.push("-q:v", String(vtQuality));
          }
          args.push("-allow_sw", "1");
          break;
        case "vaapi":
          args.unshift("-vaapi_device", "/dev/dri/renderD128");
          args.push("-vf", "format=nv12,hwupload");
          if (bitrate) args.push("-b:v", bitrate);
          else args.push("-qp", String(quality));
          break;
        case "qsv":
          args.push("-preset", preset);
          if (bitrate) args.push("-b:v", bitrate);
          else args.push("-global_quality", String(quality));
          break;
      }
    } else {
      const encoderName = codec === "h264" ? "libx264" : "libx265";
      args.push("-c:v", encoderName, "-preset", preset);
      if (bitrate) args.push("-b:v", bitrate);
      else args.push("-crf", String(quality));
    }
  } else if (codec === "vp9") {
    args.push("-c:v", "libvpx-vp9", "-b:v", bitrate || "0", "-crf", String(quality));
    args.push("-deadline", preset === "ultrafast" ? "realtime" : "good");
  } else if (codec === "prores") {
    args.push("-c:v", "prores_ks", "-profile:v", preset, "-vendor", "apl0");
    return [...args, "-y", outputPath];
  }

  if (gpuEncoder !== "vaapi") {
    args.push("-pix_fmt", pixelFormat);
  }

  args.push("-y", outputPath);
  return args;
}

/**
 * Spawn a streaming FFmpeg encoder that accepts frame buffers on stdin.
 */
export async function spawnStreamingEncoder(
  outputPath: string,
  options: StreamingEncoderOptions,
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegStreamingTimeout">>,
): Promise<StreamingEncoder> {
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  let gpuEncoder: GpuEncoder = null;
  if (options.useGpu) {
    gpuEncoder = await getCachedGpuEncoder();
  }

  const args = buildStreamingArgs(options, outputPath, gpuEncoder);

  const startTime = Date.now();
  const ffmpeg: ChildProcess = spawn("ffmpeg", args, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let exitStatus: "running" | "success" | "error" = "running";
  let stderr = "";
  let exitCode: number | null = null;
  let exitPromiseResolve: ((value: void) => void) | null = null;
  const exitPromise = new Promise<void>((resolve) => (exitPromiseResolve = resolve));

  // Track stderr for progress and error messages
  ffmpeg.stderr?.on("data", (data: Buffer) => {
    stderr += data.toString();
  });

  ffmpeg.on("close", (code: number | null) => {
    exitCode = code;
    exitStatus = code === 0 ? "success" : "error";
    exitPromiseResolve?.();
  });

  ffmpeg.on("error", (err: Error) => {
    exitStatus = "error";
    stderr += `\nProcess error: ${err.message}`;
    exitPromiseResolve?.();
  });

  // Handle abort signal
  const onAbort = () => {
    if (exitStatus === "running") {
      ffmpeg.kill("SIGTERM");
    }
  };
  if (signal) {
    if (signal.aborted) {
      ffmpeg.kill("SIGTERM");
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  // Timeout safety
  const streamingTimeout = config?.ffmpegStreamingTimeout ?? DEFAULT_CONFIG.ffmpegStreamingTimeout;
  const timer = setTimeout(() => {
    if (exitStatus === "running") {
      ffmpeg.kill("SIGTERM");
    }
  }, streamingTimeout);

  const encoder: StreamingEncoder = {
    writeFrame: (buffer: Buffer): boolean => {
      if (exitStatus !== "running" || !ffmpeg.stdin || ffmpeg.stdin.destroyed) {
        return false;
      }
      return ffmpeg.stdin.write(buffer);
    },

    close: async (): Promise<StreamingEncoderResult> => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);

      // Close stdin to signal end of input
      if (ffmpeg.stdin && !ffmpeg.stdin.destroyed) {
        await new Promise<void>((resolve) => {
          ffmpeg.stdin!.end(() => resolve());
        });
      }

      // Wait for FFmpeg to finish
      await exitPromise;

      const durationMs = Date.now() - startTime;

      if (signal?.aborted) {
        return {
          success: false,
          durationMs,
          fileSize: 0,
          error: "Streaming encode cancelled",
        };
      }

      if (exitCode !== 0) {
        return {
          success: false,
          durationMs,
          fileSize: 0,
          error: `FFmpeg exited with code ${exitCode}`,
        };
      }

      const fileSize = existsSync(outputPath) ? statSync(outputPath).size : 0;

      return { success: true, durationMs, fileSize };
    },

    getExitStatus: () => exitStatus,
  };

  return encoder;
}
