import { describe, expect, it } from "vitest";
import {
  detectAncestorBackgroundImage,
  extractFontFaceBlocks,
  localizeRemoteBackgroundImages,
  localizeRemoteFontFaces,
} from "./htmlCompiler.js";

describe("remote CSS asset discovery", () => {
  it("scans 200 KB of unclosed background urls in well under a second", async () => {
    const html = "background:url(http://".repeat(Math.floor(200_000 / 22));
    const started = performance.now();
    const result = await localizeRemoteBackgroundImages(html, "/nonexistent-download-dir");
    expect(result.html).toBe(html);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("scans 400 KB of unclosed style tags for font faces in well under a second", async () => {
    const html = "<style".repeat(Math.floor(400_000 / 6));
    const started = performance.now();
    const result = await localizeRemoteFontFaces(html, "/nonexistent-download-dir");
    expect(result.html).toBe(html);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("scans 400 KB of unclosed link tags in well under a second", async () => {
    const html = "<link ".repeat(Math.floor(400_000 / 6));
    const started = performance.now();
    expect((await localizeRemoteFontFaces(html, "/nonexistent-download-dir")).html).toBe(html);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("reads 400 KB of style text with no rule in well under a second", () => {
    const css = "a".repeat(400_000);
    const html = `<html><head><style>${css}</style></head><body><div data-composition-id="r"></div></body></html>`;
    const started = performance.now();
    expect(detectAncestorBackgroundImage(html)).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

/** The depth-counting extraction the linear one replaces. */
function rescanningFontFaceBlocks(css: string): string[] {
  const blocks: string[] = [];
  const atRule = /@font-face\s*/gi;
  for (let m = atRule.exec(css); m; m = atRule.exec(css)) {
    const openIdx = css.indexOf("{", m.index + m[0].length);
    if (openIdx === -1) break;
    let depth = 1;
    let i = openIdx + 1;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    if (depth === 0) {
      blocks.push(css.slice(m.index, i));
      atRule.lastIndex = i;
    }
  }
  return blocks;
}

const PIECES = [
  "@font-face",
  "@FONT-FACE ",
  "@font-face{",
  "{",
  "}",
  " ",
  "\n",
  "a",
  "src:url(x)",
  ";",
];

describe("@font-face block extraction", () => {
  it("returns what the depth-counting extraction returned on 20,000 generated sheets", () => {
    let seed = 5;
    const next = (n: number) =>
      Math.floor(((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * n);
    const differences: string[] = [];
    for (let run = 0; run < 20_000; run++) {
      const css = Array.from({ length: 1 + next(24) }, () => PIECES[next(PIECES.length)]).join("");
      if (
        JSON.stringify(extractFontFaceBlocks(css)) !== JSON.stringify(rescanningFontFaceBlocks(css))
      )
        differences.push(css);
    }
    expect(differences).toEqual([]);
  });

  it("reads 400 KB of unclosed rules in well under a second", () => {
    const css = "@font-face{".repeat(36_000);
    const started = performance.now();
    expect(extractFontFaceBlocks(css)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
