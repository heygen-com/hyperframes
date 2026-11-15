import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  parseVideoElements,
  extractAllVideoFrames,
  extractVideoFramesRange,
  createFrameLookupTable,
  type VideoElement,
  type ExtractedFrames,
  type ExtractionResult,
} from "./videoFrameExtractor.js";
import { extractVideoMetadata } from "../utils/ffprobe.js";
import { runFfmpeg } from "../utils/runFfmpeg.js";
import { COMPLETE_SENTINEL, GC_MARKER, SCHEMA_PREFIX } from "./extractionCache.js";

// Pass-through, so a test can tell whether extraction ran ffmpeg.
vi.mock("../utils/runFfmpeg.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../utils/runFfmpeg.js")>();
  return { ...real, runFfmpeg: vi.fn(real.runFfmpeg) };
});

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;

// Irregular timestamps once made the fps filter emit too few frames, so the video froze;
// VFR sources now extract through one `-fps_mode cfr -r` pass.
describe.skipIf(!HAS_FFMPEG)("extractAllVideoFrames on a VFR source", () => {
  const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "hf-vfr-test-"));
  const VFR_FIXTURE = join(FIXTURE_DIR, "vfr_screen.mp4");

  beforeAll(async () => {
    // 10 s at 60 fps minus frames 30-89, 180-239, 330-389, 480-539: about 36 fps on average, past
    // isVFR's 10% threshold. One keyframe (-g 600) so the mediaStart=3 seek cannot snap to an IDR.
    const result = await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=320x180:d=10:rate=60",
      "-vf",
      "select='not(between(n\\,30\\,89))*not(between(n\\,180\\,239))*not(between(n\\,330\\,389))*not(between(n\\,480\\,539))'",
      "-fps_mode",
      "vfr",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "600",
      "-keyint_min",
      "600",
      VFR_FIXTURE,
    ]);
    if (!result.success) {
      throw new Error(
        `ffmpeg fixture synthesis failed (${result.exitCode}): ${result.stderr.slice(-400)}`,
      );
    }
  }, 30_000);

  afterAll(() => {
    if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }, 30_000);

  it("skips a clip entirely before time zero without reporting an extraction error", async () => {
    const outputDir = join(FIXTURE_DIR, "out-before-timeline");
    mkdirSync(outputDir, { recursive: true });
    const video: VideoElement = {
      id: "before-timeline",
      src: VFR_FIXTURE,
      start: -2,
      end: -1,
      mediaStart: 0,
      loop: false,
      hasAudio: false,
    };

    const result = await extractAllVideoFrames([video], FIXTURE_DIR, {
      fps: 1,
      outputDir,
      timelineEnd: 2,
    });

    expect(result).toMatchObject({ success: true, extracted: [], errors: [] });
  });

  it("preserves loop phase when negative preroll crosses the source boundary", async () => {
    const outputDir = join(FIXTURE_DIR, "out-negative-loop");
    mkdirSync(outputDir, { recursive: true });
    const video: VideoElement = {
      id: "negative-loop",
      src: VFR_FIXTURE,
      start: -19,
      end: 5,
      mediaStart: 0,
      loop: true,
      hasAudio: false,
    };

    const result = await extractAllVideoFrames([video], FIXTURE_DIR, {
      fps: 1,
      outputDir,
      timelineEnd: 2,
    });

    expect(result.errors).toEqual([]);
    const extracted = result.extracted[0];
    if (!extracted) throw new Error("expected loop source frames");
    const lookup = createFrameLookupTable([video], result.extracted);
    expect(video).toMatchObject({ start: -19, mediaStart: 0, loop: true });
    expect(lookup.getFrame("negative-loop", 0)).toBe(
      extracted.framePaths.get(extracted.totalFrames - 1),
    );
  }, 30_000);

  it("preserves the held final frame after negative preroll exhausts a source", async () => {
    const outputDir = join(FIXTURE_DIR, "out-negative-held-tail");
    mkdirSync(outputDir, { recursive: true });
    const video: VideoElement = {
      id: "negative-held-tail",
      src: VFR_FIXTURE,
      start: -15,
      end: 5,
      mediaStart: 0,
      loop: false,
      hasAudio: false,
    };

    const result = await extractAllVideoFrames([video], FIXTURE_DIR, {
      fps: 1,
      outputDir,
      timelineEnd: 2,
    });

    expect(result.errors).toEqual([]);
    const extracted = result.extracted[0];
    if (!extracted) throw new Error("expected held-tail source frames");
    const lookup = createFrameLookupTable([video], result.extracted);
    // The authored slot remains active through end=5, but lookup is rebased to
    // one exact final frame instead of assuming the last second contains a
    // timestamp or materializing the full source.
    expect(video).toMatchObject({ start: 0, end: 5, mediaStart: 9.999999, loop: false });
    expect(extracted.totalFrames).toBe(1);
    expect(lookup.getFrame("negative-held-tail", 0)).toBe(
      extracted.framePaths.get(extracted.totalFrames - 1),
    );
  }, 30_000);

  it("detects the synthesized fixture as VFR", async () => {
    const md = await extractVideoMetadata(VFR_FIXTURE);
    expect(md.isVFR).toBe(true);
  });

  it.each([
    ["compiled EOF", 4, 1],
    ["compiled past EOF", 5, 2],
    ["ordinary explicit zero", 6, 0],
  ])(
    "drops a known zero timeline window without extraction or error: %s",
    async (label, start, mediaStart) => {
      const src = await synthCfrClip(`zero-window-${label.replaceAll(" ", "-")}.mp4`, 1);
      const videos = parseVideoElements(
        `<video id="zero-window" src="${src}" data-start="${start}" data-duration="0" data-end="${start}" data-media-start="${mediaStart}" muted></video>`,
      );
      const outputDir = join(FIXTURE_DIR, `out-zero-window-${label.replaceAll(" ", "-")}`);
      const result = await extractAllVideoFrames(videos, FIXTURE_DIR, { fps: 30, outputDir });

      expect(result.errors).toEqual([]);
      expect(result.extracted).toEqual([]);
      expect(result.totalFramesExtracted).toBe(0);
      expect(videos).toEqual([]);
    },
  );

  it("passes an exact 24000/1001 rate through VFR normalization", async () => {
    const outputDir = join(FIXTURE_DIR, "out-vfr-ntsc-boundary");
    mkdirSync(outputDir, { recursive: true });

    const result = await extractVideoFramesRange(VFR_FIXTURE, "vfr-ntsc-boundary", 0, 0.125125, {
      fps: { num: 24000, den: 1001 },
      outputDir,
      format: "jpg",
    });

    expect(result.metadata.isVFR).toBe(true);
    expect(result.totalFrames).toBe(3);
  }, 60_000);

  // With B-frames, mp4 packet durations are decode-order gaps, so a frame can claim 0.5s while
  // the next one starts 17ms later. Each slot must still show the frame on screen at its time:
  // `-fps_mode cfr` on ffmpeg 8 held such a frame for 14 slots and cut the still before a gap short.
  it("samples a B-frame VFR source by timestamp, not by packet duration", async () => {
    const source = join(FIXTURE_DIR, "vfr_bframes.mp4");
    const synth = await runFfmpeg([
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=320x180:d=4:rate=60",
      "-vf",
      "select='not(between(n\\,30\\,89))*not(between(n\\,150\\,179))'",
      "-fps_mode",
      "vfr",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-bf",
      "3",
      "-g",
      "600",
      "-pix_fmt",
      "yuv420p",
      source,
    ]);
    if (!synth.success) throw new Error(`fixture synthesis failed: ${synth.stderr.slice(-400)}`);
    const distinctFrames = (paths: Iterable<string>) =>
      new Set([...paths].map((path) => readFileSync(path).toString("base64"))).size;

    // 2.5s to 3s is a still; every 30fps slot after it lands on its own 60fps source frame.
    const afterGap = await extractVideoFramesRange(source, "vfr-bframes-after-gap", 2.5, 1.5, {
      fps: 30,
      outputDir: join(FIXTURE_DIR, "out-vfr-bframes-after-gap"),
      format: "png",
    });
    expect(afterGap.metadata.isVFR).toBe(true);
    expect(afterGap.totalFrames).toBe(45);
    const slots = [...afterGap.framePaths.entries()].sort(([a], [b]) => a - b);
    expect(distinctFrames(slots.slice(0, 15).map(([, path]) => path))).toBe(1);
    expect(distinctFrames(slots.slice(15).map(([, path]) => path))).toBe(30);

    const endsOnStill = await extractVideoFramesRange(source, "vfr-bframes-still", 0, 3, {
      fps: 30,
      outputDir: join(FIXTURE_DIR, "out-vfr-bframes-still"),
      format: "png",
    });
    expect(endsOnStill.totalFrames).toBe(90);
  }, 60_000);

  it("produces the expected frame count for a mid-file segment", async () => {
    const outputDir = join(FIXTURE_DIR, "out-mid-segment");
    mkdirSync(outputDir, { recursive: true });

    const video: VideoElement = {
      id: "v1",
      src: VFR_FIXTURE,
      start: 0,
      end: 4,
      mediaStart: 3,
      loop: false,
      hasAudio: false,
    };

    const result = await extractAllVideoFrames([video], FIXTURE_DIR, {
      fps: 30,
      outputDir,
    });

    expect(result.errors).toEqual([]);
    expect(result.extracted).toHaveLength(1);
    const frames = readdirSync(join(outputDir, "v1")).filter((f) => f.endsWith(".jpg"));
    // Pre-fix behavior produced ~90 frames (a 25% shortfall).
    // ±3 tolerance: FFmpeg's one-pass VFR→CFR extraction yields slightly
    // different frame counts across versions (timestamp rounding).
    expect(frames.length).toBeGreaterThanOrEqual(117);
    expect(frames.length).toBeLessThanOrEqual(123);

    expect(result.phaseBreakdown).toBeDefined();
    expect(result.phaseBreakdown.extractMs).toBeGreaterThan(0);
    expect(result.phaseBreakdown.vfrPreflightCount).toBe(1);
    expect(result.phaseBreakdown.vfrPreflightMs).toBeGreaterThanOrEqual(0);
  }, 60_000);

  // Shared fixture helpers for the cache tests below. All synthesize clean
  // CFR SDR clips — keeps VFR preflight count at zero so cache keys are
  // stable across runs within a test.
  async function synthCfrClip(name: string, durationSeconds: number): Promise<string> {
    const src = join(FIXTURE_DIR, name);
    const synth = await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=s=320x180:d=${durationSeconds}:rate=30`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      src,
    ]);
    if (!synth.success) {
      throw new Error(`Fixture synthesis failed (${name}): ${synth.stderr.slice(-400)}`);
    }
    return src;
  }

  it("rejects a media start beyond source duration before invoking FFmpeg", async () => {
    const src = await synthCfrClip("zero-output-src.mp4", 1);
    const outputDir = join(FIXTURE_DIR, "out-zero-output");
    await expect(
      extractVideoFramesRange(src, "past-eof", 2, 1, { fps: 30, outputDir }),
    ).rejects.toMatchObject({
      kind: "media_start_out_of_range",
      retryable: false,
    });
  }, 60_000);

  it("preserves legacy metadata rejection unless typed aggregation is explicitly enabled", async () => {
    const src = join(FIXTURE_DIR, "invalid-probe.mp4");
    writeFileSync(src, "not a media container");
    const video = cfrClipElement("invalid-probe", src, 1);

    await expect(
      extractAllVideoFrames([video], FIXTURE_DIR, {
        fps: 30,
        outputDir: join(FIXTURE_DIR, "out-invalid-probe-legacy"),
      }),
    ).rejects.toThrow();

    const collected = await extractAllVideoFrames([video], FIXTURE_DIR, {
      fps: 30,
      outputDir: join(FIXTURE_DIR, "out-invalid-probe-typed"),
      collectProbeFailures: true,
    });
    expect(collected.success).toBe(false);
    expect(collected.extracted).toEqual([]);
    expect(collected.errors).toEqual([
      expect.objectContaining({
        videoId: "invalid-probe",
        kind: "invalid_media",
        retryable: false,
      }),
    ]);
  }, 60_000);

  async function synthHdrTaggedClip(name: string, durationSeconds: number): Promise<string> {
    const src = join(FIXTURE_DIR, name);
    const synth = await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=s=320x180:d=${durationSeconds}:rate=30`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-color_primaries",
      "bt2020",
      "-color_trc",
      "smpte2084",
      "-colorspace",
      "bt2020nc",
      // The -color_* flags above only tag the container/encoder context;
      // whether they reach the H.264 VUI depends on the ffmpeg build (the
      // pinned Windows CI build drops the transfer). Write the VUI directly
      // so probing reports smpte2084 on every build (9/16/9 = bt2020/PQ/bt2020nc).
      "-bsf:v",
      "h264_metadata=colour_primaries=9:transfer_characteristics=16:matrix_coefficients=9",
      src,
    ]);
    if (!synth.success) {
      throw new Error(`HDR fixture synthesis failed (${name}): ${synth.stderr.slice(-400)}`);
    }
    return src;
  }

  function cfrClipElement(
    id: string,
    src: string,
    endSeconds: number,
    mediaStart = 0,
  ): VideoElement {
    return {
      id,
      src,
      start: 0,
      end: endSeconds,
      mediaStart,
      loop: false,
      hasAudio: false,
    };
  }

  async function extractWithCache(
    video: VideoElement,
    outName: string,
    cacheDir: string,
    fps = 30,
  ): Promise<ExtractionResult> {
    const outputDir = join(FIXTURE_DIR, outName);
    mkdirSync(outputDir, { recursive: true });
    return extractAllVideoFrames([video], FIXTURE_DIR, { fps, outputDir }, undefined, {
      extractCacheDir: cacheDir,
    });
  }

  function cacheEntryNames(cacheDir: string): string[] {
    return readdirSync(cacheDir).filter((name) => name.startsWith(SCHEMA_PREFIX));
  }

  function supersetDirNames(outputDir: string): string[] {
    if (!existsSync(outputDir)) return [];
    return readdirSync(outputDir).filter((name) => name.startsWith("__superset-"));
  }

  function extractedFor(result: ExtractionResult, videoId: string): ExtractedFrames {
    const extracted = result.extracted.find((item) => item.videoId === videoId);
    if (!extracted) throw new Error(`missing extraction result for ${videoId}`);
    return extracted;
  }

  function framePath(result: ExtractionResult, videoId: string, frameIndex: number): string {
    const extracted = extractedFor(result, videoId);
    const frame = extracted?.framePaths.get(frameIndex);
    if (!frame) throw new Error(`missing frame ${frameIndex} for ${videoId}`);
    return frame;
  }

  it("reuses extracted frames on a warm cache hit", async () => {
    const CACHE_DIR = mkdtempSync(join(tmpdir(), "hf-extract-cache-test-"));
    const SRC = await synthCfrClip("cache-src.mp4", 2);
    const video = cfrClipElement("cv1", SRC, 2);

    const miss = await extractWithCache(video, "out-cache-miss", CACHE_DIR);
    expect(miss.errors).toEqual([]);
    expect(miss.phaseBreakdown.cacheHits).toBe(0);
    expect(miss.phaseBreakdown.cacheMisses).toBe(1);
    const ffmpegRunsBeforeHit = vi.mocked(runFfmpeg).mock.calls.length;

    const hit = await extractWithCache(video, "out-cache-hit", CACHE_DIR);
    expect(hit.errors).toEqual([]);
    expect(hit.phaseBreakdown.cacheHits).toBe(1);
    expect(hit.phaseBreakdown.cacheMisses).toBe(0);
    expect(vi.mocked(runFfmpeg).mock.calls.length).toBe(ffmpegRunsBeforeHit);
    expect(hit.extracted).toHaveLength(1);
    expect(hit.extracted[0]!.totalFrames).toBe(miss.extracted[0]!.totalFrames);

    rmSync(CACHE_DIR, { recursive: true, force: true });
  }, 60_000);

  it("does not reuse a decimal-rate VFR cache entry for the exact rational rate", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "hf-extract-cache-ntsc-rate-test-"));
    const decimalOutputDir = join(FIXTURE_DIR, "out-cache-vfr-ntsc-decimal");
    const rationalOutputDir = join(FIXTURE_DIR, "out-cache-vfr-ntsc-rational");
    mkdirSync(decimalOutputDir, { recursive: true });
    mkdirSync(rationalOutputDir, { recursive: true });
    try {
      const decimal = await extractAllVideoFrames(
        [cfrClipElement("vfr-ntsc-cache", VFR_FIXTURE, 0.125125)],
        FIXTURE_DIR,
        { fps: 24000 / 1001, outputDir: decimalOutputDir },
        undefined,
        { extractCacheDir: cacheDir },
      );
      expect(decimal.errors).toEqual([]);
      expect(decimal.phaseBreakdown.cacheMisses).toBe(1);
      expect(decimal.extracted[0]?.totalFrames).toBe(3);
      // Model the warm v3 entry from before exact-rate extraction: the
      // decimal path could persist one extra frame at this boundary. If the
      // rational lookup collides, rehydration below will observe all four.
      writeFileSync(
        join(decimal.extracted[0]!.outputDir, "frame_00004.jpg"),
        "stale-decimal-boundary-frame",
        "utf-8",
      );

      const rational = await extractAllVideoFrames(
        [cfrClipElement("vfr-ntsc-cache", VFR_FIXTURE, 0.125125)],
        FIXTURE_DIR,
        { fps: { num: 24000, den: 1001 }, outputDir: rationalOutputDir },
        undefined,
        { extractCacheDir: cacheDir },
      );
      expect(rational.errors).toEqual([]);
      expect(rational.phaseBreakdown.cacheHits).toBe(0);
      expect(rational.phaseBreakdown.cacheMisses).toBe(1);
      expect(rational.extracted[0]?.totalFrames).toBe(3);
      expect(cacheEntryNames(cacheDir)).toHaveLength(2);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("reuses one-cycle loop extraction across different authored starts", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "hf-extract-loop-phase-cache-test-"));
    const src = await synthCfrClip("cache-loop-phase-src.mp4", 3);
    try {
      const firstOutputDir = join(FIXTURE_DIR, "out-cache-loop-phase-first");
      const secondOutputDir = join(FIXTURE_DIR, "out-cache-loop-phase-second");
      mkdirSync(firstOutputDir, { recursive: true });
      mkdirSync(secondOutputDir, { recursive: true });

      const first = await extractAllVideoFrames(
        [
          {
            ...cfrClipElement("loop-cache-first", src, 60),
            loop: true,
          },
        ],
        FIXTURE_DIR,
        { fps: 30, outputDir: firstOutputDir, timelineEnd: 60 },
        undefined,
        { extractCacheDir: cacheDir },
      );
      expect(first.errors).toEqual([]);
      expect(first.phaseBreakdown.cacheMisses).toBe(1);

      const second = await extractAllVideoFrames(
        [
          {
            ...cfrClipElement("loop-cache-second", src, 66),
            start: -6,
            loop: true,
          },
        ],
        FIXTURE_DIR,
        { fps: 30, outputDir: secondOutputDir, timelineEnd: 60 },
        undefined,
        { extractCacheDir: cacheDir },
      );
      expect(second.errors).toEqual([]);
      expect(second.phaseBreakdown.cacheHits).toBe(1);
      expect(second.phaseBreakdown.cacheMisses).toBe(0);
      expect(second.extracted[0]?.totalFrames).toBe(first.extracted[0]?.totalFrames);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("updates the cache sentinel mtime on a hit", async () => {
    const CACHE_DIR = mkdtempSync(join(tmpdir(), "hf-extract-cache-touch-test-"));
    const SRC = await synthCfrClip("cache-touch-src.mp4", 1);
    const video = cfrClipElement("touch", SRC, 1);

    const miss = await extractWithCache(video, "out-cache-touch-miss", CACHE_DIR);
    expect(miss.errors).toEqual([]);
    expect(miss.phaseBreakdown.cacheMisses).toBe(1);

    const cacheEntryNames = readdirSync(CACHE_DIR).filter((name) => name.startsWith(SCHEMA_PREFIX));
    expect(cacheEntryNames).toHaveLength(1);
    const sentinel = join(CACHE_DIR, cacheEntryNames[0]!, COMPLETE_SENTINEL);
    const old = new Date(Date.now() - 120_000);
    utimesSync(sentinel, old, old);
    const before = statSync(sentinel).mtimeMs;

    const hit = await extractWithCache(video, "out-cache-touch-hit", CACHE_DIR);

    expect(hit.errors).toEqual([]);
    expect(hit.phaseBreakdown.cacheHits).toBe(1);
    expect(statSync(sentinel).mtimeMs).toBeGreaterThan(before);

    rmSync(CACHE_DIR, { recursive: true, force: true });
  }, 60_000);

  it("skips cache GC on all-hit renders", async () => {
    const CACHE_DIR = mkdtempSync(join(tmpdir(), "hf-extract-cache-gc-skip-test-"));
    const SRC = await synthCfrClip("cache-gc-skip-src.mp4", 1);
    const video = cfrClipElement("gc-skip", SRC, 1);

    const miss = await extractWithCache(video, "out-cache-gc-skip-miss", CACHE_DIR);
    expect(miss.errors).toEqual([]);
    expect(miss.phaseBreakdown.cacheMisses).toBe(1);

    const agedPartial = join(CACHE_DIR, `${SCHEMA_PREFIX}aged.partial-1234-deadbeef`);
    mkdirSync(agedPartial, { recursive: true });
    writeFileSync(join(agedPartial, "frame_00001.jpg"), "stale", "utf-8");
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(agedPartial, old, old);

    const hit = await extractWithCache(video, "out-cache-gc-skip-hit", CACHE_DIR);
    expect(hit.errors).toEqual([]);
    expect(hit.phaseBreakdown.cacheHits).toBe(1);
    expect(hit.phaseBreakdown.cacheMisses).toBe(0);
    expect(existsSync(agedPartial)).toBe(true);

    rmSync(CACHE_DIR, { recursive: true, force: true });
  }, 60_000);

  it("disables caching for this render when the cache dir is not writable", async () => {
    const CACHE_FILE = join(FIXTURE_DIR, "cache-dir-is-a-file");
    writeFileSync(CACHE_FILE, "not a directory", "utf-8");
    const SRC = await synthCfrClip("cache-disabled-src.mp4", 1);

    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const result = await extractWithCache(
        cfrClipElement("uncached", SRC, 1),
        "out-cache-disabled",
        CACHE_FILE,
      );

      expect(result.errors).toEqual([]);
      expect(result.extracted).toHaveLength(1);
      expect(result.phaseBreakdown.cacheHits).toBe(0);
      expect(result.phaseBreakdown.cacheMisses).toBe(0);
      expect(stderr).toHaveBeenCalledTimes(1);
      expect(String(stderr.mock.calls[0]?.[0])).toContain("extraction cache dir");
      expect(String(stderr.mock.calls[0]?.[0])).toContain("caching disabled for this render");
    } finally {
      stderr.mockRestore();
    }
  }, 60_000);

  it("invalidates the cache when fps changes", async () => {
    const CACHE_DIR = mkdtempSync(join(tmpdir(), "hf-extract-cache-test-"));
    const SRC = await synthCfrClip("cache-fps-src.mp4", 1);
    const video = cfrClipElement("cv2", SRC, 1);

    const first = await extractWithCache(video, "out-cache-fps-30", CACHE_DIR);
    expect(first.phaseBreakdown.cacheMisses).toBe(1);

    const second = await extractWithCache(video, "out-cache-fps-60", CACHE_DIR, 60);
    expect(second.phaseBreakdown.cacheMisses).toBe(1);
    expect(second.phaseBreakdown.cacheHits).toBe(0);

    rmSync(CACHE_DIR, { recursive: true, force: true });
  }, 60_000);

  it("applies SDR→HDR conversion during extraction without normalized intermediates", async () => {
    const SDR_LONG = await synthCfrClip("sdr-long.mp4", 10);
    const HDR_SHORT = await synthHdrTaggedClip("hdr-short.mp4", 2);
    const outputDir = join(FIXTURE_DIR, "out-hdr-segment");
    const plainOutputDir = join(FIXTURE_DIR, "out-hdr-plain-sdr");
    mkdirSync(outputDir, { recursive: true });
    mkdirSync(plainOutputDir, { recursive: true });

    const videos: VideoElement[] = [
      { id: "sdr", src: SDR_LONG, start: 0, end: 2, mediaStart: 0, loop: false, hasAudio: false },
      {
        id: "hdr",
        src: HDR_SHORT,
        start: 2,
        end: 4,
        mediaStart: 0,
        loop: false,
        hasAudio: false,
      },
    ];

    const result = await extractAllVideoFrames(videos, FIXTURE_DIR, {
      fps: 30,
      outputDir,
    });
    expect(result.errors).toEqual([]);
    expect(result.phaseBreakdown.hdrPreflightCount).toBe(1);
    expect(existsSync(join(outputDir, "_hdr_normalized"))).toBe(false);

    const sdrFrames = result.extracted.find((item) => item.videoId === "sdr");
    expect(sdrFrames?.totalFrames).toBe(60);

    const plain = await extractVideoFramesRange(SDR_LONG, "plain-sdr", 0, 2, {
      fps: 30,
      outputDir: plainOutputDir,
      format: "jpg",
    });
    expect(plain.totalFrames).toBe(60);
    expect(
      readFileSync(framePath(result, "sdr", 0)).equals(readFileSync(plain.framePaths.get(0)!)),
    ).toBe(false);
  }, 60_000);

  it("leaves SDR clips alone in a mixed timeline that tone-maps to SDR", async () => {
    const SDR = await synthCfrClip("sdr-tonemap-peer.mp4", 1);
    const HDR = await synthHdrTaggedClip("hdr-tonemap-peer.mp4", 1);
    const outputDir = join(FIXTURE_DIR, "out-hdr-tonemap-mixed");
    mkdirSync(outputDir, { recursive: true });

    const result = await extractAllVideoFrames(
      [cfrClipElement("sdr", SDR, 1), { ...cfrClipElement("hdr", HDR, 1), start: 1, end: 2 }],
      FIXTURE_DIR,
      { fps: 30, outputDir, toneMapHdrToSdr: true },
    );

    expect(result.errors).toEqual([]);
    expect(result.phaseBreakdown.hdrPreflightCount).toBe(0);
  }, 60_000);

  it("keeps a finite SDR past-EOF slot in a mixed HDR timeline", async () => {
    const SDR_SHORT = await synthCfrClip("sdr-past-eof.mp4", 1);
    const HDR_SHORT = await synthHdrTaggedClip("hdr-past-eof-peer.mp4", 1);
    const outputDir = join(FIXTURE_DIR, "out-hdr-past-eof");
    mkdirSync(outputDir, { recursive: true });

    const result = await extractAllVideoFrames(
      [
        cfrClipElement("sdr-past-eof", SDR_SHORT, 4, 5),
        { ...cfrClipElement("hdr-peer", HDR_SHORT, 1), start: 1, end: 2 },
      ],
      FIXTURE_DIR,
      { fps: 30, outputDir },
    );

    // The SDR slot must survive the mixed-HDR preflight and use the held-tail
    // path. Reverting its guard to `mediaStart >= playableDuration` records an
    // out-of-range error here and drops the slot before extraction.
    expect(result.errors).toEqual([]);
    expect(result.phaseBreakdown.hdrPreflightCount).toBe(1);
    expect(extractedFor(result, "sdr-past-eof").totalFrames).toBe(1);
    expect(extractedFor(result, "hdr-peer").totalFrames).toBeGreaterThan(0);
  }, 60_000);

  it("keeps SDR→HDR cache entries distinct from plain SDR entries", async () => {
    const CACHE_DIR = mkdtempSync(join(tmpdir(), "hf-extract-hdr-cache-test-"));
    const SDR = await synthCfrClip("cache-hdr-sdr.mp4", 1);
    const HDR = await synthHdrTaggedClip("cache-hdr-hdr.mp4", 1);
    try {
      const mixedOutputDir = join(FIXTURE_DIR, "out-cache-hdr-mixed");
      mkdirSync(mixedOutputDir, { recursive: true });
      const mixed = await extractAllVideoFrames(
        [
          cfrClipElement("sdr-transform", SDR, 1),
          { ...cfrClipElement("hdr-peer", HDR, 1), start: 1, end: 2 },
        ],
        FIXTURE_DIR,
        { fps: 30, outputDir: mixedOutputDir },
        undefined,
        { extractCacheDir: CACHE_DIR },
      );
      expect(mixed.errors).toEqual([]);
      expect(mixed.phaseBreakdown.hdrPreflightCount).toBe(1);
      expect(mixed.phaseBreakdown.cacheHits).toBe(0);
      expect(mixed.phaseBreakdown.cacheMisses).toBe(2);

      const plain = await extractWithCache(
        cfrClipElement("sdr-plain", SDR, 1),
        "out-cache-hdr-plain",
        CACHE_DIR,
      );
      expect(plain.errors).toEqual([]);
      expect(plain.phaseBreakdown.cacheHits).toBe(0);
      expect(plain.phaseBreakdown.cacheMisses).toBe(1);
      expect(cacheEntryNames(CACHE_DIR)).toHaveLength(3);

      // Cross-render poisoning regression: the plain-SDR render must not be
      // served the BT.2020-converted frames the mixed render cached for the
      // SAME source+trim. Compare actual frame bytes across the cache
      // boundary, not just entry counts.
      expect(
        readFileSync(framePath(plain, "sdr-plain", 0)).equals(
          readFileSync(framePath(mixed, "sdr-transform", 0)),
        ),
      ).toBe(false);

      // And a repeat plain render must HIT the plain entry and serve
      // byte-identical plain frames (proves the hit path keys correctly too).
      const plainAgain = await extractWithCache(
        cfrClipElement("sdr-plain-again", SDR, 1),
        "out-cache-hdr-plain-again",
        CACHE_DIR,
      );
      expect(plainAgain.phaseBreakdown.cacheHits).toBe(1);
      expect(
        readFileSync(framePath(plainAgain, "sdr-plain-again", 0)).equals(
          readFileSync(framePath(plain, "sdr-plain", 0)),
        ),
      ).toBe(true);
    } finally {
      rmSync(CACHE_DIR, { recursive: true, force: true });
    }
  }, 60_000);

  it("clusters overlap components so a disjoint outlier does not break the group", async () => {
    const SRC = await synthCfrClip("superset-cluster-src.mp4", 12);
    const outputDir = join(FIXTURE_DIR, "out-superset-cluster");
    mkdirSync(outputDir, { recursive: true });

    // Three overlapping trims [0..4], [2..6], [4..8] plus one disjoint trim
    // [10..12] of the same source. Pre-clustering, the outlier failed the
    // union<=sum check for the whole bucket and ALL FOUR fell back to direct
    // extraction; the overlapping three must still share one superset.
    const result = await extractAllVideoFrames(
      [
        cfrClipElement("cl-a", SRC, 4, 0),
        cfrClipElement("cl-b", SRC, 4, 2),
        cfrClipElement("cl-c", SRC, 4, 4),
        cfrClipElement("cl-out", SRC, 2, 10),
      ],
      FIXTURE_DIR,
      { fps: 30, outputDir },
    );

    expect(result.errors).toEqual([]);
    // Overlap region t=2..4 of the source: cl-a frame 60 and cl-b frame 0
    // must be the SAME inode (shared superset extraction).
    expect(statSync(framePath(result, "cl-a", 60)).ino).toBe(
      statSync(framePath(result, "cl-b", 0)).ino,
    );
    expect(statSync(framePath(result, "cl-b", 60)).ino).toBe(
      statSync(framePath(result, "cl-c", 0)).ino,
    );
    // The outlier extracted directly: its frames share no inode with the
    // cluster (frame at source t=10 exists only in its own extraction).
    expect(extractedFor(result, "cl-out").totalFrames).toBe(60);
    expect(supersetDirNames(outputDir)).toEqual([]);
  }, 60_000);

  it("runs the GC staleness fallback sweep on all-hit renders with a stale marker", async () => {
    const CACHE_DIR = mkdtempSync(join(tmpdir(), "hf-extract-cache-gc-stale-test-"));
    const SRC = await synthCfrClip("cache-gc-stale-src.mp4", 1);
    const video = cfrClipElement("gc-stale", SRC, 1);

    const miss = await extractWithCache(video, "out-cache-gc-stale-miss", CACHE_DIR);
    expect(miss.phaseBreakdown.cacheMisses).toBe(1);

    const agedPartial = join(CACHE_DIR, `${SCHEMA_PREFIX}aged.partial-1234-cafef00d`);
    mkdirSync(agedPartial, { recursive: true });
    writeFileSync(join(agedPartial, "frame_00001.jpg"), "stale", "utf-8");
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(agedPartial, twoHoursAgo, twoHoursAgo);

    // Age the sweep marker past the 24h staleness window: the next all-hit
    // render must sweep anyway and clear the aged partial.
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(join(CACHE_DIR, GC_MARKER), twoDaysAgo, twoDaysAgo);

    const hit = await extractWithCache(video, "out-cache-gc-stale-hit", CACHE_DIR);
    expect(hit.phaseBreakdown.cacheHits).toBe(1);
    expect(hit.phaseBreakdown.cacheMisses).toBe(0);
    expect(existsSync(agedPartial)).toBe(false);
    expect(hit.phaseBreakdown.cacheAgedPartialsCleared).toBe(1);

    rmSync(CACHE_DIR, { recursive: true, force: true });
  }, 60_000);

  it("hardlinks overlapping aligned trims from one superset extraction", async () => {
    const SRC = await synthCfrClip("superset-overlap-src.mp4", 10);
    const outputDir = join(FIXTURE_DIR, "out-superset-overlap");
    const directOutputDir = join(FIXTURE_DIR, "out-superset-direct");
    mkdirSync(outputDir, { recursive: true });
    mkdirSync(directOutputDir, { recursive: true });

    const result = await extractAllVideoFrames(
      [cfrClipElement("trim-a", SRC, 4, 0), cfrClipElement("trim-b", SRC, 4, 2)],
      FIXTURE_DIR,
      { fps: 30, outputDir },
    );

    expect(result.errors).toEqual([]);
    expect(extractedFor(result, "trim-a").totalFrames).toBe(120);
    expect(extractedFor(result, "trim-b").totalFrames).toBe(120);
    expect(statSync(framePath(result, "trim-a", 60)).ino).toBe(
      statSync(framePath(result, "trim-b", 0)).ino,
    );

    const direct = await extractVideoFramesRange(SRC, "direct-trim-b", 2, 4, {
      fps: 30,
      outputDir: directOutputDir,
      format: "jpg",
    });
    expect(
      readFileSync(framePath(result, "trim-b", 0)).equals(readFileSync(direct.framePaths.get(0)!)),
    ).toBe(true);
    expect(supersetDirNames(outputDir)).toEqual([]);
  }, 60_000);

  it.each([
    { label: "decimal underflow half-frame", duration: 2.05, offset: 1, expectedFrames: 62 },
    {
      label: "non-half-integer boundary",
      duration: 0.616666,
      offset: 0.1,
      expectedFrames: 19,
    },
  ])(
    "keeps direct and superset CFR extraction equal at a $label",
    async ({ label, duration, offset, expectedFrames }) => {
      const fixtureKey = label.replaceAll(" ", "-");
      const src = await synthCfrClip(`superset-cfr-${fixtureKey}.mp4`, 4);
      const groupedOutputDir = join(FIXTURE_DIR, `out-superset-cfr-${fixtureKey}`);
      const directOutputDir = join(FIXTURE_DIR, `out-direct-cfr-${fixtureKey}`);
      mkdirSync(groupedOutputDir, { recursive: true });
      mkdirSync(directOutputDir, { recursive: true });

      const grouped = await extractAllVideoFrames(
        [
          cfrClipElement(`${fixtureKey}-base`, src, duration, 0),
          cfrClipElement(`${fixtureKey}-member`, src, duration, offset),
        ],
        FIXTURE_DIR,
        { fps: 30, outputDir: groupedOutputDir },
      );
      const direct = await extractVideoFramesRange(src, `${fixtureKey}-direct`, offset, duration, {
        fps: 30,
        outputDir: directOutputDir,
        format: "jpg",
      });

      expect(grouped.errors).toEqual([]);
      expect(direct.totalFrames).toBe(expectedFrames);
      expect(extractedFor(grouped, `${fixtureKey}-base`).totalFrames).toBe(expectedFrames);
      expect(extractedFor(grouped, `${fixtureKey}-member`).totalFrames).toBe(expectedFrames);
      expect(statSync(framePath(grouped, `${fixtureKey}-base`, Math.round(offset * 30))).ino).toBe(
        statSync(framePath(grouped, `${fixtureKey}-member`, 0)).ino,
      );
      for (let frame = 0; frame < expectedFrames; frame += 1) {
        expect(
          readFileSync(framePath(grouped, `${fixtureKey}-member`, frame)).equals(
            readFileSync(direct.framePaths.get(frame)!),
          ),
        ).toBe(true);
      }
      expect(supersetDirNames(groupedOutputDir)).toEqual([]);
    },
    60_000,
  );

  it("keeps direct and superset CFR extraction equal at 30000/1001", async () => {
    const src = await synthCfrClip("superset-cfr-ntsc.mp4", 4);
    const groupedOutputDir = join(FIXTURE_DIR, "out-superset-cfr-ntsc");
    const directOutputDir = join(FIXTURE_DIR, "out-direct-cfr-ntsc");
    const fps = { num: 30000, den: 1001 };
    const duration = 0.25025;
    mkdirSync(groupedOutputDir, { recursive: true });
    mkdirSync(directOutputDir, { recursive: true });

    const grouped = await extractAllVideoFrames(
      [
        cfrClipElement("ntsc-base", src, 0.5005, 0),
        cfrClipElement("ntsc-member", src, duration, 0),
      ],
      FIXTURE_DIR,
      { fps, outputDir: groupedOutputDir },
    );
    const direct = await extractVideoFramesRange(src, "ntsc-direct", 0, duration, {
      fps,
      outputDir: directOutputDir,
      format: "jpg",
    });

    expect(grouped.errors).toEqual([]);
    expect(direct.totalFrames).toBe(8);
    expect(extractedFor(grouped, "ntsc-base").totalFrames).toBe(15);
    expect(extractedFor(grouped, "ntsc-member").totalFrames).toBe(8);
    expect(statSync(framePath(grouped, "ntsc-base", 0)).ino).toBe(
      statSync(framePath(grouped, "ntsc-member", 0)).ino,
    );
    for (let frame = 0; frame < 8; frame += 1) {
      expect(
        readFileSync(framePath(grouped, "ntsc-member", frame)).equals(
          readFileSync(direct.framePaths.get(frame)!),
        ),
      ).toBe(true);
    }
    expect(supersetDirNames(groupedOutputDir)).toEqual([]);
  }, 60_000);

  it("does not superset disjoint trims", async () => {
    const SRC = await synthCfrClip("superset-disjoint-src.mp4", 10);
    const outputDir = join(FIXTURE_DIR, "out-superset-disjoint");
    mkdirSync(outputDir, { recursive: true });

    const result = await extractAllVideoFrames(
      [cfrClipElement("trim-a", SRC, 2, 0), cfrClipElement("trim-b", SRC, 2, 8)],
      FIXTURE_DIR,
      { fps: 30, outputDir },
    );

    expect(result.errors).toEqual([]);
    expect(statSync(framePath(result, "trim-a", 0)).ino).not.toBe(
      statSync(framePath(result, "trim-b", 0)).ino,
    );
    expect(supersetDirNames(outputDir)).toEqual([]);
  }, 60_000);

  it("does not superset trims whose offsets are not frame-aligned", async () => {
    const SRC = await synthCfrClip("superset-misaligned-src.mp4", 2);
    const outputDir = join(FIXTURE_DIR, "out-superset-misaligned");
    mkdirSync(outputDir, { recursive: true });

    const result = await extractAllVideoFrames(
      [cfrClipElement("trim-a", SRC, 1, 0), cfrClipElement("trim-b", SRC, 1, 0.017)],
      FIXTURE_DIR,
      { fps: 30, outputDir },
    );

    expect(result.errors).toEqual([]);
    expect(statSync(framePath(result, "trim-a", 0)).ino).not.toBe(
      statSync(framePath(result, "trim-b", 0)).ino,
    );
    expect(supersetDirNames(outputDir)).toEqual([]);
  }, 60_000);

  it("keeps overlapping VFR trims direct because CFR resampling phase resets per seek", async () => {
    const outputDir = join(FIXTURE_DIR, "out-vfr-superset-short");
    mkdirSync(outputDir, { recursive: true });

    const result = await extractAllVideoFrames(
      [
        cfrClipElement("vfr-short-a", VFR_FIXTURE, 0.616666, 0),
        cfrClipElement("vfr-short-b", VFR_FIXTURE, 0.616666, 0.1),
      ],
      FIXTURE_DIR,
      { fps: 30, outputDir },
    );

    expect(result.errors).toEqual([]);
    expect(extractedFor(result, "vfr-short-a").metadata.isVFR).toBe(true);
    expect(extractedFor(result, "vfr-short-a").totalFrames).toBe(19);
    expect(extractedFor(result, "vfr-short-b").totalFrames).toBe(19);
    expect(statSync(framePath(result, "vfr-short-a", 3)).ino).not.toBe(
      statSync(framePath(result, "vfr-short-b", 0)).ino,
    );
    expect(supersetDirNames(outputDir)).toEqual([]);
  }, 60_000);

  it("keeps batched and direct VFR extraction equal at a floating integral boundary", async () => {
    const groupedOutputDir = join(FIXTURE_DIR, "out-vfr-superset-integral-boundary");
    const directOutputDir = join(FIXTURE_DIR, "out-vfr-direct-integral-boundary");
    mkdirSync(groupedOutputDir, { recursive: true });
    mkdirSync(directOutputDir, { recursive: true });

    const first: VideoElement = {
      id: "vfr-integral-a",
      src: VFR_FIXTURE,
      start: 0.03,
      end: 0.33,
      mediaStart: 0.03,
      loop: false,
      hasAudio: false,
    };
    const second: VideoElement = {
      ...first,
      id: "vfr-integral-b",
      mediaStart: 0.13,
    };

    const direct = await extractAllVideoFrames([{ ...second }], FIXTURE_DIR, {
      fps: 30,
      outputDir: directOutputDir,
    });
    const grouped = await extractAllVideoFrames([{ ...first }, second], FIXTURE_DIR, {
      fps: 30,
      outputDir: groupedOutputDir,
    });

    expect(direct.errors).toEqual([]);
    expect(grouped.errors).toEqual([]);
    expect(extractedFor(direct, second.id).totalFrames).toBe(9);
    expect(extractedFor(grouped, first.id).totalFrames).toBe(9);
    expect(extractedFor(grouped, second.id).totalFrames).toBe(9);
    for (let frame = 0; frame < 9; frame += 1) {
      expect(
        readFileSync(framePath(grouped, second.id, frame)).equals(
          readFileSync(framePath(direct, second.id, frame)),
        ),
      ).toBe(true);
    }
    expect(statSync(framePath(grouped, first.id, 3)).ino).not.toBe(
      statSync(framePath(grouped, second.id, 0)).ino,
    );
    expect(supersetDirNames(groupedOutputDir)).toEqual([]);
  }, 60_000);

  it("publishes overlapping superset slices to cache entries and hits them on the next render", async () => {
    const CACHE_DIR = mkdtempSync(join(tmpdir(), "hf-extract-superset-cache-test-"));
    const SRC = await synthCfrClip("superset-cache-src.mp4", 10);
    try {
      const firstOutputDir = join(FIXTURE_DIR, "out-superset-cache-first");
      const secondOutputDir = join(FIXTURE_DIR, "out-superset-cache-second");
      mkdirSync(firstOutputDir, { recursive: true });
      mkdirSync(secondOutputDir, { recursive: true });
      const videos = [cfrClipElement("trim-a", SRC, 4, 0), cfrClipElement("trim-b", SRC, 4, 2)];

      const first = await extractAllVideoFrames(
        videos,
        FIXTURE_DIR,
        { fps: 30, outputDir: firstOutputDir },
        undefined,
        { extractCacheDir: CACHE_DIR },
      );
      expect(first.errors).toEqual([]);
      expect(first.phaseBreakdown.cacheHits).toBe(0);
      expect(first.phaseBreakdown.cacheMisses).toBe(2);
      expect(cacheEntryNames(CACHE_DIR)).toHaveLength(2);
      expect(statSync(framePath(first, "trim-a", 60)).ino).toBe(
        statSync(framePath(first, "trim-b", 0)).ino,
      );

      const second = await extractAllVideoFrames(
        videos,
        FIXTURE_DIR,
        { fps: 30, outputDir: secondOutputDir },
        undefined,
        { extractCacheDir: CACHE_DIR },
      );
      expect(second.errors).toEqual([]);
      expect(second.phaseBreakdown.cacheHits).toBe(2);
      expect(second.phaseBreakdown.cacheMisses).toBe(0);
      expect(supersetDirNames(secondOutputDir)).toEqual([]);
    } finally {
      rmSync(CACHE_DIR, { recursive: true, force: true });
    }
  }, 60_000);

  it("clamps loop-past-EOF superset slices to available source frames", async () => {
    const SRC = await synthCfrClip("superset-eof-src.mp4", 10);
    const outputDir = join(FIXTURE_DIR, "out-superset-eof");
    mkdirSync(outputDir, { recursive: true });

    const result = await extractAllVideoFrames(
      [cfrClipElement("covered", SRC, 4, 6), cfrClipElement("past-eof", SRC, 6, 8)],
      FIXTURE_DIR,
      { fps: 30, outputDir },
    );

    expect(result.errors).toEqual([]);
    expect(extractedFor(result, "covered").totalFrames).toBe(120);
    expect(extractedFor(result, "past-eof").totalFrames).toBe(60);
    expect(statSync(framePath(result, "covered", 60)).ino).toBe(
      statSync(framePath(result, "past-eof", 0)).ino,
    );
    expect(supersetDirNames(outputDir)).toEqual([]);
  }, 60_000);

  // Asserts frame-count correctness for a full VFR file. One-pass CFR image
  // extraction may repeat held source frames across timestamp gaps; the freeze
  // regression is missing frames, which leaves late timeline lookups null.
  it("produces the full frame count on the full VFR file", async () => {
    const outputDir = join(FIXTURE_DIR, "out-full");
    mkdirSync(outputDir, { recursive: true });

    const video: VideoElement = {
      id: "vfull",
      src: VFR_FIXTURE,
      start: 0,
      end: 10,
      mediaStart: 0,
      loop: false,
      hasAudio: false,
    };

    const result = await extractAllVideoFrames([video], FIXTURE_DIR, {
      fps: 30,
      outputDir,
    });
    expect(result.errors).toEqual([]);

    const frameDir = join(outputDir, "vfull");
    const frames = readdirSync(frameDir)
      .filter((f) => f.endsWith(".jpg"))
      .sort();
    // ±3 tolerance: same FFmpeg one-pass VFR→CFR rounding variance as the
    // mid-segment test.
    expect(frames.length).toBeGreaterThanOrEqual(297);
    expect(frames.length).toBeLessThanOrEqual(303);
  }, 60_000);
});
