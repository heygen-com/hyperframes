import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

const { extractAllVideoFrames, extractVideoFramesRange } = await import("./videoFrameExtractor.js");
const { extractMediaMetadata } = await import("../utils/ffprobe.js");

describe.skipIf(process.platform === "win32")("extractAllVideoFrames ffmpeg concurrency", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-extract-concurrency-"));
  const previousFfmpeg = process.env[FFMPEG_PATH_ENV];
  const shim = join(dir, "ffmpeg-shim.sh");

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
    mkdirSync(join(dir, run, "running"), { recursive: true });
    const videos: VideoElement[] = clips.map((src, i) => ({
      ...{ id: `${run}-${i}`, src, start: 0, end, mediaStart: 0 },
      ...{ loop: false, hasAudio: false },
    }));
    process.env.HF_TEST_SHIM_DIR = join(dir, run);
    process.env[FFMPEG_PATH_ENV] = shim;
    try {
      const result = await extractAllVideoFrames(videos, dir, {
        fps,
        outputDir: join(dir, run, "out"),
      });
      expect(result.errors).toEqual([]);
    } finally {
      if (previousFfmpeg === undefined) delete process.env[FFMPEG_PATH_ENV];
      else process.env[FFMPEG_PATH_ENV] = previousFfmpeg;
      delete process.env.HF_TEST_SHIM_DIR;
    }
    return readFileSync(join(dir, run, "alive"), "utf8")
      .trim()
      .split(/\s+/)
      .map(Number);
  }

  beforeAll(() => {
    writeFileSync(
      shim,
      [
        "#!/bin/sh",
        'm="$HF_TEST_SHIM_DIR/running/$$"; : > "$m"',
        'ls "$HF_TEST_SHIM_DIR/running" | wc -l >> "$HF_TEST_SHIM_DIR/alive"',
        'case "$*" in *held-*) until [ -f "$HF_TEST_SHIM_DIR/release" ] || [ ! -d "$HF_TEST_SHIM_DIR" ]; do sleep 0.05; done ;; esac',
        `"${getFfmpegBinary()}" "$@"; rc=$?`,
        'rm -f "$m"; exit $rc',
      ].join("\n"),
    );
    chmodSync(shim, 0o755);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("runs one clip's ffmpeg at a time when only one slot is free", async () => {
    const clips = await Promise.all(
      [0, 1, 2, 3].map((i) => synth(`short-${i}`, `testsrc=s=32x32:d=1:r=10,hue=h=${i * 60}`)),
    );
    const alive = await aliveCounts("short", clips, 1, 10);
    expect(alive).toHaveLength(4);
    expect(Math.max(...alive)).toBe(1);
  }, 60_000);

  it("shares the slot with the segments of long clips", async () => {
    const clips = await Promise.all(
      [0, 1].map((i) => synth(`long-${i}`, `testsrc=s=32x32:d=125:r=1,hue=h=${i * 90}`)),
    );
    const alive = await aliveCounts("long", clips, 125, 1);
    expect(alive.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...alive)).toBe(1);
  }, 120_000);

  it("gives a variable-frame-rate clip's two-process pipeline one slot", async () => {
    const clips = await Promise.all(
      [0, 1].map((i) =>
        synth(`vfr-${i}`, `color=c=0x${i ? "28C83C" : "C83C28"}:s=32x32:d=2:r=60`, [
          ...["-vf", "select='not(between(n\\,30\\,89))'", "-fps_mode", "vfr"],
        ]),
      ),
    );
    const alive = await aliveCounts("vfr", clips, 1, 30);
    expect(alive).toHaveLength(4);
    expect(Math.max(...alive)).toBeLessThanOrEqual(2);
  }, 60_000);

  it("lets a cancelled extraction leave the queue while another holds the slot", async () => {
    const [held, queued] = await Promise.all([
      synth("held-0", "testsrc=s=32x32:d=1:r=10"),
      synth("queued-0", "testsrc=s=32x32:d=1:r=10,hue=h=90"),
    ]);
    await extractMediaMetadata(queued);
    const run = join(dir, "cancel");
    mkdirSync(join(run, "running"), { recursive: true });
    const extract = (id: string, src: string, signal?: AbortSignal) =>
      extractVideoFramesRange(src, id, 0, 1, { fps: 10, outputDir: run }, signal);
    process.env.HF_TEST_SHIM_DIR = run;
    process.env[FFMPEG_PATH_ENV] = shim;
    try {
      const holder = extract("held", held);
      await vi.waitFor(() => expect(readdirSync(join(run, "running"))).toHaveLength(1));
      const cancel = new AbortController();
      const cancelled = extract("queued", queued, cancel.signal);
      await new Promise(setImmediate);
      cancel.abort();
      await expect(cancelled).rejects.toThrow(/cancelled/);
      expect(readFileSync(join(run, "alive"), "utf8").trim()).toBe("1");

      writeFileSync(join(run, "release"), "");
      expect((await holder).totalFrames).toBe(10);
    } finally {
      writeFileSync(join(run, "release"), "");
      if (previousFfmpeg === undefined) delete process.env[FFMPEG_PATH_ENV];
      else process.env[FFMPEG_PATH_ENV] = previousFfmpeg;
      delete process.env.HF_TEST_SHIM_DIR;
    }
  }, 30_000);
});
