import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { toFps } from "@hyperframes/core";
import { buildVideoLayerInput } from "./videoFrameExtractor.js";

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;

describe.skipIf(!HAS_FFMPEG)(
  "buildVideoLayerInput on a film whose audio outlasts its video",
  () => {
    let dir = "";
    let film = "";
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "video-layer-input-"));
      film = join(dir, "film.mp4");
      const made = spawnSync("ffmpeg", [
        ...["-f", "lavfi", "-i", "testsrc=d=2:s=64x64:r=30"],
        ...["-f", "lavfi", "-i", "sine=d=2.4"],
        ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", film],
      ]);
      expect(made.status).toBe(0);
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("accepts it, holds the last frame and leaves the output length to the page frames", async () => {
      const layer = await buildVideoLayerInput(film, 0, 2.4, toFps(30), { width: 64, height: 64 });
      expect(layer).toBeDefined();
      expect(layer?.inputArgs).not.toContain("-t");
      expect(layer?.filters.at(-1)).toMatch(/^tpad=stop_mode=clone:stop_duration=/);
    });
  },
);
