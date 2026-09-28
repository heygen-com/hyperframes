import { join } from "node:path";
import type { Fps } from "@hyperframes/core";

export interface GifEncodeArgsInput {
  framesDir: string;
  framePattern: string;
  palettePath: string;
  outputPath: string;
  fps: Fps;
  loop: number;
  preserveAlpha: boolean;
  wholeFrames?: boolean;
}

function fpsToFfmpegArg(fps: Fps): string {
  return fps.den === 1 ? String(fps.num) : `${fps.num}/${fps.den}`;
}

const KEEP_FILTER_GRAPH_WHEN_FRAMES_DROP_ALPHA = ["-reinit_filter", "0"];
const WRITE_EVERY_FRAME_WHOLE = ["-gifflags", "0"];

function framesInput(input: GifEncodeArgsInput, fpsArg: string): string[] {
  return [
    "-framerate",
    fpsArg,
    ...KEEP_FILTER_GRAPH_WHEN_FRAMES_DROP_ALPHA,
    "-i",
    join(input.framesDir, input.framePattern),
  ];
}

export function buildGifPalettegenArgs(input: GifEncodeArgsInput): string[] {
  const fpsArg = fpsToFfmpegArg(input.fps);
  const transparency = input.preserveAlpha ? ":reserve_transparent=1" : "";
  return [
    "-y",
    ...framesInput(input, fpsArg),
    "-vf",
    `fps=${fpsArg},palettegen=stats_mode=diff${transparency}`,
    input.palettePath,
  ];
}

export function buildGifPaletteuseArgs(input: GifEncodeArgsInput): string[] {
  const fpsArg = fpsToFfmpegArg(input.fps);
  const transparency = input.preserveAlpha ? ":alpha_threshold=128" : "";
  return [
    "-y",
    ...framesInput(input, fpsArg),
    "-i",
    input.palettePath,
    "-lavfi",
    `fps=${fpsArg} [x]; [x][1:v] paletteuse=dither=sierra2_4a${transparency}`,
    "-loop",
    String(input.loop),
    ...(input.wholeFrames ? WRITE_EVERY_FRAME_WHOLE : []),
    input.outputPath,
  ];
}
