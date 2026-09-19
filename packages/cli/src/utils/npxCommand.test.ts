import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
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

  // Runs the built command for real against a stub `npx` placed first on PATH, so the
  // cmd.exe -> npx.cmd resolution is exercised without the host's npx or the network.
  it("resolves and runs the npx shim through the built command", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-npx-stub-"));
    try {
      if (process.platform === "win32") {
        writeFileSync(join(dir, "npx.cmd"), "@echo 9.9.9\r\n");
      } else {
        writeFileSync(join(dir, "npx"), "#!/bin/sh\necho 9.9.9\n", { mode: 0o755 });
      }
      const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === "path") ?? "PATH";
      const npx = buildNpxCommand(["--version"]);
      const out = execFileSync(npx.command, npx.args, {
        encoding: "utf8",
        timeout: 15_000,
        env: { ...process.env, [pathKey]: `${dir}${delimiter}${process.env[pathKey] ?? ""}` },
      });
      expect(out.trim()).toBe("9.9.9");
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
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
