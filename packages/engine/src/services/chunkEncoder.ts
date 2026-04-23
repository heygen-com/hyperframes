/**
 * Chunk Encoder Service
 *
 * Encodes captured frames into video using FFmpeg.
 * Supports CPU (libx264) and GPU encoding.
 */

import { spawn } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { DEFAULT_CONFIG, type EngineConfig } from "../config.js";
import {
  type GpuEncoder,
  getCachedGpuEncoder,
  getGpuEncoderName,
  mapPresetForGpuEncoder,
} from "../utils/gpuEncoder.js";
import { type HdrTransfer, getHdrEncoderColorParams } from "../utils/hdr.js";
import { formatFfmpegError, runFfmpeg } from "../utils/runFfmpeg.js";
import type { EncoderOptions, EncodeResult, MuxResult } from "./chunkEncoder.types.js";

export type { EncoderOptions, EncodeResult, MuxResult } from "./chunkEncoder.types.js";

export const ENCODER_PRESETS = {
  draft: { preset: "ultrafast", quality: 28, codec: "h264" as const },
  standard: { preset: "medium", quality: 18, codec: "h264" as const },
  high: { preset: "slow", quality: 15, codec: "h264" as const },
};

export interface EncoderPreset {
  preset: string;
  quality: number;
  codec: "h264" | "h265" | "vp9" | "prores";
  pixelFormat: string;
  hdr?: { transfer: HdrTransfer };
}

/**
 * Get encoder preset for a given quality and output format.
 * WebM uses VP9 with alpha-capable pixel format; MP4 uses h264 (or h265 for HDR);
 * MOV uses ProRes 4444 with alpha for editor-compatible transparency.
 */
export function getEncoderPreset(
  quality: "draft" | "standard" | "high",
  format: "mp4" | "webm" | "mov" = "mp4",
  hdr?: { transfer: HdrTransfer },
): EncoderPreset {
  const base = ENCODER_PRESETS[quality];
  if (format === "webm") {
    return {
      preset: base.preset === "ultrafast" ? "realtime" : "good",
      quality: base.quality,
      codec: "vp9",
      pixelFormat: "yuva420p",
    };
  }
  if (format === "mov") {
    return {
      preset: "4444",
      quality: base.quality,
      codec: "prores",
      pixelFormat: "yuva444p10le",
    };
  }
  if (hdr) {
    return {
      preset: base.preset === "ultrafast" ? "fast" : base.preset,
      quality: base.quality,
      codec: "h265",
      pixelFormat: "yuv420p10le",
      hdr,
    };
  }
  return { ...base, pixelFormat: "yuv420p" };
}

// Re-export GPU utilities so existing consumers that import from chunkEncoder still work.
export { detectGpuEncoder, type GpuEncoder } from "../utils/gpuEncoder.js";

export function buildEncoderArgs(
  options: EncoderOptions,
  inputArgs: string[],
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
  } = options;

  // libx264 cannot encode HDR. If a caller passes hdr with codec=h264 we'd
  // produce a "half-HDR" file (BT.2020 container tags but a BT.709 VUI block
  // inside the bitstream) which confuses HDR-aware players. Strip hdr and
  // log a warning so the caller picks h265 (the SDR-tagged output is honest).
  if (options.hdr && codec === "h264") {
    console.warn(
      "[chunkEncoder] HDR is not supported with codec=h264 (libx264 has no HDR support). " +
        "Stripping HDR metadata and tagging output as SDR/BT.709. Use codec=h265 for HDR output.",
    );
    options = { ...options, hdr: undefined };
  }

  const args: string[] = [...inputArgs, "-r", String(fps)];
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
      // aq-mode=3 redistributes bits to dark flat areas (gradients).
      // For HDR x265 paths we additionally embed BT.2020 + transfer + HDR static
      // mastering metadata via x265-params; libx264 only carries BT.709 tags
      // since HDR through H.264 is not supported by this encoder path.
      const xParamsFlag = codec === "h264" ? "-x264-params" : "-x265-params";
      const colorParams =
        codec === "h265" && options.hdr
          ? getHdrEncoderColorParams(options.hdr.transfer).x265ColorParams
          : "colorprim=bt709:transfer=bt709:colormatrix=bt709";
      if (preset === "ultrafast") {
        args.push(xParamsFlag, `aq-mode=3:${colorParams}`);
      } else {
        args.push(xParamsFlag, `aq-mode=3:aq-strength=0.8:deblock=1,1:${colorParams}`);
      }
    }
    // Apple devices require hvc1 tag for HEVC playback (default hev1 won't open in QuickTime)
    if (codec === "h265") {
      args.push("-tag:v", "hvc1");
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

  // Color space metadata — tags the output so players interpret colors correctly.
  //
  // Default (no options.hdr): Chrome screenshots are sRGB/bt709 pixels and
  // we tag them truthfully as bt709. Tagging as bt2020 when pixels are bt709
  // causes browsers to apply the wrong color transform, producing visible
  // orange/warm shifts.
  //
  // HDR (options.hdr provided): the caller asserts the input pixels are
  // already in the BT.2020 color space (e.g. extracted HDR video frames or a
  // pre-tagged source). We tag the output as BT.2020 + the corresponding
  // transfer (smpte2084 for PQ, arib-std-b67 for HLG). HDR static mastering
  // metadata (master-display, max-cll) is embedded only in the SW libx265
  // path above; GPU H.265 + HDR carries the color tags but not the static
  // metadata, which is acceptable for previews but not for HDR-aware delivery.
  if (codec === "h264" || codec === "h265") {
    if (options.hdr) {
      const transferTag = options.hdr.transfer === "pq" ? "smpte2084" : "arib-std-b67";
      args.push(
        "-colorspace:v",
        "bt2020nc",
        "-color_primaries:v",
        "bt2020",
        "-color_trc:v",
        transferTag,
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

    // Range conversion: Chrome's full-range RGB → limited/TV range.
    if (gpuEncoder === "vaapi") {
      const vfIdx = args.indexOf("-vf");
      if (vfIdx !== -1) {
        args[vfIdx + 1] = `scale=in_range=pc:out_range=tv,${args[vfIdx + 1]}`;
      }
    } else if (!shouldUseGpu) {
      // Range conversion: Chrome screenshots are full-range RGB.
      // The scale filter handles both 8-bit and 10-bit correctly.
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

export async function encodeFramesFromDir(
  framesDir: string,
  framePattern: string,
  outputPath: string,
  options: EncoderOptions,
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegEncodeTimeout">>,
): Promise<EncodeResult> {
  const startTime = Date.now();

  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const files = readdirSync(framesDir).filter((f) => f.match(/\.(jpg|jpeg|png)$/i));
  const frameCount = files.length;

  if (frameCount === 0) {
    return {
      success: false,
      outputPath,
      durationMs: Date.now() - startTime,
      framesEncoded: 0,
      fileSize: 0,
      error: "[FFmpeg] No frame files found in directory",
    };
  }

  let gpuEncoder: GpuEncoder = null;
  if (options.useGpu) {
    gpuEncoder = await getCachedGpuEncoder();
  }

  const inputPath = join(framesDir, framePattern);
  const inputArgs = ["-framerate", String(options.fps), "-i", inputPath];
  const args = buildEncoderArgs(options, inputArgs, outputPath, gpuEncoder);

  return new Promise((resolve) => {
    const ffmpeg = spawn("ffmpeg", args);
    let stderr = "";
    const onAbort = () => {
      ffmpeg.kill("SIGTERM");
    };
    if (signal) {
      if (signal.aborted) {
        ffmpeg.kill("SIGTERM");
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    const encodeTimeout = config?.ffmpegEncodeTimeout ?? DEFAULT_CONFIG.ffmpegEncodeTimeout;
    const timer = setTimeout(() => {
      ffmpeg.kill("SIGTERM");
    }, encodeTimeout);

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      const durationMs = Date.now() - startTime;
      if (signal?.aborted) {
        resolve({
          success: false,
          outputPath,
          durationMs,
          framesEncoded: 0,
          fileSize: 0,
          error: "FFmpeg encode cancelled",
        });
        return;
      }

      if (code !== 0) {
        resolve({
          success: false,
          outputPath,
          durationMs,
          framesEncoded: 0,
          fileSize: 0,
          error: formatFfmpegError(code, stderr),
        });
        return;
      }

      const fileSize = existsSync(outputPath) ? statSync(outputPath).size : 0;
      resolve({ success: true, outputPath, durationMs, framesEncoded: frameCount, fileSize });
    });

    ffmpeg.on("error", (err) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve({
        success: false,
        outputPath,
        durationMs: Date.now() - startTime,
        framesEncoded: 0,
        fileSize: 0,
        error: `[FFmpeg] ${err.message}`,
      });
    });
  });
}

export async function encodeFramesChunkedConcat(
  framesDir: string,
  framePattern: string,
  outputPath: string,
  options: EncoderOptions,
  chunkSizeFrames: number,
  signal?: AbortSignal,
): Promise<EncodeResult> {
  const start = Date.now();
  const files = readdirSync(framesDir)
    .filter((f) => f.match(/\.(jpg|jpeg|png)$/i))
    .sort();
  if (files.length === 0) {
    return {
      success: false,
      outputPath,
      durationMs: Date.now() - start,
      framesEncoded: 0,
      fileSize: 0,
      error: "[FFmpeg] No frame files found in directory",
    };
  }
  const chunkSize = Math.max(30, Math.floor(chunkSizeFrames));
  const chunkCount = Math.ceil(files.length / chunkSize);
  const chunkDir = join(dirname(outputPath), "chunk-encode");
  if (!existsSync(chunkDir)) mkdirSync(chunkDir, { recursive: true });
  const chunkPaths: string[] = [];

  for (let i = 0; i < chunkCount; i++) {
    if (signal?.aborted) {
      return {
        success: false,
        outputPath,
        durationMs: Date.now() - start,
        framesEncoded: 0,
        fileSize: 0,
        error: "Chunked encode cancelled",
      };
    }
    const startNumber = i * chunkSize;
    const framesInChunk = Math.min(chunkSize, files.length - startNumber);
    const ext = outputPath.endsWith(".webm")
      ? ".webm"
      : outputPath.endsWith(".mov")
        ? ".mov"
        : ".mp4";
    const chunkPath = join(chunkDir, `chunk_${String(i).padStart(4, "0")}${ext}`);
    const inputPath = join(framesDir, framePattern);
    const inputArgs = [
      "-framerate",
      String(options.fps),
      "-start_number",
      String(startNumber),
      "-i",
      inputPath,
      "-frames:v",
      String(framesInChunk),
    ];
    let gpuEncoder: GpuEncoder = null;
    if (options.useGpu) gpuEncoder = await getCachedGpuEncoder();
    const args = buildEncoderArgs(options, inputArgs, chunkPath, gpuEncoder);
    const chunkResult = await new Promise<{ success: boolean; error?: string }>((resolve) => {
      const ffmpeg = spawn("ffmpeg", args);
      let stderr = "";
      ffmpeg.stderr.on("data", (d) => {
        stderr += d.toString();
      });
      ffmpeg.on("close", (code) => {
        if (code === 0) resolve({ success: true });
        else resolve({ success: false, error: `Chunk ${i} encode failed: ${stderr.slice(-400)}` });
      });
      ffmpeg.on("error", (err) => {
        resolve({ success: false, error: `Chunk ${i} encode error: ${err.message}` });
      });
    });
    if (!chunkResult.success) {
      return {
        success: false,
        outputPath,
        durationMs: Date.now() - start,
        framesEncoded: 0,
        fileSize: 0,
        error: chunkResult.error,
      };
    }
    chunkPaths.push(chunkPath);
  }

  const concatListPath = join(chunkDir, "concat-list.txt");
  const concatInput = chunkPaths.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join("\n");
  writeFileSync(concatListPath, concatInput, "utf-8");

  const concatArgs = [
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatListPath,
    "-c",
    "copy",
    "-y",
    outputPath,
  ];
  const concatResult = await new Promise<{ success: boolean; error?: string }>((resolve) => {
    const ffmpeg = spawn("ffmpeg", concatArgs);
    let stderr = "";
    ffmpeg.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve({ success: true });
      else resolve({ success: false, error: `Chunk concat failed: ${stderr.slice(-400)}` });
    });
    ffmpeg.on("error", (err) => {
      resolve({ success: false, error: `Chunk concat error: ${err.message}` });
    });
  });

  if (!concatResult.success) {
    return {
      success: false,
      outputPath,
      durationMs: Date.now() - start,
      framesEncoded: 0,
      fileSize: 0,
      error: concatResult.error,
    };
  }

  const fileSize = existsSync(outputPath) ? statSync(outputPath).size : 0;
  return {
    success: true,
    outputPath,
    durationMs: Date.now() - start,
    framesEncoded: files.length,
    fileSize,
  };
}

export async function muxVideoWithAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegProcessTimeout">>,
): Promise<MuxResult> {
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const isWebm = outputPath.endsWith(".webm");
  const isMov = outputPath.endsWith(".mov");
  const args = ["-i", videoPath, "-i", audioPath, "-c:v", "copy"];

  if (isWebm) {
    args.push("-c:a", "libopus", "-b:a", "128k");
  } else if (isMov) {
    args.push("-c:a", "aac", "-b:a", "192k");
  } else {
    args.push("-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart");
  }
  args.push("-shortest", "-y", outputPath);

  const processTimeout = config?.ffmpegProcessTimeout ?? DEFAULT_CONFIG.ffmpegProcessTimeout;
  const result = await runFfmpeg(args, { signal, timeout: processTimeout });

  if (signal?.aborted) {
    return {
      success: false,
      outputPath,
      durationMs: result.durationMs,
      error: "FFmpeg mux cancelled",
    };
  }
  return {
    success: result.success,
    outputPath,
    durationMs: result.durationMs,
    error: !result.success ? formatFfmpegError(result.exitCode, result.stderr) : undefined,
  };
}

export async function applyFaststart(
  inputPath: string,
  outputPath: string,
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegProcessTimeout">>,
): Promise<MuxResult> {
  // faststart is MP4-only (moves moov atom to file start for streaming).
  // WebM and MOV don't need it — skip the re-mux.
  if (outputPath.endsWith(".webm") || outputPath.endsWith(".mov")) {
    if (inputPath !== outputPath) copyFileSync(inputPath, outputPath);
    return { success: true, outputPath, durationMs: 0 };
  }
  const args = ["-i", inputPath, "-c", "copy", "-movflags", "+faststart", "-y", outputPath];

  const processTimeout = config?.ffmpegProcessTimeout ?? DEFAULT_CONFIG.ffmpegProcessTimeout;
  const result = await runFfmpeg(args, { signal, timeout: processTimeout });

  if (signal?.aborted) {
    return {
      success: false,
      outputPath,
      durationMs: result.durationMs,
      error: "FFmpeg faststart cancelled",
    };
  }
  return {
    success: result.success,
    outputPath,
    durationMs: result.durationMs,
    error: !result.success ? formatFfmpegError(result.exitCode, result.stderr) : undefined,
  };
}
