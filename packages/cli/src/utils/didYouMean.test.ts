import { describe, expect, it } from "vitest";
import { closestMatch } from "./didYouMean.js";

describe("closestMatch", () => {
  const commands = ["render", "preview", "publish", "lint", "check", "help"];

  it.each([
    ["rendr", "render"],
    ["previw", "preview"],
    ["pub", "publish"],
    ["chekc", "check"],
  ])("suggests %s -> %s", (input, expected) => {
    expect(closestMatch(input, commands)).toBe(expected);
  });

  it("suggests nothing when no candidate is close", () => {
    expect(closestMatch("zzzzzz", commands)).toBeUndefined();
    expect(closestMatch("x", commands)).toBeUndefined();
  });

  it("completes an abbreviated flag", () => {
    expect(closestMatch("out", ["output", "fps", "quality"])).toBe("output");
  });
});
