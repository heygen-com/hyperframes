import { execFileSync } from "node:child_process";
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

  // Runs a real npx, so only the dedicated shim job sets HF_NPX_SHIM_E2E; the general shards stay hermetic.
  it.runIf(process.env.HF_NPX_SHIM_E2E === "1")(
    "executes the host npx version check through the resolved command",
    () => {
      const npx = buildNpxCommand(["--version"]);
      const version = execFileSync(npx.command, npx.args, {
        encoding: "utf8",
        timeout: 30_000,
      }).trim();

      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    },
    60_000,
  );
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
