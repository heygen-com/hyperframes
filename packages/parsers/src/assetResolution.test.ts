import { describe, expect, it } from "vitest";
import { maskNonScannableRanges } from "./assetResolution.js";

describe("maskNonScannableRanges", () => {
  it("masks complete comments without changing offsets", () => {
    const html = '<video src="before.mp4"><!-- <video src="hidden.mp4"> --><video src="after.mp4">';
    const masked = maskNonScannableRanges(html);

    expect(masked).toHaveLength(html.length);
    expect(masked).toContain('<video src="before.mp4">');
    expect(masked).not.toContain("hidden.mp4");
    expect(masked).toContain('<video src="after.mp4">');
  });

  it("handles many comment openers in linear scans", () => {
    const html = `prefix${"<!--".repeat(10_000)}-->suffix`;
    const masked = maskNonScannableRanges(html);

    expect(masked).toHaveLength(html.length);
    expect(masked).toBe(`prefix${" ".repeat(html.length - 12)}suffix`);
  });
});
