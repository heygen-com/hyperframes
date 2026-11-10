import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closestMatch, fileHint, REDIRECTS_WITH_NEXT_STEP, redirectLine } from "./didYouMean.js";

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

  it("names them for a path that does not exist yet too", () => {
    expect(fileHint("clips/no-such-file.mp4", ["measure"], ops)).toBe(
      "'clips/no-such-file.mp4' looks like a file; name a command first: 'hyperframes measure <probe|cuts> clips/no-such-file.mp4'.",
    );
  });

  it("stays quiet at the root, for a plain word, and for a group with no commands", () => {
    expect(fileHint("package.json", [], ops)).toBeUndefined();
    expect(fileHint("prbe", ["measure"], ops)).toBeUndefined();
    expect(fileHint("package.json", ["measure"], [])).toBeUndefined();
  });
});

describe("redirectLine", () => {
  it("is the line the hyperframes-cli skill carries for every redirect with a next step", () => {
    const skill = readFileSync(
      new URL("../../../../skills/hyperframes-cli/SKILL.md", import.meta.url),
      "utf8",
    );
    expect(REDIRECTS_WITH_NEXT_STEP).toContain("captions");
    for (const word of REDIRECTS_WITH_NEXT_STEP) {
      const line = redirectLine(word);
      expect(skill).toContain(line);
      const guide = /\.\.\/\S+\.md/.exec(line)?.[0] ?? "";
      const skillDir = dirname(
        fileURLToPath(new URL("../../../../skills/hyperframes-cli/SKILL.md", import.meta.url)),
      );
      expect(existsSync(resolve(skillDir, guide)), `${word} points at ${guide}`).toBe(true);
    }
  });
});
