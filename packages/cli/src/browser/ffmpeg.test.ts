import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execSync: vi.fn() }));
vi.mock("node:fs", () => ({ existsSync: vi.fn() }));

const mockExec = vi.mocked(execSync);
const mockExists = vi.mocked(existsSync);

// The common-dir fallback list is platform-gated (empty on win32), so pin the
// platform to a POSIX value to keep the test deterministic on Windows CI.
const originalPlatform = process.platform;
beforeEach(() => {
  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  vi.resetModules();
});

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  vi.clearAllMocks();
  delete process.env.HYPERFRAMES_FFMPEG_PATH;
});

describe("findFFmpeg", () => {
  it("falls back to a common install dir when `which` fails (GUI-launched PATH)", async () => {
    // Simulate a process whose PATH lacks /opt/homebrew/bin: `which ffmpeg` throws.
    mockExec.mockImplementation(() => {
      throw new Error("which: no ffmpeg in PATH");
    });
    mockExists.mockImplementation((p) => p === "/opt/homebrew/bin/ffmpeg");

    const { findFFmpeg } = await import("./ffmpeg.js");
    expect(findFFmpeg()).toBe("/opt/homebrew/bin/ffmpeg");
  });

  it("returns undefined when ffmpeg is on neither PATH nor a common dir", async () => {
    mockExec.mockImplementation(() => {
      throw new Error("not found");
    });
    mockExists.mockReturnValue(false);

    const { findFFmpeg } = await import("./ffmpeg.js");
    expect(findFFmpeg()).toBeUndefined();
  });

  it("on win32, prefers ffmpeg.exe over a ffmpeg.cmd shim listed first", async () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    mockExec.mockReturnValue("C:\\tools\\bin\\ffmpeg.cmd\r\nC:\\ffmpeg\\bin\\ffmpeg.exe\r\n");

    const { findFFmpeg } = await import("./ffmpeg.js");
    expect(findFFmpeg()).toBe(resolve("C:\\ffmpeg\\bin\\ffmpeg.exe"));
  });

  it("on non-win32, returns the first ffmpeg path from which unchanged", async () => {
    mockExec.mockReturnValue("/usr/local/bin/ffmpeg\n/usr/bin/ffmpeg\n");

    const { findFFmpeg } = await import("./ffmpeg.js");
    expect(findFFmpeg()).toBe("/usr/local/bin/ffmpeg");
  });
});
