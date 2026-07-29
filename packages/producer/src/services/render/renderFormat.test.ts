import { describe, expect, it } from "bun:test";
import { outputNeedsAlpha } from "./renderFormat.js";

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
