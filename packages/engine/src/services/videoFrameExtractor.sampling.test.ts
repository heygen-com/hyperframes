import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  extractAllVideoFrames,
  extractVideoFramesRange,
  type VideoElement,
  type ExtractedFrames,
} from "./videoFrameExtractor.js";
import { ffmpegStatsReader, runFfmpeg, type RunFfmpegOptions } from "../utils/runFfmpeg.js";

// Pass-through, so a test can tell whether extraction ran ffmpeg.
vi.mock("../utils/runFfmpeg.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../utils/runFfmpeg.js")>();
  return { ...real, runFfmpeg: vi.fn(real.runFfmpeg) };
});

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;

// Each output slot shows the frame on screen at its time, as the preview does.
describe.skipIf(!HAS_FFMPEG)("frame sampling at the output frame rate", () => {
  const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "hf-video-frame-sampling-"));
  const WIDTH = 32;
  const HEIGHT = 16;
  // Matroska stores whole-millisecond timestamps (a 30 fps frame at 66.67 ms reads 67 ms);
  // a 1/30 timescale stores each frame exactly on a coarse tick.
  const SOURCES = {
    "mp4-60": { fps: 60, file: "index-60fps.mp4", muxer: [] },
    "mkv-30": { fps: 30, file: "index-30fps.mkv", muxer: [] },
    "mp4-30-timescale-30": {
      fps: 30,
      file: "index-30fps-ts30.mp4",
      muxer: ["-video_track_timescale", "30"],
    },
  } as const;
  type SourceName = keyof typeof SOURCES;
  const sourcePath = (name: SourceName) => join(FIXTURE_DIR, SOURCES[name].file);

  beforeAll(async () => {
    for (const name of Object.keys(SOURCES) as SourceName[]) {
      // Frame k carries luma 16 + 2k, so each extracted frame names its source index.
      const result = await runFfmpeg([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        `nullsrc=s=${WIDTH}x${HEIGHT}:r=${SOURCES[name].fps}:d=1.5,geq=lum='16+2*N':cb=128:cr=128`,
        "-c:v",
        "libx264",
        "-qp",
        "0",
        "-pix_fmt",
        "yuv420p",
        ...SOURCES[name].muxer,
        sourcePath(name),
      ]);
      if (!result.success) throw new Error(`index fixture synthesis failed: ${result.stderr}`);
    }
  }, 30_000);

  afterAll(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }, 30_000);

  function sourceIndexes(extracted: ExtractedFrames): number[] {
    const decoded = spawnSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      join(extracted.outputDir, extracted.framePattern),
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "pipe:1",
    ]);
    if (decoded.status !== 0) throw new Error(decoded.stderr.toString());
    const indexes: number[] = [];
    for (let offset = 0; offset < decoded.stdout.length; offset += WIDTH * HEIGHT) {
      indexes.push(Math.round(((decoded.stdout[offset] ?? 0) * 219) / 255 / 2));
    }
    return indexes;
  }

  it.each([
    { source: "mp4-60", fps: 24, startTime: 0, duration: 0.5 },
    { source: "mp4-60", fps: 10, startTime: 0.37, duration: 0.6 },
    { source: "mkv-30", fps: 30, startTime: 0, duration: 0.5 },
    { source: "mp4-30-timescale-30", fps: 60, startTime: 0, duration: 0.5 },
  ] as const)(
    "$source: samples the frame on screen at each $fps fps slot from $startTime s",
    async (c) => {
      const extracted = await extractVideoFramesRange(
        sourcePath(c.source),
        `${c.source}-${c.fps}`,
        c.startTime,
        c.duration,
        { fps: c.fps, outputDir: FIXTURE_DIR, format: "png" },
      );
      const onScreen = Array.from({ length: Math.round(c.duration * c.fps) }, (_, i) =>
        Math.floor((c.startTime + i / c.fps) * SOURCES[c.source].fps + 1e-9),
      );
      expect(sourceIndexes(extracted)).toEqual(onScreen);
    },
    30_000,
  );

  // #5260: one ffmpeg process over a 26-minute clip hit ffmpegProcessTimeout.
  it.each([
    // 260 frames: one 240-frame segment, then 20 more.
    { startTime: 0.5, duration: 130, frames: 260 },
    // 200.3 - 80.3 is 120.00000000000001 s: exactly one segment, not a second near-empty one.
    { startTime: 80.3, duration: 200.3 - 80.3, frames: 240 },
  ])(
    "extracts $duration s from $startTime s at 2 fps across segments without a gap or repeat",
    async (c) => {
      const source = join(FIXTURE_DIR, "index-2fps-long.mp4");
      if (!existsSync(source)) {
        const synth = await runFfmpeg([
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          `nullsrc=s=${WIDTH}x${HEIGHT}:r=2:d=205,geq=lum='16+2*mod(N\\,100)':cb=128:cr=128`,
          "-c:v",
          "libx264",
          "-qp",
          "0",
          "-pix_fmt",
          "yuv420p",
          source,
        ]);
        if (!synth.success) throw new Error(`long fixture synthesis failed: ${synth.stderr}`);
      }
      const extracted = await extractVideoFramesRange(
        source,
        `long-2fps-${c.startTime}`,
        c.startTime,
        c.duration,
        { fps: 2, outputDir: FIXTURE_DIR, format: "png" },
      );
      const onScreen = Array.from(
        { length: c.frames },
        (_, i) => Math.floor((c.startTime + i / 2) * 2 + 1e-9) % 100,
      );
      expect(extracted.totalFrames).toBe(c.frames);
      expect(sourceIndexes(extracted)).toEqual(onScreen);
    },
    60_000,
  );

  it("stops extraction only on a stall, and its ffmpeg reports each frame it writes", async () => {
    const source = join(FIXTURE_DIR, "paced-2s.mp4");
    const synth = await runFfmpeg([
      ...["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi"],
      ...["-i", `testsrc=s=${WIDTH}x${HEIGHT}:r=30:d=2`, "-pix_fmt", "yuv420p", source],
    ]);
    if (!synth.success) throw new Error(`paced fixture synthesis failed: ${synth.stderr}`);
    const { runFfmpeg: real } =
      await vi.importActual<typeof import("../utils/runFfmpeg.js")>("../utils/runFfmpeg.js");
    let requested: RunFfmpegOptions | undefined;
    const reported: number[] = [];
    const readStats = ffmpegStatsReader(({ frames }) => {
      if (frames) reported.push(frames);
    });
    // Real-time pacing spreads the stats over the run. The stall clock itself is runFfmpeg's to
    // test; here it is lifted so a starved runner cannot race it.
    vi.mocked(runFfmpeg).mockImplementation((args, opts) => {
      requested = opts;
      return real(["-stats_period", "0.1", "-re", ...args], {
        ...opts,
        timeout: 60_000,
        onStderr: readStats,
      });
    });
    try {
      const extracted = await extractVideoFramesRange(
        source,
        "paced-stall-only",
        0,
        2,
        { fps: 10, outputDir: FIXTURE_DIR, format: "png" },
        undefined,
        { ffmpegProcessTimeout: 2000 },
      );
      expect(extracted.totalFrames).toBe(20);
      expect(requested).toMatchObject({ timeout: 2000 });
      expect(new Set(reported).size).toBeGreaterThan(1);
    } finally {
      vi.mocked(runFfmpeg).mockImplementation(real);
    }
  }, 30_000);

  it.each([
    { name: "one keyframe", keyint: "infinite", gapSeconds: 8 },
    { name: "a keyframe every second", keyint: "30", gapSeconds: 0 },
  ])(
    "gives the stall clock the time to decode up to the seek point ($name)",
    async ({ keyint, gapSeconds }) => {
      const source = join(FIXTURE_DIR, `gop-${keyint}.mp4`);
      const synth = await runFfmpeg([
        ...["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi"],
        ...["-i", `testsrc=s=${WIDTH}x${HEIGHT}:r=30:d=10`, "-pix_fmt", "yuv420p"],
        ...["-x264-params", `keyint=${keyint}:scenecut=0`, source],
      ]);
      if (!synth.success) throw new Error(`gop fixture synthesis failed: ${synth.stderr}`);
      const { runFfmpeg: real } =
        await vi.importActual<typeof import("../utils/runFfmpeg.js")>("../utils/runFfmpeg.js");
      let requested: RunFfmpegOptions | undefined;
      vi.mocked(runFfmpeg).mockImplementation((args, opts) => {
        requested = opts;
        return real(args, opts);
      });
      try {
        await extractVideoFramesRange(
          source,
          `stall-seek-${keyint}`,
          8,
          1,
          { fps: 10, outputDir: FIXTURE_DIR, format: "png" },
          undefined,
          { ffmpegProcessTimeout: 2000 },
        );
        expect(requested?.timeout).toBe(2000 + gapSeconds * 1000);
      } finally {
        vi.mocked(runFfmpeg).mockImplementation(real);
      }
    },
    30_000,
  );

  it("stops a run that writes no new frame for the stall timeout", async () => {
    // stdin stays open and empty, so ffmpeg waits for its first frame forever.
    const stalled = await runFfmpeg(
      ["-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-i", "pipe:0", "-f", "null", "-"],
      { timeout: 500 },
    );
    expect(stalled.terminationReason).toBe("inactivity");
  }, 30_000);

  // A distributed chunk extracts only the frames it renders; they must be the full extraction's.
  describe("partial extraction", () => {
    const gopSource = join(FIXTURE_DIR, "gop-30fps.mp4");

    beforeAll(async () => {
      // Real motion and long GOPs, so range seeks land mid-GOP.
      const synth = await runFfmpeg([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=64x36:r=30:d=20",
        "-c:v",
        "libx264",
        "-g",
        "250",
        "-pix_fmt",
        "yuv420p",
        gopSource,
      ]);
      if (!synth.success) throw new Error(`gop fixture synthesis failed: ${synth.stderr}`);
    }, 30_000);

    function frameBytes(dir: string): Map<string, Buffer> {
      return new Map(readdirSync(dir).map((name) => [name, readFileSync(join(dir, name))]));
    }

    it.each([
      { fps: 24, startTime: 1.3, duration: 17 },
      { fps: 60, startTime: 0, duration: 20 },
    ])(
      "frameRanges at $fps fps write the same files as a full extraction",
      async (c) => {
        const full = await extractVideoFramesRange(
          gopSource,
          `full-${c.fps}`,
          c.startTime,
          c.duration,
          { fps: c.fps, outputDir: FIXTURE_DIR, format: "jpg" },
        );
        const last = full.totalFrames;
        const ranges = [
          { firstFrame: 0, frames: 5 },
          { firstFrame: 97, frames: 40 },
          { firstFrame: last - 3, frames: 3 },
        ];
        const partial = await extractVideoFramesRange(
          gopSource,
          `partial-${c.fps}`,
          c.startTime,
          c.duration,
          { fps: c.fps, outputDir: FIXTURE_DIR, format: "jpg", frameRanges: ranges },
        );
        const fullFrames = frameBytes(full.outputDir);
        const partialFrames = frameBytes(partial.outputDir);
        expect(partialFrames.size).toBe(48);
        for (const [name, bytes] of partialFrames) {
          expect(fullFrames.get(name)?.equals(bytes), name).toBe(true);
        }
      },
      60_000,
    );

    it.each([
      { fps: 24, mediaStart: 3.3 },
      { fps: 30, mediaStart: 0 },
      { fps: 60, mediaStart: 7.77 },
    ])(
      "a deferred window to the source end at $fps fps reports the full frame count",
      async (c) => {
        const video = (): VideoElement => ({
          id: `defer-${c.fps}`,
          src: gopSource,
          start: 0,
          end: Infinity,
          mediaStart: c.mediaStart,
          loop: false,
          hasAudio: false,
        });
        const full = await extractAllVideoFrames([video()], FIXTURE_DIR, {
          fps: c.fps,
          outputDir: join(FIXTURE_DIR, `defer-full-${c.fps}`),
        });
        const deferred = await extractAllVideoFrames([video()], FIXTURE_DIR, {
          fps: c.fps,
          outputDir: join(FIXTURE_DIR, `defer-${c.fps}`),
          deferRangeExtraction: true,
        });
        expect(deferred.errors).toEqual([]);
        const result = deferred.extracted[0]!;
        expect(result.totalFrames).toBe(full.extracted[0]!.totalFrames);
        expect(result.framePaths.size).toBe(0);
        expect(readdirSync(result.outputDir)).toEqual([]);
        expect(result.deferredRange).toEqual({
          startTime: c.mediaStart,
          durationSeconds: expect.any(Number),
          format: "jpg",
        });
      },
      60_000,
    );

    it("halves frames while they still cover the box a video is shown in", async () => {
      const firstFrameSize = async (
        videoId: string,
        shownBox: { width: number; height: number },
      ) => {
        const result = await extractVideoFramesRange(gopSource, videoId, 0, 1, {
          fps: 30,
          outputDir: FIXTURE_DIR,
          format: "jpg",
          frameRanges: [{ firstFrame: 0, frames: 1 }],
          shownBox,
        });
        const [frame] = result.framePaths.values();
        return spawnSync("ffprobe", [
          "-v",
          "error",
          "-show_entries",
          "stream=width,height",
          "-of",
          "csv=p=0",
          "--",
          frame!,
        ])
          .stdout.toString()
          .trim();
      };
      // 64x36 source: halved as often as the box allows (even sides round up); never below the box.
      expect(await firstFrameSize("shown-quarter", { width: 16, height: 9 })).toBe("16,10");
      expect(await firstFrameSize("shown-third", { width: 20, height: 12 })).toBe("32,18");
      // Exactly half (a 4K source in a 1080p box): one halving lands on the box and still covers it.
      expect(await firstFrameSize("shown-half", { width: 32, height: 18 })).toBe("32,18");
      expect(await firstFrameSize("shown-near-full", { width: 40, height: 20 })).toBe("64,36");
    }, 30_000);
  });
});
