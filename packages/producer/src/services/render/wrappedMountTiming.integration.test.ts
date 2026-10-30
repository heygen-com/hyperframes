// A composition nested in a timed scene through a neutral wrapper plays on the scene's clock, not
// the root's (#4334). Needs Chrome + ffmpeg: integration lane.

import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveConfig } from "@hyperframes/engine";
import { createRenderJob, executeRenderJob } from "../renderOrchestrator.js";
import { HAS_FFMPEG, frameLevels } from "./frameLevelsTestFixtures.js";

const WIDTH = 160;
const HEIGHT = 90;
const FPS = 30;

// The scene starts at 1 s; the inner composition fades its box in over its own first second.
const INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <script src="assets/gsap.min.js"></script>
  <style>
    * { margin: 0; padding: 0; } body { overflow: hidden; background: #000; }
    #inner, #box { position: absolute; inset: 0; }
    #box { background: #fff; opacity: 0; }
  </style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="2"
    data-width="${WIDTH}" data-height="${HEIGHT}" data-fps="${FPS}">
    <div id="scene" data-composition-id="scene" data-start="1" data-duration="1" data-track-index="0"
      data-width="${WIDTH}" data-height="${HEIGHT}">
      <section>
        <div id="inner" data-composition-id="inner" data-duration="1"
          data-width="${WIDTH}" data-height="${HEIGHT}"><div id="box"></div></div>
      </section>
    </div>
  </div>
  <script>
    window.__timelines["main"] = gsap.timeline({ paused: true });
    window.__timelines["scene"] = gsap.timeline({ paused: true }).set({}, {}, 1);
    window.__timelines["inner"] = gsap
      .timeline({ paused: true })
      .to("#box", { opacity: 1, duration: 1, ease: "none" });
  </script>
</body>
</html>
`;

let root: string;

describe.skipIf(!HAS_FFMPEG)("a composition behind a wrapper — real render (#4334)", () => {
  let levels: number[];

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "hf-wrapped-mount-"));
    mkdirSync(join(root, "assets"), { recursive: true });
    copyFileSync(
      resolve(import.meta.dirname, "../../../../core/node_modules/gsap/dist/gsap.min.js"),
      join(root, "assets/gsap.min.js"),
    );
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
  }, 120_000);

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("fades the box in over the scene's second, not the root's first", () => {
    expect(levels).toHaveLength(2 * FPS);
    expect(levels[Math.round(0.5 * FPS)]!).toBeLessThan(5);
    // Half way through the scene the box is half faded in (about 128 of 255).
    expect(levels[Math.round(1.5 * FPS)]!).toBeGreaterThan(90);
    expect(levels[Math.round(1.5 * FPS)]!).toBeLessThan(165);
    expect(levels[Math.round(1.25 * FPS)]!).toBeLessThan(levels[Math.round(1.75 * FPS)]!);
  });
});
