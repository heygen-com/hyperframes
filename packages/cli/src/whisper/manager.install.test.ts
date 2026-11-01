import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    if (command === "which" && args[0] === "brew") throw new Error("not available");
    if (command === "which" && args[0] === "whisper-cli") throw new Error("not available");
    if (command === "which" || command === "where") return `/bin/${args[0]}\n`;
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
