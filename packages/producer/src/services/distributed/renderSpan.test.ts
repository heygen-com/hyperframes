import { describe, expect, it } from "bun:test";
import type { DistributedRenderConfig } from "./plan.js";
import { RenderSpanUnsupportedError, spanFrameRange, spanPlanConfig } from "./renderSpan.js";

describe("spanFrameRange", () => {
  it("is the frames the seconds cover, to the end when --end is absent", () => {
    expect(spanFrameRange(0.5, 1.5, 30, 90)).toEqual({ startFrame: 15, endFrame: 45 });
    expect(spanFrameRange(1, undefined, 30, 90)).toEqual({ startFrame: 30, endFrame: 90 });
  });

  it("stops at the last frame of the film", () => {
    expect(spanFrameRange(2, 9, 30, 90)).toEqual({ startFrame: 60, endFrame: 90 });
  });

  it("refuses a range with no frame, naming how long the film is", () => {
    expect(() => spanFrameRange(3, 4, 30, 90)).toThrow(RenderSpanUnsupportedError);
    expect(() => spanFrameRange(3, 4, 30, 90)).toThrow("90 frames at 30 fps (3s)");
  });
});

describe("spanPlanConfig", () => {
  it("lifts the Lambda plan cap and the font guards, keeping the rest of the config", () => {
    const config: DistributedRenderConfig = {
      fps: 30,
      width: 320,
      height: 240,
      format: "mp4",
      planDirSizeLimitBytes: 1024,
      rejectOnSystemFonts: true,
    };
    expect(spanPlanConfig(config)).toMatchObject({
      fps: 30,
      width: 320,
      height: 240,
      format: "mp4",
      rejectOnSystemFonts: false,
      failClosedFontFetch: false,
      planDirSizeLimitBytes: Number.MAX_SAFE_INTEGER,
    });
  });
});
