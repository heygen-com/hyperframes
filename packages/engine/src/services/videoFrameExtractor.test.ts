import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  parseVideoElements,
  parseImageElements,
  extractAllVideoFrames,
  createFrameLookupTable,
  resolveProjectRelativeSrc,
  codecMayHaveAlpha,
  decoderForCodec,
  type VideoElement,
  type ExtractedFrames,
} from "./videoFrameExtractor.js";
import { extractVideoMetadata } from "../utils/ffprobe.js";
import { runFfmpeg } from "../utils/runFfmpeg.js";

// ffmpeg is not preinstalled on GitHub's ubuntu-24.04 runners. The producer
// regression test at packages/producer/tests/vfr-screen-recording/ runs inside
// Dockerfile.test (which does include ffmpeg) and is the primary CI signal
// for this bug. Locally and in any CI job with ffmpeg on PATH, the tests
// below run too — they exercise the extractor in isolation against a
// synthesized VFR fixture.
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;

// Codec-based alpha defaulting replaces tag-based detection (the
// alpha_mode/ALPHA_MODE case bug — see ffprobe.test.ts for the regression
// pin on that). The extractor uses these helpers for two decisions:
//   1. whether to force the alpha-aware decoder (libvpx-vp9 for VP9, libvpx
//      for VP8)
//   2. whether to default the cached frame format to PNG (with alpha) vs JPG
// The "default to capable" trade is small file-size growth on opaque VP9
// content for correctness on alpha-having content even when the sidecar tag
// is missing or muxed with the wrong case.
describe("codec alpha capability", () => {
  it("flags VP9, VP8, and ProRes as alpha-capable", () => {
    expect(codecMayHaveAlpha("vp9")).toBe(true);
    expect(codecMayHaveAlpha("VP9")).toBe(true);
    expect(codecMayHaveAlpha("vp8")).toBe(true);
    expect(codecMayHaveAlpha("prores")).toBe(true);
  });

  it("does not flag h264 / h265 / mpeg4 (no alpha in their bitstreams)", () => {
    expect(codecMayHaveAlpha("h264")).toBe(false);
    expect(codecMayHaveAlpha("h265")).toBe(false);
    expect(codecMayHaveAlpha("hevc")).toBe(false);
    expect(codecMayHaveAlpha("mpeg4")).toBe(false);
  });

  it("treats undefined / empty input as non-alpha", () => {
    expect(codecMayHaveAlpha(undefined)).toBe(false);
    expect(codecMayHaveAlpha("")).toBe(false);
  });

  it("returns the alpha-aware decoder name for VP9 and VP8", () => {
    expect(decoderForCodec("vp9")).toBe("libvpx-vp9");
    expect(decoderForCodec("VP9")).toBe("libvpx-vp9");
    expect(decoderForCodec("vp8")).toBe("libvpx");
  });
});

// Regression: a long-standing footgun where `<video src="../assets/foo">`
// inside a sub-composition silently dropped the video from extraction. The
// browser's URL resolver clamps `..` at the served origin's root (so the
// page renders fine in the studio), but `path.join(projectDir, "../assets/foo")`
// normalizes to <parentOfProjectDir>/assets/foo, which doesn't exist —
// extraction skipped, no frame injection, rendered output shows the video's
// first decoded frame for the whole clip duration. The resolver now mirrors
// browser semantics by clamping any traversal that escapes the project root.
describe("resolveProjectRelativeSrc — sub-composition path clamping", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "hf-resolver-"));
    mkdirSync(join(tmp, "project", "assets"), { recursive: true });
    writeFileSync(join(tmp, "project", "assets", "foo.mp4"), "");
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns the literal join when the file exists at projectDir/src", () => {
    const projectDir = join(tmp, "project");
    expect(resolveProjectRelativeSrc("assets/foo.mp4", projectDir)).toBe(
      join(projectDir, "assets/foo.mp4"),
    );
  });

  it("clamps a leading `../` so `../assets/foo.mp4` resolves to assets/foo.mp4", () => {
    const projectDir = join(tmp, "project");
    expect(resolveProjectRelativeSrc("../assets/foo.mp4", projectDir)).toBe(
      join(projectDir, "assets/foo.mp4"),
    );
  });

  it("clamps multiple leading `../../../` segments", () => {
    const projectDir = join(tmp, "project");
    expect(resolveProjectRelativeSrc("../../../assets/foo.mp4", projectDir)).toBe(
      join(projectDir, "assets/foo.mp4"),
    );
  });

  it("clamps mid-path traversal that escapes baseDir (not just leading `..`)", () => {
    // `assets/../../foo.mp4` collapses past projectDir via path.join — this
    // case used to silently escape; the resolver now strips embedded `..`
    // segments and re-anchors at the project root.
    const projectDir = join(tmp, "project");
    expect(resolveProjectRelativeSrc("assets/../../assets/foo.mp4", projectDir)).toBe(
      join(projectDir, "assets/foo.mp4"),
    );
  });

  it("returns the (non-existent) base-dir path on miss so callers get a stable error message", () => {
    const projectDir = join(tmp, "project");
    expect(resolveProjectRelativeSrc("../assets/missing.mp4", projectDir)).toBe(
      join(projectDir, "../assets/missing.mp4"),
    );
  });

  it("prefers compiled-dir over base-dir when the file exists in both", () => {
    const projectDir = join(tmp, "project");
    const compiledDir = join(tmp, "compiled");
    mkdirSync(join(compiledDir, "assets"), { recursive: true });
    writeFileSync(join(compiledDir, "assets", "foo.mp4"), "");
    expect(resolveProjectRelativeSrc("assets/foo.mp4", projectDir, compiledDir)).toBe(
      join(compiledDir, "assets/foo.mp4"),
    );
  });

  it("resolves percent-encoded non-Latin filenames across scripts", () => {
    const projectDir = join(tmp, "project");
    const cases = [
      ["arabic", "%D9%87%D9%86%D8%A7-%D9%85%D8%B1%D9%88%D8%A7.mp4"],
      ["japanese", "%E6%97%A5%E6%9C%AC%E8%AA%9E.mp4"],
      ["cyrillic", "%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82.mp4"],
      ["korean", "%ED%95%9C%EA%B8%80.mp4"],
    ] as const;

    for (const [, encodedFilename] of cases) {
      const filename = decodeURIComponent(encodedFilename);
      writeFileSync(join(projectDir, "assets", filename), "");

      expect(resolveProjectRelativeSrc(`assets/${encodedFilename}`, projectDir)).toBe(
        join(projectDir, "assets", filename),
      );
    }
  });

  it("falls back to literal filenames when percent sequences are malformed", () => {
    const projectDir = join(tmp, "project");
    const filename = "100%-discount.mp4";
    writeFileSync(join(projectDir, "assets", filename), "");

    expect(resolveProjectRelativeSrc(`assets/${filename}`, projectDir)).toBe(
      join(projectDir, "assets", filename),
    );
  });
});

describe("parseVideoElements", () => {
  it("parses videos without an id or data-start attribute", () => {
    const videos = parseVideoElements('<video src="clip.mp4"></video>');

    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({
      id: "hf-video-0",
      src: "clip.mp4",
      start: 0,
      end: Infinity,
      mediaStart: 0,
      loop: false,
      hasAudio: false,
    });
  });

  it("preserves explicit ids and derives end from data-duration", () => {
    const videos = parseVideoElements(
      '<video id="hero" src="clip.mp4" data-start="2" data-duration="5" data-media-start="1.5" data-has-audio="true"></video>',
    );

    expect(videos).toHaveLength(1);
    expect(videos[0]).toEqual({
      id: "hero",
      src: "clip.mp4",
      start: 2,
      end: 7,
      mediaStart: 1.5,
      loop: false,
      hasAudio: true,
    });
  });

  it("preserves looped timed video semantics for render frame lookup", () => {
    const videos = parseVideoElements(
      '<video id="hero" src="clip.webm" data-start="2" data-duration="5" loop></video>',
    );

    expect(videos[0]).toMatchObject({
      id: "hero",
      start: 2,
      end: 7,
      loop: true,
    });
  });
});

describe("FrameLookupTable", () => {
  function fakeExtracted(totalFrames: number, fps: number): ExtractedFrames {
    const framePaths = new Map<number, string>();
    for (let i = 0; i < totalFrames; i += 1) {
      framePaths.set(i, `frame-${i}.jpg`);
    }
    return {
      videoId: "hero",
      srcPath: "clip.webm",
      outputDir: "/tmp/frames",
      framePattern: "frame-%05d.jpg",
      fps,
      totalFrames,
      metadata: {
        durationSeconds: totalFrames / fps,
        width: 320,
        height: 180,
        fps,
        hasAudio: false,
        videoCodec: "vp9",
        colorSpace: {
          colorTransfer: "bt709",
          colorPrimaries: "bt709",
          colorSpace: "bt709",
        },
        isVFR: false,
        hasAlpha: false,
      },
      framePaths,
    };
  }

  it("wraps active frame payloads for looped clips whose display window exceeds source frames", () => {
    const table = createFrameLookupTable(
      [
        {
          id: "hero",
          src: "clip.webm",
          start: 0,
          end: 5,
          mediaStart: 0,
          loop: true,
          hasAudio: false,
        },
      ],
      [fakeExtracted(30, 30)],
    );

    expect(table.getActiveFramePayloads(0.5).get("hero")?.frameIndex).toBe(15);
    expect(table.getActiveFramePayloads(1.5).get("hero")?.frameIndex).toBe(15);
    expect(table.getActiveFramePayloads(4.5).get("hero")?.frameIndex).toBe(15);
  });

  it("does not hold stale frames for non-looping clips after extracted frames end", () => {
    const table = createFrameLookupTable(
      [
        {
          id: "hero",
          src: "clip.webm",
          start: 0,
          end: 5,
          mediaStart: 0,
          loop: false,
          hasAudio: false,
        },
      ],
      [fakeExtracted(30, 30)],
    );

    expect(table.getActiveFramePayloads(0.5).has("hero")).toBe(true);
    expect(table.getActiveFramePayloads(1.5).has("hero")).toBe(false);
  });
});

describe("parseImageElements", () => {
  it("parses images with data-start and data-duration", () => {
    const images = parseImageElements(
      '<img id="photo" src="hdr-photo.png" data-start="0" data-duration="3" />',
    );

    expect(images).toHaveLength(1);
    expect(images[0]).toEqual({
      id: "photo",
      src: "hdr-photo.png",
      start: 0,
      end: 3,
    });
  });

  it("generates stable IDs for images without one", () => {
    const images = parseImageElements(
      '<img src="a.png" data-start="0" data-end="2" /><img src="b.png" data-start="1" data-end="4" />',
    );

    expect(images).toHaveLength(2);
    expect(images[0]!.id).toBe("hf-img-0");
    expect(images[1]!.id).toBe("hf-img-1");
  });

  it("defaults start to 0 and end to Infinity when attributes missing", () => {
    const images = parseImageElements('<img src="photo.png" />');

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      src: "photo.png",
      start: 0,
      end: Infinity,
    });
  });

  it("ignores img elements without src", () => {
    const images = parseImageElements('<img data-start="0" data-end="3" />');
    expect(images).toHaveLength(0);
  });

  it("uses data-end over data-duration when both present", () => {
    const images = parseImageElements(
      '<img src="a.png" data-start="1" data-end="5" data-duration="10" />',
    );
    expect(images[0]!.end).toBe(5);
  });
});

// Regression test for the VFR (variable frame rate) freeze bug.
// Screen recordings and phone videos often have irregular timestamps.
// When such inputs hit `extractVideoFramesRange`'s `-ss <start> -i ... -t <dur>
// -vf fps=N` pipeline, the fps filter can emit fewer frames than requested —
// e.g. a 4-second segment at 30fps would produce ~90 frames instead of 120.
// FrameLookupTable.getFrameAtTime then returns null for out-of-range indices
// and the compositor holds the last valid frame, which the user perceives as
// the video freezing. extractAllVideoFrames normalizes VFR sources to CFR
// before extraction to fix this.
describe.skipIf(!HAS_FFMPEG)("extractAllVideoFrames on a VFR source", () => {
  const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "hf-vfr-test-"));
  const VFR_FIXTURE = join(FIXTURE_DIR, "vfr_screen.mp4");

  beforeAll(async () => {
    // 10s testsrc2 at 60fps, ~40% of frames dropped via select filter and
    // encoded with -vsync vfr so timestamps are irregular. Declared fps 60,
    // actual average ~36 — well over the 10% threshold used by isVFR.
    // The select expression drops four 1-second windows (frames 30-89,
    // 180-239, 330-389, 480-539) to simulate static segments in a screen
    // recording where no pixels changed.
    // -g/-keyint_min 600 forces a single keyframe so mid-segment seeks in the
    // mediaStart=3 test don't snap to an intermediate IDR and drift the count.
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
      "-vsync",
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
  });

  it("detects the synthesized fixture as VFR", async () => {
    const md = await extractVideoMetadata(VFR_FIXTURE);
    expect(md.isVFR).toBe(true);
  });

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
    // ±3 tolerance: FFmpeg's VFR→CFR normalization yields slightly different
    // frame counts across versions (timestamp rounding in the fps filter).
    expect(frames.length).toBeGreaterThanOrEqual(117);
    expect(frames.length).toBeLessThanOrEqual(123);

    expect(result.phaseBreakdown).toBeDefined();
    expect(result.phaseBreakdown.extractMs).toBeGreaterThan(0);
    expect(result.phaseBreakdown.vfrPreflightCount).toBe(1);
    expect(result.phaseBreakdown.vfrPreflightMs).toBeGreaterThan(0);
  }, 60_000);

  it("reuses extracted frames on a warm cache hit", async () => {
    const CACHE_DIR = mkdtempSync(join(tmpdir(), "hf-extract-cache-test-"));
    const SRC = join(FIXTURE_DIR, "cache-src.mp4");

    // Synthesize a clean CFR SDR clip — bypasses VFR preflight so the cache
    // key is stable across the two runs.
    const synth = await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=320x180:d=2:rate=30",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      SRC,
    ]);
    if (!synth.success) {
      throw new Error(`Cache fixture synthesis failed: ${synth.stderr.slice(-400)}`);
    }

    const video: VideoElement = {
      id: "cv1",
      src: SRC,
      start: 0,
      end: 2,
      mediaStart: 0,
      loop: false,
      hasAudio: false,
    };

    const outDirA = join(FIXTURE_DIR, "out-cache-miss");
    mkdirSync(outDirA, { recursive: true });
    const miss = await extractAllVideoFrames(
      [video],
      FIXTURE_DIR,
      { fps: 30, outputDir: outDirA },
      undefined,
      { extractCacheDir: CACHE_DIR },
    );
    expect(miss.errors).toEqual([]);
    expect(miss.phaseBreakdown.cacheHits).toBe(0);
    expect(miss.phaseBreakdown.cacheMisses).toBe(1);

    const outDirB = join(FIXTURE_DIR, "out-cache-hit");
    mkdirSync(outDirB, { recursive: true });
    const hit = await extractAllVideoFrames(
      [video],
      FIXTURE_DIR,
      { fps: 30, outputDir: outDirB },
      undefined,
      { extractCacheDir: CACHE_DIR },
    );
    expect(hit.errors).toEqual([]);
    expect(hit.phaseBreakdown.cacheHits).toBe(1);
    expect(hit.phaseBreakdown.cacheMisses).toBe(0);
    // extractMs on a hit is only the cache-lookup bookkeeping; asserting <50ms
    // is loose enough to survive CI jitter but tight enough to catch a
    // regression that accidentally triggered ffmpeg again.
    expect(hit.phaseBreakdown.extractMs).toBeLessThan(50);
    expect(hit.extracted).toHaveLength(1);
    expect(hit.extracted[0]!.totalFrames).toBe(miss.extracted[0]!.totalFrames);

    rmSync(CACHE_DIR, { recursive: true, force: true });
  }, 60_000);

  it("invalidates the cache when fps changes", async () => {
    const CACHE_DIR = mkdtempSync(join(tmpdir(), "hf-extract-cache-test-"));
    const SRC = join(FIXTURE_DIR, "cache-fps-src.mp4");

    const synth = await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=320x180:d=1:rate=30",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      SRC,
    ]);
    if (!synth.success) {
      throw new Error(`Cache-fps fixture synthesis failed: ${synth.stderr.slice(-400)}`);
    }

    const video: VideoElement = {
      id: "cv2",
      src: SRC,
      start: 0,
      end: 1,
      mediaStart: 0,
      loop: false,
      hasAudio: false,
    };

    const outA = join(FIXTURE_DIR, "out-cache-fps-30");
    mkdirSync(outA, { recursive: true });
    const first = await extractAllVideoFrames(
      [video],
      FIXTURE_DIR,
      { fps: 30, outputDir: outA },
      undefined,
      { extractCacheDir: CACHE_DIR },
    );
    expect(first.phaseBreakdown.cacheMisses).toBe(1);

    const outB = join(FIXTURE_DIR, "out-cache-fps-60");
    mkdirSync(outB, { recursive: true });
    const second = await extractAllVideoFrames(
      [video],
      FIXTURE_DIR,
      { fps: 60, outputDir: outB },
      undefined,
      { extractCacheDir: CACHE_DIR },
    );
    expect(second.phaseBreakdown.cacheMisses).toBe(1);
    expect(second.phaseBreakdown.cacheHits).toBe(0);

    rmSync(CACHE_DIR, { recursive: true, force: true });
  }, 60_000);

  // Regression test for the segment-scope HDR preflight fix: pre-fix,
  // convertSdrToHdr re-encoded the entire source, so a 30-minute SDR source
  // contributing a 2-second clip took ~200× longer than needed. Post-fix the
  // converted file's duration matches the used segment.
  it("bounds the SDR→HDR preflight re-encode to the used segment", async () => {
    const SDR_LONG = join(FIXTURE_DIR, "sdr-long.mp4");
    const HDR_SHORT = join(FIXTURE_DIR, "hdr-short.mp4");

    const sdrResult = await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=320x180:d=10:rate=30",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      SDR_LONG,
    ]);
    if (!sdrResult.success) {
      throw new Error(`SDR fixture synthesis failed: ${sdrResult.stderr.slice(-400)}`);
    }

    // Tag as bt2020nc / smpte2084 so the preflight path considers the timeline mixed-HDR.
    const hdrResult = await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=320x180:d=2:rate=30",
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
      HDR_SHORT,
    ]);
    if (!hdrResult.success) {
      throw new Error(`HDR fixture synthesis failed: ${hdrResult.stderr.slice(-400)}`);
    }

    const outputDir = join(FIXTURE_DIR, "out-hdr-segment");
    mkdirSync(outputDir, { recursive: true });

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

    const convertedPath = join(outputDir, "_hdr_normalized", "sdr_hdr.mp4");
    expect(existsSync(convertedPath)).toBe(true);
    const convertedMeta = await extractVideoMetadata(convertedPath);
    // Pre-fix duration matched the 10s source; post-fix it matches the 2s segment
    // (±0.2s for encoder keyframe/seek alignment).
    expect(convertedMeta.durationSeconds).toBeGreaterThan(1.8);
    expect(convertedMeta.durationSeconds).toBeLessThan(2.5);
  }, 60_000);

  // Asserts both frame-count correctness and that we don't emit long runs of
  // byte-identical "duplicate" frames — the user-visible "frozen screen
  // recording" symptom. Pre-fix duplicate rate on this fixture is ~38%
  // (116/300); on the actual reporter's ScreenCaptureKit clip, 18–44% across
  // segments. <10% threshold leaves margin across ffmpeg versions without
  // letting a regression slip through.
  it("produces the full frame count and no duplicate-frame runs on the full VFR file", async () => {
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
    // ±3 tolerance: same FFmpeg VFR→CFR rounding variance as the mid-segment test.
    expect(frames.length).toBeGreaterThanOrEqual(297);
    expect(frames.length).toBeLessThanOrEqual(303);

    let prevHash: string | null = null;
    let duplicates = 0;
    for (const f of frames) {
      const hash = createHash("sha256")
        .update(readFileSync(join(frameDir, f)))
        .digest("hex");
      if (hash === prevHash) duplicates += 1;
      prevHash = hash;
    }
    const duplicateRate = duplicates / frames.length;
    expect(duplicateRate).toBeLessThan(0.1);
  }, 60_000);
});
