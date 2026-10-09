import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { buildWaveformCacheKey, decodeAudioPeaks } from "./waveform.js";

describe("buildWaveformCacheKey", () => {
  it("is stable for the same file", () => {
    const a = buildWaveformCacheKey("assets/music-bed.m4a", { size: 4187869, mtimeMs: 1000 });
    const b = buildWaveformCacheKey("assets/music-bed.m4a", { size: 4187869, mtimeMs: 1000 });
    expect(a).toBe(b);
  });

  it("changes when the file behind the path is replaced", () => {
    // The case this exists for: an asset rebuilt in place — same name, new
    // content. Keyed on the path alone the cache served the old peaks forever,
    // so a bed whose ducking had just been removed still drew as ducked.
    const before = buildWaveformCacheKey("assets/music-bed.m4a", { size: 4187869, mtimeMs: 1000 });
    const after = buildWaveformCacheKey("assets/music-bed.m4a", { size: 3900000, mtimeMs: 2000 });
    expect(after).not.toBe(before);
  });

  it("separates two files of the same size edited at different times, and vice versa", () => {
    const base = { size: 100, mtimeMs: 1000 };
    expect(buildWaveformCacheKey("a.m4a", base)).not.toBe(
      buildWaveformCacheKey("a.m4a", { ...base, mtimeMs: 1001 }),
    );
    expect(buildWaveformCacheKey("a.m4a", base)).not.toBe(
      buildWaveformCacheKey("a.m4a", { ...base, size: 101 }),
    );
  });

  it("keeps distinct assets apart and stays a plain filename", () => {
    const fp = { size: 10, mtimeMs: 5 };
    expect(buildWaveformCacheKey("a/b.m4a", fp)).not.toBe(buildWaveformCacheKey("a/c.m4a", fp));
    expect(buildWaveformCacheKey("a/b.m4a", fp)).not.toMatch(/[/\\]/);
    expect(buildWaveformCacheKey("a/b.m4a", fp)).toMatch(/\.json$/);
  });
});

describe("decodeAudioPeaks on a video file", () => {
  const ffmpeg = findFfBinary("ffmpeg");
  it.skipIf(!ffmpeg)("reads the audio track of an .mp4", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-wave-video-"));
    const file = join(dir, "talk.mp4");
    try {
      execFileSync(ffmpeg ?? "ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=32x32:d=1",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1",
        "-shortest",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        file,
      ]);
      const peaks = await decodeAudioPeaks(file);
      expect(peaks.length).toBeGreaterThan(0);
      expect(Math.max(...peaks)).toBeCloseTo(1, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
