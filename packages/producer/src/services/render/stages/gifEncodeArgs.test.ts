import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { buildGifPalettegenArgs, buildGifPaletteuseArgs } from "./gifEncodeArgs.js";
import { runEncodeStage, type EncodeStageInput } from "./encodeStage.js";

const ffmpeg = (args: string[]) => spawnSync("ffmpeg", args);

describe("GIF encode of RGB frames among RGBA frames", () => {
  it("encodes every frame without rebuilding the filter graph", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-gif-mixed-"));
    try {
      const frame = (i: number) => join(dir, `frame_${String(i).padStart(6, "0")}.png`);
      for (const [i, color, pixFmt] of [
        [1, "red@0.2", "rgba"],
        [2, "blue", "rgb24"],
      ] as const) {
        const lavfi = `color=c=${color}:s=64x36,format=rgba`;
        expect(
          ffmpeg(["-f", "lavfi", "-i", lavfi, "-frames:v", "1", "-pix_fmt", pixFmt, frame(i)])
            .status,
        ).toBe(0);
      }
      for (let i = 3; i <= 16; i++) copyFileSync(frame(2 - (i % 2)), frame(i));
      const args = {
        framesDir: dir,
        framePattern: "frame_%06d.png",
        palettePath: join(dir, "palette.png"),
        outputPath: join(dir, "out.gif"),
        fps: { num: 10, den: 1 },
        loop: 0,
        preserveAlpha: true,
      };
      expect(ffmpeg(buildGifPalettegenArgs(args)).status).toBe(0);
      // Without the fix the crash is a race that most, not all, runs lose.
      for (let run = 0; run < 5; run++) {
        const encode = ffmpeg(buildGifPaletteuseArgs(args));
        expect(encode.stderr.toString()).not.toContain("Reconfiguring filter graph");
        expect(encode.status).toBe(0);
      }
      const decoded = ffmpeg([
        "-i",
        args.outputPath,
        "-vf",
        "crop=1:1:0:0,format=rgba",
        "-f",
        "rawvideo",
        "-",
      ]);
      const alphas = [...decoded.stdout].filter((_, n) => n % 4 === 3);
      expect(alphas).toHaveLength(16);
      expect(alphas.slice(0, 2)).toEqual([0, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

function encodeInput(dir: string, framesDir: string): EncodeStageInput {
  return {
    job: { config: { fps: { num: 10, den: 1 }, gifLoop: 0 } },
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    outputPath: join(dir, "out.gif"),
    framesDir,
    videoOnlyPath: join(dir, "video-only.mp4"),
    needsAlpha: true,
    captureImageFormat: "png",
    hasAudio: false,
    isPngSequence: false,
    isGif: true,
    engineConfig: { ffmpegEncodeTimeout: 60_000 },
    abortSignal: undefined,
    assertNotAborted: () => {},
  } as unknown as EncodeStageInput;
}

// Writes one PNG per lavfi source, each converted to the given pixel format.
function writeFrames(framesDir: string, sources: ReadonlyArray<readonly [string, string]>): void {
  mkdirSync(framesDir, { recursive: true });
  sources.forEach(([lavfi, pixFmt], n) => {
    const out = join(framesDir, `frame_${String(n + 1).padStart(6, "0")}.png`);
    const args = ["-f", "lavfi", "-i", lavfi, "-frames:v", "1", "-pix_fmt", pixFmt, out];
    expect(ffmpeg(args).status).toBe(0);
  });
}

const PATTERN = "testsrc2=s=64x36:d=1,format=rgba";
const SMALL_CHANGE = ",drawbox=x=24:y=12:w=8:h=8:color=red:t=fill";

describe("transparent GIF encode", () => {
  it("keeps opaque frames whole and transparent pixels transparent after them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-gif-dispose-"));
    try {
      const framesDir = join(dir, "frames");
      // The third frame changes only a small box, so ffmpeg would crop it against the second.
      writeFrames(framesDir, [
        ["color=c=red@0.2:s=64x36,format=rgba", "rgba"],
        [PATTERN, "rgb24"],
        [PATTERN + SMALL_CHANGE, "rgb24"],
        ["color=c=green@0.2:s=64x36,format=rgba", "rgba"],
      ]);
      const input = encodeInput(dir, framesDir);
      await runEncodeStage(input);
      const decoded = ffmpeg(["-i", input.outputPath, "-vf", "format=rgba", "-f", "rawvideo", "-"]);
      const pixels = 64 * 36;
      const transparentPerFrame = [0, 1, 2, 3].map((f) => {
        let count = 0;
        for (let p = 0; p < pixels; p++)
          if (decoded.stdout[(f * pixels + p) * 4 + 3] === 0) count++;
        return count;
      });
      expect(transparentPerFrame).toEqual([pixels, 0, 0, pixels]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it.each([
    [
      "all opaque",
      [
        [PATTERN, "rgb24"],
        ["color=c=blue:s=64x36,format=rgba", "rgb24"],
        [PATTERN + SMALL_CHANGE, "rgb24"],
      ],
    ],
    [
      "translucent throughout",
      [
        ["color=c=red@0.2:s=64x36,format=rgba" + SMALL_CHANGE, "rgba"],
        ["color=c=green@0.2:s=64x36,format=rgba", "rgba"],
      ],
    ],
  ] as const)(
    "leaves a GIF that is %s exactly as the plain encode",
    async (_name, sources) => {
      const dir = mkdtempSync(join(tmpdir(), "hf-gif-plain-"));
      try {
        const framesDir = join(dir, "frames");
        writeFrames(framesDir, sources);
        const input = encodeInput(dir, framesDir);
        await runEncodeStage(input);
        const plain = {
          framesDir,
          framePattern: "frame_%06d.png",
          palettePath: join(dir, "plain-palette.png"),
          outputPath: join(dir, "plain.gif"),
          fps: { num: 10, den: 1 },
          loop: 0,
          preserveAlpha: true,
        };
        expect(ffmpeg(buildGifPalettegenArgs(plain)).status).toBe(0);
        expect(ffmpeg(buildGifPaletteuseArgs(plain)).status).toBe(0);
        expect(readFileSync(input.outputPath).equals(readFileSync(plain.outputPath))).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
