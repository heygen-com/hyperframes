import { describe, expect, it } from "vitest";
import { estimateHdrExtractionBytes } from "./captureHdrResources.js";

describe("estimateHdrExtractionBytes", () => {
  it("sums 6 bytes per pixel per frame across videos", () => {
    // 10s @ 30fps of 1920x1080 = 300 frames * 1920*1080*6
    expect(
      estimateHdrExtractionBytes([{ durationSeconds: 10, width: 1920, height: 1080 }], 30),
    ).toBe(300 * 1920 * 1080 * 6);
  });

  it("accumulates multiple videos and rounds frame counts up", () => {
    const bytes = estimateHdrExtractionBytes(
      [
        { durationSeconds: 1.5, width: 100, height: 100 },
        { durationSeconds: 0.05, width: 100, height: 100 },
      ],
      30,
    );
    expect(bytes).toBe((45 + 2) * 100 * 100 * 6);
  });

  it("treats negative durations as empty", () => {
    expect(estimateHdrExtractionBytes([{ durationSeconds: -3, width: 100, height: 100 }], 30)).toBe(
      0,
    );
  });
});
