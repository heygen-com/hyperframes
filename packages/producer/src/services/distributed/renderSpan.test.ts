import { describe, expect, it } from "bun:test";
import { RenderSpanUnsupportedError, spanFrameRange } from "./renderSpan.js";

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
