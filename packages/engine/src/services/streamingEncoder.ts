/**
 * Streaming Encoder Service
 *
 * Pipes frame screenshot buffers directly to FFmpeg's stdin via `-f image2pipe`
 * instead of writing them to disk and reading them back in a separate encode
 * stage. Inspired by Remotion's approach to browser-based video rendering.
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

import {
  type GpuEncoder,
  getCachedGpuEncoder,
  getGpuEncoderName,
  mapPresetForGpuEncoder,
} from "../utils/gpuEncoder.js";
import { formatFfmpegError } from "../utils/runFfmpeg.js";
import { getHdrEncoderColorParams } from "../utils/hdr.js";
import { type EncoderOptions } from "./chunkEncoder.types.js";
import { DEFAULT_CONFIG, type EngineConfig } from "../config.js";

// Re-export EncoderOptions so callers can reference the type via this module.
export type { EncoderOptions } from "./chunkEncoder.types.js";

// ---------------------------------------------------------------------------
// 1. Frame reorder buffer — ordered async barrier
// ---------------------------------------------------------------------------
//
// Parallel workers produce frames out of order; FFmpeg's stdin expects them in
// strict sequential order. Each worker calls `waitForFrame(n)` to block until
// its turn, writes, then calls `advanceTo(n + 1)` to release the next waiter.
//
// `pending` holds an array per frame index (not a single resolver) so that
// `waitForAllDone` can coexist with the writer still waiting on the final
// frame without one clobbering the other.

export interface FrameReorderBuffer {
  waitForFrame: (frame: number) => Promise<void>;
  advanceTo: (frame: number) => void;
  waitForAllDone: () => Promise<void>;
}

export function createFrameReorderBuffer(startFrame: number, endFrame: number): FrameReorderBuffer {
  let cursor = startFrame;
  const pending = new Map<number, Array<() => void>>();

  const enqueueAt = (frame: number, resolve: () => void): void => {
    const list = pending.get(frame);
    if (list === undefined) {
      pending.set(frame, [resolve]);
    } else {
      list.push(resolve);
    }
  };

  const flushAt = (frame: number): void => {
    const list = pending.get(frame);
    if (list === undefined) return;
    pending.delete(frame);
    for (const resolve of list) resolve();
  };

  const waitForFrame = (frame: number): Promise<void> =>
    new Promise<void>((resolve) => {
      if (frame === cursor) {
        resolve();
        return;
      }
      enqueueAt(frame, resolve);
    });

  const advanceTo = (frame: number): void => {
    cursor = frame;
    flushAt(frame);
  };

  const waitForAllDone = (): Promise<void> =>
    new Promise<void>((resolve) => {
      if (cursor >= endFrame) {
        resolve();
        return;
      }
      enqueueAt(endFrame, resolve);
    });

  return { waitForFrame, advanceTo, waitForAllDone };
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
  hdr?: { transfer: import("../utils/hdr.js").HdrTransfer };
  /** When set, use rawvideo input instead of image2pipe. For HDR PQ-encoded frames. */
  rawInputFormat?: "rgb48le";
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
 *
 * Exported so unit tests can assert on the constructed CLI without spawning
 * FFmpeg — see streamingEncoder.test.ts.
 */
export function buildStreamingArgs(
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
  const args: string[] = [];
  if (options.rawInputFormat) {
    // Raw pixel input (HLG/PQ-encoded rgb48le from FFmpeg extraction).
    // Tag the input with the correct color space so FFmpeg uses the right
    // YUV matrix when converting rgb48le → yuv420p10le for encoding.
    // Without these tags FFmpeg assumes bt709 and applies the wrong matrix.
    const hdrTransfer = options.hdr?.transfer;
    const inputColorTrc =
      hdrTransfer === "pq" ? "smpte2084" : hdrTransfer === "hlg" ? "arib-std-b67" : undefined;
    args.push(
      "-f",
      "rawvideo",
      "-pix_fmt",
      options.rawInputFormat,
      "-s",
      `${options.width}x${options.height}`,
      "-framerate",
      String(fps),
    );
    if (inputColorTrc) {
      args.push(
        "-color_primaries",
        "bt2020",
        "-color_trc",
        inputColorTrc,
        "-colorspace",
        "bt2020nc",
      );
    }
    args.push("-i", "-");
  } else {
    const inputCodec = imageFormat === "png" ? "png" : "mjpeg";
    args.push("-f", "image2pipe", "-vcodec", inputCodec, "-framerate", String(fps), "-i", "-");
  }
  args.push("-r", String(fps));

  const shouldUseGpu = useGpu && gpuEncoder !== null;

  if (codec === "h264" || codec === "h265") {
    if (shouldUseGpu) {
      const encoderName = getGpuEncoderName(gpuEncoder, codec);
      args.push("-c:v", encoderName);

      switch (gpuEncoder) {
        case "nvenc":
          args.push("-preset", mapPresetForGpuEncoder("nvenc", preset));
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
          args.push("-preset", mapPresetForGpuEncoder("qsv", preset));
          if (bitrate) args.push("-b:v", bitrate);
          else args.push("-global_quality", String(quality));
          break;
      }
    } else {
      const encoderName = codec === "h264" ? "libx264" : "libx265";
      args.push("-c:v", encoderName, "-preset", preset);
      if (bitrate) args.push("-b:v", bitrate);
      else args.push("-crf", String(quality));

      // Encoder-specific params: anti-banding + color space tagging.
      // For HDR, getHdrEncoderColorParams also emits the SMPTE ST 2086
      // mastering-display and CTA-861.3 MaxCLL/MaxFALL SEI messages —
      // without them, players (Apple, YouTube, HDR TVs) treat the file
      // as SDR BT.2020 and tone-map incorrectly.
      const xParamsFlag = codec === "h264" ? "-x264-params" : "-x265-params";
      const colorParams =
        options.rawInputFormat && options.hdr
          ? getHdrEncoderColorParams(options.hdr.transfer).x265ColorParams
          : "colorprim=bt709:transfer=bt709:colormatrix=bt709";
      if (preset === "ultrafast") {
        args.push(xParamsFlag, `aq-mode=3:${colorParams}`);
      } else {
        args.push(xParamsFlag, `aq-mode=3:aq-strength=0.8:deblock=1,1:${colorParams}`);
      }
      // Apple devices require hvc1 tag for HEVC playback (default hev1 won't open in QuickTime)
      if (codec === "h265") {
        args.push("-tag:v", "hvc1");
      }
    }
  } else if (codec === "vp9") {
    args.push("-c:v", "libvpx-vp9", "-b:v", bitrate || "0", "-crf", String(quality));
    args.push("-deadline", preset === "ultrafast" ? "realtime" : "good");
    args.push("-row-mt", "1");
    if (pixelFormat === "yuva420p") {
      args.push("-auto-alt-ref", "0");
      args.push("-metadata:s:v:0", "alpha_mode=1");
    }
  } else if (codec === "prores") {
    args.push("-c:v", "prores_ks", "-profile:v", preset, "-vendor", "apl0");
    args.push("-pix_fmt", pixelFormat);
    return [...args, "-y", outputPath];
  }

  // Color space metadata.
  // When rawInputFormat is set, data comes from the WebGPU HDR pipeline
  // (PQ-encoded) — tag with bt2020/PQ truthfully.
  // Otherwise, Chrome captures sRGB — tag as bt709.
  if (codec === "h264" || codec === "h265") {
    if (options.rawInputFormat && options.hdr) {
      args.push(
        "-colorspace:v",
        "bt2020nc",
        "-color_primaries:v",
        "bt2020",
        "-color_trc:v",
        options.hdr.transfer === "pq" ? "smpte2084" : "arib-std-b67",
        "-color_range",
        "tv",
      );
    } else {
      args.push(
        "-colorspace:v",
        "bt709",
        "-color_primaries:v",
        "bt709",
        "-color_trc:v",
        "bt709",
        "-color_range",
        "tv",
      );
    }

    // Video filter for range/color conversion.
    // Raw HDR input (from WebGPU pipeline) is already PQ-encoded — no conversion needed.
    // Chrome screenshots need full→TV range conversion.
    if (options.rawInputFormat) {
      // No filter needed — PQ data goes straight to encoder
    } else if (gpuEncoder === "vaapi") {
      const vfIdx = args.indexOf("-vf");
      if (vfIdx !== -1) {
        args[vfIdx + 1] = `scale=in_range=pc:out_range=tv,${args[vfIdx + 1]}`;
      }
    } else if (!shouldUseGpu) {
      // Range conversion: Chrome screenshots are full-range RGB.
      args.push("-vf", "scale=in_range=pc:out_range=tv");
    }

    // Fixed timescale for consistent A/V timing across platforms.
    args.push("-video_track_timescale", "90000");
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
      // Copy the buffer before writing — Node streams hold a reference to the
      // provided buffer and drain it asynchronously. The HDR path's compositor
      // reuses pre-allocated transOutput/normalCanvas buffers across frames,
      // so without this copy the pipe would read partially-overwritten data
      // and flicker. The SDR path doesn't invoke writeFrame at all (it pipes
      // PNG files via encodeFramesFromDir), so the memcpy here is HDR-only
      // and justified by correctness.
      const copy = Buffer.from(buffer);
      return ffmpeg.stdin.write(copy);
    },

    close: async (): Promise<StreamingEncoderResult> => {
      // INVARIANT: close() is idempotent. The renderOrchestrator HDR cleanup
      // path tracks an `encoderClosed` flag and may still re-call close() in
      // the outer finally if the inner cleanup raised before the flag flipped.
      // Each step here must be safe to repeat:
      //   - clearTimeout: safe to call on an already-cleared/fired timer
      //   - removeEventListener: no-op if the listener was already removed
      //     (and {once: true} would have removed it on the first abort anyway)
      //   - stdin.end gated on !destroyed: skipped on the second call
      //   - exitPromise: a single shared Promise; awaiting an already-resolved
      //     Promise resolves immediately with the same captured exitCode
      // The returned StreamingEncoderResult is therefore consistent across
      // repeated calls. If you change this method, preserve idempotency or
      // a regression here will silently double-close ffmpeg and produce
      // harder-to-trace errors at the orchestrator layer.
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);

      const stdin = ffmpeg.stdin;
      if (stdin && !stdin.destroyed) {
        await new Promise<void>((resolve) => {
          stdin.end(() => resolve());
        });
      }

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
          error: formatFfmpegError(exitCode, stderr),
        };
      }

      const fileSize = existsSync(outputPath) ? statSync(outputPath).size : 0;

      return { success: true, durationMs, fileSize };
    },

    getExitStatus: () => exitStatus,
  };

  return encoder;
}
