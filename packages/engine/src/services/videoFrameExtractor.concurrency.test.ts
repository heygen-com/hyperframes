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
  const previousFfmpeg = process.env[FFMPEG_PATH_ENV];

  async function synth(name: string, lavfi: string, extra: string[] = []): Promise<string> {
    const clip = join(dir, `${name}.mp4`);
    const made = await runFfmpeg([
      ...["-y", "-v", "error", "-f", "lavfi", "-i", lavfi, ...extra],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", clip],
    ]);
    expect(made.success, made.stderr).toBe(true);
    return clip;
  }

  // Extracts `clips` through a shim ffmpeg and returns how many ffmpegs were alive as each started.
  async function aliveCounts(run: string, clips: string[], end: number, fps: number) {
    const markers = join(dir, run, "running");
    mkdirSync(markers, { recursive: true });
    process.env.HF_TEST_SHIM_DIR = join(dir, run);
    const videos: VideoElement[] = clips.map((src, i) => ({
      ...{ id: `${run}-${i}`, src, start: 0, end, mediaStart: 0 },
      ...{ loop: false, hasAudio: false },
    }));
    const result = await extractAllVideoFrames(videos, dir, {
      fps,
      outputDir: join(dir, run, "out"),
    });
    expect(result.errors).toEqual([]);
    return readFileSync(join(dir, run, "alive"), "utf8")
      .trim()
      .split(/\s+/)
      .map(Number);
  }

  beforeAll(() => {
    const shim = join(dir, "ffmpeg-shim.sh");
    writeFileSync(
      shim,
      [
        "#!/bin/sh",
        'm="$HF_TEST_SHIM_DIR/running/$$"; : > "$m"',
        'ls "$HF_TEST_SHIM_DIR/running" | wc -l >> "$HF_TEST_SHIM_DIR/alive"',
        `"${getFfmpegBinary()}" "$@"; rc=$?`,
        'rm -f "$m"; exit $rc',
      ].join("\n"),
    );
    chmodSync(shim, 0o755);
  });

  afterAll(() => {
    if (previousFfmpeg === undefined) delete process.env[FFMPEG_PATH_ENV];
    else process.env[FFMPEG_PATH_ENV] = previousFfmpeg;
    delete process.env.HF_TEST_SHIM_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  const useShim = () => (process.env[FFMPEG_PATH_ENV] = join(dir, "ffmpeg-shim.sh"));
  const useRealFfmpeg = () => {
    if (previousFfmpeg === undefined) delete process.env[FFMPEG_PATH_ENV];
    else process.env[FFMPEG_PATH_ENV] = previousFfmpeg;
  };

  it("runs one clip's ffmpeg at a time when only one slot is free", async () => {
    const clips = await Promise.all(
      [0, 1, 2, 3].map((i) => synth(`short-${i}`, `testsrc=s=32x32:d=1:r=10,hue=h=${i * 60}`)),
    );
    useShim();
    try {
      const alive = await aliveCounts("short", clips, 1, 10);
      expect(alive).toHaveLength(4);
      expect(Math.max(...alive)).toBe(1);
    } finally {
      useRealFfmpeg();
    }
  }, 60_000);

  it("shares the slot with the segments of long clips", async () => {
    const clips = await Promise.all(
      [0, 1].map((i) => synth(`long-${i}`, `testsrc=s=32x32:d=125:r=1,hue=h=${i * 90}`)),
    );
    useShim();
    try {
      const alive = await aliveCounts("long", clips, 125, 1);
      expect(alive.length).toBeGreaterThanOrEqual(4);
      expect(Math.max(...alive)).toBe(1);
    } finally {
      useRealFfmpeg();
    }
  }, 120_000);

  it("gives a variable-frame-rate clip's two-process pipeline one slot", async () => {
    const clips = await Promise.all(
      [0, 1].map((i) =>
        synth(`vfr-${i}`, `color=c=0x${i ? "28C83C" : "C83C28"}:s=32x32:d=2:r=60`, [
          ...["-vf", "select='not(between(n\\,30\\,89))'", "-fps_mode", "vfr"],
        ]),
      ),
    );
    useShim();
    try {
      const alive = await aliveCounts("vfr", clips, 1, 30);
      expect(alive).toHaveLength(4);
      expect(Math.max(...alive)).toBeLessThanOrEqual(2);
    } finally {
      useRealFfmpeg();
    }
  }, 60_000);
});
