import { describe, expect, it } from "vitest";
import { planVisibleCrop } from "../src/capture/geometry";

const viewport = {
  viewportWidth: 1000,
  viewportHeight: 600,
  devicePixelRatio: 2,
};

describe("planVisibleCrop", () => {
  it("maps a complete CSS selection to screenshot pixels", () => {
    expect(
      planVisibleCrop({ ...viewport, left: 100, top: 50, width: 300, height: 200 }, 2000, 1200),
    ).toEqual({
      sourceX: 200,
      sourceY: 100,
      sourceWidth: 600,
      sourceHeight: 400,
      outputWidth: 600,
      outputHeight: 400,
      completeness: "complete",
    });
  });

  it("clips every viewport edge and reports an honest cropped still", () => {
    expect(
      planVisibleCrop({ ...viewport, left: -20, top: -10, width: 1050, height: 650 }, 1000, 600),
    ).toEqual({
      sourceX: 0,
      sourceY: 0,
      sourceWidth: 1000,
      sourceHeight: 600,
      outputWidth: 1000,
      outputHeight: 600,
      completeness: "cropped",
    });
  });

  it("rejects a selection with no visible pixels", () => {
    expect(
      planVisibleCrop({ ...viewport, left: 1100, top: 0, width: 100, height: 100 }, 1000, 600),
    ).toBeNull();
  });
});
