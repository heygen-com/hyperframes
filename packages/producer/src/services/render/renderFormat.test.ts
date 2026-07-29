import { describe, expect, it } from "bun:test";
import { outputNeedsAlpha, outputSupportsPageSideShaderCompositing } from "./renderFormat.js";

describe("outputNeedsAlpha", () => {
  it("uses alpha-aware capture for transparent-capable formats", () => {
    expect(outputNeedsAlpha("gif")).toBe(true);
    expect(outputNeedsAlpha("webm")).toBe(true);
    expect(outputNeedsAlpha("mov")).toBe(true);
    expect(outputNeedsAlpha("png-sequence")).toBe(true);
  });

  it("preserves opaque capture for mp4", () => {
    expect(outputNeedsAlpha("mp4")).toBe(false);
  });
});

describe("outputSupportsPageSideShaderCompositing", () => {
  it("supports opaque MP4 capture and RGBA GIF disk frames", () => {
    expect(outputSupportsPageSideShaderCompositing("mp4")).toBe(true);
    expect(outputSupportsPageSideShaderCompositing("gif")).toBe(true);
  });

  it("keeps the alpha video and PNG sequence formats on their existing paths", () => {
    expect(outputSupportsPageSideShaderCompositing("webm")).toBe(false);
    expect(outputSupportsPageSideShaderCompositing("mov")).toBe(false);
    expect(outputSupportsPageSideShaderCompositing("png-sequence")).toBe(false);
  });
});
