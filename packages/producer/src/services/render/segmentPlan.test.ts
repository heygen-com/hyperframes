import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEGMENT_FRAMES,
  MIN_SEGMENT_FRAMES,
  planSegments,
  resolveSegmentFrames,
} from "./segmentPlan.js";

describe("planSegments", () => {
  it("covers [0, total) exactly with a shorter tail", () => {
    expect(planSegments(7, 3)).toEqual([
      { index: 0, startFrame: 0, endFrame: 3 },
      { index: 1, startFrame: 3, endFrame: 6 },
      { index: 2, startFrame: 6, endFrame: 7 },
    ]);
  });

  it("returns one segment when total <= segment size", () => {
    expect(planSegments(3, 3000)).toEqual([{ index: 0, startFrame: 0, endFrame: 3 }]);
  });

  it("leaves no gap or overlap for an exact multiple", () => {
    // Concat assembles these back to back, so a gap drops frames and an
    // overlap duplicates them — neither is visible until the output is long.
    const slices = planSegments(9, 3);
    expect(slices).toHaveLength(3);
    expect(slices[0]?.startFrame).toBe(0);
    expect(slices.at(-1)?.endFrame).toBe(9);
    for (let i = 1; i < slices.length; i += 1) {
      expect(slices[i]?.startFrame).toBe(slices[i - 1]?.endFrame);
    }
  });

  it("rejects non-positive or fractional input", () => {
    expect(() => planSegments(0, 10)).toThrow(/totalFrames/);
    expect(() => planSegments(10, 0)).toThrow(/segmentFrames/);
    expect(() => planSegments(10.5, 3)).toThrow(/totalFrames/);
  });
});

describe("resolveSegmentFrames", () => {
  it("defaults to 3000", () => {
    expect(resolveSegmentFrames({})).toBe(DEFAULT_SEGMENT_FRAMES);
  });
  it("reads HF_SEGMENT_FRAMES and clamps to the minimum", () => {
    expect(resolveSegmentFrames({ HF_SEGMENT_FRAMES: "600" })).toBe(600);
    expect(resolveSegmentFrames({ HF_SEGMENT_FRAMES: "5" })).toBe(MIN_SEGMENT_FRAMES);
    expect(resolveSegmentFrames({ HF_SEGMENT_FRAMES: "-100" })).toBe(MIN_SEGMENT_FRAMES);
    expect(resolveSegmentFrames({ HF_SEGMENT_FRAMES: "abc" })).toBe(DEFAULT_SEGMENT_FRAMES);
    expect(resolveSegmentFrames({ HF_SEGMENT_FRAMES: "12.7" })).toBe(DEFAULT_SEGMENT_FRAMES);
  });
});
