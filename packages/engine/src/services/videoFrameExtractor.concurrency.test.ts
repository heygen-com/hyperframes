import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { VideoElement } from "../types.js";
import { FFMPEG_PATH_ENV, getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { runFfmpeg } from "../utils/runFfmpeg.js";

// Two CPUs: the extractor runs at most one ffmpeg at a time.
vi.mock("os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("os")>()),
  cpus: () => [{}, {}],
}));

const { extractAllVideoFrames } = await import("./videoFrameExtractor.js");

describe("extractAllVideoFrames ffmpeg concurrency", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-extract-concurrency-"));
  const markers = join(dir, "running");
  const clips = ["a", "b", "c", "d"].map((name) => join(dir, `${name}.mp4`));

  beforeAll(async () => {
    for (const [i, clip] of clips.entries()) {
      const made = await runFfmpeg([
        ...["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi"],
        ...["-i", `testsrc=s=32x32:d=1:r=10,hue=h=${i * 60}`, "-pix_fmt", "yuv420p", clip],
      ]);
      expect(made.success).toBe(true);
    }
    mkdirSync(markers);
    // Records how many extraction processes are alive as each one starts.
    const shim = join(dir, "ffmpeg-shim.sh");
    writeFileSync(
      shim,
      [
        "#!/bin/sh",
        `m="${markers}/$$"; : > "$m"`,
        `ls "${markers}" | wc -l >> "${dir}/alive"`,
        `"${getFfmpegBinary()}" "$@"; rc=$?`,
        'rm -f "$m"; exit $rc',
      ].join("\n"),
    );
    chmodSync(shim, 0o755);
    process.env[FFMPEG_PATH_ENV] = shim;
  }, 60_000);

  afterAll(() => {
    delete process.env[FFMPEG_PATH_ENV];
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs one clip's ffmpeg at a time when only one slot is free", async () => {
    const videos: VideoElement[] = clips.map((src, i) => ({
      id: `clip-${i}`,
      src,
      start: 0,
      end: 1,
      mediaStart: 0,
      loop: false,
      hasAudio: false,
    }));

    const result = await extractAllVideoFrames(videos, dir, {
      fps: 10,
      outputDir: join(dir, "out"),
    });

    expect(result.errors).toEqual([]);
    expect(result.extracted).toHaveLength(4);
    const alive = readFileSync(join(dir, "alive"), "utf8").trim().split(/\s+/).map(Number);
    expect(alive).toHaveLength(4);
    expect(Math.max(...alive)).toBe(1);
  }, 60_000);
});
