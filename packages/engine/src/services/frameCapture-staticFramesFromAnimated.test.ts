import { describe, expect, it, vi } from "vitest";
import { computeStaticFrameSet, staticFramesFromAnimated } from "./frameCapture.js";

describe("staticFramesFromAnimated", () => {
  it("marks f static only when neither f nor f-1 is animated, never frame 0", () => {
    expect([...staticFramesFromAnimated(new Set([3]), 7)]).toEqual([1, 2, 5, 6]);
    expect([...staticFramesFromAnimated(new Set(), 3)]).toEqual([1, 2]);
    expect([...staticFramesFromAnimated(new Set([0]), 3)]).toEqual([2]);
  });
});

describe("computeStaticFrameSet animatedFrameSet", () => {
  function makePage(evalResult: Record<string, unknown>) {
    return {
      evaluate: vi.fn().mockResolvedValueOnce(evalResult).mockResolvedValueOnce([]),
    } as unknown as Parameters<typeof computeStaticFrameSet>[0];
  }
  const base = {
    intervals: [{ start: 1, end: 1.1, spatial: false }],
    tweenCount: 1,
    duration: 4,
    hasVideo: false,
    hasCanvas: false,
    hasNonGsapAnim: false,
    hasUnresolvableClipStart: false,
    hasTimelineCall: false,
  };

  it("reports the animated frames and keeps the static set their complement", async () => {
    const result = await computeStaticFrameSet(makePage(base), 30);
    expect([...result.animatedFrameSet].sort((a, b) => a - b)).toEqual([30, 31, 32, 33]);
    expect(result.staticFrameSet).toEqual(staticFramesFromAnimated(result.animatedFrameSet, 120));
  });

  it("still reports the animated frames when ineligible", async () => {
    const result = await computeStaticFrameSet(makePage({ ...base, tweenCount: 0 }), 30);
    expect(result.eligible).toBe(false);
    expect(result.staticFrameSet.size).toBe(0);
    expect(result.animatedFrameSet.has(30)).toBe(true);
  });
});
