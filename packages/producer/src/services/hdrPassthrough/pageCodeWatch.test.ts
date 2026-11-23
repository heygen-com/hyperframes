import { describe, expect, it } from "bun:test";
import { findPageCodeInCoverage, type ScriptCoverageLike } from "./pageCodeWatch.js";
import type { ScriptOrigin } from "./scriptOrigins.js";

const script = (
  scriptId: string,
  url: string,
  ...counts: Array<[string, number]>
): ScriptCoverageLike => ({
  scriptId,
  url,
  functions: counts.map(([functionName, count]) => ({
    functionName,
    ranges: [{ count }],
  })),
});

/** Origins by script id; anything unlisted is the page's. */
const origins =
  (known: Record<string, ScriptOrigin>) =>
  async (scriptId: string): Promise<ScriptOrigin> =>
    known[scriptId] ?? "page";

describe("findPageCodeInCoverage", () => {
  it("is null when only the renderer and GSAP ran", async () => {
    expect(
      await findPageCodeInCoverage(
        [
          script("11", "hyperframes://injected/1", ["seekToTime", 30], ["flushAnimationFrame", 30]),
          script("13", "http://127.0.0.1:4100/assets/gsap.min.js", ["render", 90]),
          script("70", "pptr:evaluate;x", ["collectOverlayPageFingerprint", 90]),
          script("4", "", ["window.__hfMediaId", 90]),
          // Page functions that did not run.
          script("20", "hyperframes-composition://body", ["", 0], ["build", 0]),
        ],
        origins({ "11": "renderer", "13": "gsap", "70": "renderer", "4": "renderer" }),
      ),
    ).toBeNull();
  });

  it("goes by origin, not by URL", async () => {
    // A page script named like the renderer's or like GSAP, and an unnamed eval.
    const ran = [
      script("30", "hyperframes://injected/0", ["set", 3]),
      script("31", "http://127.0.0.1:4100/assets/gsap.min.js", ["set", 2]),
      script("32", "", ["", 1]),
    ];
    expect(await findPageCodeInCoverage(ran, origins({}))).toBe(
      "3 page function(s) ran after load, first set in hyperframes://injected/0",
    );
  });

  it("names a page setter the runtime assigns on every seek", async () => {
    expect(
      await findPageCodeInCoverage(
        [
          script("11", "hyperframes://injected/1", ["seekToTime", 90]),
          script("20", "hyperframes-composition://body", ["", 0], ["set", 90], ["apply", 90]),
        ],
        origins({ "11": "renderer" }),
      ),
    ).toBe("2 page function(s) ran after load, first set in hyperframes-composition://body");
  });

  it("names an unnamed function by its script id", async () => {
    expect(await findPageCodeInCoverage([script("42", "", ["", 1])], origins({}))).toBe(
      "1 page function(s) ran after load, first an anonymous function in script 42",
    );
  });

  it("only reads origins of scripts in which something ran", async () => {
    const asked: string[] = [];
    await findPageCodeInCoverage(
      [script("1", "a", ["f", 0]), script("2", "b", ["g", 1])],
      async (scriptId) => {
        asked.push(scriptId);
        return "renderer";
      },
    );
    expect(asked).toEqual(["2"]);
  });
});
