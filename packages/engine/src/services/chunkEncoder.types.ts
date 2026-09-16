import type { HdrTransfer } from "../utils/hdr.js";
import type { Fps } from "@hyperframes/core";

export interface EncoderOptions {
  /** Frame rate as an exact rational; see `Fps` in @hyperframes/core. */
  fps: Fps;
  width: number;
  height: number;
  codec?: "h264" | "h265" | "vp9" | "prores";
  preset?: string;
  quality?: number;
  bitrate?: string;
  pixelFormat?: string;
  /** libvpx-vp9 -cpu-used value. Defaults to the engine VP9 setting. */
  vp9CpuUsed?: number;
  useGpu?: boolean;
  hdr?: { transfer: HdrTransfer };
  /**
   * When `true`, force closed-GOP encoding with a keyframe at every
   * `gopSize` boundary so the resulting stream can be losslessly
   * concatenated (`ffmpeg -f concat -c copy`) with sibling chunks, or cut
   * into fixed-length HLS media segments with `-f hls -c copy`.
   *
   * Default `false`: GOP placement is left to libx264/libx265 defaults
   * (open-GOP, scenecut-driven keyframes), preserving the in-process
   * renderer's byte-identical output.
   *
   * The SW libx264 / libx265 / libvpx-vp9 paths honor it fully. GPU encoders
   * take the generic `-g` / `-keyint_min` / `-force_key_frames` args only —
   * `-sc_threshold` and the x264/x265 param string have no GPU equivalent.
   * ProRes ignores the flag entirely: it is intra-only, so every frame is
   * already a keyframe and there is nothing to force.
   *
   * For libvpx-vp9, closed-GOP also forces `-auto-alt-ref 0` so the
   * boundary frame between chunks remains independently decodable —
   * libvpx-vp9's default alt-ref frames can land anywhere in the GOP
   * for compression and break concat-copy seams.
   */
  lockGopForChunkConcat?: boolean;
  /**
   * Required when `lockGopForChunkConcat` is `true`. Number of frames per
   * GOP — set to `chunkSize` so every chunk starts on an IDR keyframe and
   * concat-copy boundaries land on independently-decodable frames.
   */
  gopSize?: number;
}

export interface EncodeResult {
  success: boolean;
  outputPath: string;
  durationMs: number;
  framesEncoded: number;
  fileSize: number;
  error?: string;
  /** Stable machine-readable cause for failures safe to retry on a fresh host. */
  failureReason?: "external_interruption";
}

export interface MuxResult {
  success: boolean;
  outputPath: string;
  durationMs: number;
  error?: string;
  /** Stable machine-readable cause for failures safe to retry on a fresh host. */
  failureReason?: "external_interruption";
}
