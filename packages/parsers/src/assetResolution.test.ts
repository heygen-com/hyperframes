import { describe, expect, it } from "vitest";
import { isUnresolvedAssetPlaceholder, maskNonScannableRanges } from "./assetResolution.js";

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

describe("isUnresolvedAssetPlaceholder", () => {
  it("is true for __UPPER__ placeholders (raw or padded)", () => {
    for (const src of ["__DURATION__", "  __DURATION__  ", "__X__"]) {
      expect(isUnresolvedAssetPlaceholder(src)).toBe(true);
    }
  });

  it("is true for unresolved templating tokens, including ?/# inside ${...}", () => {
    for (const src of [
      "<<tts_x>>",
      "{{ videoUrl }}",
      "${audioUrl}",
      "${asset?.url}", // cleanAssetUrl would chop this to `${asset` — must match on the raw value
      "${a ?? b}",
      "${u}?v=1",
      "audio/${name}.mp3", // embedded token in an otherwise path-shaped value
    ]) {
      expect(isUnresolvedAssetPlaceholder(src)).toBe(true);
    }
  });

  it("is false for real paths and remote URLs (remote handling is left to each caller)", () => {
    for (const src of [
      "audio/clip.mp3",
      "clip.mp4?v=1",
      "https://cdn.example.com/a.mp3",
      "//host/a.png",
      "",
      "   ",
    ]) {
      expect(isUnresolvedAssetPlaceholder(src)).toBe(false);
    }
  });
});
