// fallow-ignore-file code-duplication
import { vi, afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  parseVideoElements,
  hasGradedCanvas,
  parseImageElements,
  extractAllVideoFrames,
  extractionFrameCountForDuration,
  createFrameLookupTable,
  FrameLookupTable,
  rebaseVideoToWindow,
  alignClipStartToFirstOutputFrame,
  resolveFrameFormat,
  codecMayHaveAlpha,
  decoderForCodec,
  resolveVideoExtractionWindow,
  resolveVideoExtractionDuration,
  getFrameAtTime,
  analyzeClipMediaFit,
  classifyVideoExtractionError,
  videoExtractionSourceLabel,
  runVideoExtractionWithRetry,
  VideoSourceExtractionError,
  type VideoElement,
  type ExtractedFrames,
} from "./videoFrameExtractor.js";
import {
  extractFinalVideoFrameTimestamp,
  extractVideoMetadata,
  type VideoMetadata,
} from "../utils/ffprobe.js";
import { runFfmpeg } from "../utils/runFfmpeg.js";
import { resolveRuntimeMediaClipDuration } from "../../../core/src/runtime/media.js";
import { compileTimingAttrs, sourceTimeAt } from "@hyperframes/core";
import { RATE_RANGE } from "@hyperframes/core/audio-automation";

// Pass-through, so a test can tell whether extraction ran ffmpeg.
vi.mock("../utils/runFfmpeg.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../utils/runFfmpeg.js")>();
  return { ...real, runFfmpeg: vi.fn(real.runFfmpeg) };
});

// ffmpeg is not preinstalled on GitHub's ubuntu-24.04 runners. The producer
// regression test at packages/producer/tests/vfr-screen-recording/ runs inside
// Dockerfile.test (which does include ffmpeg) and is the primary CI signal
// for this bug. Locally and in any CI job with ffmpeg on PATH, the tests
// below run too — they exercise the extractor in isolation against a
// synthesized VFR fixture.
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;

type Rgb = [number, number, number];

const UI_FIXTURE_WIDTH = 240;
const UI_FIXTURE_HEIGHT = 160;

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

  it("extracts the source span a ramped slot consumes: 2s of 1x to 3x reads 2*(3-1)/ln 3 source seconds", () => {
    const rate = {
      target: "rate",
      points: [
        { t: 0, v: 1 },
        { t: 2, v: 3 },
      ],
    };
    expect(
      resolveVideoExtractionWindow(video({ end: 2, playbackRate: rate }), metadata(8), 2),
    ).toMatchObject({ compositionStart: 0, mediaStart: 0, timelineDurationSeconds: 2 });
    const { durationSeconds } = resolveVideoExtractionWindow(
      video({ end: 2, playbackRate: rate }),
      metadata(8),
      2,
    );
    expect(durationSeconds).toBeCloseTo(3.6411, 3);
  });

  const RAMP = {
    target: "rate",
    points: [
      { t: 0, v: 1 },
      { t: 4, v: 3 },
    ],
  };

  it("starts a ramped clip that begins before the timeline at the integrated source time of the trimmed part", () => {
    // geometric 1x to 3x over 4s: source(t) = 4(3^(t/4)-1)/ln 3; 1s trimmed reads 1.1508, all 4s read 7.2819
    const window = resolveVideoExtractionWindow(
      video({ start: -1, end: 3, playbackRate: RAMP }),
      metadata(20),
      3,
    );
    expect(window.mediaStart).toBeCloseTo(1.1508, 3);
    expect(window.durationSeconds).toBeCloseTo(6.1311, 3);
  });

  it("rebases a ramped clip so lookup reads the same source second the untrimmed lane would", () => {
    const clip = video({ start: -1, end: 3, playbackRate: RAMP });
    rebaseVideoToWindow(clip, resolveVideoExtractionWindow(clip, metadata(20), 3));
    // composition second 2 is 3s into the authored lane: source 4.6586
    const seconds = clip.mediaStart + sourceTimeAt(clip.playbackRate ?? 1, 2 - clip.start);
    expect(seconds).toBeCloseTo(4.6586, 3);
  });

  it("leaves media start untouched for a nested clip whose start sums to a frame boundary with float dust", () => {
    // 3.3 + 1.3666666666666667 = 4.666666666666666, frame 140 at 30 fps
    const clip = video({ start: 3.3 + 1.3666666666666667, end: 8, mediaStart: 1.35 });
    alignClipStartToFirstOutputFrame(clip, 30);
    expect(clip.mediaStart).toBe(1.35);
    expect(clip.start).toBe(140 / 30);
  });

  it("snaps a float-noise composition start to the timeline origin so the first frame is kept", () => {
    const clip = video({ start: -1, end: 8, playbackRate: 0.7 });
    rebaseVideoToWindow(clip, { compositionStart: 2.2e-16, mediaStart: 0.7, durationSeconds: 5 });
    expect(clip.start).toBe(0);
  });

  it("reports the natural timeline duration of a ramped clip through the lane", () => {
    const flat = {
      target: "rate",
      points: [
        { t: 0, v: 2 },
        { t: 1, v: 2 },
      ],
    };
    expect(resolveVideoExtractionWindow(video({ playbackRate: flat }), metadata(4))).toMatchObject({
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

  it("plans a one-frame held tail when an explicit non-looping slot starts past EOF", () => {
    expect(resolveVideoExtractionWindow(video({ end: 6, mediaStart: 5 }), metadata(2))).toEqual({
      compositionStart: 0,
      mediaStart: 1.999999,
      durationSeconds: 0.000001,
      preserveTimelineEnd: true,
      ensureFinalFrame: true,
    });
  });

  it("keeps the playable suffix when an explicit non-looping slot starts just inside EOF", () => {
    expect(
      resolveVideoExtractionWindow(video({ end: 6, mediaStart: 1.9 }), metadata(2), 6),
    ).toEqual({
      compositionStart: 0,
      mediaStart: 1.9,
      durationSeconds: 0.10000000000000009,
      preserveTimelineEnd: true,
      ensureFinalFrame: true,
    });
  });

  it("rejects a looping explicit slot that starts at source EOF", () => {
    expect(() =>
      resolveVideoExtractionWindow(video({ end: 6, mediaStart: 2, loop: true }), metadata(2), 6),
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
  it("ceils VFR windows and counts every output slot a CFR window covers", () => {
    expect(extractionFrameCountForDuration(0.466666, 30, true)).toBe(14);
    expect(extractionFrameCountForDuration(0.466666, 30, false)).toBe(14);
    expect(extractionFrameCountForDuration(0.616666, 30, true)).toBe(19);
    expect(extractionFrameCountForDuration(0.616666, 30, false)).toBe(19);
    expect(extractionFrameCountForDuration(0.2667, 30, false)).toBe(9);
    expect(extractionFrameCountForDuration(0.266667, 30, false)).toBe(8);
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

  it("names a failed clip by its project-relative file, never a host, query or absolute path", () => {
    expect(videoExtractionSourceLabel("assets/clips/a.mp4", "/proj")).toBe("assets/clips/a.mp4");
    expect(videoExtractionSourceLabel("/proj/assets/a.mp4?x=1", "/proj")).toBe("assets/a.mp4");
    expect(videoExtractionSourceLabel("/elsewhere/private/b.mp4", "/proj")).toBe("b.mp4");
    expect(videoExtractionSourceLabel("https://cdn.example/v/c%201.mp4?Signature=s", "/proj")).toBe(
      "c 1.mp4",
    );
    expect(videoExtractionSourceLabel("HTTPS://cdn.example/v/d.mp4?Signature=s", "/proj")).toBe(
      "d.mp4",
    );
  });

  it("never prints a scheme payload, username or drive path for a source that is not a project file", () => {
    expect(videoExtractionSourceLabel("file:///Users/me/private/a.mp4", "/proj")).toBe("a.mp4");
    expect(videoExtractionSourceLabel("data:video/mp4;base64,AAAA", "/proj")).toBe("inline video");
    expect(videoExtractionSourceLabel("blob:https://cdn.example/1f3a", "/proj")).toBe(
      "inline video",
    );
    expect(videoExtractionSourceLabel("ftp://host.example/pub/e.mp4", "/proj")).toBe("e.mp4");
    expect(videoExtractionSourceLabel("C:\\Users\\me\\private\\f.mp4", "/proj")).toBe("f.mp4");
    expect(videoExtractionSourceLabel("C:\\proj\\assets\\g.mp4", "C:\\proj")).toBe("assets/g.mp4");
  });

  it("reports which clip failed when a source file is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-extract-names-"));
    try {
      const result = await extractAllVideoFrames(
        [
          {
            id: "v1",
            src: "assets/missing.mp4",
            start: 0,
            end: 1,
            mediaStart: 0,
            loop: false,
            hasAudio: false,
          },
        ],
        dir,
        { fps: 30, outputDir: join(dir, "out") },
      );
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ videoId: "v1", source: "assets/missing.mp4" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  it("keeps ProRes without an alpha plane on jpg and ProRes with one on png", () => {
    expect(resolveFrameFormat(metadata({ videoCodec: "prores" }), undefined)).toBe("jpg");
    expect(resolveFrameFormat(metadata({ videoCodec: "prores", hasAlpha: true }), "jpg")).toBe(
      "png",
    );
  });

  type FormatCase = Pick<VideoMetadata, "videoCodec" | "hasAlpha" | "alphaPlaneDecoded"> & {
    requested: "auto" | "jpg" | "png";
  };
  const formatCases: FormatCase[] = ["vp9", "vp8", "h264", "prores"].flatMap((videoCodec) =>
    [true, false].flatMap((hasAlpha) =>
      [true, false, undefined].flatMap((alphaPlaneDecoded) =>
        (["auto", "jpg", "png"] as const).map((requested) => ({
          videoCodec,
          hasAlpha,
          alphaPlaneDecoded,
          requested,
        })),
      ),
    ),
  );
  function expectedFormat({ videoCodec, hasAlpha, alphaPlaneDecoded, requested }: FormatCase) {
    const sidecar = videoCodec === "vp9" || videoCodec === "vp8";
    const keepsPng = hasAlpha || (sidecar && alphaPlaneDecoded !== false);
    return keepsPng || requested === "png" ? "png" : "jpg";
  }

  it("lets VP8/VP9 leave png only when a decode probe found no alpha plane", () => {
    expect(formatCases).toHaveLength(72);
    for (const { requested, ...fields } of formatCases) {
      const actual = resolveFrameFormat(metadata(fields), requested);
      expect(actual, JSON.stringify(fields)).toBe(expectedFormat({ requested, ...fields }));
    }
    expect(resolveFrameFormat(metadata({ videoCodec: "vp9", alphaPlaneDecoded: false }))).toBe(
      "jpg",
    );
    expect(resolveFrameFormat(metadata({ videoCodec: "vp8", alphaPlaneDecoded: false }))).toBe(
      "jpg",
    );
  });
});

describe("parseVideoElements", () => {
  it("marks a graded video and image, and only those", () => {
    const html = `<video id="g" src="g.mp4" data-color-grading='{"preset":"clean-studio"}'></video>
      <video id="p" src="p.mp4"></video>
      <img id="gi" src="gi.png" data-color-grading='{"adjust":{"exposure":0.2}}'>
      <img id="pi" src="pi.png">`;
    expect(parseVideoElements(html).map(({ id, graded }) => [id, graded])).toEqual([
      ["g", true],
      ["p", undefined],
    ]);
    expect(parseImageElements(html).map(({ id, graded }) => [id, graded])).toEqual([
      ["gi", true],
      ["pi", undefined],
    ]);
    expect(hasGradedCanvas(html)).toBe(false);
    expect(
      hasGradedCanvas(`<canvas data-color-grading='{"preset":"clean-studio"}'></canvas>`),
    ).toBe(true);
  });

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
    expect(low?.playbackRate).toBe(RATE_RANGE.min);
    expect(high?.playbackRate).toBe(RATE_RANGE.max);
    expect(invalid?.playbackRate).toBe(1);
  });

  it("parses a rate lane from data-automation into the clip's rate", () => {
    const automation = JSON.stringify({
      version: 1,
      lanes: [
        {
          target: "rate",
          points: [
            { t: 0, v: 1 },
            { t: 2, v: 3 },
          ],
        },
      ],
    });
    const [ramped] = parseVideoElements(
      `<video id="ramped" src="clip.mp4" data-automation='${automation}'></video>`,
    );

    expect(ramped?.playbackRate).toMatchObject({ target: "rate" });
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

  it("resolves a reference inside its own composition when another composition reuses the id", () => {
    const videos = parseVideoElements(
      '<div data-composition-id="main">' +
        '<div data-composition-id="scene-a" data-start="0" data-duration="4">' +
        '<div id="intro" data-start="0" data-duration="2"></div>' +
        "</div>" +
        '<div data-composition-id="scene-b" data-start="4" data-duration="4">' +
        '<div id="intro" data-start="0" data-duration="3"></div>' +
        '<video id="clip" src="b.mp4" data-start="intro" data-duration="1"></video>' +
        "</div>" +
        "</div>",
    );
    expect(videos.find((v) => v.id === "clip")?.start).toBe(3);
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

  it("discovers <video> elements that use <source> children", () => {
    const videos = parseVideoElements(
      '<video id="rec" data-start="1" data-duration="4">' +
        '<source src="https://cdn.example.com/rec.mp4" type="video/mp4">' +
        '<source src="_remote_media/rec.webm" type="video/webm">' +
        "</video>",
    );
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({ id: "rec", src: "_remote_media/rec.webm", start: 1, end: 5 });
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

  it("shows a copy starting on a float sum at that instant, as the preview does", () => {
    const copyStart = 0.1 + 0.2;
    const clip = (id: string, start: number) => ({
      id,
      src: `${id}.webm`,
      start,
      end: start + 0.2,
      mediaStart: 0,
      loop: false,
      hasAudio: false,
    });
    const frames = (videoId: string) => ({ ...fakeExtracted(30, 30), videoId });
    const table = () =>
      createFrameLookupTable(
        [clip("a", 0.1), clip("copy", copyStart)],
        [frames("a"), frames("copy")],
      );

    expect(table().getActiveFramePayloads(0.3).get("copy")?.frameIndex).toBe(0);
    const stepping = table();
    stepping.getActiveFramePayloads(0.2);
    expect(stepping.getActiveFramePayloads(0.3).get("copy")?.frameIndex).toBe(0);
    expect(getFrameAtTime(frames("copy"), 0.3, copyStart)).toBe("frame-0.jpg");
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

  it("shows the last frame just before the end and leaves at t === end, as the runtime does", () => {
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
    expect(table.getActiveFramePayloads(2.5).get("hero")?.frameIndex).toBe(45);
    expect(table.getActiveFramePayloads(2.99).get("hero")?.frameIndex).toBe(59);
    expect(table.getActiveFramePayloads(3.0).has("hero")).toBe(false);
    expect(table.getFrame("hero", 3.0)).toBeNull();
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
    expect(table.getActiveFramePayloads(4.99).get("hero")?.frameIndex).toBe(29);
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
  });

  it("gives a frame a hair before two clips meet to the clip export shows there", () => {
    const clip = (id: string, start: number, end: number) => ({
      id,
      src: `${id}.webm`,
      start,
      end,
      mediaStart: 0,
      loop: false,
      hasAudio: false,
    });
    const table = () =>
      createFrameLookupTable(
        [clip("a", 0, 1.00001), clip("b", 1.00001, 2)],
        [
          { ...fakeExtracted(90, 30), videoId: "a" },
          { ...fakeExtracted(90, 30), videoId: "b" },
        ],
        30,
      );
    const stepping = table();
    stepping.getActiveFramePayloads(29 / 30);
    const payloads = stepping.getActiveFramePayloads(1);

    expect([...payloads.keys()]).toEqual(["b"]);
    expect(payloads.get("b")?.frameIndex).toBe(0);
    expect([...table().getActiveFramePayloads(1).keys()]).toEqual(["b"]);
    expect(table().getFrame("a", 1)).toBeNull();
  });

  it.each([
    ["an exact", 0.1, 0.3, 0.3],
    ["a float-sum", 0.1, 0.1 + 0.2, 9 / 30],
  ])(
    "hands %s shared boundary to the incoming clip only, as the runtime does",
    (_, aStart, aEnd, t) => {
      const clip = (id: string, start: number, end: number) => ({
        id,
        src: `${id}.webm`,
        start,
        end,
        mediaStart: 0,
        loop: false,
        hasAudio: false,
      });
      const table = () =>
        createFrameLookupTable(
          [clip("a", aStart, aEnd), clip("b", 0.3, 0.5)],
          [
            { ...fakeExtracted(90, 30), videoId: "a" },
            { ...fakeExtracted(90, 30), videoId: "b" },
          ],
        );
      const stepping = table();
      expect([...stepping.getActiveFramePayloads(8 / 30).keys()]).toEqual(["a"]);
      expect([...stepping.getActiveFramePayloads(t).keys()]).toEqual(["b"]);
      expect([...table().getActiveFramePayloads(t).keys()]).toEqual(["b"]);
      expect(table().getFrame("a", t)).toBeNull();
    },
  );
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
        filters: ["-vf", "select='eq(n,0)+eq(n,2)'", "-fps_mode", "vfr"],
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
  }, 30_000);

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

  it("renders the same final decoded frame just inside and past EOF", async () => {
    const metadata = await extractVideoMetadata(cfrFixture);
    const sourceDuration = metadata.videoStreamDurationSeconds;
    const outputDir = mkdtempSync(join(fixtureDir, "eof-out-"));
    const videos: VideoElement[] = [
      {
        id: "just-inside-eof",
        src: cfrFixture,
        start: 0,
        end: 5,
        mediaStart: sourceDuration - 0.001,
        loop: false,
        hasAudio: false,
      },
      {
        id: "past-eof",
        src: cfrFixture,
        start: 0,
        end: 5,
        mediaStart: sourceDuration + 1,
        loop: false,
        hasAudio: false,
      },
    ];

    const result = await extractAllVideoFrames(videos, fixtureDir, {
      fps: 30,
      format: "png",
      outputDir,
      timelineEnd: 5,
    });

    expect(result.errors).toEqual([]);
    expect(result.extracted).toHaveLength(2);
    const insideFrame = result.extracted[0]?.framePaths.get(0);
    const pastFrame = result.extracted[1]?.framePaths.get(0);
    expect(insideFrame).toBeDefined();
    expect(pastFrame).toBeDefined();
    if (!insideFrame || !pastFrame) throw new Error("expected both final-frame outputs");
    expect(readFileSync(pastFrame)).toEqual(readFileSync(insideFrame));
  }, 30_000);
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

  it("indexes frames by integrated source time for a rate lane", () => {
    const extracted = { ...makeExtracted(25, 351), videoId: "ramped" } as ExtractedFrames;
    const rate = {
      target: "rate",
      points: [
        { t: 0, v: 1 },
        { t: 2, v: 3 },
      ],
    };
    const table = new FrameLookupTable();
    table.addVideo(extracted, 0, 10, 0, false, rate);
    // 2s * (3-1)/ln 3 = 3.6411 source seconds * 25 fps = frame 91
    expect(table.getFrame("ramped", 2)).toBe("frame-91.jpg");
    expect(table.getFrame("ramped", 0)).toBe("frame-0.jpg");
  });

  it("wraps a ramped loop in source space so the lane keeps running across cycles", () => {
    const extracted = { ...makeExtracted(25, 100), videoId: "looped" } as ExtractedFrames;
    const rate = {
      target: "rate",
      points: [
        { t: 0, v: 1 },
        { t: 4, v: 3 },
      ],
    };
    const table = new FrameLookupTable();
    table.addVideo(extracted, 0, 10, 0, true, rate);
    // source(3) = 4.6586 on a 4s source wraps to 0.6586 * 25 fps = frame 16
    expect(table.getFrame("looped", 3)).toBe("frame-16.jpg");
  });

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

  it("picks the frame the preview shows when a clip starts a hair after a frame instant", () => {
    // 449/30 written with six decimals starts the clip a third of a microsecond late. The preview's
    // <video> still shows the take's second frame at output frame 450, so the render must too.
    const extracted = makeExtracted(30, 100);
    expect(getFrameAtTime(extracted, 450 / 30, 14.966667, false, 4.3)).toBe("frame-1.jpg");
    expect(getFrameAtTime(extracted, 460 / 30, 14.966667, false, 4.3)).toBe("frame-11.jpg");
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

describe("parseVideoElements hidden flag", () => {
  it("marks a video hidden on itself or through a hidden ancestor", () => {
    const videos = parseVideoElements(
      `<div data-hidden><video id="a" src="a.mp4" data-has-audio="true"></video></div>` +
        `<video id="b" src="b.mp4" data-has-audio="true" data-hidden></video>` +
        `<video id="c" src="c.mp4" data-has-audio="true"></video>`,
    );
    expect(videos.map((v) => [v.id, v.hidden])).toEqual([
      ["a", true],
      ["b", true],
      ["c", undefined],
    ]);
  });

  it("marks only an audible video hidden when its audio group is hidden", () => {
    const videos = parseVideoElements(
      `<hf-audio-group id="g" data-hidden></hf-audio-group>` +
        `<video id="a" src="a.mp4" data-has-audio="true" data-audio-group="g"></video>` +
        `<video id="b" src="b.mp4" muted data-audio-group="g"></video>`,
    );
    expect(videos.map((v) => [v.id, v.hidden])).toEqual([
      ["a", true],
      ["b", undefined],
    ]);
  });
});

describe.skipIf(!HAS_FFMPEG)("a clip stored on a non-square pixel grid", () => {
  const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "hf-sar-"));
  const SOURCE = join(FIXTURE_DIR, "anamorphic.mp4");

  beforeAll(async () => {
    const result = await runFfmpeg([
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=64x64:d=1:r=10",
      "-vf",
      "setsar=1/2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      SOURCE,
    ]);
    if (!result.success) throw new Error(`fixture synthesis failed: ${result.stderr.slice(-400)}`);
  }, 30_000);

  afterAll(() => rmSync(FIXTURE_DIR, { recursive: true, force: true }), 30_000);

  it("keeps the display shape of a rotated clip, whose autorotate swaps the pixel aspect", async () => {
    const rotated = join(FIXTURE_DIR, "rotated.mp4");
    // `-display_rotation` is an ffmpeg 6 input option; older builds take the same rotation as metadata.
    const rotateWith = (args: string[]) =>
      runFfmpeg(["-y", "-v", "error", ...args, "-c", "copy", rotated]);
    let synth = await rotateWith(["-display_rotation:v:0", "90", "-i", SOURCE]);
    if (!synth.success) synth = await rotateWith(["-i", SOURCE, "-metadata:s:v:0", "rotate=90"]);
    expect(synth.success).toBe(true);
    const outDir = join(FIXTURE_DIR, "out-rot");
    mkdirSync(outDir, { recursive: true });
    const video: VideoElement = {
      id: "r",
      src: rotated,
      start: 0,
      end: 1,
      mediaStart: 0,
      loop: false,
      hasAudio: false,
    };
    const result = await extractAllVideoFrames([video], FIXTURE_DIR, {
      fps: 10,
      outputDir: outDir,
    });
    expect(result.errors).toEqual([]);
    const probe = spawnSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      "--",
      result.extracted[0]!.framePaths.get(0)!,
    ]);
    expect(probe.stdout.toString().trim()).toBe("128,64");
  });

  it("extracts frames at the shape Chrome displays, not the stored grid", async () => {
    const outDir = join(FIXTURE_DIR, "out");
    mkdirSync(outDir, { recursive: true });
    const video: VideoElement = {
      id: "v",
      src: SOURCE,
      start: 0,
      end: 1,
      mediaStart: 0,
      loop: false,
      hasAudio: false,
    };
    const result = await extractAllVideoFrames([video], FIXTURE_DIR, {
      fps: 10,
      outputDir: outDir,
    });
    expect(result.errors).toEqual([]);
    const probe = spawnSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      "--",
      result.extracted[0]!.framePaths.get(0)!,
    ]);
    expect(probe.stdout.toString().trim()).toBe("32,64");
  });
});

// Each source frame N is a flat gray of 3N, so the frame a render shows reads straight off a pixel.
describe.skipIf(!HAS_FFMPEG)("a clip whose data-start is off the frame grid", () => {
  const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "hf-offgrid-start-"));
  const SOURCE = join(FIXTURE_DIR, "numbered.mp4");
  const FPS = 30;

  beforeAll(async () => {
    const result = await runFfmpeg([
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x64:d=6:r=30",
      "-vf",
      "format=gray,geq=lum='N*3'",
      "-c:v",
      "libx264",
      "-crf",
      "0",
      "-g",
      "30",
      "-pix_fmt",
      "yuv420p",
      SOURCE,
    ]);
    if (!result.success) throw new Error(`fixture synthesis failed: ${result.stderr.slice(-400)}`);
  }, 30_000);

  afterAll(() => rmSync(FIXTURE_DIR, { recursive: true, force: true }), 30_000);

  async function sourceFramesShown(
    start: number,
    outputFrames: number[],
  ): Promise<(number | null)[]> {
    const outDir = join(FIXTURE_DIR, `out-${start}`);
    mkdirSync(outDir, { recursive: true });
    const video: VideoElement = {
      id: "v",
      src: SOURCE,
      start,
      end: start + 1.9,
      mediaStart: start,
      loop: false,
      hasAudio: false,
    };
    const result = await extractAllVideoFrames([video], FIXTURE_DIR, {
      fps: FPS,
      outputDir: outDir,
    });
    expect(result.errors).toEqual([]);
    const table = createFrameLookupTable([video], result.extracted, FPS);
    return outputFrames.map((n) => {
      const path = table.getFrame("v", n / FPS);
      return path ? Math.round(readFirstFramePixel(path, 0, 0)[0] / 3) : null;
    });
  }

  it("keeps a looped clip on the same source frame after every wrap", async () => {
    const loopSource = join(FIXTURE_DIR, "loop.mp4");
    const synth = await runFfmpeg([
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x64:d=2:r=30",
      "-vf",
      "format=gray,geq=lum='N*4'",
      "-c:v",
      "libx264",
      "-crf",
      "0",
      "-pix_fmt",
      "yuv420p",
      loopSource,
    ]);
    expect(synth.success).toBe(true);
    const outDir = join(FIXTURE_DIR, "out-loop");
    mkdirSync(outDir, { recursive: true });
    const video: VideoElement = {
      id: "v",
      src: loopSource,
      start: 0.35,
      end: 6.35,
      mediaStart: 1,
      loop: true,
      hasAudio: false,
    };
    const result = await extractAllVideoFrames([video], FIXTURE_DIR, {
      fps: FPS,
      outputDir: outDir,
      timelineEnd: 6,
    });
    expect(result.errors).toEqual([]);
    const table = createFrameLookupTable([video], result.extracted, FPS);
    const shown = [0, 1, 2, 3, 4].map((wrap) => {
      const path = table.getFrame("v", (12 + wrap * FPS + 1) / FPS);
      return path ? Math.round(readFirstFramePixel(path, 0, 0)[0] / 4) : null;
    });
    expect(new Set(shown).size).toBe(1);
  }, 60_000);

  it.each([1.95, 2.0001, 1.999999])(
    "shows source frame N at output frame N for data-start=data-media-start=%s",
    async (start) => {
      const shown = await sourceFramesShown(start, [61, 62, 63, 64, 65]);
      expect(shown).toEqual([61, 62, 63, 64, 65]);
    },
    60_000,
  );
});
