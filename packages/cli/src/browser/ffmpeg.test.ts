import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
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
});
