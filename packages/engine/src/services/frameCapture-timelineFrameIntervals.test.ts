import { describe, it, expect, vi } from "vitest";
import {
  computeStaticFrameSet,
  computeTimelineAtRiskFrames,
  MAX_TIMELINE_FRAME_INTERVALS,
} from "./frameCapture.js";

type Page = Parameters<typeof computeTimelineAtRiskFrames>[0];

function atRiskPage(intervals: Array<{ start: number; end: number }>, duration: number): Page {
  return { evaluate: vi.fn().mockResolvedValueOnce({ intervals, duration }) } as unknown as Page;
}

function staticPage(
  intervals: Array<{ start: number; end: number; spatial: boolean }>,
  duration: number,
): Page {
  return {
    evaluate: vi
      .fn()
      .mockResolvedValueOnce({
        intervals,
        tweenCount: Math.max(1, intervals.length),
        duration,
        hasVideo: false,
        hasCanvas: false,
        hasFrameSources: false,
        hasIframe: false,
        hasNonGsapAnim: false,
        hasUnresolvableClipStart: false,
        hasTimelineCall: false,
      })
      .mockResolvedValueOnce([]),
  } as unknown as Page;
}

describe("computeTimelineAtRiskFrames frame range", () => {
  it("keeps at-risk frames inside the composition's frame range", async () => {
    // A 10 s comp at 30 fps has frames 0..299; the tween claims to run to 20 s.
    const { frames, totalFrames } = await computeTimelineAtRiskFrames(
      atRiskPage([{ start: 9, end: 20 }], 10),
      30,
    );
    expect(totalFrames).toBe(300);
    expect(Math.max(...frames)).toBe(299);
    expect(Math.min(...frames)).toBe(269);
    expect(frames.size).toBe(31);
  });

  it("clamps to the render's duration when the producer passes one", async () => {
    const { frames } = await computeTimelineAtRiskFrames(
      atRiskPage([{ start: 0, end: 1e9 }], 1e9),
      30,
      2,
    );
    expect(frames.size).toBe(60);
    expect(Math.max(...frames)).toBe(59);
  });

  it("ignores a tween that starts after the last frame or has no numeric times", async () => {
    const { frames } = await computeTimelineAtRiskFrames(
      atRiskPage(
        [
          { start: 50, end: 60 },
          { start: Number.NaN, end: 5 },
        ],
        10,
      ),
      30,
    );
    expect(frames.size).toBe(0);
  });

  it("gives the same frames for stacked overlapping tweens as for one", async () => {
    const stacked = Array.from({ length: 5_000 }, () => ({ start: 1, end: 9 }));
    const { frames } = await computeTimelineAtRiskFrames(atRiskPage(stacked, 10), 30);
    const { frames: single } = await computeTimelineAtRiskFrames(
      atRiskPage([{ start: 1, end: 9 }], 10),
      30,
    );
    expect([...frames].sort((a, b) => a - b)).toEqual([...single].sort((a, b) => a - b));
    expect(frames.size).toBe(243); // frames 29..271 (one-frame margin each side)
  });

  it("treats every frame as at risk past the tween interval limit", async () => {
    const many = Array.from({ length: MAX_TIMELINE_FRAME_INTERVALS + 1 }, () => ({
      start: 0,
      end: 0.1,
    }));
    const { frames, totalFrames } = await computeTimelineAtRiskFrames(atRiskPage(many, 10), 30);
    expect(frames.size).toBe(totalFrames);
  });
});

describe("computeStaticFrameSet tween intervals", () => {
  it("is ineligible past the tween interval limit", async () => {
    const many = Array.from({ length: MAX_TIMELINE_FRAME_INTERVALS + 1 }, () => ({
      start: 0,
      end: 0.1,
      spatial: false,
    }));
    const page = staticPage(many, 10);
    const result = await computeStaticFrameSet(page, 30);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("tween interval limit");
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it("predicts the same frames for stacked overlapping tweens as for one", async () => {
    const stacked = Array.from({ length: 5_000 }, (_, i) => ({
      start: 1,
      end: 2,
      spatial: i % 2 === 0,
    }));
    const one = await computeStaticFrameSet(staticPage([stacked[0]!], 10), 30);
    const many = await computeStaticFrameSet(staticPage(stacked, 10), 30);
    expect(many.eligible).toBe(true);
    expect([...many.staticFrameSet]).toEqual([...one.staticFrameSet]);
    // Every animated frame has a spatial tween on it, so none is non-spatial-only.
    expect(many.nonSpatialOnlyFrameSet.size).toBe(0);
    expect(one.nonSpatialOnlyFrameSet.size).toBe(0);
  });
});
