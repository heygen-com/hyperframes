import { describe, expect, it } from "vitest";
import {
  assertDiskCaptureHeadroom,
  estimateDiskCaptureBytes,
  inspectDiskCaptureHeadroom,
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

  it("exposes the same 90% headroom decision to fallback planning", () => {
    const estimatedBytes = estimateDiskCaptureBytes(10, captureOptions);

    expect(
      inspectDiskCaptureHeadroom(
        "/render/captured-frames",
        10,
        captureOptions,
        () => estimatedBytes / 0.9 - 1,
      ),
    ).toEqual({ available: false, estimatedBytes, freeBytes: estimatedBytes / 0.9 - 1 });
    expect(
      inspectDiskCaptureHeadroom("/render/captured-frames", 10, captureOptions, () => null)
        .available,
    ).toBe(true);
  });

  it("rejects the reported 5318-frame landscape disk route with 45 GiB free", () => {
    const landscape = {
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      format: "jpeg" as const,
    };
    const headroom = inspectDiskCaptureHeadroom(
      "/render/captured-frames",
      5318,
      landscape,
      () => 45 * 1024 ** 3,
    );

    expect(headroom.estimatedBytes).toBe(5318 * 1920 * 1080 * 4);
    expect(headroom.available).toBe(false);
  });
});
