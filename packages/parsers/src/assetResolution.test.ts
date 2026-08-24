import { describe, expect, it } from "vitest";
import {
  collectSubCompositionSrcs,
  isUnresolvedAssetPlaceholder,
  maskNonScannableRanges,
} from "./assetResolution.js";

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

describe("collectSubCompositionSrcs", () => {
  it("finds mounts inside a template, which a DOM query cannot see", () => {
    const html =
      '<!doctype html><html><body><div data-composition-src="compositions/a.html"></div>' +
      '<template id="t"><div data-composition-src="compositions/b.html"></div></template></body></html>';
    expect(collectSubCompositionSrcs(html)).toEqual(["compositions/a.html", "compositions/b.html"]);
  });

  it("skips commented-out, scripted, and styled mounts", () => {
    const html =
      '<!-- <div data-composition-src="commented.html"></div> -->' +
      "<script>const s = '<div data-composition-src=\"scripted.html\"></div>';</script>" +
      '<style>/* <div data-composition-src="styled.html"></div> */</style>' +
      '<div data-composition-src="real.html"></div>';
    expect(collectSubCompositionSrcs(html)).toEqual(["real.html"]);
  });

  it("skips build-time placeholders and dedupes repeats", () => {
    const html =
      '<div data-composition-src="__SCENE__"></div>' +
      '<div data-composition-src="{{scene}}"></div>' +
      '<div data-composition-src="a.html"></div><div data-composition-src="a.html"></div>';
    expect(collectSubCompositionSrcs(html)).toEqual(["a.html"]);
  });

  // A remote mount names no file on disk, and every caller resolves what comes
  // back against the project root. Letting one through yields a nonsense path
  // (`<projectDir>/https:/host/a.html`): a false "does not exist" for lint, and
  // a wasted slot against the telemetry walk's file budget.
  it("drops remote and inline mounts, keeping local ones", () => {
    const html =
      '<div data-composition-src="https://host/remote.html"></div>' +
      '<div data-composition-src="//host/protocol-relative.html"></div>' +
      '<div data-composition-src="data:text/html,inline"></div>' +
      '<div data-composition-src="compositions/local.html"></div>';
    expect(collectSubCompositionSrcs(html)).toEqual(["compositions/local.html"]);
  });

  it("ignores an unterminated final tag and an attribute outside any tag", () => {
    expect(collectSubCompositionSrcs('<div data-composition-src="a.html"')).toEqual([]);
    expect(collectSubCompositionSrcs('data-composition-src="a.html"')).toEqual([]);
  });

  // Regression guard, and it needs no timing assertion to bite: the previous
  // whole-file regex had two open-ended `[^>]*` spans, which is quadratic on
  // input full of `<` with no `>`. At 1MB that ran for minutes, so this case
  // failed on the suite timeout. This scan walks tag by tag and is linear.
  // The function is on the render-plan path, so a truncated download or a blob
  // of stray `<` must not be able to hang a render before it starts.
  it("stays fast on a megabyte of unterminated tag openings", () => {
    expect(collectSubCompositionSrcs("<".repeat(1024 * 1024))).toEqual([]);
  });
});
