import { describe, expect, it } from "bun:test";
import { buildGifPalettegenArgs, buildGifPaletteuseArgs } from "./gifEncodeArgs.js";

describe("gif encode args", () => {
  const input = {
    framesDir: "/tmp/hf/captured-frames",
    framePattern: "frame_%06d.jpg",
    palettePath: "/tmp/hf/gif-palette.png",
    outputPath: "/tmp/hf/demo.gif",
    fps: { num: 15, den: 1 },
    loop: 0,
  };

  it("builds the palettegen pass with diff statistics", () => {
    expect(buildGifPalettegenArgs(input)).toEqual([
      "-y",
      "-framerate",
      "15",
      "-i",
      "/tmp/hf/captured-frames/frame_%06d.jpg",
      "-vf",
      "fps=15,palettegen=stats_mode=diff",
      "/tmp/hf/gif-palette.png",
    ]);
  });

  it("builds the paletteuse pass with Sierra dithering and loop count", () => {
    expect(buildGifPaletteuseArgs({ ...input, loop: 3 })).toEqual([
      "-y",
      "-framerate",
      "15",
      "-i",
      "/tmp/hf/captured-frames/frame_%06d.jpg",
      "-i",
      "/tmp/hf/gif-palette.png",
      "-lavfi",
      "fps=15 [x]; [x][1:v] paletteuse=dither=sierra2_4a",
      "-loop",
      "3",
      "/tmp/hf/demo.gif",
    ]);
  });
});
