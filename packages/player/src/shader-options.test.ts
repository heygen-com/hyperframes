import { describe, expect, it } from "vitest";
import { getShaderModeFromElement, SHADER_LOADING_ATTR } from "./shader-options.js";

const modeOf = (value: string | null) => {
  const el = document.createElement("div");
  if (value !== null) el.setAttribute(SHADER_LOADING_ATTR, value);
  return getShaderModeFromElement(el);
};

describe("getShaderModeFromElement", () => {
  it.each([
    [null, "composition"],
    ["", "composition"],
    ["  ", "composition"],
    ["none", "none"],
    [" OFF ", "none"],
    ["false", "none"],
    ["0", "none"],
    ["player", "player"],
    ["True", "player"],
    ["1", "player"],
    ["on", "player"],
    ["composition", "composition"],
    ["sometimes", "composition"],
    ["constructor", "composition"],
    ["__proto__", "composition"],
  ])("reads %j as %s", (value, mode) => {
    expect(modeOf(value)).toBe(mode);
  });
});
