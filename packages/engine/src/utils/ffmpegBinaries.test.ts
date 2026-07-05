// fallow-ignore-file code-duplication
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertConfiguredFfmpegBinariesExist,
  getFfmpegBinary,
  getFfprobeBinary,
  selectBinaryFromPathResults,
} from "./ffmpegBinaries.js";

describe("ffmpeg binary env resolution", () => {
  const originalFfmpegPath = process.env.HYPERFRAMES_FFMPEG_PATH;
  const originalFfprobePath = process.env.HYPERFRAMES_FFPROBE_PATH;

  afterEach(() => {
    if (originalFfmpegPath === undefined) delete process.env.HYPERFRAMES_FFMPEG_PATH;
    else process.env.HYPERFRAMES_FFMPEG_PATH = originalFfmpegPath;
    if (originalFfprobePath === undefined) delete process.env.HYPERFRAMES_FFPROBE_PATH;
    else process.env.HYPERFRAMES_FFPROBE_PATH = originalFfprobePath;
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
});

describe("selectBinaryFromPathResults", () => {
  it("on win32, prefers the .exe over a .cmd shim listed first (spawn EINVAL fix)", () => {
    // The exact reported layout: `where ffmpeg` lists a .cmd wrapper first.
    const out = "C:\\tools\\bin\\ffmpeg.cmd\r\nC:\\ffmpeg\\bin\\ffmpeg.exe\r\n";
    expect(selectBinaryFromPathResults(out, "win32")).toBe("C:\\ffmpeg\\bin\\ffmpeg.exe");
  });

  it("on win32, also skips a .bat shim in favor of a later .exe", () => {
    const out = "C:\\a\\ffmpeg.bat\nC:\\b\\ffmpeg.exe\n";
    expect(selectBinaryFromPathResults(out, "win32")).toBe("C:\\b\\ffmpeg.exe");
  });

  it("on win32, falls back to the first result when no .exe/.com is listed", () => {
    // No directly-spawnable exe present — keep prior behavior (don't drop it).
    const out = "C:\\tools\\bin\\ffmpeg.cmd\r\n";
    expect(selectBinaryFromPathResults(out, "win32")).toBe("C:\\tools\\bin\\ffmpeg.cmd");
  });

  it("on non-win32, returns the first result unchanged", () => {
    const out = "/usr/local/bin/ffmpeg\n/usr/bin/ffmpeg\n";
    expect(selectBinaryFromPathResults(out, "linux")).toBe("/usr/local/bin/ffmpeg");
  });

  it("returns undefined for empty output", () => {
    expect(selectBinaryFromPathResults("\r\n  \n", "win32")).toBeUndefined();
  });
});
