import { describe, expect, it } from "bun:test";
import { buildChunkCaptureOptions } from "./chunkFrames.js";

const input = {
  dimensions: { width: 320, height: 240, fpsNum: 30, fpsDen: 1, format: "mp4" as const },
  encoder: { quality: "standard" as const, deviceScaleFactor: 1, variables: undefined },
  videoCount: 0,
  html: "<html></html>",
};

describe("buildChunkCaptureOptions", () => {
  it("honors the explicit off value frozen by the planner", () => {
    expect(
      buildChunkCaptureOptions({
        ...input,
        encoder: { ...input.encoder, pageMotionBlur: "off" },
      }).pageMotionBlur,
    ).toBe("off");
  });

  it("leaves the composition's own data-motion-blur in charge when the planner froze no value", () => {
    expect(buildChunkCaptureOptions(input).pageMotionBlur).toBeUndefined();
  });

  it("asks for no engine motion blur either", () => {
    expect(buildChunkCaptureOptions(input).motionBlur).toBeUndefined();
  });
});
