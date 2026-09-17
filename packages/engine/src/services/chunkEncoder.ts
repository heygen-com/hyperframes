// fallow-ignore-file code-duplication complexity
/**
 * Chunk Encoder Service
 *
 * Encodes captured frames into video using FFmpeg.
 * Supports CPU (libx264) and GPU encoding.
 */

import {
  closeSync,
  copyFileSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  writeSync,
} from "fs";
import { join, dirname, extname } from "path";
import { DEFAULT_CONFIG, type EngineConfig } from "../config.js";
import {
  type GpuEncoder,
  getCachedGpuEncoder,
  getGpuEncoderName,
  buildVideoToolboxRateControlArgs,
  mapPresetForGpuEncoder,
} from "../utils/gpuEncoder.js";
import { type HdrTransfer, getHdrEncoderColorParams } from "../utils/hdr.js";
import { withEvenDimensionPad } from "../utils/evenDimensions.js";
import { formatFfmpegError, isExternalFfmpegInterruption, runFfmpeg } from "../utils/runFfmpeg.js";
import { extractAudioMetadata } from "../utils/ffprobe.js";
import { type Fps, fpsToFfmpegArg, fpsToNumber } from "@hyperframes/core";
import type { EncoderOptions, EncodeResult, MuxResult } from "./chunkEncoder.types.js";
import { appendVp9CpuUsedArg } from "./vp9Options.js";
import { appendRenderProvenanceArgs } from "../utils/renderProvenance.js";

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
  // Two independent reports of this exact timeout, both resolved by env vars
  // that already exist but aren't named anywhere the user would see them at
  // the point of failure — they had to go find FFMPEG_ENCODE_TIMEOUT_MS and
  // PRODUCER_ENABLE_CHUNKED_ENCODE themselves. Name both here instead of
  // just stating what happened.
  return (
    `${error}\nFFmpeg killed after exceeding ffmpegEncodeTimeout (${timeoutMs} ms). ` +
    "Long or high-frame-count renders may need more time: set FFMPEG_ENCODE_TIMEOUT_MS " +
    "to a higher value (ms), or set PRODUCER_ENABLE_CHUNKED_ENCODE=true to encode in " +
    "smaller chunks instead of one long-running ffmpeg process."
  );
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
  /**
   * @deprecated No longer used. `-avoid_negative_ts` is never passed for
   * mp4/mov muxing (ffmpeg's `auto` default already resolves to `disabled`
   * for those containers), so the AAC priming edit list is preserved
   * unconditionally and this flag has no effect. See issue #3487. Kept for
   * source compatibility; it will be removed in a future major.
   */
  preserveAudioPrimingEditList?: boolean;
  /** Hard cap copied audio to the already-encoded video's exact duration. */
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

/** The `lockGopForChunkConcat` / `gopSize` pair, shared by every encoder entry point. */
export interface LockedGopOptions {
  lockGopForChunkConcat?: boolean;
  gopSize?: number;
}

/**
 * Integer GOP length, or `null` when no lock was requested. Throws on a lock
 * with an invalid size — a silent fallback ships open-GOP output that only
 * surfaces later as a broken playback seam.
 */
export function resolveLockedGopSize(options: LockedGopOptions): number | null {
  if (options.lockGopForChunkConcat !== true) return null;
  if (
    typeof options.gopSize !== "number" ||
    !Number.isFinite(options.gopSize) ||
    options.gopSize <= 0
  ) {
    throw new Error(
      `[chunkEncoder] lockGopForChunkConcat=true requires a positive integer gopSize (received ${String(options.gopSize)})`,
    );
  }
  return Math.floor(options.gopSize);
}

/**
 * Closed-GOP / forced-keyframe args for libx264 / libx265, so an orchestrator
 * can concat chunks with `-c copy` or cut the stream into segments with
 * `-f hls -c copy`. Without them the encoder picks its own keyframes and a
 * boundary may not land on an independently decodable IDR.
 */
export function appendLockedGopArgs(args: string[], gopSize: number): void {
  args.push(
    "-g",
    String(gopSize),
    "-keyint_min",
    String(gopSize),
    "-sc_threshold",
    "0",
    "-force_key_frames",
    `expr:eq(mod(n,${gopSize}),0)`,
  );
}

/**
 * The `-x264-params` / `-x265-params` fragment that bakes the IDR cadence into
 * the encoder itself — `-force_key_frames` alone still permits mini-GOPs with
 * open-GOP references. `repeat-headers=1` keeps each boundary self-contained.
 */
export function lockedGopCodecParams(codec: "h264" | "h265", gopSize: number): string {
  const shared = "scenecut=0:open-gop=0:repeat-headers=1";
  return codec === "h264" ? shared : `keyint=${gopSize}:min-keyint=${gopSize}:${shared}`;
}

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
          args.push(
            ...buildVideoToolboxRateControlArgs({
              bitrate,
              width: options.width,
              height: options.height,
              fps: fpsToNumber(fps),
              quality,
            }),
          );
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
      // ffmpeg-concat chunk files with `-c copy`. See `appendLockedGopArgs`.
      const gop = resolveLockedGopSize(options);
      const lockGop = gop !== null;
      if (gop !== null) appendLockedGopArgs(args, gop);

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
      const gopParams = gop !== null ? lockedGopCodecParams(codec, gop) : "";
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
    const vp9Gop = resolveLockedGopSize(options);
    const lockGopVp9 = vp9Gop !== null;
    if (vp9Gop !== null) {
      args.push("-g", String(vp9Gop), "-keyint_min", String(vp9Gop), "-auto-alt-ref", "0");
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
    appendRenderProvenanceArgs(args, outputPath);
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
      // vaapi already runs `format=nv12,hwupload`; the nv12 conversion aligns
      // odd dimensions before upload, so only prepend the range conversion.
      const vfIdx = args.indexOf("-vf");
      if (vfIdx !== -1) {
        args[vfIdx + 1] = `scale=in_range=pc:out_range=tv,${args[vfIdx + 1]}`;
      }
    } else if (shouldUseGpu) {
      // nvenc/videotoolbox/qsv/amf feed software frames straight to the HW
      // encoder with no `-vf`. They hit the same "height not divisible by 2"
      // abort as libx264 on an odd-sized 4:2:0 canvas, so pad odd dimensions
      // up to even on the software side before the encode.
      const vf = withEvenDimensionPad("", pixelFormat, options.width, options.height);
      if (vf) args.push("-vf", vf);
    } else {
      // Range conversion: Chrome screenshots are full-range RGB.
      // The scale filter handles both 8-bit and 10-bit correctly. Pad odd
      // dimensions up to even so libx264/libx265 (4:2:0) don't abort with
      // "height not divisible by 2" on an odd-sized composition canvas.
      args.push(
        "-vf",
        withEvenDimensionPad(
          "scale=in_range=pc:out_range=tv",
          pixelFormat,
          options.width,
          options.height,
        ),
      );
    }

    // Fixed timescale for consistent A/V timing across platforms.
    args.push("-video_track_timescale", "90000");
  }

  if (gpuEncoder !== "vaapi") {
    args.push("-pix_fmt", pixelFormat);
  }

  args.push("-avoid_negative_ts", "make_zero");

  appendRenderProvenanceArgs(args, outputPath);

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
  const encodeTimeout = config?.ffmpegEncodeTimeout ?? DEFAULT_CONFIG.ffmpegEncodeTimeout;
  const result = await runFfmpeg(args, { signal, timeout: encodeTimeout });
  if (result.terminationReason === "abort") {
    return {
      success: false,
      outputPath,
      durationMs: result.durationMs,
      framesEncoded: 0,
      fileSize: 0,
      error: "FFmpeg encode cancelled",
    };
  }
  if (!result.success) {
    return {
      success: false,
      outputPath,
      durationMs: result.durationMs,
      framesEncoded: 0,
      fileSize: 0,
      error: appendEncodeTimeoutMessage(
        formatFfmpegError(result.exitCode, result.stderr),
        result.terminationReason === "deadline",
        encodeTimeout,
      ),
      failureReason: isExternalFfmpegInterruption(result) ? "external_interruption" : undefined,
    };
  }
  const fileSize = existsSync(outputPath) ? statSync(outputPath).size : 0;
  return {
    success: true,
    outputPath,
    durationMs: Date.now() - startTime,
    framesEncoded: frameCount,
    fileSize,
  };
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
  mkdirSync(dirname(outputPath), { recursive: true });
  // Keep intermediates under the caller-owned output directory for its existing
  // cleanup/debug policy, but never reuse another invocation's chunk files.
  const chunkDir = mkdtempSync(join(dirname(outputPath), "chunk-encode-"));
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
    const encodeTimeout = config?.ffmpegEncodeTimeout ?? DEFAULT_CONFIG.ffmpegEncodeTimeout;
    const processResult = await runFfmpeg(args, { signal, timeout: encodeTimeout });
    const chunkResult = {
      success: processResult.success,
      error: processResult.success
        ? undefined
        : appendEncodeTimeoutMessage(
            `Chunk ${i} encode failed: ${processResult.stderr.slice(-400)}`,
            processResult.terminationReason === "deadline",
            encodeTimeout,
          ),
    };
    if (!chunkResult.success) {
      return {
        success: false,
        outputPath,
        durationMs: Date.now() - start,
        framesEncoded: 0,
        fileSize: 0,
        error: chunkResult.error,
        failureReason: isExternalFfmpegInterruption(processResult)
          ? "external_interruption"
          : undefined,
      };
    }
    chunkPaths.push(chunkPath);
  }

  const concatListPath = join(chunkDir, "concat-list.txt");
  const concatInput = chunkPaths.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join("\n");
  writeFileSync(concatListPath, concatInput, "utf-8");

  const concatArgs = ["-f", "concat", "-safe", "0", "-i", concatListPath, "-c", "copy"];
  // The concat demuxer does not carry per-chunk container metadata into the
  // output, so the chunks' provenance is dropped here even though every chunk
  // carries it. Re-assert on the concatenated file: for a no-audio mov/webm
  // this is the last container write, since mux is skipped and applyFaststart
  // only copies those two formats.
  appendRenderProvenanceArgs(concatArgs, outputPath);
  concatArgs.push("-y", outputPath);
  const encodeTimeout = config?.ffmpegEncodeTimeout ?? DEFAULT_CONFIG.ffmpegEncodeTimeout;
  const concatProcessResult = await runFfmpeg(concatArgs, { signal, timeout: encodeTimeout });
  const concatResult = {
    success: concatProcessResult.success,
    error: concatProcessResult.success
      ? undefined
      : appendEncodeTimeoutMessage(
          `Chunk concat failed: ${concatProcessResult.stderr.slice(-400)}`,
          concatProcessResult.terminationReason === "deadline",
          encodeTimeout,
        ),
  };

  if (!concatResult.success) {
    return {
      success: false,
      outputPath,
      durationMs: Date.now() - start,
      framesEncoded: 0,
      fileSize: 0,
      error: concatResult.error,
      failureReason: isExternalFfmpegInterruption(concatProcessResult)
        ? "external_interruption"
        : undefined,
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
  // No `-avoid_negative_ts` here, in any mode. ffmpeg's default is `auto`,
  // which the mp4/mov muxers (AVFMT_TS_NEGATIVE) already resolve to
  // `disabled` — the correct behavior for the containers this function
  // writes. Passing `make_zero` explicitly overrides that default and, on the
  // dominant audio-copy path, discards the AAC priming edit list the sidecar
  // encode created: the video start_time shifts forward one AAC frame
  // (~21ms) and the muxer writes an empty video edit at t=0, which
  // edit-list-honoring players (QuickTime/Safari) show as a black first
  // frame. See issue #3487. The video-only encoder args (buildEncoderArgs)
  // still pass the flag deliberately — those chunks are consumed as raw
  // elementary output, not as a delivered mp4/mov.
  //
  // Re-assert provenance here: this stage re-muxes into the delivered
  // container, and the mp4 muxer drops the encode stage's tags without the
  // use_metadata_tags flag that appendRenderProvenanceArgs adds.
  appendRenderProvenanceArgs(args, outputPath);
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
    failureReason: result.failureReason,
  };
}

export const HLS_MASTER_PLAYLIST = "master.m3u8";
export const HLS_VIDEO_PLAYLIST = "video.m3u8";
export const HLS_AUDIO_PLAYLIST = "audio.m3u8";

/**
 * Drop the standalone audio-only variant ffmpeg's `-var_stream_map` adds to
 * the master playlist.
 *
 * With `a:0,agroup:aud` the hls muxer lists the audio rendition twice: as the
 * `#EXT-X-MEDIA:TYPE=AUDIO` entry the video variant references (wanted), and
 * again as its own `#EXT-X-STREAM-INF` variant with no `RESOLUTION` (not
 * wanted). That is valid HLS, but a player choosing variants by bandwidth can
 * pick it and play sound with no picture, and the VOD consumer asked for a
 * single rendition. A variant tag without a `RESOLUTION` attribute is
 * audio-only; its URI is always the following line, so both go.
 */
export function stripAudioOnlyVariants(masterPlaylist: string): string {
  const lines = masterPlaylist.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("#EXT-X-STREAM-INF:") && !line.includes("RESOLUTION=")) {
      // ffmpeg separates variants with a blank line; drop the one before this
      // variant so the master does not end up with two in a row.
      if (kept.at(-1) === "") kept.pop();
      i += 1;
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

export interface PackageHlsOptions extends Partial<Pick<EngineConfig, "ffmpegProcessTimeout">> {
  /** Whole seconds, so it matches the integer `EXT-X-TARGETDURATION` ffmpeg writes. */
  segmentSeconds: number;
  signal?: AbortSignal;
}

/**
 * Stream-copy an H.264 video (and optional AAC sidecar) into an HLS VOD
 * directory: `master.m3u8`, `video.m3u8` + `video_%05d.ts`, and `audio.m3u8` +
 * `audio_%05d.ts` when audio is given. `outputPath` in the result is the directory.
 * The master carries exactly one `#EXT-X-STREAM-INF` variant (the video, with
 * the audio attached as a rendition group); see `stripAudioOnlyVariants`.
 *
 * `-hls_time` cuts at the first keyframe at or after each target, so the input
 * must be encoded with the GOP lock (`gopSize = segmentSeconds × fps`). The lock
 * is software-encoder only; a GPU encode will not segment on time.
 */
export async function packageHls(
  videoPath: string,
  audioPath: string | null,
  outputDir: string,
  options: PackageHlsOptions,
): Promise<MuxResult> {
  const { segmentSeconds, signal } = options;
  if (!Number.isInteger(segmentSeconds) || segmentSeconds <= 0) {
    throw new Error(
      `[chunkEncoder] packageHls requires a positive integer segmentSeconds (received ${String(segmentSeconds)})`,
    );
  }
  // `-hls_segment_filename` is a printf template and the hls muxer does not honor `%%`.
  if (outputDir.includes("%")) {
    throw new Error(`[chunkEncoder] packageHls outputDir must not contain "%": ${outputDir}`);
  }

  // ffmpeg does not create the directory for the segment pattern.
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const hasAudio = audioPath !== null;
  const args = hasAudio
    ? ["-i", videoPath, "-i", audioPath, "-map", "0:v:0", "-map", "1:a:0"]
    : ["-i", videoPath, "-map", "0:v:0"];

  args.push(
    "-c",
    "copy",
    "-f",
    "hls",
    "-hls_time",
    String(segmentSeconds),
    "-hls_playlist_type",
    "vod",
    "-hls_flags",
    "independent_segments",
    "-hls_segment_type",
    "mpegts",
    "-var_stream_map",
    hasAudio ? "v:0,agroup:aud,name:video a:0,agroup:aud,name:audio" : "v:0,name:video",
    "-master_pl_name",
    HLS_MASTER_PLAYLIST,
    "-hls_segment_filename",
    join(outputDir, "%v_%05d.ts"),
    // Without these the mpegts muxer starts the stream at PTS 1.4 s.
    "-muxdelay",
    "0",
    "-muxpreload",
    "0",
  );

  // No provenance tags (MPEG-TS drops them; `-movflags` is invalid for `-f hls`)
  // and no `-avoid_negative_ts`, which would drop the AAC priming (#3487).
  args.push("-y", join(outputDir, "%v.m3u8"));

  const processTimeout = options.ffmpegProcessTimeout ?? DEFAULT_CONFIG.ffmpegProcessTimeout;
  const result = await runFfmpeg(args, { signal, timeout: processTimeout });

  if (signal?.aborted) {
    return {
      success: false,
      outputPath: outputDir,
      durationMs: result.durationMs,
      error: "FFmpeg HLS packaging cancelled",
    };
  }
  if (result.success && hasAudio) {
    const masterPath = join(outputDir, HLS_MASTER_PLAYLIST);
    // One descriptor for the read-modify-write: re-resolving the path to write
    // it back races anything else in this predictable temp dir, and `r+` with
    // owner-only mode neither creates nor widens the playlist ffmpeg wrote.
    // A missing one is fine — the argument-level tests stub ffmpeg.
    let master: number | undefined;
    try {
      master = openSync(masterPath, "r+", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (master !== undefined) {
      try {
        const stripped = stripAudioOnlyVariants(readFileSync(master, "utf-8"));
        // Stripping only shortens the playlist; truncate or the tail survives.
        ftruncateSync(master, 0);
        writeSync(master, stripped, 0, "utf-8");
      } finally {
        closeSync(master);
      }
    }
  }
  return {
    success: result.success,
    outputPath: outputDir,
    durationMs: result.durationMs,
    error: !result.success ? formatFfmpegError(result.exitCode, result.stderr) : undefined,
    failureReason: result.failureReason,
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
  appendRenderProvenanceArgs(args, outputPath);
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
    failureReason: result.failureReason,
  };
}
