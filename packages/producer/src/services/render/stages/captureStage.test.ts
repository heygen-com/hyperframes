import { describe, expect, it } from "vitest";
import {
  assertDiskCaptureHeadroom,
  estimateDiskCaptureBytes,
  shouldAllowAdaptiveCaptureRetry,
} from "./captureStage.js";

describe("shouldAllowAdaptiveCaptureRetry", () => {
  it("keeps timeout recovery enabled when the initial worker count was explicit", () => {
    expect(shouldAllowAdaptiveCaptureRetry(6, true)).toBe(true);
  });

  it("does not retry an already sequential capture", () => {
    expect(shouldAllowAdaptiveCaptureRetry(1, true)).toBe(false);
  });
});

describe("disk capture capacity", () => {
  const captureOptions = {
    width: 100,
    height: 50,
    fps: { num: 30, den: 1 },
    deviceScaleFactor: 2,
    format: "jpeg" as const,
  };

  it("estimates output-resolution frame storage conservatively", () => {
    expect(estimateDiskCaptureBytes(10, captureOptions)).toBe(800_000);
  });

  it("fails before capture when estimated frames exceed available headroom", () => {
    expect(() =>
      assertDiskCaptureHeadroom("/render/captured-frames", 10, captureOptions, () => 800_000),
    ).toThrow(/may need ~0\.8 MB.*0\.8 MB is free.*--low-memory-mode/s);
  });
});
