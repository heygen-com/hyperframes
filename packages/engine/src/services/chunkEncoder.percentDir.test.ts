import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { encodeFramesFromDir } from "./chunkEncoder.js";
import { frameSequencePath } from "./extractedFrameIndex.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;

describe.skipIf(!HAS_FFMPEG)("frame-sequence encode from a directory with a printf code", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hf-percent-dir-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("encodes frames read from a directory named like 'x 12% Up'", async () => {
    const framesDir = join(root, "x 12% Up");
    mkdirSync(framesDir);
    const made = spawnSync(getFfmpegBinary(), [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=32x32:rate=25",
      "-frames:v",
      "10",
      frameSequencePath(framesDir, "frame_%06d.jpg"),
    ]);
    expect(made.status).toBe(0);

    const outputPath = join(root, "out", "video.mp4");
    const result = await encodeFramesFromDir(framesDir, "frame_%06d.jpg", outputPath, {
      fps: { num: 25, den: 1 },
      width: 32,
      height: 32,
      codec: "h264",
      preset: "ultrafast",
      quality: 30,
    });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(existsSync(outputPath)).toBe(true);
  });
});
