import { describe, expect, it } from "vitest";
import {
  findObjectArrayKeyframeIndex,
  getCompatibleObjectArrayKeyframeTiming,
  getObjectArrayKeyframeTiming,
} from "./gsapObjectArrayTiming.js";

describe("getObjectArrayKeyframeTiming", () => {
  it("preserves tenth-percent precision for evenly distributed arrays", () => {
    expect(getObjectArrayKeyframeTiming([undefined, undefined, undefined, undefined])).toEqual({
      percentages: [0, 33.3, 66.7, 100],
    });
  });

  it("maps positive authored durations to cumulative percentages", () => {
    expect(getObjectArrayKeyframeTiming([1, 2, 1])).toEqual({
      percentages: [25, 75, 100],
      totalDuration: 4,
    });
  });

  it.each([
    [[0, 1, 1], "zero"],
    [[1, -1, 1], "negative"],
    [[1, Number.NaN, 1], "non-finite"],
    [[1, "__raw:total * 0.5", 1], "expression"],
    [[1, undefined, 1], "partial"],
  ])("rejects %s duration timing (%s)", (durations) => {
    expect(getObjectArrayKeyframeTiming(durations)).toBeNull();
  });
});

describe("findObjectArrayKeyframeIndex", () => {
  it("falls back to the nearest array entry for an in-range percentage", () => {
    expect(
      findObjectArrayKeyframeIndex([undefined, undefined, undefined, undefined], 50, {
        fallbackToNearest: true,
      }),
    ).toBe(1);
  });

  it("rejects out-of-range and unresolved timing", () => {
    expect(findObjectArrayKeyframeIndex([undefined, undefined], -1)).toBeNull();
    expect(findObjectArrayKeyframeIndex([undefined, undefined], 101)).toBeNull();
    expect(findObjectArrayKeyframeIndex([1, 0, 1], 50)).toBeNull();
  });
});

describe("getCompatibleObjectArrayKeyframeTiming", () => {
  it("accepts absent or matching outer durations and rejects conflicts", () => {
    expect(getCompatibleObjectArrayKeyframeTiming([0.25, 0.75], undefined)).not.toBeNull();
    expect(getCompatibleObjectArrayKeyframeTiming([0.25, 0.75], 1)).not.toBeNull();
    expect(getCompatibleObjectArrayKeyframeTiming([0.25, 0.75], 2)).toBeNull();
    expect(getCompatibleObjectArrayKeyframeTiming([0.25, 0.75], "1")).toBeNull();
  });
});
