import { describe, expect, it } from "vitest";
import { frameCount, frameTimestamp, quantizeTimeToFrame } from "./frameTiming.js";

describe("quantizeTimeToFrame", () => {
  it("rounds to the nearest frame boundary", () => {
    expect(quantizeTimeToFrame(1.51, 30)).toBeCloseTo(45 / 30, 10);
    expect(quantizeTimeToFrame(0.016, 60)).toBeCloseTo(1 / 60, 10);
  });

  it("returns 0 on invalid input", () => {
    expect(quantizeTimeToFrame(Number.NaN, 30)).toBe(0);
    expect(quantizeTimeToFrame(1, 0)).toBe(0);
  });
});

describe("frameCount", () => {
  it("rounds duration * fps and never returns less than 1 for a positive duration", () => {
    expect(frameCount(5, 30)).toBe(150);
    expect(frameCount(0.01, 30)).toBe(1);
    expect(frameCount(0, 30)).toBe(0);
    expect(frameCount(-1, 30)).toBe(0);
  });
});

describe("frameTimestamp", () => {
  it("maps frame index to seconds", () => {
    expect(frameTimestamp(45, 30)).toBeCloseTo(1.5, 10);
    expect(frameTimestamp(0, 30)).toBe(0);
  });
});
