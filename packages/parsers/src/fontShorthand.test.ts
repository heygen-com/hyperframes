import { describe, expect, it } from "vitest";
import { fontShorthandFamilies, parseFontShorthand } from "./fontShorthand.js";

describe("parseFontShorthand", () => {
  it.each([
    ["16px Inter", "Inter"],
    ["16px/1.5 Inter, sans-serif", "Inter, sans-serif"],
    ["16px / 1.5 Inter", "Inter"],
    ["16px/ 1.5 Inter", "Inter"],
    ["16px /1.5 Inter", "Inter"],
    ["italic small-caps bold condensed 16px/2 'PingFang SC', serif", "'PingFang SC', serif"],
    ['500 16px/1 "PingFang SC", Inter, sans-serif', '"PingFang SC", Inter, sans-serif'],
    ["var(--weight) 16px Inter", "Inter"],
    ["var(--weight) calc(1rem + 2px) / var(--leading) Inter", "Inter"],
    ["oblique 10deg large Inter", "Inter"],
    ["16px var(--family)", "var(--family)"],
    ['700 var(--size)/1.1 "Inter"', '"Inter"'],
    ["var(--size) / 1.2 Inter, sans-serif", "Inter, sans-serif"],
  ])("reads %s as family list %s", (value, families) => {
    expect(parseFontShorthand(value)).toEqual({ families, certain: true });
  });

  it.each(["caption", "inherit", "16px", "16px / 1.5"])("finds no family in %s", (value) => {
    expect(parseFontShorthand(value)).toEqual({ families: "", certain: true });
  });

  it.each([
    ["var(--size) Inter", "Inter"],
    ["var(--weight) var(--size) Inter", "Inter"],
    ["Inter 16px", ""],
  ])("is unsure of %s, guessing %s", (value, families) => {
    expect(parseFontShorthand(value)).toEqual({ families, certain: false });
  });

  it("gives the renderer its best guess even when unsure", () => {
    expect(fontShorthandFamilies("var(--size) Inter, sans-serif")).toBe("Inter, sans-serif");
  });
});
