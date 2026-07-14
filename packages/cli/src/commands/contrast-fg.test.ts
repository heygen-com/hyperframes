import { describe, expect, it } from "vitest";
import { resolveForegroundColor } from "./contrast-fg.js";

describe("resolveForegroundColor", () => {
  it("uses `color` for ordinary HTML text", () => {
    expect(
      resolveForegroundColor({
        isSvgText: false,
        fill: "rgb(255, 255, 255)",
        color: "rgb(0, 0, 0)",
      }),
    ).toEqual([0, 0, 0, 1]);
  });

  it("uses `fill` for SVG text when fill is set but color is not (the reported bug)", () => {
    // fill: white on a dark bg, no `color` set — getComputedStyle(el).color
    // resolves to the inherited/initial black, which does not match what's
    // actually rendered. The audit must read `fill`, not `color`, here.
    expect(
      resolveForegroundColor({
        isSvgText: true,
        fill: "rgb(255, 255, 255)",
        color: "rgb(0, 0, 0)",
      }),
    ).toEqual([255, 255, 255, 1]);
  });

  it("preserves fill alpha", () => {
    expect(
      resolveForegroundColor({
        isSvgText: true,
        fill: "rgba(10, 20, 30, 0.5)",
        color: "rgb(0, 0, 0)",
      }),
    ).toEqual([10, 20, 30, 0.5]);
  });

  it("falls back to `color` when fill is 'none'", () => {
    expect(
      resolveForegroundColor({ isSvgText: true, fill: "none", color: "rgb(0, 255, 0)" }),
    ).toEqual([0, 255, 0, 1]);
  });

  it("falls back to `color` when fill is 'context-fill'", () => {
    expect(
      resolveForegroundColor({ isSvgText: true, fill: "context-fill", color: "rgb(0, 255, 0)" }),
    ).toEqual([0, 255, 0, 1]);
  });

  it("falls back to `color` when fill is a gradient/pattern reference", () => {
    expect(
      resolveForegroundColor({ isSvgText: true, fill: 'url("#grad")', color: "rgb(0, 255, 0)" }),
    ).toEqual([0, 255, 0, 1]);
  });

  it("never crashes on garbage fill values", () => {
    expect(() =>
      resolveForegroundColor({ isSvgText: true, fill: "currentcolor", color: "rgb(1, 2, 3)" }),
    ).not.toThrow();
  });
});
