import { describe, expect, it } from "vitest";
import { closestMatch, fileHint } from "./didYouMean.js";

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

describe("fileHint", () => {
  const ops = ["probe", "cuts"];

  it("names the commands to put before a file given to a group", () => {
    expect(fileHint("package.json", ["measure"], ops)).toBe(
      "'package.json' is a file; name a command first: 'hyperframes measure <probe|cuts> package.json'.",
    );
  });

  it("stays quiet at the root, for a missing file, and for a group with no commands", () => {
    expect(fileHint("package.json", [], ops)).toBeUndefined();
    expect(fileHint("no-such-file.mp4", ["measure"], ops)).toBeUndefined();
    expect(fileHint("package.json", ["measure"], [])).toBeUndefined();
  });
});
