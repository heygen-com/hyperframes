import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ensureWhisper, findWhisper, WhisperUnavailableError } from "./manager.js";
const calls = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("node:child_process", () => ({ execFileSync: calls.exec }));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  platform: () => "darwin",
}));
afterEach(() => {
  vi.unstubAllEnvs();
  calls.exec.mockReset();
});
it("never installs when the runtime vanishes after discovery and installation is disabled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-missing-runtime-"));
  const binary = join(dir, "whisper-cli");
  writeFileSync(binary, "runtime");
  vi.stubEnv("HYPERFRAMES_WHISPER_PATH", binary);
  calls.exec.mockImplementation((command: string, args: string[]) => {
    if ((command === "which" || command === "where") && args[0] !== "whisper-cli")
      return `/bin/${args[0]}\n`;
    throw new Error("not available");
  });
  try {
    expect(findWhisper()?.executablePath).toBe(binary);
    rmSync(binary);
    await expect(ensureWhisper({ installRuntime: false })).rejects.toBeInstanceOf(
      WhisperUnavailableError,
    );
    expect(
      calls.exec.mock.calls.filter(
        ([command]) => command === "brew" || command === "git" || command === "cmake",
      ),
    ).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("clones whisper.cpp inside its build dir, with no cache path on the command line", async () => {
  const cache = mkdtempSync(join(tmpdir(), "hf-whisper-cache-"));
  vi.stubEnv("HYPERFRAMES_CACHE_DIR", cache);
  vi.resetModules();
  const { ensureWhisper: ensure, WhisperUnavailableError: Unavailable } =
    await import("./manager.js");
  calls.exec.mockImplementation((command: string, args: string[]) => {
    const lookup = command === "which" || command === "where";
    if (lookup && (args[0] === "brew" || args[0] === "whisper-cli"))
      throw new Error("not available");
    if (lookup) return `/bin/${args[0]}\n`;
    if (command === "git" && args[0] === "clone") throw new Error("stop after the clone");
    return "";
  });
  try {
    await expect(ensure()).rejects.toBeInstanceOf(Unavailable);
    const clone = calls.exec.mock.calls.find(([c, a]) => c === "git" && a[0] === "clone");
    const [, args, options] = clone as [string, string[], { cwd?: string }];
    expect(args.some((arg) => arg.includes(cache))).toBe(false);
    expect(options.cwd).toBe(join(cache, "whisper", "whisper.cpp"));
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});

it("builds only the reviewed whisper.cpp commit", async () => {
  const cache = mkdtempSync(join(tmpdir(), "hf-whisper-cache-"));
  vi.stubEnv("HYPERFRAMES_CACHE_DIR", cache);
  vi.resetModules();
  const { ensureWhisper: ensure } = await import("./manager.js");
  calls.exec.mockImplementation((command: string, args: string[]) => {
    const lookup = command === "which" || command === "where";
    if (lookup && (args[0] === "brew" || args[0] === "whisper-cli"))
      throw new Error("not available");
    if (lookup) return `/bin/${args[0]}\n`;
    if (command === "git" && args[0] === "rev-parse") return "0123456789abcdef\n";
    return "";
  });
  try {
    await expect(ensure()).rejects.toThrow();
    const clone = calls.exec.mock.calls.find(([c, a]) => c === "git" && a[0] === "clone");
    expect((clone as [string, string[]])[1]).toEqual(expect.arrayContaining(["--branch"]));
    expect(calls.exec.mock.calls.some(([command]) => command === "cmake")).toBe(false);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});

it("names the missing build tool when whisper.cpp cannot be built", async () => {
  vi.stubEnv("HYPERFRAMES_CACHE_DIR", mkdtempSync(join(tmpdir(), "hf-whisper-cache-")));
  vi.resetModules();
  const { ensureWhisper: ensure } = await import("./manager.js");
  calls.exec.mockImplementation((command: string, args: string[]) => {
    if ((command === "which" || command === "where") && args[0] !== "git")
      throw new Error("not available");
    return `/bin/${args[0]}\n`;
  });
  await expect(ensure()).rejects.toThrow(/cannot build whisper\.cpp: cmake not found on PATH/);
});

it("gives a Linux user one runnable line to get a working engine", async () => {
  vi.resetModules();
  vi.doMock("node:os", async (original) => ({
    ...(await original<typeof import("node:os")>()),
    platform: () => "linux",
  }));
  const { getInstallInstructions } = await import("./manager.js");
  expect(getInstallInstructions()).toContain("sudo apt-get install -y git cmake build-essential");
  vi.doUnmock("node:os");
});

it("gives a Windows user one runnable winget line, and finds a Release-built whisper-cli.exe", async () => {
  const cache = mkdtempSync(join(tmpdir(), "hf-whisper-cache-"));
  vi.stubEnv("HYPERFRAMES_CACHE_DIR", cache);
  vi.resetModules();
  vi.doMock("node:os", async (original) => ({
    ...(await original<typeof import("node:os")>()),
    platform: () => "win32",
  }));
  try {
    const { getInstallInstructions, findWhisper } = await import("./manager.js");
    expect(getInstallInstructions()).toContain("winget install -e --id Kitware.CMake");
    calls.exec.mockImplementation(() => {
      throw new Error("not available");
    });
    const exe = join(cache, "whisper", "whisper.cpp", "build", "bin", "Release", "whisper-cli.exe");
    mkdirSync(dirname(exe), { recursive: true });
    writeFileSync(exe, "binary");
    expect(findWhisper()?.executablePath).toBe(exe);
  } finally {
    vi.doUnmock("node:os");
    rmSync(cache, { recursive: true, force: true });
  }
});
