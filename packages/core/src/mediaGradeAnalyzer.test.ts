// @vitest-environment node

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { analyzeMediaGrade, gradeSampleTimes } from "./mediaGradeAnalyzer";

const dir = mkdtempSync(join(tmpdir(), "grade-analyzer-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let clip: string | undefined;

// Two minutes of 10-bit HLG HEVC: black for the first half, white for the second.
function makeLongHlgClip(): string {
  if (clip) return clip;
  const out = join(dir, "hlg.mp4");
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=128x128:r=2:d=120,drawbox=c=white:t=fill:enable='gte(t,60)'",
      "-c:v",
      "libx265",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p10le",
      "-x265-params",
      "log-level=error:keyint=4:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc",
      "-color_primaries",
      "bt2020",
      "-color_trc",
      "arib-std-b67",
      "-colorspace",
      "bt2020nc",
      "-y",
      out,
    ],
    { stdio: "pipe" },
  );
  clip = out;
  return out;
}

describe("analyzeMediaGrade", () => {
  it("samples across the whole length of a long 10-bit HLG clip", () => {
    const result = analyzeMediaGrade(makeLongHlgClip());

    expect(result.source).toMatchObject({
      transfer: "arib-std-b67",
      pixelFormat: "yuv420p10le",
      hdr: true,
    });
    expect(result.measured.frames).toBe(5);
    // Samples from both halves: a black minimum and a white maximum.
    expect(result.measured.yMin).toBeLessThan(40);
    expect(result.measured.yMax).toBeGreaterThan(200);
  });

  it("names the sample and the limit when a frame decode times out", () => {
    vi.stubEnv("HYPERFRAMES_ANALYZE_TIMEOUT_MS", "1");
    try {
      expect(() => analyzeMediaGrade(makeLongHlgClip())).toThrow(
        /took longer than 0\.001s to measure the frame at 12\.0s; set HYPERFRAMES_ANALYZE_TIMEOUT_MS/,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("measures the clip the same way in the media-use copy", async () => {
    const vendored = await import(
      new URL("../../../packages/cli/src/media-use/lib/grade-analyzer.mjs", import.meta.url).href
    );
    expect(vendored.analyzeMediaGrade(makeLongHlgClip())).toEqual(
      analyzeMediaGrade(makeLongHlgClip()),
    );
  });

  it("places one sample in the middle of each fifth of the clip", () => {
    expect(gradeSampleTimes(300)).toEqual([30, 90, 150, 210, 270]);
  });
});
