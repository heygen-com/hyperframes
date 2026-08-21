import { resolve } from "node:path";
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

  it("calls out a mangled replacement character in configured binary paths", () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = "/missing/ffmpeg�.exe";

    expect(() => assertConfiguredFfmpegBinariesExist()).toThrow(/replacement character|mangled/i);
  });
});
