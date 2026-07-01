import { describe, expect, it } from "vitest";

import { formatRenderSummaryDetail } from "./format.js";

describe("formatRenderSummaryDetail", () => {
  it("shows the output video length as the primary figure and labels render time", () => {
    // Output is 71.7s of video but only took 34.2s of wall-clock to render:
    // the two must be distinguishable so users stop comparing render time to ffprobe.
    const detail = formatRenderSummaryDetail({
      elapsedMs: 34_200,
      outputDurationSeconds: 71.7,
      isDirectory: false,
    });
    expect(detail).toBe("1m 11.7s video · rendered in 34.2s");
    expect(detail).toContain("video");
    expect(detail).toContain("rendered in");
  });

  it("omits the video figure gracefully when the duration is unknown", () => {
    expect(formatRenderSummaryDetail({ elapsedMs: 5_000, isDirectory: false })).toBe(
      "rendered in 5.0s",
    );
  });

  it("shows a frame count for png-sequence directory output instead of a video length", () => {
    const detail = formatRenderSummaryDetail({
      elapsedMs: 12_000,
      isDirectory: true,
      frameCount: 120,
      // a stray duration must not leak into directory output
      outputDurationSeconds: 4,
    });
    expect(detail).toBe("120 frames · rendered in 12.0s");
    expect(detail).not.toContain("video");
  });

  it("does not crash and shows only render time for a directory with no frame count", () => {
    expect(formatRenderSummaryDetail({ elapsedMs: 1_000, isDirectory: true })).toBe(
      "rendered in 1.0s",
    );
  });
});
