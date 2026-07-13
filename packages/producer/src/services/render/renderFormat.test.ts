import { describe, expect, it } from "bun:test";
import { outputNeedsAlpha } from "./renderFormat.js";

describe("outputNeedsAlpha", () => {
  it("preserves alpha for formats that can encode transparency", () => {
    expect(outputNeedsAlpha("gif")).toBe(true);
    expect(outputNeedsAlpha("webm")).toBe(true);
    expect(outputNeedsAlpha("mov")).toBe(true);
    expect(outputNeedsAlpha("png-sequence")).toBe(true);
  });

  it("uses opaque capture for mp4", () => {
    expect(outputNeedsAlpha("mp4")).toBe(false);
  });
});
