import { describe, expect, it } from "bun:test";
import { findPageCodeInCoverage, isPageScript, type ScriptCoverageLike } from "./pageCodeWatch.js";

const script = (url: string, ...counts: Array<[string, number]>): ScriptCoverageLike => ({
  url,
  functions: counts.map(([functionName, count]) => ({
    functionName,
    ranges: [{ count }],
  })),
});

describe("isPageScript", () => {
  it.each([
    "hyperframes://injected/0",
    "hyperframes://after-fonts-fallback",
    "pptr:evaluate;file%3A%2F%2F%2Fsrc%2Fx.ts",
    "",
    "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js",
    "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/CustomEase.min.js",
    "http://127.0.0.1:4100/node_modules/gsap/dist/gsap.js",
    "http://127.0.0.1:4100/assets/gsap.min.js",
    "http://127.0.0.1:4100/gsap-core.js?v=3",
  ])("leaves out the renderer's and GSAP's %s", (url) => {
    expect(isPageScript(url)).toBe(false);
  });

  it.each([
    "hyperframes-composition://body",
    "http://127.0.0.1:4100/index.html",
    "http://127.0.0.1:4100/assets/app.js",
    "http://127.0.0.1:4100/assets/my-gsap.min.js",
    "http://127.0.0.1:4100/assets/gsap-setup.js",
    "https://cdn.jsdelivr.net/npm/lottie-web@5/build/player/lottie.min.js",
  ])("counts %s as the page's", (url) => {
    expect(isPageScript(url)).toBe(true);
  });
});

describe("findPageCodeInCoverage", () => {
  it("is null when only the renderer and GSAP ran", () => {
    expect(
      findPageCodeInCoverage([
        script("hyperframes://injected/1", ["seekToTime", 30], ["flushAnimationFrame", 30]),
        script("http://127.0.0.1:4100/assets/gsap.min.js", ["render", 90]),
        script("pptr:evaluate;x", ["collectOverlayPageFingerprint", 90]),
        // Page functions that did not run on a seek.
        script("hyperframes-composition://body", ["", 0], ["build", 0]),
      ]),
    ).toBeNull();
  });

  it("names a page setter the runtime assigns on every seek", () => {
    expect(
      findPageCodeInCoverage([
        script("hyperframes://injected/1", ["seekToTime", 90]),
        script("hyperframes-composition://body", ["", 0], ["set", 90], ["apply", 90]),
      ]),
    ).toBe("2 page function(s) ran on seeks, first set in hyperframes-composition://body");
  });

  it("names an anonymous function by its script", () => {
    expect(findPageCodeInCoverage([script("http://127.0.0.1:4100/assets/app.js", ["", 1])])).toBe(
      "1 page function(s) ran on seeks, first an anonymous function in http://127.0.0.1:4100/assets/app.js",
    );
  });
});
