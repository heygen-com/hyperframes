import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeVideo, readClip, sumOf, videoClip } from "./media.js";

const terms = (n: number) => Array.from({ length: n }, (_, i) => `eq(n\\,${i * 2})`);

describe("sumOf", () => {
  it("keeps a short sum flat", () => {
    expect(sumOf(terms(3))).toBe("eq(n\\,0)+eq(n\\,2)+eq(n\\,4)");
  });

  it("nests a sum past 100 terms and keeps every one", () => {
    const sum = sumOf(terms(101));
    expect(sum.startsWith("(eq(n\\,0)+")).toBe(true);
    expect(sum.match(/eq\(n/g)).toHaveLength(101);
  });
});

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe.skipIf(!ffmpeg)("a select of many frames", () => {
  it("decodes all 237 picked frames", () => {
    // Windows agents on ffmpeg 8 hit "Error while parsing expression" past 100 eq() terms.
    const dir = mkdtempSync(join(tmpdir(), "hf-sum-"));
    try {
      const path = join(dir, "clip.mp4");
      execFileSync("ffmpeg", [
        ...["-v", "error", "-f", "lavfi", "-i", "testsrc=d=16:r=30:s=32x32"],
        ...["-pix_fmt", "yuv420p", "-y", path],
      ]);
      const info = probeVideo(path);
      const clip = {
        ...videoClip(path, 0, undefined, info),
        filters: [`select=${sumOf(terms(237))}`, `setpts=N/(${info.fpsText})/TB`],
      };
      expect(readClip(clip).frames).toHaveLength(237);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
