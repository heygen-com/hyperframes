import type { Fps } from "@hyperframes/core";
import { fpsToFfmpegArg } from "@hyperframes/core";
import type { EngineConfig } from "../config.js";
import { appendRenderProvenanceArgs } from "../utils/renderProvenance.js";
import { spawnFfmpegStream, type StreamingEncoder } from "./streamingEncoder.js";

export interface ChunkColour {
  primaries: number;
  transfer: number;
  matrix: number;
  fullRange: boolean;
}

export const BT709_LIMITED: ChunkColour = {
  primaries: 1,
  transfer: 1,
  matrix: 1,
  fullRange: false,
};

export interface ChunkStreamingOptions {
  fps: Fps;
  colour?: ChunkColour;
}

export function buildChunkStreamingArgs(
  options: ChunkStreamingOptions,
  outputPath: string,
): string[] {
  const { primaries, transfer, matrix, fullRange } = options.colour ?? BT709_LIMITED;
  const vui = [
    `colour_primaries=${primaries}`,
    `transfer_characteristics=${transfer}`,
    `matrix_coefficients=${matrix}`,
    `video_full_range_flag=${fullRange ? 1 : 0}`,
  ].join(":");
  const args = ["-f", "h264", "-framerate", fpsToFfmpegArg(options.fps), "-i", "-"];
  args.push("-c:v", "copy", "-bsf:v", `h264_metadata=${vui}`);
  args.push(
    ...["-colorspace:v", "bt709", "-color_primaries:v", "bt709", "-color_trc:v", "bt709"],
    ...["-color_range", fullRange ? "pc" : "tv"],
    ...["-video_track_timescale", "90000", "-avoid_negative_ts", "make_zero"],
  );
  appendRenderProvenanceArgs(args, outputPath);
  args.push("-y", outputPath);
  return args;
}

export function spawnChunkStreamingEncoder(
  outputPath: string,
  options: ChunkStreamingOptions,
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegStreamingTimeout">>,
): StreamingEncoder {
  return spawnFfmpegStream(outputPath, buildChunkStreamingArgs(options, outputPath), {
    signal,
    config,
  });
}
