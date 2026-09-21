import { describe, expect, it } from "vitest";

import {
  formatRenderPipelineDetail,
  formatRenderSummaryDetail,
  formatScreenshotFallbackHint,
  resolvePrintedCaptureMode,
} from "./format.js";

describe("formatRenderPipelineDetail", () => {
  it("names the capture path, gpu mode and each stage in pipeline order", () => {
    const line = formatRenderPipelineDetail({
      captureMode: "screenshot",
      browserGpuMode: "software",
      stages: { encodeMs: 5767, captureFrameMs: 22856, compileMs: 685, assembleMs: 509 },
    });
    expect(line).toBe(
      "screenshot capture · software gpu · compile 0.7s · capture 22.9s · encode 5.8s · assemble 0.5s",
    );
  });

  it("skips fields that were never measured and returns nothing for an empty summary", () => {
    expect(formatRenderPipelineDetail({ captureMode: "beginframe", stages: {} })).toBe(
      "beginframe capture",
    );
    expect(formatRenderPipelineDetail({ stages: {} })).toBeUndefined();
  });

  it("keeps a measured 0 ms stage instead of dropping it", () => {
    // a silent composition still records audioProcessMs = 0
    expect(formatRenderPipelineDetail({ stages: { audioProcessMs: 0 } })).toBe("audio 0.0s");
  });

  it("labels encode as overlapped when the streaming encoder ran", () => {
    expect(
      formatRenderPipelineDetail({
        streamingEncode: true,
        stages: { captureFrameMs: 10_000, encodeMs: 4_000 },
      }),
    ).toBe("capture 10.0s · encode (during capture) 4.0s");
  });
});

describe("resolvePrintedCaptureMode", () => {
  it("prefers the session mode, including a joined fallback, over observability", () => {
    expect(resolvePrintedCaptureMode("drawelement", "screenshot")).toBe("drawelement");
    expect(resolvePrintedCaptureMode("beginframe|screenshot", "screenshot")).toBe(
      "beginframe|screenshot",
    );
  });

  it("treats the aggregator's unknown sentinel as absent and uses observability", () => {
    expect(resolvePrintedCaptureMode("unknown", "screenshot")).toBe("screenshot");
    expect(resolvePrintedCaptureMode(undefined, "beginframe")).toBe("beginframe");
    expect(resolvePrintedCaptureMode("unknown", undefined)).toBeUndefined();
  });
});

describe("formatScreenshotFallbackHint", () => {
  const slow = {
    captureMode: "screenshot",
    browserGpuMode: "software" as const,
    requestedGpuMode: "auto" as const,
    platform: "linux" as const,
  };

  it("explains the slow path only for linux + auto-probed software gpu + screenshot", () => {
    expect(formatScreenshotFallbackHint(slow)).toContain("BeginFrame did not run");
    expect(formatScreenshotFallbackHint({ ...slow, platform: "darwin" })).toBeUndefined();
    expect(formatScreenshotFallbackHint({ ...slow, browserGpuMode: "hardware" })).toBeUndefined();
    expect(formatScreenshotFallbackHint({ ...slow, captureMode: "beginframe" })).toBeUndefined();
  });

  it("stays silent when software gpu was requested, as --docker and --no-browser-gpu do", () => {
    expect(formatScreenshotFallbackHint({ ...slow, requestedGpuMode: "software" })).toBeUndefined();
    expect(formatScreenshotFallbackHint({ ...slow, requestedGpuMode: undefined })).toBeUndefined();
  });
});

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

  it("shows the video length for an HLS playlist directory", () => {
    const detail = formatRenderSummaryDetail({
      elapsedMs: 12_000,
      isDirectory: true,
      playlistDirectory: true,
      frameCount: 120,
      outputDurationSeconds: 4,
    });
    expect(detail).toBe("4.0s video · rendered in 12.0s");
  });

  it("does not crash and shows only render time for a directory with no frame count", () => {
    expect(formatRenderSummaryDetail({ elapsedMs: 1_000, isDirectory: true })).toBe(
      "rendered in 1.0s",
    );
  });
});
