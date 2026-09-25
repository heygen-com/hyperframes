import { describe, expect, it } from "vitest";
import { cssColorAlpha, isTransparentColor } from "./visualPaint";

describe("cssColorAlpha", () => {
  it.each([
    ["transparent", 0],
    ["rgba(255, 255, 255, 0)", 0],
    ["rgb(255 255 255 / 0%)", 0],
    ["hsl(0 0% 100% / 25%)", 0.25],
    ["rgb(1, 2, 3)", 1],
    ["#fff", 1],
  ])("reads %s as alpha %s", (color, expected) => {
    expect(cssColorAlpha(color)).toBe(expected);
  });

  it("treats every zero-alpha functional colour as transparent", () => {
    expect(isTransparentColor("hsla(120, 50%, 50%, 0)")).toBe(true);
    expect(isTransparentColor("rgb(255 255 255 / 0.01)")).toBe(false);
  });
});
