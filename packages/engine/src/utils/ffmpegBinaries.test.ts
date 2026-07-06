// fallow-ignore-file code-duplication
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertConfiguredFfmpegBinariesExist,
  getFfmpegBinary,
  getFfprobeBinary,
} from "./ffmpegBinaries.js";

describe("ffmpeg binary env resolution", () => {
  const originalFfmpegPath = process.env.HYPERFRAMES_FFMPEG_PATH;
  const originalFfprobePath = process.env.HYPERFRAMES_FFPROBE_PATH;
  const originalPath = process.env.PATH;

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("child_process");
    if (originalFfmpegPath === undefined) delete process.env.HYPERFRAMES_FFMPEG_PATH;
    else process.env.HYPERFRAMES_FFMPEG_PATH = originalFfmpegPath;
    if (originalFfprobePath === undefined) delete process.env.HYPERFRAMES_FFPROBE_PATH;
    else process.env.HYPERFRAMES_FFPROBE_PATH = originalFfprobePath;
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  });

  it("uses configured absolute paths when env vars are set", () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = "/tools/ffmpeg.exe";
    process.env.HYPERFRAMES_FFPROBE_PATH = "/tools/ffprobe.exe";

    expect(getFfmpegBinary()).toBe(resolve("/tools/ffmpeg.exe"));
    expect(getFfprobeBinary()).toBe(resolve("/tools/ffprobe.exe"));
  });

  it("throws a clear error when a configured FFmpeg path is missing", () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = "/missing/ffmpeg.exe";

    expect(() => assertConfiguredFfmpegBinariesExist()).toThrow(
      /FFmpeg binary not found at HYPERFRAMES_FFMPEG_PATH/,
    );
  });

  it("accepts existing configured paths", () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = process.execPath;
    process.env.HYPERFRAMES_FFPROBE_PATH = process.execPath;

    expect(() => assertConfiguredFfmpegBinariesExist()).not.toThrow();
  });

  it("prefers the real Windows exe when PATH lookup lists a cmd shim first", async () => {
    vi.resetModules();
    vi.doMock("child_process", () => ({
      execFileSync: () => "C:\\tools\\ffmpeg.cmd\r\nC:\\tools\\ffmpeg.exe\r\n",
    }));

    const { getFfmpegBinary: getMockedFfmpegBinary } = await import("./ffmpegBinaries.js");

    expect(getMockedFfmpegBinary()).toBe(resolve("C:\\tools\\ffmpeg.exe"));
  });

  it("falls back to scanning PATH when which/where fails", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "hyperframes-ffmpeg-path-"));
    const ffmpegPath = join(binDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    const execFileSync = vi.fn(() => {
      throw new Error("lookup command failed");
    });
    writeFileSync(ffmpegPath, "#!/bin/sh\n");
    chmodSync(ffmpegPath, 0o755);
    process.env.PATH = binDir;
    vi.resetModules();
    vi.doMock("child_process", () => ({ execFileSync }));

    try {
      const { getFfmpegBinary: getMockedFfmpegBinary } = await import("./ffmpegBinaries.js");

      expect(getMockedFfmpegBinary()).toBe(resolve(ffmpegPath));
      expect(execFileSync).toHaveBeenCalledOnce();
    } finally {
      rmSync(binDir, { force: true, recursive: true });
    }
  });

  it("calls out a mangled replacement character in configured binary paths", () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = "/missing/ffmpeg�.exe";

    expect(() => assertConfiguredFfmpegBinariesExist()).toThrow(/replacement character|mangled/i);
  });
});
