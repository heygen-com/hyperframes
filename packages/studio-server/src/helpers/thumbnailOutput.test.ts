import { describe, expect, it } from "vitest";
import { thumbnailDeviceScaleFactor } from "./thumbnailOutput";

describe("thumbnailDeviceScaleFactor", () => {
  it("preserves source-density captures and bounds landscape and portrait previews", () => {
    expect(
      thumbnailDeviceScaleFactor({
        width: 1920,
        height: 1080,
        outputWidth: 1920,
        outputHeight: 1080,
      }),
    ).toBe(1);
    expect(
      thumbnailDeviceScaleFactor({
        width: 1920,
        height: 1080,
        outputWidth: 240,
        outputHeight: 135,
      }),
    ).toBe(0.125);
    expect(
      thumbnailDeviceScaleFactor({
        width: 1080,
        height: 1920,
        outputWidth: 76,
        outputHeight: 135,
      }),
    ).toBeCloseTo(76 / 1080);
  });

  it("rejects invalid dimensions instead of silently changing layout", () => {
    expect(() =>
      thumbnailDeviceScaleFactor({ width: 0, height: 1080, outputWidth: 240, outputHeight: 135 }),
    ).toThrow(RangeError);
  });
});
