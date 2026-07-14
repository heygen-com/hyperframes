import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { findFFmpeg, findFFprobe } from "./ffmpeg.js";

// Lookup mechanics (PATH scan, common-dir fallback, Windows shim preference)
// are covered by @hyperframes/parsers ffBinaries.test.ts. These tests pin the
// CLI wrapper's contract: a configured-but-missing override means "not found"
// so callers surface the install hint instead of a spawn error.
describe("findFFmpeg / findFFprobe", () => {
  afterEach(() => {
    delete process.env.HYPERFRAMES_FFMPEG_PATH;
    delete process.env.HYPERFRAMES_FFPROBE_PATH;
  });

  it("returns undefined when the env override points at a missing file", () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = join(tmpdir(), "missing-ffmpeg");
    process.env.HYPERFRAMES_FFPROBE_PATH = join(tmpdir(), "missing-ffprobe");

    expect(findFFmpeg()).toBeUndefined();
    expect(findFFprobe()).toBeUndefined();
  });

  it("returns the configured path when the env override exists", () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = process.execPath;

    expect(findFFmpeg()).toBe(process.execPath);
  });
});
