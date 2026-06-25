import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildNpxCommand } from "./npxCommand.js";

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

  it("executes the host npx version check through the resolved command", () => {
    const npx = buildNpxCommand(["--version"]);
    const version = execFileSync(npx.command, npx.args, {
      encoding: "utf8",
      timeout: 10_000,
    }).trim();

    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
