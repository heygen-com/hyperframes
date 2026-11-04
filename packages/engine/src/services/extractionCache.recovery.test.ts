import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { COMPLETE_SENTINEL } from "./extractionCache.js";
import { extractAllVideoFrames, type VideoElement } from "./videoFrameExtractor.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

it.runIf(hasFfmpeg)(
  "recovers an emptied extraction cache and reuses its replacement",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-cache-recovery-"));
    try {
      const src = join(root, "source.mp4");
      const generated = spawnSync(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=64x64:rate=30:duration=1",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          src,
        ],
        { encoding: "utf8" },
      );
      expect(generated.status, generated.stderr).toBe(0);
      const video: VideoElement = {
        id: "footage",
        src,
        start: 0,
        end: 1,
        mediaStart: 0,
        loop: false,
        hasAudio: false,
      };
      const cache = join(root, "cache");
      const extract = (stage: string) =>
        extractAllVideoFrames([video], root, { fps: 30, outputDir: join(root, stage) }, undefined, {
          extractCacheDir: cache,
        });
      const cold = await extract("cold");
      expect(cold.errors).toEqual([]);
      const initial = cold.extracted[0];
      const firstPath = initial?.framePaths.get(0);
      if (!initial || !firstPath) throw new Error("Cold extraction produced no first frame");
      expect(initial.totalFrames).toBe(30);
      const firstFrame = readFileSync(firstPath);
      for (const path of initial.framePaths.values()) rmSync(path);
      expect(existsSync(join(initial.outputDir, COMPLETE_SENTINEL))).toBe(true);

      const recovered = await extract("recovered");

      expect(recovered.errors).toEqual([]);
      expect(recovered.phaseBreakdown.cacheMisses).toBe(1);
      expect(recovered.extracted[0]?.totalFrames).toBe(30);
      const recoveredPath = recovered.extracted[0]?.framePaths.get(0);
      if (!recoveredPath) throw new Error("Recovery produced no first frame");
      expect(readFileSync(recoveredPath)).toEqual(firstFrame);
      const warm = await extract("warm");
      expect(warm.errors).toEqual([]);
      expect(warm.phaseBreakdown.cacheHits).toBe(1);
      expect(warm.extracted[0]?.totalFrames).toBe(30);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  30_000,
);
