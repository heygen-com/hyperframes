// A graded <img> that is hidden when grading first looks, rendered for real: it is graded from the
// frame it appears on. One project per shape, since grading another element re-scans the page and
// would hide the bug. Needs Chrome + ffmpeg: integration lane.

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveConfig } from "@hyperframes/engine";
import { createRenderJob, executeRenderJob } from "../renderOrchestrator.js";
import { FFMPEG, HAS_FFMPEG, frameLevels } from "./frameLevelsTestFixtures.js";

const WIDTH = 64;
const HEIGHT = 36;
const FPS = 30;
const FRAME_COUNT = 60;
const REVEAL_FRAME = 30;
const REVEAL = REVEAL_FRAME / FPS;
const DURATION = FRAME_COUNT / FPS;
const SOURCE_GREY = 128;
const IMAGE = `<img src="assets/grey.png" data-color-grading='{"adjust":{"exposure":-1}}'
  style="position:absolute;inset:0;width:100%;height:100%" />`;
const SIZE = `data-width="${WIDTH}" data-height="${HEIGHT}"`;

const index = (scene: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <script src="assets/gsap.min.js"></script>
  <style>* { margin: 0; padding: 0; } body { overflow: hidden; background: #000; }</style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="${DURATION}" ${SIZE}
    data-fps="${FPS}">
    ${scene}
  </div>
  <script>window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body>
</html>
`;

const subComposition = (id: string, duration: number, body: string, script = "") => `<!DOCTYPE html>
<html>
<body>
<template id="${id}-template">
  <div data-composition-id="${id}" ${SIZE} data-duration="${duration}">${body}</div>
  ${script}
</template>
</body>
</html>
`;

const subCompositionHost = (id: string, start: number, duration: number) =>
  `<div id="s-${id}" data-composition-id="${id}" data-composition-src="compositions/${id}.html"
    data-start="${start}" data-duration="${duration}" data-track-index="0" ${SIZE}></div>`;

const SHAPES = {
  "a still image in a timed insert mid-timeline": {
    index: index(`<div class="clip" data-start="${REVEAL}" data-duration="${DURATION - REVEAL}"
      data-track-index="0" style="position:absolute;inset:0">${IMAGE}</div>`),
  },
  "an image in a layer its timeline reveals from visibility:hidden": {
    index: index(subCompositionHost("layer", 0, DURATION)),
    layer: subComposition(
      "layer",
      DURATION,
      `<div id="hidden-layer" style="position:absolute;inset:0;visibility:hidden">${IMAGE}</div>`,
      `<script>
        (() => {
          const tl = gsap.timeline({ paused: true });
          tl.set("#hidden-layer", { visibility: "visible" }, ${REVEAL});
          tl.set({}, {}, ${DURATION});
          window.__timelines["layer"] = tl;
        })();
      </script>`,
    ),
  },
  "an image in a sub-composition whose host starts later": {
    index: index(subCompositionHost("late", REVEAL, DURATION - REVEAL)),
    late: subComposition("late", DURATION - REVEAL, IMAGE),
  },
} satisfies Record<string, Record<string, string>>;

let root: string;

describe.skipIf(!HAS_FFMPEG)("color-graded <img> hidden at first, then shown — real render", () => {
  const levels = new Map<string, number[]>();

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "hf-late-image-grading-"));
    const grey = join(root, "grey.png");
    const fixture = spawnSync(
      FFMPEG,
      ["-v", "error", "-f", "lavfi", "-i", `color=c=0x808080:size=${WIDTH}x${HEIGHT}`].concat([
        "-frames:v",
        "1",
        "-y",
        grey,
      ]),
      { encoding: "utf-8" },
    );
    if (fixture.status !== 0) throw new Error(`image fixture failed: ${fixture.stderr}`);
    for (const [shape, files] of Object.entries(SHAPES)) {
      const project = mkdtempSync(join(root, "shape-"));
      mkdirSync(join(project, "assets"));
      mkdirSync(join(project, "compositions"));
      copyFileSync(grey, join(project, "assets/grey.png"));
      copyFileSync(
        resolve(import.meta.dirname, "../../../../core/node_modules/gsap/dist/gsap.min.js"),
        join(project, "assets/gsap.min.js"),
      );
      for (const [name, html] of Object.entries(files)) {
        writeFileSync(
          join(project, name === "index" ? "index.html" : `compositions/${name}.html`),
          html,
        );
      }
      const job = createRenderJob({
        fps: FPS,
        quality: "draft",
        format: "mp4",
        hdrMode: "force-sdr",
        workers: 1,
        producerConfig: resolveConfig({ browserGpuMode: "software" }),
      });
      const output = join(project, "out.mp4");
      await executeRenderJob(job, project, output);
      levels.set(shape, frameLevels(output, WIDTH, HEIGHT));
    }
  }, 600_000);

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it.each(Object.keys(SHAPES))("grades %s from the frame it appears on", (shape) => {
    const shown = levels.get(shape)!;
    expect(shown).toHaveLength(FRAME_COUNT);
    expect(shown[REVEAL_FRAME - 5], "hidden before the reveal").toBeLessThan(3);
    for (let i = REVEAL_FRAME; i < FRAME_COUNT; i++) {
      // Ungraded, the frame shows the source grey; the grade pulls it far below.
      expect(SOURCE_GREY - shown[i]!, `frame ${i}`).toBeGreaterThan(30);
    }
  });
});
