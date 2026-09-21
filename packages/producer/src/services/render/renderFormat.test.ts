import { describe, expect, it } from "bun:test";
import {
  outputNeedsAlpha,
  outputSupportsPageSideShaderCompositing,
  outputUsesH264Pipeline,
} from "./renderFormat.js";

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

  // Regression guard: `outputNeedsAlpha` used to be `format !== "mp4"`, so a
  // new opaque format defaults to alpha and silently flips HLS to RGBA PNG
  // screenshot capture — slower, and it disables BeginFrame. Nothing fails; the
  // render just takes the wrong path.
  it("keeps HLS on the opaque capture path", () => {
    expect(outputNeedsAlpha("hls")).toBe(false);
  });
});

describe("outputSupportsPageSideShaderCompositing", () => {
  it("supports opaque MP4 capture and RGBA GIF disk frames", () => {
    expect(outputSupportsPageSideShaderCompositing("mp4")).toBe(true);
    expect(outputSupportsPageSideShaderCompositing("gif")).toBe(true);
  });

  it("supports HLS, which captures exactly like mp4", () => {
    expect(outputSupportsPageSideShaderCompositing("hls")).toBe(true);
  });

  it("keeps the alpha video and PNG sequence formats on their existing paths", () => {
    expect(outputSupportsPageSideShaderCompositing("webm")).toBe(false);
    expect(outputSupportsPageSideShaderCompositing("mov")).toBe(false);
    expect(outputSupportsPageSideShaderCompositing("png-sequence")).toBe(false);
  });
});

describe("outputUsesH264Pipeline", () => {
  it("groups mp4 and hls, which share the encode and differ only in container", () => {
    expect(outputUsesH264Pipeline("mp4")).toBe(true);
    expect(outputUsesH264Pipeline("hls")).toBe(true);
  });

  it("excludes every format with its own encode path", () => {
    expect(outputUsesH264Pipeline("webm")).toBe(false);
    expect(outputUsesH264Pipeline("mov")).toBe(false);
    expect(outputUsesH264Pipeline("png-sequence")).toBe(false);
    expect(outputUsesH264Pipeline("gif")).toBe(false);
  });
});
