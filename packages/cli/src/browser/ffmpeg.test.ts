import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn(), execSync: vi.fn() }));
vi.mock("node:fs", () => ({ existsSync: vi.fn() }));

const mockExec = vi.mocked(execSync);
const mockExecFile = vi.mocked(execFileSync);
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
  it("prefers the real Windows exe when where lists a cmd shim first", async () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    mockExec.mockReturnValue("C:\\tools\\ffmpeg.cmd\r\nC:\\tools\\ffmpeg.exe\r\n");

    const { findFFmpeg } = await import("./ffmpeg.js");
    expect(findFFmpeg()).toBe(resolve("C:\\tools\\ffmpeg.exe"));
  });

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

describe("resolveH264EncoderMode", () => {
  it("falls back to VideoToolbox when libx264 is absent", async () => {
    const { resolveH264EncoderMode } = await import("./ffmpeg.js");
    const encoders = `
 V....D h264_videotoolbox    VideoToolbox H.264 Encoder
`;

    expect(resolveH264EncoderMode(encoders, false)).toBe("gpu");
  });

  it("does not treat a compiled Linux hardware encoder as usable", async () => {
    const { resolveH264EncoderMode } = await import("./ffmpeg.js");
    const encoders = `
 V....D h264_vaapi    H.264/AVC (VAAPI)
`;

    expect(() => resolveH264EncoderMode(encoders, false)).toThrow(
      "neither libx264 nor VideoToolbox",
    );
  });

  it("inspects the configured FFmpeg binary", async () => {
    mockExecFile.mockReturnValue(
      " V....D h264_videotoolbox    VideoToolbox H.264 Encoder\n" as never,
    );
    const { detectH264EncoderMode } = await import("./ffmpeg.js");

    expect(detectH264EncoderMode("/custom/ffmpeg", false)).toBe("gpu");
    expect(mockExecFile).toHaveBeenCalledWith(
      "/custom/ffmpeg",
      ["-hide_banner", "-encoders"],
      expect.objectContaining({ encoding: "utf-8" }),
    );
  });
});
