import { describe, expect, test } from "vitest";
import { computeSnapThreshold, snapKeyframe } from "./keyframeSnapping";

describe("snapKeyframe", () => {
  test("snaps to frame boundary", () => {
    const result = snapKeyframe(0.34, { fps: 30, keyframeTimes: [], threshold: 0.05 });
    expect(result.snapType).toBe("frame");
    expect(Math.abs(result.snappedTime - 1 / 3)).toBeLessThan(0.01);
  });

  test("snaps to cross-element keyframe when closest", () => {
    const result = snapKeyframe(1.005, { fps: 30, keyframeTimes: [1.0], threshold: 0.05 });
    expect(result.snapType).toBe("keyframe");
    expect(result.snappedTime).toBe(1.0);
  });

  test("keyframe snap wins tie with frame at same position", () => {
    const result = snapKeyframe(1.0, { fps: 30, keyframeTimes: [1.0], threshold: 0.05 });
    expect(result.snapType).toBe("keyframe");
    expect(result.snappedTime).toBe(1.0);
  });

  test("snaps to beat marker when closer than frame", () => {
    const result = snapKeyframe(2.49, {
      fps: 30,
      keyframeTimes: [],
      beatTimes: [2.5],
      threshold: 0.05,
    });
    expect(result.snapType).toBe("beat");
    expect(result.snappedTime).toBe(2.5);
  });

  test("disabled returns raw time", () => {
    const result = snapKeyframe(1.5, {
      fps: 30,
      keyframeTimes: [1.5],
      threshold: 0.05,
      disabled: true,
    });
    expect(result.snapType).toBeNull();
    expect(result.snappedTime).toBe(1.5);
  });

  test("no snap when outside threshold", () => {
    const result = snapKeyframe(1.5, {
      fps: 30,
      keyframeTimes: [0.5],
      threshold: 0.05,
    });
    expect(result.snapType).toBe("frame");
  });

  test("empty beat times is graceful", () => {
    const result = snapKeyframe(0.5, {
      fps: 30,
      keyframeTimes: [],
      beatTimes: [],
      threshold: 0.05,
    });
    expect(result.snapType).toBe("frame");
  });
});

describe("computeSnapThreshold", () => {
  test("returns threshold based on pixels per second", () => {
    const threshold = computeSnapThreshold(100, 5);
    expect(threshold).toBe(0.05);
  });

  test("fallback for zero pixels per second", () => {
    expect(computeSnapThreshold(0)).toBe(0.1);
  });
});
