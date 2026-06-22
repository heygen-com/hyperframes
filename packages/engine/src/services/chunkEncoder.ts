// fallow-ignore-file code-duplication complexity
/**
 * Chunk Encoder Service
 *
 * Encodes captured frames into video using FFmpeg.
 * Supports CPU (libx264) and GPU encoding.
 */

import { spawn } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "fs";
import { join, dirname, extname } from "path";
import { trackChildProcess } from "../utils/processTracker.js";
import { DEFAULT_CONFIG, type EngineConfig } from "../config.js";
import {
  type GpuEncoder,
  getCachedGpuEncoder,
  getGpuEncoderName,
  mapPresetForGpuEncoder,
} from "../utils/gpuEncoder.js";
import { type HdrTransfer, getHdrEncoderColorParams } from "../utils/hdr.js";
import { formatFfmpegError, runFfmpeg } from "../utils/runFfmpeg.js";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { extractAudioMetadata } from "../utils/ffprobe.js";
import { type Fps, fpsToFfmpegArg } from "@hyperframes/core";
import type { EncoderOptions, EncodeResult, MuxResult } from "./chunkEncoder.types.js";
import { appendVp9CpuUsedArg } from "./vp9Options.js";

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

function appendEncodeTimeoutMessage(error: string, timedOut: boolean, timeoutMs: number): string {
  if (!timedOut) return error;
  return `${error}\nFFmpeg killed after exceeding ffmpegEncodeTimeout (${timeoutMs} ms)`;
}

function isAacSidecar(audioPath: string): boolean {
  return extname(audioPath).toLowerCase() === ".aac";
}

const KNOWN_NON_AAC_AUDIO_EXTENSIONS = new Set([
  ".flac",
  ".mp3",
  ".oga",
  ".ogg",
  ".opus",
  ".wav",
  ".webm",
]);

export interface MuxVideoWithAudioOptions extends Partial<
  Pick<EngineConfig, "ffmpegProcessTimeout">
> {
  /**
   * Codec of the sidecar audio when the caller already knows it. HyperFrames
   * render paths pass the mixed AAC sidecar by contract, so muxing should not
   * depend on the file extension alone.
   */
  audioCodec?: "aac";
}

async function shouldCopyAacSidecar(
  audioPath: string,
  options: MuxVideoWithAudioOptions | undefined,
) {
  if (options?.audioCodec === "aac" || isAacSidecar(audioPath)) return true;

  const audioExtension = extname(audioPath).toLowerCase();
  if (KNOWN_NON_AAC_AUDIO_EXTENSIONS.has(audioExtension)) return false;

  try {
    const metadata = await extractAudioMetadata(audioPath);
    return metadata.audioCodec === "aac";
  } catch {
    // Preserve the pre-existing fallback for invalid or unprobeable sidecars:
    // let the final ffmpeg transcode path surface the actionable mux error.
    return false;
  }
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
    vp9CpuUsed,
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

  const args: string[] = [...inputArgs, "-r", fpsToFfmpegArg(fps)];
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
        case "amf":
          if (bitrate) args.push("-b:v", bitrate);
          else args.push("-rc", "cqp", "-qp_i", String(quality), "-qp_p", String(quality));
          break;
      }

      // Same B-frame story as the SW branch below — nvenc/amf emit B-frames
      // by default (qsv via b_strategy, vaapi too), and the negative-DTS
      // freeze hits the same downstream players. The unconditional
      // `-avoid_negative_ts make_zero` near the bottom of this function
      // covers the mux level, but we belt-and-suspenders the encoder too
      // so even tools that consume the chunk file directly (without going
      // through our mux step) play correctly. videotoolbox doesn't accept
      // `-bf` so it's skipped — videotoolbox h264 also doesn't emit
      // negative DTS in practice on macOS Sonoma+.
      if (
        codec === "h264" &&
        (gpuEncoder === "nvenc" ||
          gpuEncoder === "qsv" ||
          gpuEncoder === "vaapi" ||
          gpuEncoder === "amf")
      ) {
        args.push("-bf", "0");
        if (gpuEncoder === "qsv") {
          args.push("-b_strategy", "0");
        }
      }
    } else {
      const encoderName = codec === "h264" ? "libx264" : "libx265";
      args.push("-c:v", encoderName, "-preset", preset);
      if (bitrate) args.push("-b:v", bitrate);
      else args.push("-crf", String(quality));

      // Closed-GOP / forced-keyframe args so an external orchestrator can
      // ffmpeg-concat chunk files with `-c copy`. Without these, libx264 /
      // libx265 emit open-GOP frames with mid-chunk scenecut keyframes; the
      // first frame of each chunk isn't an independently-decodable IDR and
      // concat-copy playback freezes at chunk seams on some decoders.
      const lockGop = options.lockGopForChunkConcat === true;
      let gop = 0;
      if (lockGop) {
        if (
          typeof options.gopSize !== "number" ||
          !Number.isFinite(options.gopSize) ||
          options.gopSize <= 0
        ) {
          throw new Error(
            `[chunkEncoder] lockGopForChunkConcat=true requires a positive integer gopSize (received ${String(options.gopSize)})`,
          );
        }
        gop = Math.floor(options.gopSize);
        args.push(
          "-g",
          String(gop),
          "-keyint_min",
          String(gop),
          "-sc_threshold",
          "0",
          "-force_key_frames",
          `expr:eq(mod(n,${gop}),0)`,
        );
      }

      // Disable B-frames. Standard h264 with B-frames produces negative DTS
      // at the start of the stream (the first B-frame's decode order is
      // "before" the first I-frame's presentation time). VS Code's video
      // preview, several browser <video> pipelines, and some HW decoders
      // freeze on the first frame when DTS is negative, so audio plays alone.
      // -bf 0 makes PTS == DTS at every frame, eliminating the issue at the
      // source. Quality cost is ~5–10% larger files at the same CRF — a
      // worthwhile trade for "the file plays everywhere".
      //
      // Also emit `-bf 0` for h265 when closed-GOP is locked: chunked
      // concat-copy of h265 with B-frames hits the same negative-DTS hazard
      // at every chunk boundary, even though single-stream h265 normally
      // tolerates B-frames fine.
      if (codec === "h264" || (codec === "h265" && lockGop)) {
        args.push("-bf", "0");
      }

      // Encoder-specific params: anti-banding + color space tagging.
      // aq-mode=3 redistributes bits to dark flat areas (gradients).
      // For HDR x265 paths we additionally embed BT.2020 + transfer + HDR static
      // mastering metadata via x265-params; libx264 only carries BT.709 tags
      // since HDR through H.264 is not supported by this encoder path.
      //
      // When closed-GOP is locked we additionally bake the keyint/scenecut
      // controls into the codec param string so libx264's slice-type decisions
      // and libx265's rate-control respect the IDR cadence end-to-end (without
      // these, ffmpeg's `-force_key_frames` is honored but the underlying
      // encoder may still insert mini-GOPs with open-GOP references that
      // break concat-copy on some decoders). `repeat-headers=1` writes SPS/PPS
      // at every keyframe so each chunk file is self-contained.
      const xParamsFlag = codec === "h264" ? "-x264-params" : "-x265-params";
      const colorParams =
        codec === "h265" && options.hdr
          ? getHdrEncoderColorParams(options.hdr.transfer).x265ColorParams
          : "colorprim=bt709:transfer=bt709:colormatrix=bt709";
      let gopParams = "";
      if (lockGop) {
        const shared = "scenecut=0:open-gop=0:repeat-headers=1";
        gopParams = codec === "h264" ? shared : `keyint=${gop}:min-keyint=${gop}:${shared}`;
      }
      const joinParams = (...parts: string[]): string =>
        parts.filter((p) => p.length > 0).join(":");
      if (preset === "ultrafast") {
        args.push(xParamsFlag, joinParams("aq-mode=3", colorParams, gopParams));
      } else {
        args.push(
          xParamsFlag,
          joinParams("aq-mode=3", "aq-strength=0.8", "deblock=1,1", colorParams, gopParams),
        );
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
    appendVp9CpuUsedArg(args, vp9CpuUsed);

    // `-auto-alt-ref 0` is mandatory for chunk concat-copy: libvpx-vp9's
    // alt-ref frames can reference frames in either direction inside a
    // GOP, so a chunk-boundary frame is not guaranteed to be the first
    // displayable reference when alt-ref is on. The shared `vp9CpuUsed`
    // option pins speed/quality against libvpx-vp9 default drift across
    // versions for both chunked and streaming WebM encodes.
    const lockGopVp9 = options.lockGopForChunkConcat === true;
    if (lockGopVp9) {
      if (
        typeof options.gopSize !== "number" ||
        !Number.isFinite(options.gopSize) ||
        options.gopSize <= 0
      ) {
        throw new Error(
          `[chunkEncoder] lockGopForChunkConcat=true requires a positive integer gopSize (received ${String(options.gopSize)})`,
        );
      }
      const gop = Math.floor(options.gopSize);
      args.push("-g", String(gop), "-keyint_min", String(gop), "-auto-alt-ref", "0");
    }
    if (pixelFormat === "yuva420p") {
      // Alpha + alt-ref is unsupported by libvpx-vp9. The closed-GOP
      // branch above already emits `-auto-alt-ref 0`, so skip the
      // duplicate push.
      if (!lockGopVp9) {
        args.push("-auto-alt-ref", "0");
      }
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

  args.push("-avoid_negative_ts", "make_zero");

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
  const inputArgs = ["-framerate", fpsToFfmpegArg(options.fps), "-i", inputPath];
  const args = buildEncoderArgs(options, inputArgs, outputPath, gpuEncoder);

  return new Promise((resolve) => {
    const ffmpeg = spawn(getFfmpegBinary(), args);
    trackChildProcess(ffmpeg);
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
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ffmpeg.kill("SIGTERM");
    }, encodeTimeout);

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      const durationMs = Date.now() - startTime;
      if (signal?.aborted && !timedOut) {
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

      if (code !== 0 || timedOut) {
        resolve({
          success: false,
          outputPath,
          durationMs,
          framesEncoded: 0,
          fileSize: 0,
          error: appendEncodeTimeoutMessage(
            formatFfmpegError(code, stderr),
            timedOut,
            encodeTimeout,
          ),
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
        error: appendEncodeTimeoutMessage(`[FFmpeg] ${err.message}`, timedOut, encodeTimeout),
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
  config?: Partial<Pick<EngineConfig, "ffmpegEncodeTimeout">>,
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
      fpsToFfmpegArg(options.fps),
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
      const ffmpeg = spawn(getFfmpegBinary(), args);
      trackChildProcess(ffmpeg);
      let stderr = "";
      const encodeTimeout = config?.ffmpegEncodeTimeout ?? DEFAULT_CONFIG.ffmpegEncodeTimeout;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ffmpeg.kill("SIGTERM");
      }, encodeTimeout);
      ffmpeg.stderr.on("data", (d) => {
        stderr += d.toString();
      });
      ffmpeg.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0 && !timedOut) resolve({ success: true });
        else {
          resolve({
            success: false,
            error: appendEncodeTimeoutMessage(
              `Chunk ${i} encode failed: ${stderr.slice(-400)}`,
              timedOut,
              encodeTimeout,
            ),
          });
        }
      });
      ffmpeg.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          error: appendEncodeTimeoutMessage(
            `Chunk ${i} encode error: ${err.message}`,
            timedOut,
            encodeTimeout,
          ),
        });
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
    const ffmpeg = spawn(getFfmpegBinary(), concatArgs);
    trackChildProcess(ffmpeg);
    let stderr = "";
    const encodeTimeout = config?.ffmpegEncodeTimeout ?? DEFAULT_CONFIG.ffmpegEncodeTimeout;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ffmpeg.kill("SIGTERM");
    }, encodeTimeout);
    ffmpeg.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    ffmpeg.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) resolve({ success: true });
      else {
        resolve({
          success: false,
          error: appendEncodeTimeoutMessage(
            `Chunk concat failed: ${stderr.slice(-400)}`,
            timedOut,
            encodeTimeout,
          ),
        });
      }
    });
    ffmpeg.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        error: appendEncodeTimeoutMessage(
          `Chunk concat error: ${err.message}`,
          timedOut,
          encodeTimeout,
        ),
      });
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
  config?: MuxVideoWithAudioOptions,
  fps?: Fps,
): Promise<MuxResult> {
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const isWebm = outputPath.endsWith(".webm");
  const isMov = outputPath.endsWith(".mov");
  const shouldCopyAudio = isWebm ? false : await shouldCopyAacSidecar(audioPath, config);
  const args = ["-i", videoPath, "-i", audioPath, "-c:v", "copy"];

  if (isWebm) {
    args.push("-c:a", "libopus", "-b:a", "128k");
  } else if (isMov) {
    if (shouldCopyAudio) {
      args.push("-c:a", "copy");
    } else {
      args.push("-c:a", "aac", "-b:a", "192k");
    }
  } else {
    // processCompositionAudio (audioMixer.ts) performs the AAC encode and
    // owns the single encoder-priming interval. Copying that sidecar into
    // MP4 preserves the correct priming metadata; re-encoding it during mux
    // creates another priming interval that ffmpeg writes as an empty leading
    // video edit list, which QuickTime/Safari render as a black first frame.
    if (shouldCopyAudio) {
      args.push("-c:a", "copy", "-movflags", "+faststart");
    } else {
      args.push("-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart");
    }
  }
  // PTS bases can diverge during mux and reintroduce negative DTS. See
  // buildEncoderArgs for the full reasoning on why that breaks playback.
  args.push("-avoid_negative_ts", "make_zero");
  if (fps !== undefined) {
    // Set the exact output framerate so the muxer doesn't PTS-average a
    // fractional rational like `360000/12001` instead of `30/1` into the
    // output container metadata. `-c:v copy` is retained; no re-encode.
    args.push("-r", fpsToFfmpegArg(fps));
  }
  args.push("-y", outputPath);

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
  fps?: Fps,
): Promise<MuxResult> {
  // faststart is MP4-only (moves moov atom to file start for streaming).
  // WebM and MOV don't need it — skip the re-mux.
  if (outputPath.endsWith(".webm") || outputPath.endsWith(".mov")) {
    if (inputPath !== outputPath) copyFileSync(inputPath, outputPath);
    return { success: true, outputPath, durationMs: 0 };
  }
  const args = ["-i", inputPath, "-c", "copy", "-movflags", "+faststart"];
  if (fps !== undefined) {
    // Set the exact output framerate so the final remux doesn't PTS-average
    // a fractional rational like `360000/12001` instead of `30/1` into the
    // output container metadata. `-c copy` is retained; no re-encode.
    args.push("-r", fpsToFfmpegArg(fps));
  }
  args.push("-y", outputPath);

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
