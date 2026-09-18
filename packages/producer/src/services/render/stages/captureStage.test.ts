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

  it("estimates compressed jpeg frame storage at the output resolution", () => {
    // 200 × 100 output px × 0.5 B/px × 10 frames.
    expect(estimateDiskCaptureBytes(10, captureOptions)).toBe(100_000);
  });

  it("keeps a heavier per-pixel estimate for lossless png alpha frames", () => {
    expect(estimateDiskCaptureBytes(10, { ...captureOptions, format: "png" })).toBe(400_000);
  });

  it("fails before capture when estimated frames exceed available headroom", () => {
    expect(() =>
      assertDiskCaptureHeadroom("/render/captured-frames", 10, captureOptions, () => 100_000),
    ).toThrow(
      /estimated temporary frame storage is ~0\.1 MB.*only 0\.1 MB is free.*--low-memory-mode/s,
    );
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

  it("admits the reported 5318-frame landscape disk route with 45 GiB free", () => {
    // Field case (bug 189036 family): the old uncompressed-RGBA estimate
    // (~44 GiB) mis-rejected this render against 45 GiB free even though
    // the actual JPEG footprint is a few GiB.
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

    expect(headroom.estimatedBytes).toBe(5318 * 1920 * 1080 * 0.5);
    expect(headroom.available).toBe(true);
  });

  it("still rejects when even the compressed estimate exceeds the headroom", () => {
    const landscape = {
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      format: "jpeg" as const,
    };
    expect(
      inspectDiskCaptureHeadroom("/render/captured-frames", 5318, landscape, () => 5 * 1024 ** 3)
        .available,
    ).toBe(false);
  });
});
