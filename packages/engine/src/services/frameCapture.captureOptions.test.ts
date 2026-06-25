// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveCaptureSessionOptions } from "./frameCapture.js";

describe("createCaptureSession captureBeyondViewport defaults", () => {
  it("plumbs the macOS regular-Chrome default into returned session options", () => {
    const options = resolveCaptureSessionOptions(
      {
        width: 1920,
        height: 1080,
        fps: { num: 30, den: 1 },
        format: "jpeg",
      },
      "Chrome/149.0.7827.155",
      "darwin",
    );

    expect(options.captureBeyondViewport).toBe(true);
  });

  it("preserves explicit caller overrides", () => {
    const options = resolveCaptureSessionOptions(
      {
        width: 1920,
        height: 1080,
        fps: { num: 30, den: 1 },
        format: "jpeg",
        captureBeyondViewport: false,
      },
      "Chrome/149.0.7827.155",
      "darwin",
    );

    expect(options.captureBeyondViewport).toBe(false);
  });
});
