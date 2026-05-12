/**
 * Tests for the hf#732 hybrid layered-path gating + partitioning predicates.
 * These pin the contracts that the dispatcher in `captureHdrStage.ts`
 * depends on; both helpers are pure so the tests are cheap to maintain.
 */

import { describe, expect, it } from "vitest";
import {
  distributeLayeredHybridFrameRanges,
  partitionTransitionFrames,
  shouldUseHybridLayeredPath,
} from "./captureHdrFrameShared.js";

describe("shouldUseHybridLayeredPath", () => {
  it("returns false for HDR content (HDR raw-frame sources are fd-bound)", () => {
    expect(
      shouldUseHybridLayeredPath({
        hasHdrContent: true,
        transitionFramesCount: 30,
        totalFrames: 300,
        workerCount: 6,
      }),
    ).toBe(false);
  });

  it("returns false for single-worker budgets (sequential loop is already optimal)", () => {
    expect(
      shouldUseHybridLayeredPath({
        hasHdrContent: false,
        transitionFramesCount: 30,
        totalFrames: 300,
        workerCount: 1,
      }),
    ).toBe(false);
    expect(
      shouldUseHybridLayeredPath({
        hasHdrContent: false,
        transitionFramesCount: 30,
        totalFrames: 300,
        workerCount: 0,
      }),
    ).toBe(false);
  });

  it("returns false when every frame is inside a transition window", () => {
    expect(
      shouldUseHybridLayeredPath({
        hasHdrContent: false,
        transitionFramesCount: 120,
        totalFrames: 120,
        workerCount: 6,
      }),
    ).toBe(false);
    // Transition-frame count strictly greater than total is degenerate and
    // should still be rejected (parallel workers can't help).
    expect(
      shouldUseHybridLayeredPath({
        hasHdrContent: false,
        transitionFramesCount: 200,
        totalFrames: 120,
        workerCount: 6,
      }),
    ).toBe(false);
  });

  it("returns false for empty timelines", () => {
    expect(
      shouldUseHybridLayeredPath({
        hasHdrContent: false,
        transitionFramesCount: 0,
        totalFrames: 0,
        workerCount: 6,
      }),
    ).toBe(false);
  });

  it("returns true for SDR multi-worker with mixed transition/normal frames", () => {
    expect(
      shouldUseHybridLayeredPath({
        hasHdrContent: false,
        transitionFramesCount: 30,
        totalFrames: 300,
        workerCount: 6,
      }),
    ).toBe(true);
  });

  it("returns true when there are no transitions at all (pure normal-frame parallelism)", () => {
    expect(
      shouldUseHybridLayeredPath({
        hasHdrContent: false,
        transitionFramesCount: 0,
        totalFrames: 300,
        workerCount: 6,
      }),
    ).toBe(true);
  });
});

describe("distributeLayeredHybridFrameRanges", () => {
  it("partitions [0, n) into contiguous slices that cover exactly the range", () => {
    const ranges = distributeLayeredHybridFrameRanges(300, 6);
    expect(ranges.length).toBe(6);
    expect(ranges[0]!.start).toBe(0);
    let prevEnd = 0;
    for (const r of ranges) {
      expect(r.start).toBe(prevEnd);
      expect(r.end).toBeGreaterThanOrEqual(r.start);
      expect(r.end).toBeLessThanOrEqual(300);
      prevEnd = r.end;
    }
    expect(prevEnd).toBe(300);
  });

  it("does NOT pin all transition frames to one worker (contiguous chunking spreads them)", () => {
    // 300 frames, 6 workers → ~50 per worker. Transition window 60-69
    // (10 frames) falls in worker 1's slice [50, 100). The transition
    // frames are not all assigned to worker 0.
    const ranges = distributeLayeredHybridFrameRanges(300, 6);
    const worker0 = ranges[0]!;
    const transitionInWorker0 = [];
    for (let i = 60; i <= 69; i++) {
      if (i >= worker0.start && i < worker0.end) transitionInWorker0.push(i);
    }
    expect(transitionInWorker0.length).toBe(0);
  });

  it("clamps non-positive workerCount to 1", () => {
    const ranges = distributeLayeredHybridFrameRanges(100, 0);
    expect(ranges.length).toBe(1);
    expect(ranges[0]).toEqual({ start: 0, end: 100 });
    const negative = distributeLayeredHybridFrameRanges(100, -5);
    expect(negative.length).toBe(1);
  });

  it("assigns zero-width ranges to workers past the frame budget", () => {
    const ranges = distributeLayeredHybridFrameRanges(5, 10);
    expect(ranges.length).toBe(10);
    expect(ranges.slice(5).every((r) => r.start === r.end)).toBe(true);
  });

  it("handles zero-frame inputs", () => {
    const ranges = distributeLayeredHybridFrameRanges(0, 4);
    expect(ranges.length).toBe(4);
    expect(ranges.every((r) => r.start === 0 && r.end === 0)).toBe(true);
  });
});

describe("partitionTransitionFrames", () => {
  it("returns a Set of frame indices that fall inside any transition window", () => {
    const ranges = [
      { startFrame: 30, endFrame: 39 },
      { startFrame: 120, endFrame: 125 },
    ];
    const set = partitionTransitionFrames(ranges, 200);
    expect(set.size).toBe(10 + 6);
    expect(set.has(30)).toBe(true);
    expect(set.has(39)).toBe(true);
    expect(set.has(40)).toBe(false);
    expect(set.has(120)).toBe(true);
    expect(set.has(125)).toBe(true);
    expect(set.has(126)).toBe(false);
  });

  it("clamps range endpoints to [0, totalFrames - 1]", () => {
    const ranges = [{ startFrame: -5, endFrame: 5 }];
    const set = partitionTransitionFrames(ranges, 3);
    expect(set.has(-1)).toBe(false);
    expect(set.has(0)).toBe(true);
    expect(set.has(2)).toBe(true);
    expect(set.has(3)).toBe(false);
  });

  it("returns empty set for non-positive totalFrames", () => {
    expect(partitionTransitionFrames([{ startFrame: 0, endFrame: 5 }], 0).size).toBe(0);
    expect(partitionTransitionFrames([{ startFrame: 0, endFrame: 5 }], -1).size).toBe(0);
  });
});
