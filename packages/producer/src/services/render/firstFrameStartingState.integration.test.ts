// Frame 0 of a real render shows the starting state that a sub-composition's timeline sets at
// t=0, not the page's pre-timeline styles. Needs Chrome + ffmpeg: integration lane.

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
const REVEAL_FRAME = 15;

const INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <script src="assets/gsap.min.js"></script>
  <style>* { margin: 0; padding: 0; } body { overflow: hidden; background: #000; }</style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="1"
    data-width="${WIDTH}" data-height="${HEIGHT}" data-fps="${FPS}">
    <div id="s-words" data-composition-id="words" data-composition-src="compositions/words.html"
      data-start="0" data-duration="1" data-track-index="0"
      data-width="${WIDTH}" data-height="${HEIGHT}"></div>
  </div>
  <script>window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body>
</html>
`;

// The words have no hidden CSS state: only the timeline's t=0 steps hide them.
const WORDS = `<!DOCTYPE html>
<html>
<body>
<template id="words-template">
  <style>
    @font-face { font-family: "Fixture"; src: url("assets/fixture.woff2") format("woff2"); font-weight: 500; }
    #words { position: absolute; inset: 0; background: #000; }
    #words .w { position: absolute; top: 20px; font: 500 40px "Fixture", serif; color: #fff; }
  </style>
  <div id="words" data-composition-id="words" data-width="${WIDTH}" data-height="${HEIGHT}" data-duration="1">
    <span class="w">Aa</span><span class="w">Bb</span>
  </div>
  <script>
    (() => {
      const tl = gsap.timeline({ paused: true });
      const words = [...document.querySelectorAll("#words .w")];
      words.forEach((w) => tl.set(w, { visibility: "hidden" }, 0));
      words.forEach((w, i) => tl.set(w, { visibility: "visible", left: 10 + i * 70 }, ${REVEAL_FRAME / FPS}));
      tl.set({}, {}, 1);
      window.__timelines["words"] = tl;
    })();
  </script>
</template>
</body>
</html>
`;

let root: string;

describe.skipIf(!HAS_FFMPEG)(
  "first frame of a real render — sub-composition starting state",
  () => {
    let levels: number[];

    beforeAll(async () => {
      root = mkdtempSync(join(tmpdir(), "hf-first-frame-"));
      mkdirSync(join(root, "assets"), { recursive: true });
      mkdirSync(join(root, "compositions"), { recursive: true });
      copyFileSync(
        resolve(import.meta.dirname, "../../../../core/node_modules/gsap/dist/gsap.min.js"),
        join(root, "assets/gsap.min.js"),
      );
      copyFileSync(
        resolve(
          import.meta.dirname,
          "../../../tests/heygen-promo-preview-assets/src/TT_Norms_Pro_Medium.woff2",
        ),
        join(root, "assets/fixture.woff2"),
      );
      writeFileSync(join(root, "index.html"), INDEX);
      writeFileSync(join(root, "compositions/words.html"), WORDS);
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

    it("frame 0 matches frame 1: the words are already hidden", () => {
      expect(levels[0]).toBeCloseTo(levels[1]!, 0);
      expect(levels[0]).toBeLessThan(1);
    });

    it("the words appear when the timeline reveals them", () => {
      expect(levels[REVEAL_FRAME]! - levels[0]!).toBeGreaterThan(2);
    });
  },
);
