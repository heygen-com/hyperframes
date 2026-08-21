// fallow-ignore-file code-duplication
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
  parseImageElements,
  extractAllVideoFrames,
  extractVideoFramesRange,
  extractionFrameCountForDuration,
  createFrameLookupTable,
  resolveProjectRelativeSrc,
  resolveFrameFormat,
  codecMayHaveAlpha,
  decoderForCodec,
  resolveVideoExtractionWindow,
  resolveVideoExtractionDuration,
  getFrameAtTime,
  analyzeClipMediaFit,
  classifyVideoExtractionError,
  runVideoExtractionWithRetry,
  VideoSourceExtractionError,
  type VideoElement,
  type ExtractedFrames,
  type ExtractionResult,
} from "./videoFrameExtractor.js";

describe("parseVideoElements strict literal timing", () => {
  it.each(["", "   ", "0s", "0abc", "0px", "-1s", "Infinity", "NaN", "0x10"])(
    "does not drop hand-authored data-duration=%j as an explicit zero window",
    (duration) => {
      expect(
        parseVideoElements(
          `<video id="v" src="clip.mp4" data-start="0" data-duration="${duration}"></video>`,
        ),
      ).toHaveLength(1);
    },
  );
});
import {
  extractFinalVideoFrameTimestamp,
  extractVideoMetadata,
  type VideoMetadata,
} from "../utils/ffprobe.js";
import { runFfmpeg } from "../utils/runFfmpeg.js";
import { COMPLETE_SENTINEL, GC_MARKER, SCHEMA_PREFIX } from "./extractionCache.js";
import { resolveRuntimeMediaClipDuration } from "../../../core/src/runtime/media.js";
import { compileTimingAttrs } from "@hyperframes/core";

// ffmpeg is not preinstalled on GitHub's ubuntu-24.04 runners. The producer
// regression test at packages/producer/tests/vfr-screen-recording/ runs inside
// Dockerfile.test (which does include ffmpeg) and is the primary CI signal
// for this bug. Locally and in any CI job with ffmpeg on PATH, the tests
// below run too — they exercise the extractor in isolation against a
// synthesized VFR fixture.
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;

describe("resolveVideoExtractionDuration", () => {
  const metadata = (
    durationSeconds: number,
    videoStreamDurationSeconds = durationSeconds,
  ): VideoMetadata => ({
    durationSeconds,
    videoStreamDurationSeconds,
    width: 1920,
    height: 1080,
    fps: 30,
    videoCodec: "h264",
    hasAudio: false,
    isVFR: false,
    hasAlpha: false,
    colorSpace: null,
  });
  const video = (overrides: Partial<VideoElement> = {}): VideoElement => ({
    id: "root-video",
    src: "video.mp4",
    start: 0,
    end: Number.POSITIVE_INFINITY,
    mediaStart: 0,
    playbackRate: 1,
    loop: false,
    hasAudio: false,
    ...overrides,
  });

  it("caps an open 60-second root source to a two-second composition", () => {
    expect(resolveVideoExtractionDuration(video(), metadata(60), 2)).toBe(2);
  });

  it("keeps a shorter natural source duration inside a longer composition", () => {
    expect(resolveVideoExtractionDuration(video(), metadata(2), 10)).toBe(2);
  });

  it("falls back to container duration when stream duration is unavailable", () => {
    expect(resolveVideoExtractionDuration(video(), metadata(2, 0), 10)).toBe(2);
  });

  it("preserves explicit bounds and loop flags while applying the timeline ceiling", () => {
    const explicitLoop = video({ end: 8, loop: true });
    expect(resolveVideoExtractionDuration(explicitLoop, metadata(60), 10)).toBe(8);
    expect(explicitLoop.loop).toBe(true);
  });

  it("extracts the source span consumed by an explicit 2x timeline slot", () => {
    expect(
      resolveVideoExtractionWindow(
        video({ end: 2, mediaStart: 1, playbackRate: 2 }),
        metadata(8),
        2,
      ),
    ).toMatchObject({
      compositionStart: 0,
      mediaStart: 1,
      durationSeconds: 4,
      timelineDurationSeconds: 2,
    });
  });

  it("reports natural timeline duration after constant playback-rate retiming", () => {
    expect(
      resolveVideoExtractionWindow(video({ mediaStart: 1, playbackRate: 2 }), metadata(5), 10),
    ).toMatchObject({
      compositionStart: 0,
      mediaStart: 1,
      durationSeconds: 4,
      timelineDurationSeconds: 2,
    });
  });

  it("trims materially negative preroll and advances the source offset", () => {
    const preroll = video({ start: -60, end: 120, mediaStart: 0 });
    expect(resolveVideoExtractionWindow(preroll, metadata(120), 2)).toEqual({
      compositionStart: 0,
      mediaStart: 60,
      durationSeconds: 2,
    });
    expect(resolveVideoExtractionDuration(preroll, metadata(120), 2)).toBe(2);
  });

  it("returns an empty window for a clip entirely before composition time zero", () => {
    expect(resolveVideoExtractionWindow(video({ start: -60, end: -10 }), metadata(120), 2)).toEqual(
      { compositionStart: 0, mediaStart: 60, durationSeconds: 0 },
    );
  });

  it("preserves a short source cycle when negative preroll crosses a loop boundary", () => {
    expect(
      resolveVideoExtractionWindow(
        video({ start: -5, end: 10, mediaStart: 0, loop: true }),
        metadata(3),
        2,
      ),
    ).toEqual({
      compositionStart: -5,
      mediaStart: 0,
      durationSeconds: 3,
      preserveTimelinePhase: true,
    });
  });

  it("marks an entirely held interval for exact final-frame resolution", () => {
    expect(
      resolveVideoExtractionWindow(
        video({ start: -5, end: 10, mediaStart: 0, loop: false }),
        metadata(3),
        2,
      ),
    ).toEqual({
      compositionStart: -2.000001,
      mediaStart: 2.999999,
      durationSeconds: 0.000001,
      preserveTimelineEnd: true,
      ensureFinalFrame: true,
    });
  });

  it.each([
    { loop: true, preservation: { preserveTimelinePhase: true }, label: "loop" },
    {
      loop: false,
      preservation: { preserveTimelineEnd: true, ensureFinalFrame: true },
      label: "held tail",
    },
  ])(
    "caps a finite long slot to one short source range for $label playback",
    ({ loop, preservation }) => {
      expect(resolveVideoExtractionWindow(video({ end: 60, loop }), metadata(3), 60)).toEqual({
        compositionStart: 0,
        mediaStart: 0,
        durationSeconds: 3,
        ...preservation,
      });
    },
  );

  it.each([
    { loop: true, preservation: { preserveTimelinePhase: true }, label: "loop" },
    {
      loop: false,
      preservation: { preserveTimelineEnd: true, ensureFinalFrame: true },
      label: "held tail",
    },
  ])(
    "uses the playable video-stream duration for a long-audio mux in $label playback",
    ({ loop, preservation }) => {
      expect(resolveVideoExtractionWindow(video({ end: 60, loop }), metadata(60, 3), 60)).toEqual({
        compositionStart: 0,
        mediaStart: 0,
        durationSeconds: 3,
        ...preservation,
      });
    },
  );

  it("preserves authored timing when the visible interval partially crosses a held tail", () => {
    expect(
      resolveVideoExtractionWindow(
        video({ start: -2, end: 10, mediaStart: 0, loop: false }),
        metadata(3),
        2,
      ),
    ).toEqual({
      compositionStart: 0,
      mediaStart: 2,
      durationSeconds: 1,
      preserveTimelineEnd: true,
      ensureFinalFrame: true,
    });
  });

  it.each([
    { start: 0, expected: { compositionStart: 0, mediaStart: 0, durationSeconds: 3 } },
    { start: -2, expected: { compositionStart: 0, mediaStart: 2, durationSeconds: 1 } },
    { start: -5, expected: { compositionStart: 0, mediaStart: 5, durationSeconds: 0 } },
  ])(
    "keeps an omitted-duration clip source-bounded like runtime (start=$start)",
    ({ start, expected }) => {
      for (const loop of [false, true]) {
        const parsed = parseVideoElements(
          `<video id="natural" src="video.mp4"${loop ? " loop" : ""}></video>`,
        )[0]!;
        const planned = { ...parsed, start };
        const runtimeDuration = resolveRuntimeMediaClipDuration({
          isVideo: true,
          sourceDuration: 3,
          hostRemaining: 15 - start,
          explicitDuration: null,
        });
        expect(runtimeDuration).toBe(3);
        expect(parsed.end).toBe(Number.POSITIVE_INFINITY);
        expect(resolveVideoExtractionWindow(planned, metadata(3), 15)).toEqual(expected);
      }
    },
  );

  it("bounds an entirely held long source to its final-frame sample", () => {
    expect(
      resolveVideoExtractionWindow(
        video({ start: -600, end: 10, mediaStart: 0, loop: false }),
        metadata(120),
        2,
      ),
    ).toEqual({
      compositionStart: -480.000001,
      mediaStart: 119.999999,
      durationSeconds: 0.000001,
      preserveTimelineEnd: true,
      ensureFinalFrame: true,
    });
  });

  it("preserves a complete loop cycle when visibility ends exactly on a wrap boundary", () => {
    expect(
      resolveVideoExtractionWindow(
        video({ start: -1, end: 10, mediaStart: 0, loop: true }),
        metadata(3),
        2,
      ),
    ).toEqual({
      compositionStart: -1,
      mediaStart: 0,
      durationSeconds: 3,
      preserveTimelinePhase: true,
    });
  });

  it("keeps an open-ended loop source-bounded instead of inventing a longer slot", () => {
    expect(resolveVideoExtractionWindow(video({ loop: true }), metadata(3), 10)).toEqual({
      compositionStart: 0,
      mediaStart: 0,
      durationSeconds: 3,
    });
  });

  it("never plans more extraction than the playable source range", () => {
    for (const loop of [false, true]) {
      for (const sourceDuration of [0.5, 3, 120]) {
        for (const mediaStart of [0, sourceDuration / 3]) {
          for (const start of [-600, -5, -1, 0, 2]) {
            const window = resolveVideoExtractionWindow(
              video({ start, end: start + 60, mediaStart, loop }),
              metadata(sourceDuration),
              10,
            );
            expect(window.durationSeconds).toBeLessThanOrEqual(sourceDuration - mediaStart);
            expect(window.durationSeconds).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it("rejects a media start at source EOF before planning extraction", () => {
    expect(() =>
      resolveVideoExtractionWindow(video({ mediaStart: 3 }), metadata(3), 10),
    ).toThrowError(expect.objectContaining({ kind: "media_start_out_of_range", retryable: false }));
  });

  it("rejects a media start at video-stream EOF even when the container continues", () => {
    expect(() =>
      resolveVideoExtractionWindow(video({ mediaStart: 3 }), metadata(60, 3), 10),
    ).toThrowError(expect.objectContaining({ kind: "media_start_out_of_range", retryable: false }));
  });

  it("rebases a loop phase when the visible window stays within one cycle", () => {
    expect(
      resolveVideoExtractionWindow(
        video({ start: -5, end: 10, mediaStart: 0, loop: true }),
        metadata(3),
        0.5,
      ),
    ).toEqual({ compositionStart: 0, mediaStart: 2, durationSeconds: 0.5 });
  });

  it("retains legacy behavior when no timeline end is supplied", () => {
    expect(resolveVideoExtractionDuration(video(), metadata(60))).toBe(60);
  });
});

describe("extractionFrameCountForDuration", () => {
  it("uses the same VFR ceil and CFR nearest-boundary rules as FFmpeg", () => {
    expect(extractionFrameCountForDuration(0.466666, 30, true)).toBe(14);
    expect(extractionFrameCountForDuration(0.466666, 30, false)).toBe(14);
    expect(extractionFrameCountForDuration(0.616666, 30, true)).toBe(19);
    expect(extractionFrameCountForDuration(0.616666, 30, false)).toBe(18);
  });

  it.each([
    [0.33 - 0.03, 30, 9],
    [0.29 - 0.04, 24, 6],
    [0.35 - 0.05, 60, 18],
    [4.03 - 3.53, 30, 15],
    [4.03 - 3.78, 24, 6],
  ])(
    "snaps floating-point integral boundaries before VFR ceil (%s seconds at %i fps)",
    (duration, fps, expectedFrames) => {
      expect(extractionFrameCountForDuration(duration, fps, true)).toBe(expectedFrames);
    },
  );

  it("still ceils a genuine fractional boundary beyond floating-point noise", () => {
    expect(extractionFrameCountForDuration(0.300001, 30, true)).toBe(10);
  });

  it("matches FFmpeg's six-digit duration parsing", () => {
    expect(extractionFrameCountForDuration(0.6000009, 30, true)).toBe(18);
    expect(extractionFrameCountForDuration(0.600001, 30, true)).toBe(19);
    expect(extractionFrameCountForDuration(2.05, 30, false)).toBe(62);
  });

  it("keeps exact NTSC rationals at short CFR and VFR boundaries", () => {
    expect(extractionFrameCountForDuration(0.25025, { num: 30000, den: 1001 }, false)).toBe(8);
    expect(extractionFrameCountForDuration(0.125125, { num: 24000, den: 1001 }, true)).toBe(3);
    expect(extractionFrameCountForDuration(0.5005, { num: 24000, den: 1001 }, true)).toBe(12);
  });

  it("fails closed for invalid durations and emits one frame for positive sub-frame work", () => {
    expect(extractionFrameCountForDuration(Number.NaN, 30, true)).toBe(0);
    expect(extractionFrameCountForDuration(1, 0, true)).toBe(0);
    expect(extractionFrameCountForDuration(0, 30, true)).toBe(0);
    expect(extractionFrameCountForDuration(0.001, 30, false)).toBe(1);
  });
});

describe("video extraction failure taxonomy and bounded retry", () => {
  it("classifies missing and transient HTTP sources without exposing retry ambiguity", () => {
    expect(classifyVideoExtractionError(new Error("HTTP 404: Not Found"))).toMatchObject({
      kind: "download_not_found",
      retryable: false,
    });
    expect(classifyVideoExtractionError(new Error("HTTP 503: Service Unavailable"))).toMatchObject({
      kind: "download_transient",
      retryable: true,
    });
  });

  it("retries one transient failure, cleaning partial output before the retry", async () => {
    const retryDir = mkdtempSync(join(tmpdir(), "hf-extract-retry-"));
    const partialPath = join(retryDir, "frame-00001.jpg");
    let attempts = 0;
    try {
      const outcome = await runVideoExtractionWithRetry(
        async () => {
          attempts += 1;
          if (attempts === 1) {
            writeFileSync(partialPath, "partial");
            throw new VideoSourceExtractionError(
              "ffmpeg_timeout",
              true,
              "Video frame extraction timed out",
            );
          }
          expect(existsSync(partialPath)).toBe(false);
          return "frames";
        },
        {
          maxTransientRetries: 1,
          onRetry: () => {
            rmSync(retryDir, { recursive: true, force: true });
            mkdirSync(retryDir, { recursive: true });
          },
        },
      );

      expect(outcome).toEqual({ result: "frames", retries: 1 });
      expect(attempts).toBe(2);
    } finally {
      rmSync(retryDir, { recursive: true, force: true });
    }
  });

  it("does not retry deterministic or caller-aborted failures", async () => {
    let deterministicAttempts = 0;
    await expect(
      runVideoExtractionWithRetry(async () => {
        deterministicAttempts += 1;
        throw new VideoSourceExtractionError(
          "zero_output",
          false,
          "Video source produced no decodable frames",
        );
      }),
    ).rejects.toMatchObject({ kind: "zero_output", retryable: false });
    expect(deterministicAttempts).toBe(1);

    const controller = new AbortController();
    controller.abort();
    let abortedAttempts = 0;
    await expect(
      runVideoExtractionWithRetry(
        async () => {
          abortedAttempts += 1;
          throw new VideoSourceExtractionError(
            "download_transient",
            true,
            "Video source download failed transiently",
          );
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ kind: "cancelled", retryable: false });
    expect(abortedAttempts).toBe(0);
  });

  it("does not retry transient extraction failures unless the caller opts in", async () => {
    let attempts = 0;
    await expect(
      runVideoExtractionWithRetry(async () => {
        attempts += 1;
        throw new VideoSourceExtractionError(
          "ffmpeg_timeout",
          true,
          "Video frame extraction timed out",
        );
      }),
    ).rejects.toMatchObject({ kind: "ffmpeg_timeout", retryable: true });
    expect(attempts).toBe(1);
  });

  it("fails closed to zero retries for a non-finite runtime retry budget", async () => {
    let attempts = 0;
    await expect(
      runVideoExtractionWithRetry(
        async () => {
          attempts += 1;
          throw new VideoSourceExtractionError(
            "ffmpeg_timeout",
            true,
            "Video frame extraction timed out",
          );
        },
        { maxTransientRetries: Number.NaN },
      ),
    ).rejects.toMatchObject({ kind: "ffmpeg_timeout", retryable: true });
    expect(attempts).toBe(1);
  });
});

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

describe("resolveFrameFormat", () => {
  function metadata(overrides: Partial<VideoMetadata> = {}): VideoMetadata {
    return {
      durationSeconds: 1,
      width: 320,
      height: 180,
      fps: 30,
      hasAudio: false,
      videoCodec: "h264",
      colorSpace: {
        colorTransfer: "bt709",
        colorPrimaries: "bt709",
        colorSpace: "bt709",
      },
      isVFR: false,
      hasAlpha: false,
      ...overrides,
    };
  }

  it("keeps opaque non-alpha sources on jpg by default", () => {
    expect(resolveFrameFormat(metadata(), undefined)).toBe("jpg");
    expect(resolveFrameFormat(metadata(), "auto")).toBe("jpg");
  });

  it("honors explicit png for opaque videos", () => {
    expect(resolveFrameFormat(metadata(), "png")).toBe("png");
  });

  it("honors explicit jpg for opaque videos", () => {
    expect(resolveFrameFormat(metadata(), "jpg")).toBe("jpg");
  });

  it("forces png when alpha is present or the codec can carry alpha", () => {
    expect(resolveFrameFormat(metadata({ hasAlpha: true }), "jpg")).toBe("png");
    expect(resolveFrameFormat(metadata({ videoCodec: "vp9" }), "jpg")).toBe("png");
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

  it("resolves a browser root-absolute URL from the project root", () => {
    const projectDir = join(tmp, "project");
    expect(resolveProjectRelativeSrc("/assets/foo.mp4", projectDir)).toBe(
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
  it.each([
    {
      label: "valueless playback-start",
      attributes: 'data-playback-start data-media-start="1.5"',
      expected: 1.5,
    },
    {
      label: "empty playback-start",
      attributes: 'data-playback-start="" data-media-start="1.5"',
      expected: 1.5,
    },
    {
      label: "whitespace playback-start",
      attributes: 'data-playback-start="   " data-media-start="1.5"',
      expected: 1.5,
    },
    {
      label: "invalid playback-start",
      attributes: 'data-playback-start="later" data-media-start="1.5"',
      expected: 1.5,
    },
    { label: "missing media-start", attributes: "", expected: 0 },
    { label: "invalid media-start", attributes: 'data-media-start="later"', expected: 0 },
    {
      label: "negative playback-start",
      attributes: 'data-playback-start="-1" data-media-start="1.5"',
      expected: 1.5,
    },
    { label: "negative media-start", attributes: 'data-media-start="-1"', expected: 0 },
    {
      label: "finite playback-start",
      attributes: 'data-playback-start="2.25" data-media-start="1.5"',
      expected: 2.25,
    },
    {
      label: "zero playback-start",
      attributes: 'data-playback-start="0" data-media-start="1.5"',
      expected: 0,
    },
  ])("uses finite playback-start -> media-start -> 0 for $label", ({ attributes, expected }) => {
    const [video] = parseVideoElements(`<video id="hero" src="clip.mp4" ${attributes}></video>`);

    expect(video?.mediaStart).toBe(expected);
  });

  it("parses and normalizes constant playback rate for final rendering", () => {
    const [fast, low, high, invalid] = parseVideoElements(
      '<video id="fast" src="clip.mp4" data-playback-rate="2"></video>' +
        '<video id="low" src="clip.mp4" data-playback-rate="0.01"></video>' +
        '<video id="high" src="clip.mp4" data-playback-rate="20"></video>' +
        '<video id="invalid" src="clip.mp4" data-playback-rate="nope"></video>',
    );

    expect(fast?.playbackRate).toBe(2);
    expect(low?.playbackRate).toBe(0.1);
    expect(high?.playbackRate).toBe(5);
    expect(invalid?.playbackRate).toBe(1);
  });

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
      playbackRate: 1,
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

  it("resolves a relative data-start reference to another clip's end", () => {
    const videos = parseVideoElements(
      '<video id="intro" src="a.mp4" data-start="0" data-duration="10"></video>' +
        '<video id="main" src="b.mp4" data-start="intro" data-duration="20"></video>',
    );
    const main = videos.find((v) => v.id === "main");
    // intro ends at 10, so main starts at 10 and ends at 30 — not NaN.
    expect(main?.start).toBe(10);
    expect(main?.end).toBe(30);
  });

  it("still resolves relative data-start after compileTimingAttrs", () => {
    const raw =
      '<video id="intro" src="a.mp4" data-start="0" data-duration="10"></video>' +
      '<video id="main" src="b.mp4" data-start="intro" data-duration="20"></video>';
    const { html } = compileTimingAttrs(raw);
    const main = parseVideoElements(html).find((v) => v.id === "main");
    expect(main?.start).toBe(10);
    expect(main?.end).toBe(30);
  });

  it("applies + and - offsets on a relative reference", () => {
    const videos = parseVideoElements(
      '<video id="intro" src="a.mp4" data-start="0" data-duration="10"></video>' +
        '<video id="gap" src="b.mp4" data-start="intro + 2" data-duration="5"></video>' +
        '<video id="overlap" src="c.mp4" data-start="intro - 0.5" data-duration="5"></video>',
    );
    expect(videos.find((v) => v.id === "gap")?.start).toBe(12);
    expect(videos.find((v) => v.id === "overlap")?.start).toBe(9.5);
  });

  it("resolves chained references (A -> B -> C)", () => {
    const videos = parseVideoElements(
      '<video id="a" src="a.mp4" data-start="0" data-duration="4"></video>' +
        '<video id="b" src="b.mp4" data-start="a" data-duration="3"></video>' +
        '<video id="c" src="c.mp4" data-start="b" data-duration="2"></video>',
    );
    expect(videos.find((v) => v.id === "b")?.start).toBe(4);
    expect(videos.find((v) => v.id === "c")?.start).toBe(7); // 4 + 3
  });

  it("resolves a reference to a non-video timed element (div clip)", () => {
    const videos = parseVideoElements(
      '<div id="title" data-start="0" data-duration="6"></div>' +
        '<video id="clip" src="b.mp4" data-start="title" data-duration="5"></video>',
    );
    expect(videos.find((v) => v.id === "clip")?.start).toBe(6);
  });

  it("derives a referenced clip's duration from data-end when data-duration is absent", () => {
    const videos = parseVideoElements(
      '<video id="intro" src="a.mp4" data-start="2" data-end="9"></video>' +
        '<video id="main" src="b.mp4" data-start="intro" data-duration="5"></video>',
    );
    // intro: start 2, end 9 -> duration 7 -> main starts at 9.
    expect(videos.find((v) => v.id === "main")?.start).toBe(9);
  });

  it("falls back to 0 (never NaN) for an unknown reference target", () => {
    const videos = parseVideoElements(
      '<video id="orphan" src="a.mp4" data-start="does-not-exist" data-duration="5"></video>',
    );
    const orphan = videos.find((v) => v.id === "orphan");
    expect(orphan?.start).toBe(0);
    expect(Number.isNaN(orphan?.start)).toBe(false);
    expect(orphan?.end).toBe(5);
  });

  it("does not hang or NaN on a circular reference", () => {
    const videos = parseVideoElements(
      '<video id="a" src="a.mp4" data-start="b" data-duration="4"></video>' +
        '<video id="b" src="b.mp4" data-start="a" data-duration="3"></video>',
    );
    for (const v of videos) {
      expect(Number.isNaN(v.start)).toBe(false);
    }
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

  it("selects source frames at the authored constant playback rate", () => {
    const videos = parseVideoElements(
      '<video id="hero" src="clip.webm" data-start="0" data-duration="2" data-playback-rate="2"></video>',
    );
    const table = createFrameLookupTable(videos, [fakeExtracted(120, 30)]);

    expect(table.getActiveFramePayloads(1).get("hero")?.frameIndex).toBe(60);
  });

  it("wraps at video-stream EOF when a mux container has longer audio", () => {
    const extracted = fakeExtracted(6, 2);
    extracted.metadata.durationSeconds = 60;
    extracted.metadata.videoStreamDurationSeconds = 3;
    const table = createFrameLookupTable(
      [
        {
          id: "hero",
          src: "clip.webm",
          start: 0,
          end: 60,
          mediaStart: 0,
          loop: true,
          hasAudio: false,
        },
      ],
      [extracted],
    );

    expect(table.getActiveFramePayloads(4).get("hero")?.frameIndex).toBe(2);
  });

  it("holds the last frame for a non-looping clip until its authored slot ends", () => {
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
    expect(table.getActiveFramePayloads(1.5).get("hero")?.frameIndex).toBe(29);
    expect(table.getActiveFramePayloads(4.5).get("hero")?.frameIndex).toBe(29);
    expect(table.getFrame("hero", 4.5)).toBeTruthy();
    expect(table.getActiveFramePayloads(5.1).has("hero")).toBe(false);
    expect(table.getFrame("hero", 5.1)).toBeNull();
  });

  it("does not invent a held frame when extraction produced no frames", () => {
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
      [fakeExtracted(0, 30)],
    );

    expect(table.getActiveFramePayloads(4.5).has("hero")).toBe(false);
    expect(table.getFrame("hero", 4.5)).toBeNull();
  });

  it("places a relative-reference video in its resolved window end-to-end (was blank)", () => {
    // The reported bug: <video data-start="intro"> gave NaN start/end, so the
    // active-window checks (start <= t <= end) were always false and the clip
    // composited blank. With resolution, `main` is active across [10, 30].
    const videos = parseVideoElements(
      '<video id="intro" src="a.mp4" data-start="0" data-duration="10"></video>' +
        '<video id="main" src="b.mp4" data-start="intro" data-duration="20"></video>',
    );
    const table = createFrameLookupTable(videos, [{ ...fakeExtracted(600, 30), videoId: "main" }]);
    expect(table.getActiveFramePayloads(5).has("main")).toBe(false); // before resolved start (10)
    expect(table.getActiveFramePayloads(15).has("main")).toBe(true); // within [10, 30]
    expect(table.getActiveFramePayloads(29).has("main")).toBe(true);
    expect(table.getActiveFramePayloads(31).has("main")).toBe(false); // after resolved end (30)
  });

  it("holds the last frame at the inclusive clip end (t === end)", () => {
    // clip [1,3] with exactly 2s of source frames (60 @ 30fps). The frame
    // landing on t === end used to deactivate one frame early and render blank,
    // while the runtime keeps the element visible on its last frame.
    const table = createFrameLookupTable(
      [
        {
          id: "hero",
          src: "clip.webm",
          start: 1,
          end: 3,
          mediaStart: 0,
          loop: false,
          hasAudio: false,
        },
      ],
      [fakeExtracted(60, 30)],
    );
    const atEnd = table.getActiveFramePayloads(3.0).get("hero");
    expect(atEnd?.frameIndex).toBe(59);
    // mid-clip is unaffected
    expect(table.getActiveFramePayloads(2.5).get("hero")?.frameIndex).toBe(45);
  });

  it("holds the last frame across the tail when the source is shorter than the window", () => {
    // clip [0,5] with only 1s of source (30 @ 30fps). The authored slot is the
    // visibility contract, so the final source frame fills its remaining tail.
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
    expect(table.getActiveFramePayloads(1.5).get("hero")?.frameIndex).toBe(29);
    expect(table.getActiveFramePayloads(5.0).get("hero")?.frameIndex).toBe(29);
  });

  it("holds the last frame when the source is a sub-frame shorter than the slot", () => {
    // clip [2, 3.45] declares a 1.45s slot, but `ffmpeg -t 1.45` at 30fps emits
    // 43 frames = 1.433s — a half-frame short. The tail between source
    // exhaustion (~3.433) and the clip end (3.45) must hold the last frame
    // rather than render the page background (a one-frame black flash at the
    // cut). The held index is the final extracted frame (42).
    const table = createFrameLookupTable(
      [
        {
          id: "hero",
          src: "clip.mp4",
          start: 2,
          end: 3.45,
          mediaStart: 0,
          loop: false,
          hasAudio: false,
        },
      ],
      [fakeExtracted(43, 30)],
    );
    // last real frame
    expect(table.getActiveFramePayloads(3.4).get("hero")?.frameIndex).toBe(42);
    // source exhausted but within tolerance of the end → hold, don't blank
    expect(table.getActiveFramePayloads(3.44).get("hero")?.frameIndex).toBe(42);
    expect(table.getActiveFramePayloads(3.45).get("hero")?.frameIndex).toBe(42);
  });

  it("keeps both clips active at a shared adjacent boundary, matching the runtime", () => {
    // clip A ends at 3.0, clip B starts at 3.0. The runtime shows both at the
    // shared instant; the active set must too.
    const table = createFrameLookupTable(
      [
        { id: "a", src: "a.webm", start: 0, end: 3, mediaStart: 0, loop: false, hasAudio: false },
        { id: "b", src: "b.webm", start: 3, end: 6, mediaStart: 0, loop: false, hasAudio: false },
      ],
      // createFrameLookupTable maps each clip to extracted frames by id.
      [
        { ...fakeExtracted(90, 30), videoId: "a" },
        { ...fakeExtracted(90, 30), videoId: "b" },
      ],
    );
    const payloads = table.getActiveFramePayloads(3.0);
    expect(payloads.has("a")).toBe(true);
    expect(payloads.has("b")).toBe(true);
  });
});

describe("analyzeClipMediaFit", () => {
  it("returns null for a sub-tolerance shortfall the compiler leaves unclamped", () => {
    // 1.433s media in a 1.45s slot — a sub-frame shortfall (<0.05s) the renderer
    // freezes seamlessly and the compiler never clamps. Not worth warning about.
    expect(analyzeClipMediaFit({ slotSeconds: 1.45, mediaSeconds: 1.433 })).toBeNull();
  });

  it("returns null when media is longer than or equal to the slot", () => {
    expect(analyzeClipMediaFit({ slotSeconds: 2, mediaSeconds: 2 })).toBeNull();
    expect(analyzeClipMediaFit({ slotSeconds: 2, mediaSeconds: 5 })).toBeNull();
  });

  it("reports the shortfall when the slot exceeds media beyond the clamp epsilon", () => {
    const fit = analyzeClipMediaFit({ slotSeconds: 5, mediaSeconds: 1 });
    expect(fit).not.toBeNull();
    expect(fit?.shortfallSeconds).toBeCloseTo(4, 5);
    expect(fit?.toleranceSeconds).toBeCloseTo(0.05, 5);
  });

  it("never flags looping clips (they repeat to fill the slot)", () => {
    expect(analyzeClipMediaFit({ slotSeconds: 5, mediaSeconds: 1, loop: true })).toBeNull();
  });

  it("returns null for unusable inputs (non-finite media, zero slot)", () => {
    expect(analyzeClipMediaFit({ slotSeconds: 0, mediaSeconds: 1 })).toBeNull();
    expect(analyzeClipMediaFit({ slotSeconds: 5, mediaSeconds: NaN })).toBeNull();
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

type Rgb = [number, number, number];

const UI_FIXTURE_WIDTH = 240;
const UI_FIXTURE_HEIGHT = 160;
const RED_SAMPLE_PIXELS = [
  [70, 72],
  [118, 82],
  [178, 92],
] as const;

function readFirstFramePixel(mediaPath: string, x: number, y: number): Rgb {
  const result = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      mediaPath,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    { maxBuffer: UI_FIXTURE_WIDTH * UI_FIXTURE_HEIGHT * 3 + 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`ffmpeg pixel decode failed: ${result.stderr.toString().slice(-400)}`);
  }

  const offset = (y * UI_FIXTURE_WIDTH + x) * 3;
  return [
    result.stdout[offset] ?? 0,
    result.stdout[offset + 1] ?? 0,
    result.stdout[offset + 2] ?? 0,
  ];
}

function maxChannelDelta(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

// Regression for saturated UI recordings: default JPEG extraction can shift
// high-chroma reds before browser capture. Forcing PNG should keep extracted
// source-video frames effectively identical to the decoded source pixels.
describe.skipIf(!HAS_FFMPEG)("video frame extraction format", () => {
  const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "hf-video-frame-format-"));
  const UI_FIXTURE = join(FIXTURE_DIR, "ui-red.mp4");

  beforeAll(async () => {
    const result = await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=0xffe7ee:s=${UI_FIXTURE_WIDTH}x${UI_FIXTURE_HEIGHT}:d=1:r=1`,
      "-vf",
      "drawbox=x=44:y=58:w=152:h=44:color=0xdd382e@1:t=fill,drawbox=x=64:y=75:w=112:h=10:color=0xfff0f0@1:t=fill",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-colorspace",
      "bt709",
      UI_FIXTURE,
    ]);
    if (!result.success) {
      throw new Error(`UI color fixture synthesis failed: ${result.stderr.slice(-400)}`);
    }
  }, 30_000);

  afterAll(() => {
    if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  function fixtureVideo(): VideoElement {
    return {
      id: "ui",
      src: UI_FIXTURE,
      start: 0,
      end: 1,
      mediaStart: 0,
      loop: false,
      hasAudio: false,
    };
  }

  it("keeps color-sensitive UI reds closer to source when extraction is forced to png", async () => {
    const defaultOut = join(FIXTURE_DIR, "out-default");
    const pngOut = join(FIXTURE_DIR, "out-png");
    mkdirSync(defaultOut, { recursive: true });
    mkdirSync(pngOut, { recursive: true });

    const defaultResult = await extractAllVideoFrames([fixtureVideo()], FIXTURE_DIR, {
      fps: 1,
      outputDir: defaultOut,
    });
    const pngResult = await extractAllVideoFrames([fixtureVideo()], FIXTURE_DIR, {
      fps: 1,
      outputDir: pngOut,
      format: "png",
    });

    expect(defaultResult.errors).toEqual([]);
    expect(pngResult.errors).toEqual([]);
    const defaultFrame = defaultResult.extracted[0]!.framePaths.get(0)!;
    const pngFrame = pngResult.extracted[0]!.framePaths.get(0)!;
    expect(defaultFrame.endsWith(".jpg")).toBe(true);
    expect(pngFrame.endsWith(".png")).toBe(true);

    let worstDefaultDelta = 0;
    let worstPngDelta = 0;
    for (const [x, y] of RED_SAMPLE_PIXELS) {
      const sourcePixel = readFirstFramePixel(UI_FIXTURE, x, y);
      worstDefaultDelta = Math.max(
        worstDefaultDelta,
        maxChannelDelta(sourcePixel, readFirstFramePixel(defaultFrame, x, y)),
      );
      worstPngDelta = Math.max(
        worstPngDelta,
        maxChannelDelta(sourcePixel, readFirstFramePixel(pngFrame, x, y)),
      );
    }

    expect(worstPngDelta).toBeLessThanOrEqual(5);
    expect(worstPngDelta).toBeLessThanOrEqual(worstDefaultDelta);
  }, 60_000);

  it("keeps jpg and png extraction caches separate", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "hf-extract-format-cache-"));
    try {
      const defaultOut = join(FIXTURE_DIR, "cache-default");
      const pngOut = join(FIXTURE_DIR, "cache-png");
      const pngHitOut = join(FIXTURE_DIR, "cache-png-hit");
      mkdirSync(defaultOut, { recursive: true });
      mkdirSync(pngOut, { recursive: true });
      mkdirSync(pngHitOut, { recursive: true });

      const defaultResult = await extractAllVideoFrames(
        [fixtureVideo()],
        FIXTURE_DIR,
        { fps: 1, outputDir: defaultOut },
        undefined,
        { extractCacheDir: cacheDir },
      );
      expect(defaultResult.errors).toEqual([]);
      expect(defaultResult.phaseBreakdown.cacheHits).toBe(0);
      expect(defaultResult.phaseBreakdown.cacheMisses).toBe(1);
      expect(defaultResult.extracted[0]!.framePaths.get(0)!.endsWith(".jpg")).toBe(true);

      const pngMiss = await extractAllVideoFrames(
        [fixtureVideo()],
        FIXTURE_DIR,
        { fps: 1, outputDir: pngOut, format: "png" },
        undefined,
        { extractCacheDir: cacheDir },
      );
      expect(pngMiss.errors).toEqual([]);
      expect(pngMiss.phaseBreakdown.cacheHits).toBe(0);
      expect(pngMiss.phaseBreakdown.cacheMisses).toBe(1);
      expect(pngMiss.extracted[0]!.framePaths.get(0)!.endsWith(".png")).toBe(true);

      const pngHit = await extractAllVideoFrames(
        [fixtureVideo()],
        FIXTURE_DIR,
        { fps: 1, outputDir: pngHitOut, format: "png" },
        undefined,
        { extractCacheDir: cacheDir },
      );
      expect(pngHit.errors).toEqual([]);
      expect(pngHit.phaseBreakdown.cacheHits).toBe(1);
      expect(pngHit.phaseBreakdown.cacheMisses).toBe(0);
      expect(pngHit.extracted[0]!.framePaths.get(0)!.endsWith(".png")).toBe(true);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("dedupes identical extractions within one render", async () => {
    const outputDir = join(FIXTURE_DIR, "out-dedupe");
    mkdirSync(outputDir, { recursive: true });

    const videoA: VideoElement = { ...fixtureVideo(), id: "dupe-a" };
    const videoB: VideoElement = { ...fixtureVideo(), id: "dupe-b" };

    const result = await extractAllVideoFrames([videoA, videoB], FIXTURE_DIR, {
      fps: 1,
      outputDir,
    });

    expect(result.errors).toEqual([]);
    expect(result.extracted).toHaveLength(2);
    const first = result.extracted[0]!;
    const second = result.extracted[1]!;
    expect(first.videoId).toBe("dupe-a");
    expect(second.videoId).toBe("dupe-b");
    expect(second.outputDir).toBe(first.outputDir);
    expect(Array.from(second.framePaths.entries())).toEqual(Array.from(first.framePaths.entries()));

    const frameDirs = readdirSync(outputDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(frameDirs).toEqual(["dupe-a"]);
    expect(readdirSync(first.outputDir).filter((f) => f.endsWith(".jpg"))).toHaveLength(
      first.totalFrames,
    );
  }, 60_000);
});

describe.skipIf(!HAS_FFMPEG)("held tails on sparse-timestamp sources", () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "hf-sparse-held-tail-"));
  const cfrFixture = join(fixtureDir, "sub-1fps-cfr.mp4");
  const vfrFixture = join(fixtureDir, "sparse-vfr.mp4");
  const nonZeroStartFixture = join(fixtureDir, "nonzero-start.mp4");
  const negativeStartTransportFixture = join(fixtureDir, "negative-start.ts");

  beforeAll(async () => {
    const fixtures = [
      {
        path: cfrFixture,
        input: "testsrc2=s=64x64:d=10:rate=1/5",
        filters: [] as string[],
      },
      {
        path: vfrFixture,
        input: "testsrc2=s=64x64:d=10:rate=1/2",
        filters: ["-vf", "select='eq(n,0)+eq(n,2)'", "-vsync", "vfr"],
      },
      {
        path: nonZeroStartFixture,
        input: "testsrc2=s=64x64:d=3:rate=1",
        filters: ["-output_ts_offset", "5"],
      },
      {
        path: negativeStartTransportFixture,
        input: "testsrc2=s=64x64:d=3:rate=1",
        filters: [
          "-mpegts_copyts",
          "1",
          "-muxdelay",
          "0",
          "-avoid_negative_ts",
          "disabled",
          "-output_ts_offset",
          "-2",
        ],
      },
    ];
    for (const fixture of fixtures) {
      const result = await runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        fixture.input,
        ...fixture.filters,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-y",
        fixture.path,
      ]);
      if (!result.success) {
        throw new Error(`sparse fixture synthesis failed: ${result.stderr.slice(-400)}`);
      }
    }
  }, 30_000);

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it.each([
    {
      label: "sub-1fps CFR",
      src: cfrFixture,
      expectedVfr: false,
      finalTimestamp: 5,
      streamStart: 0,
    },
    {
      label: "sparse VFR",
      src: vfrFixture,
      expectedVfr: true,
      finalTimestamp: 4,
      streamStart: 0,
    },
    {
      label: "non-zero stream start",
      src: nonZeroStartFixture,
      expectedVfr: false,
      finalTimestamp: 2,
      streamStart: 5,
    },
    {
      label: "unindexed negative-base MPEG-TS",
      src: negativeStartTransportFixture,
      expectedVfr: false,
      finalTimestamp: 2,
      streamStart: -2,
    },
  ])(
    "extracts one real final SDR frame for $label",
    async ({ src, expectedVfr, finalTimestamp, streamStart }) => {
      const metadata = await extractVideoMetadata(src);
      expect(metadata.fps).toBeLessThanOrEqual(1);
      expect(metadata.isVFR).toBe(expectedVfr);
      expect(metadata.videoStreamStartSeconds).toBeCloseTo(streamStart, 6);
      await expect(extractFinalVideoFrameTimestamp(src, metadata)).resolves.toBe(finalTimestamp);
      const outputDir = mkdtempSync(join(fixtureDir, "out-"));
      const video: VideoElement = {
        id: `held-${String(expectedVfr)}`,
        src,
        start: -15,
        end: 5,
        mediaStart: 0,
        loop: false,
        hasAudio: false,
      };

      const result = await extractAllVideoFrames([video], fixtureDir, {
        fps: 30,
        format: "png",
        outputDir,
        timelineEnd: 2,
      });

      expect(result.errors).toEqual([]);
      expect(result.extracted).toHaveLength(1);
      expect(result.extracted[0]?.totalFrames).toBe(1);
      expect(video).toMatchObject({ start: 0, end: 5, loop: false });
      expect(video.mediaStart).toBeCloseTo(metadata.videoStreamDurationSeconds - 0.000001, 7);
    },
    30_000,
  );
});

// Regression test for the VFR (variable frame rate) freeze bug.
// Screen recordings and phone videos often have irregular timestamps.
// When such inputs hit `extractVideoFramesRange`'s `-ss <start> -i ... -t <dur>
// -vf fps=N` pipeline, the fps filter can emit fewer frames than requested —
// e.g. a 4-second segment at 30fps would produce ~90 frames instead of 120.
// FrameLookupTable.getFrameAtTime then returns null for out-of-range indices
// and the compositor holds the last valid frame, which the user perceives as
// the video freezing. extractAllVideoFrames now routes VFR sources through
// FFmpeg's one-pass `-fps_mode cfr -r` extraction path to fix this without a
// separate normalization encode.
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

    const hit = await extractWithCache(video, "out-cache-hit", CACHE_DIR);
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
      expectedFrames: 18,
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

describe("getFrameAtTime — IEEE 754 boundary precision", () => {
  function makeExtracted(fps: number, totalFrames: number): ExtractedFrames {
    const framePaths = new Map<number, string>();
    for (let i = 0; i < totalFrames; i++) framePaths.set(i, `frame-${i}.jpg`);
    return {
      fps,
      totalFrames,
      framePaths,
      metadata: {
        durationSeconds: totalFrames / fps,
        width: 1920,
        height: 1080,
        codec: "h264",
        hasAudio: false,
        fps,
      },
    } as ExtractedFrames;
  }

  it("does not produce duplicate frames when data-start is grid-aligned", () => {
    const extracted = makeExtracted(25, 351);
    const videoStart = 0;
    const seen: string[] = [];
    let duplicates = 0;
    for (let i = 0; i < 351; i++) {
      const globalTime = i / 25;
      const frame = getFrameAtTime(extracted, globalTime, videoStart);
      if (frame && seen.length > 0 && frame === seen[seen.length - 1]) duplicates++;
      if (frame) seen.push(frame);
    }
    expect(duplicates).toBe(0);
  });

  it("returns monotonically increasing frame indices", () => {
    const extracted = makeExtracted(25, 100);
    let lastIndex = -1;
    for (let i = 0; i < 100; i++) {
      const globalTime = i / 25;
      const frame = getFrameAtTime(extracted, globalTime, 0);
      const idx = frame ? parseInt(frame.split("-")[1]!) : -1;
      expect(idx).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }
  });

  it("handles the 0.28 * 25 boundary case (6.999999 vs 7)", () => {
    const extracted = makeExtracted(25, 10);
    const frame = getFrameAtTime(extracted, 0.28, 0);
    expect(frame).toBe("frame-7.jpg");
  });

  it("mediaStart does not offset frame index (extractor handles trim via -ss)", () => {
    const extracted = makeExtracted(25, 100);
    const frame = getFrameAtTime(extracted, 0, 0, false, 1.0);
    expect(frame).toBe("frame-0.jpg");
  });

  it("returns null after source exhaustion without an authored slot boundary", () => {
    const extracted = makeExtracted(25, 25);
    expect(getFrameAtTime(extracted, 3, 0)).toBeNull();
  });
});
