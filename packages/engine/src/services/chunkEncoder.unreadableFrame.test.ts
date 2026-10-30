import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { encodeFramesChunkedConcat, encodeFramesFromDir } from "./chunkEncoder.js";
import type { EncoderOptions } from "./chunkEncoder.types.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;

const options: EncoderOptions = {
  fps: { num: 25, den: 1 },
  width: 32,
  height: 32,
  codec: "h264",
  preset: "ultrafast",
  quality: 30,
};

describe.skipIf(!HAS_FFMPEG)("frame-sequence encode with an unreadable frame", () => {
  let framesDir: string;

  // A directory under a frame's name: ffmpeg sees it in the sequence but cannot read it, for any user.
  function writeFrames(count: number, unreadable: number): void {
    const result = spawnSync(getFfmpegBinary(), [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=32x32:rate=25",
      "-frames:v",
      String(count),
      "-start_number",
      "0",
      join(framesDir, "frame_%06d.jpg"),
    ]);
    expect(result.status).toBe(0);
    const name = `frame_${String(unreadable).padStart(6, "0")}.jpg`;
    rmSync(join(framesDir, name));
    mkdirSync(join(framesDir, name));
  }

  beforeEach(() => {
    framesDir = mkdtempSync(join(tmpdir(), "hf-unreadable-frame-"));
  });

  afterEach(() => {
    rmSync(framesDir, { recursive: true, force: true });
  });

  it("fails at that frame instead of encoding a shorter video", async () => {
    writeFrames(20, 10);

    const result = await encodeFramesFromDir(
      framesDir,
      "frame_%06d.jpg",
      join(framesDir, "out", "video.mp4"),
      options,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("frame_000010.jpg");
    expect(result.error).toMatch(/Error during demuxing: \S/);
  });

  it("fails a chunked encode at that frame too", async () => {
    writeFrames(40, 15);

    const result = await encodeFramesChunkedConcat(
      framesDir,
      "frame_%06d.jpg",
      join(framesDir, "out", "video.mp4"),
      options,
      30,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("frame_000015.jpg");
    expect(result.error).toMatch(/Error during demuxing: \S/);
  });
});
