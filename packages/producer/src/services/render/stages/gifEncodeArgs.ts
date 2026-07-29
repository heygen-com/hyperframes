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
}

function fpsToFfmpegArg(fps: Fps): string {
  return fps.den === 1 ? String(fps.num) : `${fps.num}/${fps.den}`;
}

export function buildGifPalettegenArgs(input: GifEncodeArgsInput): string[] {
  const fpsArg = fpsToFfmpegArg(input.fps);
  const transparency = input.preserveAlpha ? ":reserve_transparent=1" : "";
  return [
    "-y",
    "-framerate",
    fpsArg,
    "-i",
    join(input.framesDir, input.framePattern),
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
    "-framerate",
    fpsArg,
    "-i",
    join(input.framesDir, input.framePattern),
    "-i",
    input.palettePath,
    "-lavfi",
    `fps=${fpsArg} [x]; [x][1:v] paletteuse=dither=sierra2_4a${transparency}`,
    "-loop",
    String(input.loop),
    input.outputPath,
  ];
}
