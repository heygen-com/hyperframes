import { describe, expect, it } from "vitest";
import { requiresEvenDimensions, withEvenDimensionPad } from "./evenDimensions.js";

describe("requiresEvenDimensions", () => {
  it("flags 4:2:0 subsampled formats", () => {
    expect(requiresEvenDimensions("yuv420p")).toBe(true);
    expect(requiresEvenDimensions("yuv420p10le")).toBe(true);
    expect(requiresEvenDimensions("yuvj420p")).toBe(true);
  });

  it("leaves 4:4:4 / alpha formats alone", () => {
    expect(requiresEvenDimensions("yuva444p10le")).toBe(false); // ProRes 4444
    expect(requiresEvenDimensions("yuva420p")).toBe(false); // VP9 alpha (own branch)
    expect(requiresEvenDimensions("rgb48le")).toBe(false);
  });
});

describe("withEvenDimensionPad", () => {
  it("appends the even-up pad for subsampled output (odd dims bumped to even)", () => {
    const vf = withEvenDimensionPad("scale=in_range=pc:out_range=tv", "yuv420p");
    expect(vf).toBe("scale=in_range=pc:out_range=tv,pad=ceil(iw/2)*2:ceil(ih/2)*2");
  });

  it("returns just the pad when there is no existing filter chain", () => {
    expect(withEvenDimensionPad("", "yuv420p")).toBe("pad=ceil(iw/2)*2:ceil(ih/2)*2");
  });

  it("omits the pad when known dimensions are already even", () => {
    expect(withEvenDimensionPad("", "yuv420p", 1920, 1080)).toBe("");
    expect(withEvenDimensionPad("scale=in_range=pc:out_range=tv", "yuv420p", 1920, 1080)).toBe(
      "scale=in_range=pc:out_range=tv",
    );
  });

  it("keeps the pad when either known dimension is odd", () => {
    expect(withEvenDimensionPad("", "yuv420p", 1921, 1080)).toBe("pad=ceil(iw/2)*2:ceil(ih/2)*2");
    expect(withEvenDimensionPad("", "yuv420p", 1920, 1081)).toBe("pad=ceil(iw/2)*2:ceil(ih/2)*2");
  });

  it("leaves the filter chain unchanged for alpha output (even in, unchanged)", () => {
    const vf = "scale=in_range=pc:out_range=tv";
    expect(withEvenDimensionPad(vf, "yuva444p10le")).toBe(vf);
  });

  it("pad rounds UP to even: ceil(n/2)*2 is a no-op for even and +1 for odd", () => {
    const evenUp = (n: number) => Math.ceil(n / 2) * 2;
    expect(evenUp(1080)).toBe(1080); // even in, unchanged
    expect(evenUp(723)).toBe(724); // odd in, bumped to even
    expect(evenUp(1)).toBe(2);
  });
});
