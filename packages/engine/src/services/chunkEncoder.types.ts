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
   * `gopSize` boundary so the resulting chunk file can be losslessly
   * concatenated (`ffmpeg -f concat -c copy`) with sibling chunks.
   *
   * Default `false`: GOP placement is left to libx264/libx265 defaults
   * (open-GOP, scenecut-driven keyframes), preserving the in-process
   * renderer's byte-identical output.
   *
   * Honored by the SW libx264 / libx265 / libvpx-vp9 paths. GPU encoders
   * and ProRes ignore the flag — GPU concat-copy is a separate story and
   * ProRes is intra-only (every frame is already a keyframe, so no
   * closed-GOP forcing is needed).
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
}

export interface MuxResult {
  success: boolean;
  outputPath: string;
  durationMs: number;
  error?: string;
}
