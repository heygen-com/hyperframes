import { describe, expect, it } from "vitest";
import {
  HTML_BODY_CSS_HEIGHT_FIRST_RE,
  HTML_BODY_CSS_WIDTH_FIRST_RE,
  VIEWPORT_META_SIZE_RE,
} from "./canvasScaffoldPatterns.js";

// Both callers key off group numbers: @hyperframes/lint's
// root_dimensions_mismatch reads the digits, @hyperframes/cli's
// applyResolutionPreset substitutes `$1<new>$3<new>` to keep the text around
// them. Pin the layout here so neither can renumber against the other.
const CASES = [
  {
    name: "HTML_BODY_CSS_WIDTH_FIRST_RE",
    re: HTML_BODY_CSS_WIDTH_FIRST_RE,
    source: "html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; }",
    digits: ["1920", "1080"],
    replacement: "$13840px$32160px",
    replaced: "html, body { margin: 0; width: 3840px; height: 2160px; overflow: hidden; }",
  },
  {
    name: "HTML_BODY_CSS_HEIGHT_FIRST_RE",
    re: HTML_BODY_CSS_HEIGHT_FIRST_RE,
    source: "html, body { margin: 0; height: 1080px; width: 1920px; overflow: hidden; }",
    digits: ["1080", "1920"],
    replacement: "$12160px$33840px",
    replaced: "html, body { margin: 0; height: 2160px; width: 3840px; overflow: hidden; }",
  },
  {
    name: "VIEWPORT_META_SIZE_RE",
    re: VIEWPORT_META_SIZE_RE,
    source: '<meta name="viewport" content="width=1920, height=1080" />',
    digits: ["1920", "1080"],
    replacement: "$13840$32160",
    replaced: '<meta name="viewport" content="width=3840, height=2160" />',
  },
];

describe("canvas scaffold patterns", () => {
  it.each(CASES)("$name exposes the two dimensions as groups 2 and 4", ({ re, source, digits }) => {
    const match = source.match(re);
    expect(match).not.toBeNull();
    expect(match?.slice(1)).toHaveLength(4);
    expect([match?.[2], match?.[4]]).toEqual(digits);
  });

  it.each(CASES)(
    "$name replaces both dimensions in place, leaving the rest untouched",
    ({ re, source, replacement, replaced }) => {
      expect(source.replace(re, replacement)).toBe(replaced);
    },
  );
});
