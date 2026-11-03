import { afterEach, expect, it, vi } from "vitest";

// Drives scheduleBackgroundInstall through the real installer detection, argv helper and installer
// script; only the entry path, the settings file and spawn itself are stubbed.
const BREW_ENTRY =
  "/opt/homebrew/Cellar/hyperframes/0.8.231/libexec/lib/node_modules/hyperframes/dist/cli.js";
const NPM_ENTRY = "/usr/local/lib/node_modules/hyperframes/dist/cli.js";

const originalArgv = [...process.argv];
const originalEnv = { ...process.env };
const originalTTY = process.stderr.isTTY;
const originalWrite = process.stderr.write.bind(process.stderr);

afterEach(() => {
  process.argv = [...originalArgv];
  process.env = { ...originalEnv };
  Object.defineProperty(process.stderr, "isTTY", { value: originalTTY, configurable: true });
  process.stderr.write = originalWrite;
  vi.resetModules();
  vi.doUnmock("../telemetry/config.js");
  vi.doUnmock("../version.js");
  vi.doUnmock("./env.js");
  vi.doUnmock("./attendedTerminal.js");
  vi.doUnmock("node:child_process");
  vi.doUnmock("node:fs");
});

/** A 0.8.231 install at `entry` whose cached latest is the allowed patch 0.8.232. */
async function patchAvailableAt(entry: string) {
  vi.resetModules();
  const config: Record<string, unknown> = { latestVersion: "0.8.232" };
  vi.doMock("../telemetry/config.js", () => ({
    readConfig: () => ({ ...config }),
    readConfigFresh: () => ({ ...config }),
    writeConfig: (next: Record<string, unknown>) => {
      for (const key of Object.keys(config)) delete config[key];
      Object.assign(config, next);
      return true;
    },
  }));
  vi.doMock("../version.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../version.js")>()),
    VERSION: "0.8.231",
  }));
  vi.doMock("./env.js", () => ({ isDevMode: () => false }));
  vi.doMock("./attendedTerminal.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./attendedTerminal.js")>()),
    isUnattended: () => false,
  }));
  const spawn = vi.fn((_bin: string, _args: readonly string[]) => ({ pid: 42, unref: () => {} }));
  vi.doMock("node:child_process", async (importOriginal) => ({
    ...(await importOriginal<typeof import("node:child_process")>()),
    spawn,
  }));
  vi.doMock("node:fs", async (importOriginal) => ({
    ...(await importOriginal<typeof import("node:fs")>()),
    mkdirSync: () => {},
    openSync: () => 99,
    appendFileSync: () => {},
  }));

  process.argv = [process.argv[0] ?? "node", entry];
  for (const name of ["CI", "HYPERFRAMES_NO_AUTO_INSTALL", "HYPERFRAMES_NO_UPDATE_CHECK"]) {
    delete process.env[name];
  }
  Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
  const stderr: string[] = [];
  process.stderr.write = ((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;

  const { scheduleBackgroundInstall } = await import("./autoUpdate.js");
  const { printUpdateNotice } = await import("./updateCheck.js");
  const scheduled = scheduleBackgroundInstall("0.8.232", "0.8.231");
  printUpdateNotice();
  return { scheduled, spawn, config, notice: stderr.join("") };
}

/** The bin and argv the spawned installer script would execFile. */
function installerArgv(spawn: { mock: { calls: [string, readonly string[]][] } }) {
  const script = spawn.mock.calls[0]?.[1][1] ?? "";
  const bin = /const BIN = (.*);/.exec(script)?.[1];
  const args = /const ARGS = (.*);/.exec(script)?.[1];
  return { bin: bin && JSON.parse(bin), args: args && JSON.parse(args) };
}

it("never launches an upgrade on Homebrew, whose upgrade cannot be held to the patch", async () => {
  const { scheduled, spawn, config, notice } = await patchAvailableAt(BREW_ENTRY);

  expect(scheduled).toBe(false);
  expect(spawn).not.toHaveBeenCalled();
  expect(config["pendingUpdate"]).toBeUndefined();
  expect(notice).toContain("Update available: 0.8.231 → 0.8.232");
  expect(notice).toContain("Run: brew upgrade hyperframes");
});

it("still installs an allowed patch on npm at that exact version", async () => {
  const { scheduled, spawn, notice } = await patchAvailableAt(NPM_ENTRY);

  expect(scheduled).toBe(true);
  expect(spawn).toHaveBeenCalledOnce();
  expect(installerArgv(spawn)).toEqual({
    bin: "npm",
    args: ["install", "-g", "hyperframes@0.8.232"],
  });
  expect(notice).toBe("");
});
