import { describe, expect, it } from "vitest";
import { buildNpmCommand, buildNpxCommand } from "./npxCommand.js";

describe("buildNpxCommand", () => {
  it.each([
    ["linux", "npx", ["--version"]],
    ["darwin", "npx", ["--version"]],
    ["win32", "cmd.exe", ["/d", "/s", "/c", "npx.cmd", "--version"]],
  ] as const)("builds the %s npx invocation", (platform, expectedCommand, expectedArgs) => {
    expect(buildNpxCommand(["--version"], platform)).toEqual({
      command: expectedCommand,
      args: expectedArgs,
    });
  });

  it("builds for the host platform when none is given", () => {
    expect(buildNpxCommand(["--version"])).toEqual(
      buildNpxCommand(["--version"], process.platform),
    );
  });
});

describe("buildNpmCommand", () => {
  it.each([
    ["linux", "npm", ["--version"]],
    ["darwin", "npm", ["--version"]],
    ["win32", "cmd.exe", ["/d", "/s", "/c", "npm.cmd", "--version"]],
  ] as const)("builds the %s npm invocation", (platform, expectedCommand, expectedArgs) => {
    expect(buildNpmCommand(["--version"], platform)).toEqual({
      command: expectedCommand,
      args: expectedArgs,
    });
  });
});
