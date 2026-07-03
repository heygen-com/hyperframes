// fallow-ignore-file code-duplication
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertConfiguredFfmpegBinariesExist,
  findViaPathScan,
  getFfmpegBinary,
  getFfprobeBinary,
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

// Regression: findOnPath used to rely entirely on shelling out to
// `where`/`which`, so a restricted/sandboxed shell without that helper
// binary made a genuinely-on-PATH ffmpeg/ffprobe look unresolvable, even
// though a pure PATH-directory scan would have found it fine. findViaPathScan
// is the fallback that needs no external helper process — tested directly
// (bypassing findOnPath's module-level cache and the real `where`/`which`
// call) with a real fake binary on a controlled PATH.
describe("findViaPathScan", () => {
  it("finds a binary that exists in a PATH directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "ffmpeg-path-scan-"));
    const fakeFfmpeg = join(dir, "ffmpeg");
    writeFileSync(fakeFfmpeg, "#!/bin/sh\necho fake\n");
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = dir;
      expect(findViaPathScan("ffmpeg")).toBe(fakeFfmpeg);
    } finally {
      process.env.PATH = originalPath;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns undefined when the binary is not on any PATH directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "ffmpeg-path-scan-empty-"));
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = dir;
      expect(findViaPathScan("ffmpeg")).toBeUndefined();
    } finally {
      process.env.PATH = originalPath;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("checks multiple PATH directories in order", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "ffmpeg-path-scan-a-"));
    const realDir = mkdtempSync(join(tmpdir(), "ffmpeg-path-scan-b-"));
    const fakeFfprobe = join(realDir, "ffprobe");
    writeFileSync(fakeFfprobe, "#!/bin/sh\necho fake\n");
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = [emptyDir, realDir].join(delimiter);
      expect(findViaPathScan("ffprobe")).toBe(fakeFfprobe);
    } finally {
      process.env.PATH = originalPath;
      rmSync(emptyDir, { recursive: true, force: true });
      rmSync(realDir, { recursive: true, force: true });
    }
  });
});
