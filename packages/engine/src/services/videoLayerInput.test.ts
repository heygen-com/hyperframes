import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { toFps } from "@hyperframes/core";
import { buildVideoLayerInput } from "./videoFrameExtractor.js";
import { spawnStreamingEncoder } from "./streamingEncoder.js";

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
    it("encodes exactly one output frame per page frame when the video is shorter", async () => {
      const pageFrames = 74;
      const framesDir = join(dir, "page");
      spawnSync("mkdir", ["-p", framesDir]);
      const drew = spawnSync("ffmpeg", [
        ...["-f", "lavfi", "-i", `color=c=red@0.5:s=64x64:r=30,format=rgba`],
        ...["-frames:v", String(pageFrames), "-y", join(framesDir, "p%03d.png")],
      ]);
      expect(drew.status).toBe(0);
      const layer = await buildVideoLayerInput(film, 0, 2.4387, toFps(30), {
        width: 64,
        height: 64,
      });
      expect(layer).toBeDefined();
      const out = join(dir, "out.mp4");
      const encoder = await spawnStreamingEncoder(out, {
        fps: toFps(30),
        width: 64,
        height: 64,
        codec: "h264",
        imageFormat: "png",
        videoLayer: layer,
      });
      for (const name of readdirSync(framesDir).sort()) {
        expect(await encoder.writeFrame(readFileSync(join(framesDir, name)))).toBe(true);
      }
      await encoder.close();
      const counted = spawnSync("ffprobe", [
        ...["-v", "error", "-count_frames", "-select_streams", "v:0"],
        ...["-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", out],
      ]);
      expect(Number(counted.stdout.toString().trim())).toBe(pageFrames);
    });
  },
);
