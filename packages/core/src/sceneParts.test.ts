import { describe, expect, it } from "vitest";
import { fontFaceBlocks } from "./sceneParts";

describe("fontFaceBlocks", () => {
  it("lists each @font-face rule", () => {
    const css = "@font-face{a:1}.x{}@FONT-FACE {b:2} @font-face x{}";
    expect(fontFaceBlocks(css)).toEqual(["@font-face{a:1}", "@FONT-FACE {b:2}"]);
  });

  it("reads 400 KB of unclosed rules in well under a second", () => {
    const css = "@font-face{".repeat(36_000);
    const started = performance.now();
    expect(fontFaceBlocks(css)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
