import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFfmpegBinary, getFfprobeBinary } from "../utils/ffmpegBinaries.js";
import { concatVideoFiles, encodeFramesChunkedConcat } from "./chunkEncoder.js";
import { validJpeg } from "./__fixtures__/jpeg.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"]).status === 0;

describe.skipIf(!HAS_FFMPEG)("concat input paths", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hf-relative-concat-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("finishes a multi-chunk encode with a relative output directory", async () => {
    const framesDir = join(root, "frames");
    mkdirSync(framesDir);
    for (let frame = 0; frame < 40; frame++) {
      writeFileSync(join(framesDir, `frame_${String(frame).padStart(6, "0")}.jpg`), validJpeg);
    }
    const outputPath = relative(process.cwd(), join(root, "output", "video.mp4"));
    const result = await encodeFramesChunkedConcat(
      framesDir,
      "frame_%06d.jpg",
      outputPath,
      { fps: { num: 30, den: 1 }, width: 64, height: 64, preset: "ultrafast" },
      30,
    );

    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ success: true, outputPath, framesEncoded: 40 });
    const probe = spawnSync(
      getFfprobeBinary(),
      [
        "-v",
        "error",
        "-count_frames",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,avg_frame_rate,nb_read_frames",
        "-of",
        "csv=p=0",
        "--",
        outputPath,
      ],
      { encoding: "utf8" },
    );
    expect(probe.status, probe.stderr).toBe(0);
    expect(probe.stdout.trim()).toBe("64,64,30/1,40");
  }, 30_000);

  it.each([true, false])(
    "preserves frames and order with mixed input paths, relative first: %s",
    async (relativeFirst) => {
      const inputs = join(root, "clips' directory");
      mkdirSync(inputs);
      const paths = [join(inputs, "red.mp4"), join(root, "blue.mp4")];
      for (const [index, path] of paths.entries()) {
        const made = spawnSync(getFfmpegBinary(), [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          `color=${index === 0 ? "red" : "blue"}:size=32x32:rate=30`,
          "-frames:v",
          String(index + 2),
          "-c:v",
          "libx264",
          "-bf",
          "0",
          path,
        ]);
        expect(made.status, made.stderr.toString()).toBe(0);
      }
      const inputPaths = paths.map((path, index) =>
        (index === 0) === relativeFirst ? relative(process.cwd(), path) : path,
      );
      const outputPath = join(root, "output", "joined.mp4");
      const result = await concatVideoFiles(inputPaths, outputPath);
      expect(result).toEqual({ success: true });

      const decoded = spawnSync(getFfmpegBinary(), [
        "-v",
        "error",
        "-i",
        outputPath,
        "-vf",
        "scale=1:1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "-",
      ]);
      expect(decoded.status, decoded.stderr.toString()).toBe(0);
      expect(decoded.stdout).toHaveLength(5 * 3);
      for (let frame = 0; frame < 5; frame++) {
        const red = decoded.stdout[frame * 3];
        const blue = decoded.stdout[frame * 3 + 2];
        expect(frame < 2 ? red : blue).toBeGreaterThan(240);
        expect(frame < 2 ? blue : red).toBeLessThan(5);
      }
    },
    30_000,
  );
});
