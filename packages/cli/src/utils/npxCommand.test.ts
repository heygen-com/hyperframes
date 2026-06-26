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

  // Real npx cold-start on Windows CI routinely exceeds vitest's 5s default,
  // making this smoke test flaky. Give it generous headroom (it still asserts
  // a real version string, so it isn't reduced to a tautology by mocking).
  it("executes the host npx version check through the resolved command", () => {
    const npx = buildNpxCommand(["--version"]);
    const version = execFileSync(npx.command, npx.args, {
      encoding: "utf8",
      timeout: 30_000,
    }).trim();

    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  }, 60_000);
});
