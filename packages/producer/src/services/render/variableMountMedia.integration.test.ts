// A clip whose mount binds its source through data-variable-values plays the bound file for its whole
// length, not the authored placeholder's. Needs Chrome + ffmpeg: integration lane.

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveConfig } from "@hyperframes/engine";
import { createRenderJob, executeRenderJob } from "../renderOrchestrator.js";
import { FFMPEG, HAS_FFMPEG, frameLevels } from "./frameLevelsTestFixtures.js";

const WIDTH = 160;
const HEIGHT = 90;
const FPS = 10;

const INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <script src="assets/gsap.min.js"></script>
  <style>* { margin: 0; padding: 0; } body { overflow: hidden; background: #000; }</style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="8"
    data-width="${WIDTH}" data-height="${HEIGHT}" data-fps="${FPS}">
    <div id="mount" data-composition-id="clip" data-composition-src="compositions/clip.html"
      data-start="0" data-duration="8" data-width="${WIDTH}" data-height="${HEIGHT}"
      data-variable-values='{"src":"assets/long.mp4"}'></div>
  </div>
  <script>window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body>
</html>
`;

const CLIP = `<template id="clip-template">
  <div data-composition-id="clip" data-width="${WIDTH}" data-height="${HEIGHT}">
    <video id="v" muted src="../assets/placeholder.mp4" data-var-src="src"
      data-start="0" data-duration="8" data-track-index="0"
      style="position:absolute;inset:0;width:100%;height:100%"></video>
  </div>
</template>
`;

/** Black for `black` seconds, then white for `white` seconds (none: black only). */
function makeClip(path: string, black: number, white: number): void {
  const size = `s=${WIDTH}x${HEIGHT}:r=${FPS}`;
  const args = ["-hide_banner", "-loglevel", "error"];
  args.push("-f", "lavfi", "-i", `color=c=black:${size}:d=${black}`);
  if (white > 0) {
    args.push("-f", "lavfi", "-i", `color=c=white:${size}:d=${white}`);
    args.push("-filter_complex", "concat=n=2:v=1:a=0");
  }
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", path);
  const made = spawnSync(FFMPEG, args, { encoding: "utf-8" });
  if (made.status !== 0) throw new Error(`fixture failed: ${made.stderr}`);
}

let root: string;

describe.skipIf(!HAS_FFMPEG)("a clip bound through its mount — real render", () => {
  let levels: number[];

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "hf-variable-mount-"));
    mkdirSync(join(root, "assets"), { recursive: true });
    mkdirSync(join(root, "compositions"), { recursive: true });
    copyFileSync(
      resolve(import.meta.dirname, "../../../../core/node_modules/gsap/dist/gsap.min.js"),
      join(root, "assets/gsap.min.js"),
    );
    makeClip(join(root, "assets/placeholder.mp4"), 3, 0);
    makeClip(join(root, "assets/long.mp4"), 5, 8);
    writeFileSync(join(root, "compositions/clip.html"), CLIP);
    writeFileSync(join(root, "index.html"), INDEX);
    const job = createRenderJob({
      fps: FPS,
      quality: "draft",
      format: "mp4",
      hdrMode: "force-sdr",
      workers: 1,
      producerConfig: resolveConfig({ browserGpuMode: "software" }),
    });
    const output = join(root, "out.mp4");
    await executeRenderJob(job, root, output);
    levels = frameLevels(output, WIDTH, HEIGHT);
  }, 180_000);

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("plays the bound 13 s file past the 3 s placeholder's end", () => {
    expect(levels).toHaveLength(8 * FPS);
    expect(levels[Math.round(1 * FPS)]!).toBeLessThan(20);
    // The bound file turns white at 5 s; the placeholder would hold its black last frame.
    expect(levels[Math.round(6 * FPS)]!).toBeGreaterThan(200);
  });
});
