import type { ExtractedFrames, VideoElement, VideoMetadata } from "@hyperframes/engine";
import { describe, expect, it } from "vitest";
import {
  assertVideoFrameCoverage,
  computeVideoFrameCoverage,
  countAuthoredTimedClips,
  expectedFramesForClip,
  isVideoFrameCoverageError,
  resolveVideoCoverageThreshold,
  VideoFrameCoverageError,
} from "./videoFrameCoverage.js";

function makeVideo(overrides: Partial<VideoElement> & { id: string }): VideoElement {
  return {
    id: overrides.id,
    src: overrides.src ?? `${overrides.id}.mp4`,
    start: overrides.start ?? 0,
    end: overrides.end ?? 1,
    mediaStart: overrides.mediaStart ?? 0,
    loop: overrides.loop ?? false,
    hasAudio: overrides.hasAudio ?? false,
  };
}

// `durationSeconds` defaults to Infinity, not `delivered / fps` — the two are
// unrelated in production (source duration comes from ffprobe; `delivered`
// is how many frames the extractor happened to deliver) and coupling them
// here made any test modeling a delivery shortfall silently report full
// coverage unless it remembered to override durationSeconds afterward. An
// unbounded default instead falls into computeVideoFrameCoverage's "no
// usable source duration" branch, which requires the full authored slot —
// the same behavior every test had before source-duration crediting
// existed. Tests that care about a specific source duration (the held-tail
// cases below) pass it explicitly.
function makeExtracted(
  videoId: string,
  delivered: number,
  options: { fps?: number; durationSeconds?: number } = {},
): ExtractedFrames {
  const { fps = 30, durationSeconds = Number.POSITIVE_INFINITY } = options;
  const framePaths = new Map<number, string>();
  for (let i = 0; i < delivered; i += 1) framePaths.set(i, `/tmp/${videoId}/${i}.jpg`);
  const metadata: VideoMetadata = {
    durationSeconds,
    videoStreamDurationSeconds: durationSeconds,
    width: 1280,
    height: 720,
    fps,
    videoCodec: "h264",
    hasAudio: false,
    isVFR: false,
    hasAlpha: false,
    colorSpace: null,
  };
  return {
    videoId,
    srcPath: `/tmp/${videoId}.mp4`,
    outputDir: `/tmp/${videoId}`,
    framePattern: `${videoId}-%06d.jpg`,
    fps,
    totalFrames: delivered,
    metadata,
    framePaths,
  };
}

describe("expectedFramesForClip", () => {
  it("returns 0 for invalid inputs", () => {
    expect(expectedFramesForClip(Number.NaN, 1, 30)).toBe(0);
    expect(expectedFramesForClip(0, 1, 0)).toBe(0);
    expect(expectedFramesForClip(0, 1, -1)).toBe(0);
    expect(expectedFramesForClip(2, 1, 30)).toBe(0); // negative window collapses to 0
  });

  it("ceils fractional-fps windows so a 29.97fps 1s clip demands 30 frames", () => {
    expect(expectedFramesForClip(0, 1, 29.97)).toBe(30);
    expect(expectedFramesForClip(0, 5, 30)).toBe(150);
  });
});

describe("resolveVideoCoverageThreshold", () => {
  it("defaults to 0.95 when env is unset or non-numeric", () => {
    expect(resolveVideoCoverageThreshold(undefined)).toBe(0.95);
    expect(resolveVideoCoverageThreshold("garbage")).toBe(0.95);
  });

  it("returns null when env is 0 or negative — gate disabled", () => {
    expect(resolveVideoCoverageThreshold("0")).toBeNull();
    expect(resolveVideoCoverageThreshold("-1")).toBeNull();
  });

  it("clamps values above 1 to 1", () => {
    expect(resolveVideoCoverageThreshold("2")).toBe(1);
  });

  it("passes through in-range values", () => {
    expect(resolveVideoCoverageThreshold("0.8")).toBe(0.8);
    expect(resolveVideoCoverageThreshold("0.99")).toBe(0.99);
    expect(resolveVideoCoverageThreshold("1")).toBe(1);
  });
});

describe("computeVideoFrameCoverage", () => {
  it("reports 1.0 ratio when every video delivered its authored window", () => {
    const videos = [
      makeVideo({ id: "a", start: 0, end: 1 }),
      makeVideo({ id: "b", start: 1, end: 3 }),
    ];
    const extracted = [makeExtracted("a", 30), makeExtracted("b", 60)];
    const reports = computeVideoFrameCoverage(videos, extracted, 30);
    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({
      videoId: "a",
      expectedFrames: 30,
      capturedFrames: 30,
      ratio: 1,
    });
    expect(reports[1]).toMatchObject({
      videoId: "b",
      expectedFrames: 60,
      capturedFrames: 60,
      ratio: 1,
    });
  });

  it("reports 0 capturedFrames when a video was never extracted (injection failure)", () => {
    // Field signal ts=1784139267: later-injected video clips silently drop
    // out of the extractor under injection-count saturation.
    const videos = [makeVideo({ id: "later-injection", start: 0, end: 5 })];
    const reports = computeVideoFrameCoverage(videos, [], 30);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      videoId: "later-injection",
      expectedFrames: 150,
      capturedFrames: 0,
      ratio: 0,
    });
  });

  it("uses delivered framePaths.size, not the possibly-stale totalFrames field", () => {
    const videos = [makeVideo({ id: "a", start: 0, end: 1 })];
    // Simulate an extractor whose totalFrames reports 30 but only 5 frames
    // landed in framePaths (mid-extraction crash, partial cache read, …).
    const partial = makeExtracted("a", 5);
    partial.totalFrames = 30;
    const reports = computeVideoFrameCoverage(videos, [partial], 30);
    expect(reports[0]!.capturedFrames).toBe(5);
    expect(reports[0]!.ratio).toBeCloseTo(5 / 30, 5);
  });

  it("credits a non-looping held tail against the source portion only", () => {
    const videos = [makeVideo({ id: "held", start: 0, end: 10 })];
    const extracted = [makeExtracted("held", 90, { durationSeconds: 3 })];
    const reports = computeVideoFrameCoverage(videos, extracted, 30);
    expect(reports[0]).toMatchObject({ expectedFrames: 90, capturedFrames: 90, ratio: 1 });
  });

  it("credits a looping short clip against the source portion — the delivered frame set covers every repeat (#2665)", () => {
    // Regression #2665: a looping video shorter than its slot delivered all
    // its source frames (extractor complete), but the pre-fix gate measured
    // 90 unique / 300 slot = 30% and aborted. Every one of the 300 output
    // frames maps to one of the 90 source frames — coverage is 100%.
    const videos = [makeVideo({ id: "loop", start: 0, end: 10, loop: true })];
    const extracted = [makeExtracted("loop", 90, { durationSeconds: 3 })];
    const reports = computeVideoFrameCoverage(videos, extracted, 30);
    expect(reports[0]).toMatchObject({ expectedFrames: 90, capturedFrames: 90, ratio: 1 });
  });

  it("still fails when a looping clip's source extraction is truncated", () => {
    // Fail-loud preserved for a genuinely-broken loop: only 60/90 source
    // frames arrived, so the delivered set does NOT cover every repeat.
    const videos = [makeVideo({ id: "truncated-loop", start: 0, end: 10, loop: true })];
    const extracted = [makeExtracted("truncated-loop", 60, { durationSeconds: 3 })];
    const reports = computeVideoFrameCoverage(videos, extracted, 30);
    expect(reports[0]).toMatchObject({ expectedFrames: 90, capturedFrames: 60 });
    expect(() => assertVideoFrameCoverage(reports, 0.95)).toThrow(VideoFrameCoverageError);
  });

  it("still fails when extraction is truncated before the held-tail source", () => {
    const videos = [makeVideo({ id: "truncated", start: 0, end: 10 })];
    const extracted = [makeExtracted("truncated", 60, { durationSeconds: 3 })];
    const reports = computeVideoFrameCoverage(videos, extracted, 30);
    expect(reports[0]).toMatchObject({ expectedFrames: 90, capturedFrames: 60 });
    expect(() => assertVideoFrameCoverage(reports, 0.95)).toThrow(VideoFrameCoverageError);
  });

  it("fails closed for invalid or exhausted source durations", () => {
    const videos = [
      makeVideo({ id: "zero", start: 0, end: 10 }),
      makeVideo({ id: "trimmed-away", start: 0, end: 10, mediaStart: 4 }),
    ];
    const extracted = [
      makeExtracted("zero", 0, { durationSeconds: 0 }),
      makeExtracted("trimmed-away", 30, { durationSeconds: 3 }),
    ];
    const reports = computeVideoFrameCoverage(videos, extracted, 30);
    expect(reports[0]).toMatchObject({ expectedFrames: 300, capturedFrames: 0 });
    expect(reports[1]).toMatchObject({ expectedFrames: 300, capturedFrames: 30 });
    expect(() => assertVideoFrameCoverage(reports, 0.95)).toThrow(VideoFrameCoverageError);
  });
});

describe("assertVideoFrameCoverage", () => {
  it("does not throw when every clip has full frames", () => {
    const reports = [
      { videoId: "a", clipStart: 0, clipEnd: 1, expectedFrames: 30, capturedFrames: 30, ratio: 1 },
      { videoId: "b", clipStart: 1, clipEnd: 2, expectedFrames: 30, capturedFrames: 30, ratio: 1 },
    ];
    expect(() => assertVideoFrameCoverage(reports, 0.95)).not.toThrow();
  });

  it("fails loudly with VideoFrameCoverageError when any clip has zero frames", () => {
    const reports = [
      {
        videoId: "good",
        clipStart: 0,
        clipEnd: 1,
        expectedFrames: 30,
        capturedFrames: 30,
        ratio: 1,
      },
      {
        videoId: "blank",
        clipStart: 5,
        clipEnd: 10,
        expectedFrames: 150,
        capturedFrames: 0,
        ratio: 0,
      },
    ];
    let caught: unknown = null;
    try {
      assertVideoFrameCoverage(reports, 0.95);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(VideoFrameCoverageError);
    expect(isVideoFrameCoverageError(caught)).toBe(true);
    const err = caught as VideoFrameCoverageError;
    expect(err.worst.videoId).toBe("blank");
    expect(err.threshold).toBe(0.95);
    expect(err.message).toContain("blank");
    expect(err.message).toContain("check/snapshot");
    expect(err.message).toContain("HF_VIDEO_COVERAGE_THRESHOLD=0");
  });

  it("fails loudly when a clip is below the threshold (partial coverage)", () => {
    // 80% coverage: 24/30 — below the 0.95 default, above zero.
    const reports = [
      {
        videoId: "partial",
        clipStart: 0,
        clipEnd: 1,
        expectedFrames: 30,
        capturedFrames: 24,
        ratio: 0.8,
      },
    ];
    expect(() => assertVideoFrameCoverage(reports, 0.95)).toThrow(VideoFrameCoverageError);
  });

  it("respects a threshold override — 0.5 passes 60% coverage", () => {
    const reports = [
      {
        videoId: "partial",
        clipStart: 0,
        clipEnd: 1,
        expectedFrames: 30,
        capturedFrames: 18,
        ratio: 0.6,
      },
    ];
    expect(() => assertVideoFrameCoverage(reports, 0.5)).not.toThrow();
  });

  it("is a no-op when the threshold is null (env opt-out)", () => {
    const reports = [
      {
        videoId: "blank",
        clipStart: 0,
        clipEnd: 1,
        expectedFrames: 30,
        capturedFrames: 0,
        ratio: 0,
      },
    ];
    expect(() => assertVideoFrameCoverage(reports, null)).not.toThrow();
  });

  it("ignores 0-expected-frame windows so the gate never fires on a degenerate clip", () => {
    const reports = [
      {
        videoId: "zero-duration",
        clipStart: 3,
        clipEnd: 3,
        expectedFrames: 0,
        capturedFrames: 0,
        ratio: 1,
      },
    ];
    expect(() => assertVideoFrameCoverage(reports, 1)).not.toThrow();
  });

  it("cites the worst-ratio clip in the error, not the first-found", () => {
    // Field-signal shape: 15 injected videos, several later ones blank. Cite
    // the deepest failure so operators fix root cause first, not the closest.
    const reports = [
      {
        videoId: "slightly-low",
        clipStart: 0,
        clipEnd: 1,
        expectedFrames: 30,
        capturedFrames: 27,
        ratio: 0.9,
      },
      {
        videoId: "totally-blank",
        clipStart: 1,
        clipEnd: 2,
        expectedFrames: 30,
        capturedFrames: 0,
        ratio: 0,
      },
      {
        videoId: "moderately-low",
        clipStart: 2,
        clipEnd: 3,
        expectedFrames: 30,
        capturedFrames: 15,
        ratio: 0.5,
      },
    ];
    try {
      assertVideoFrameCoverage(reports, 0.95);
      throw new Error("expected coverage assertion to throw");
    } catch (err) {
      expect(isVideoFrameCoverageError(err)).toBe(true);
      const cov = err as VideoFrameCoverageError;
      expect(cov.worst.videoId).toBe("totally-blank");
      expect(cov.failedReports.map((r) => r.videoId)).toEqual([
        "totally-blank",
        "moderately-low",
        "slightly-low",
      ]);
      expect(cov.message).toContain("+2 more clip(s) below threshold");
    }
  });
});

describe("countAuthoredTimedClips", () => {
  it("counts every [data-start] element in the compiled HTML", () => {
    // Field signal ts=1784144554: 147-clip composition with 130 word-level
    // caption divs. Static scan gives a coarse proxy — enough to make a
    // 147-clip render distinguishable in telemetry from a 3-clip render.
    const html = `<html><body>
      <div data-start="0" data-duration="1">a</div>
      <div data-start="1" data-duration="1">b</div>
      <video data-start="2" data-duration="3" src="v.mp4"></video>
      <div>not timed</div>
    </body></html>`;
    expect(countAuthoredTimedClips(html)).toBe(3);
  });

  it("returns 0 when no timed clips exist", () => {
    expect(countAuthoredTimedClips("<html><body><div>hi</div></body></html>")).toBe(0);
  });
});
