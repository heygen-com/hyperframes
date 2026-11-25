import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  matchHtmlBodyCssHeightFirst,
  matchHtmlBodyCssWidthFirst,
  matchViewportMetaSize,
  replaceCanvasScaffoldSize,
} from "./canvasScaffoldPatterns.js";

const CASES = [
  {
    match: matchHtmlBodyCssWidthFirst,
    source: "html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; }",
    digits: ["1920", "1080"],
    target: [3840, 2160],
    result: "html, body { margin: 0; width: 3840px; height: 2160px; overflow: hidden; }",
  },
  {
    match: matchHtmlBodyCssHeightFirst,
    source: "html, body { margin: 0; height: 1080px; width: 1920px; overflow: hidden; }",
    digits: ["1080", "1920"],
    target: [2160, 3840],
    result: "html, body { margin: 0; height: 2160px; width: 3840px; overflow: hidden; }",
  },
  {
    match: matchViewportMetaSize,
    source: '<meta name="viewport" content="width=1920, height=1080" />',
    digits: ["1920", "1080"],
    target: [3840, 2160],
    result: '<meta name="viewport" content="width=3840, height=2160" />',
  },
];

describe("canvas scaffold extraction", () => {
  it.each(CASES)(
    "reads and replaces dimensions in $source",
    ({ match, source, digits, target, result }) => {
      const found = match(source);
      expect(found).not.toBeNull();
      expect([found?.[2], found?.[4]]).toEqual(digits);
      if (found)
        expect(replaceCanvasScaffoldSize(source, found, target[0], target[1])).toBe(result);
    },
  );
  it("preserves case, offsets and surrounding text", () => {
    const source = "before} HTML , BODY { WIDTH: 10PX; HEIGHT: 20PX;}after";
    const found = matchHtmlBodyCssWidthFirst(source);
    expect(found).not.toBeNull();
    if (found)
      expect(replaceCanvasScaffoldSize(source, found, 30, 40)).toBe(
        "before} HTML , BODY { WIDTH: 30PX; HEIGHT: 40PX;}after",
      );
  });
  it("does not join dimensions across braces or tags", () => {
    expect(matchHtmlBodyCssWidthFirst("html,body{width:1px}height:2px")).toBeNull();
    expect(
      matchViewportMetaSize('<meta name="viewport"><meta content="width=1,height=2">'),
    ).toBeNull();
  });
  it("finds a later complete block after an incomplete block", () => {
    const found = matchHtmlBodyCssWidthFirst("html,body{width:1px}html,body{width:3px;height:4px}");
    expect([found?.[2], found?.[4]]).toEqual(["3", "4"]);
  });
  it.each(["width", "height", "viewport"])(
    "bounds malformed %s input in a killable process",
    (kind) => {
      // A separate process guarantees a regression cannot hang the test runner.
      const modulePath = resolve(__dirname, "canvasScaffoldPatterns.ts");
      const result = spawnSync(
        "bun",
        [
          "--eval",
          `
      const m = await import(${JSON.stringify(modulePath)});
      const kind = ${JSON.stringify(kind)};
      const source = kind === 'viewport'
        ? ('<meta name="viewport" '.repeat(30000) + 'content="width=1,height=x')
        : ('html,body{'.repeat(30000) + (kind + ':1px;').repeat(30000));
      const match = kind === 'viewport' ? m.matchViewportMetaSize
        : kind === 'width' ? m.matchHtmlBodyCssWidthFirst : m.matchHtmlBodyCssHeightFirst;
      if (match(source) !== null) process.exit(2);
    `,
        ],
        { timeout: 2000, encoding: "utf8" },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
    },
  );
});
