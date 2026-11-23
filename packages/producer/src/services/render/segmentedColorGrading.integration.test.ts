// A graded <video>, rendered for real (#5548): the first frame a capture session draws inside the
// clip (a segment's or a parallel worker's), and the clip's own first frame, keep the grade.
// Needs Chrome + ffmpeg: integration lane.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveConfig } from "@hyperframes/engine";
import { createRenderJob, executeRenderJob } from "../renderOrchestrator.js";
import { FFMPEG, HAS_FFMPEG, frameLevels } from "./frameLevelsTestFixtures.js";

const WIDTH = 160;
const HEIGHT = 90;
const FPS = 30;
const FRAME_COUNT = 60;
const CLIP_FIRST = 15;
const CLIP_LAST = 44;
// The smallest segment size. With two workers, both the second segment and the second worker's
// frame range start here, mid-clip.
const SECOND_SESSION_FIRST = 30;
const CLIP_GREY = 128;

const COMPOSITION = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { overflow: hidden; background: #000; }
    #clip { position: absolute; left: 0; top: 0; width: ${WIDTH}px; height: ${HEIGHT}px; }
  </style>
</head>
<body>
  <div
    id="root"
    data-composition-id="segmented-color-grading"
    data-start="0"
    data-duration="${FRAME_COUNT / FPS}"
    data-width="${WIDTH}"
    data-height="${HEIGHT}"
    data-fps="${FPS}"
  >
    <video id="clip" class="clip" src="assets/clip.mp4" data-start="${CLIP_FIRST / FPS}"
      data-duration="${(CLIP_LAST + 1 - CLIP_FIRST) / FPS}" data-track-index="0" muted playsinline
      data-color-grading='{"adjust":{"exposure":-1}}'></video>
  </div>
  <script>window.__timelines = window.__timelines || {};</script>
</body>
</html>
`;

let root: string;

interface Render {
  levels: number[];
  phases: string[];
  workerCount: number;
}

async function render(name: string, segmented: boolean, workers: number): Promise<Render> {
  const phases: string[] = [];
  let workerCount = 0;
  const job = createRenderJob({
    fps: FPS,
    quality: "draft",
    format: "mp4",
    hdrMode: "force-sdr",
    workers,
    logger: {
      info(message: string, meta?: Record<string, unknown>) {
        if (message !== "[Render:trace]") return;
        if (typeof meta?.phase === "string") phases.push(meta.phase);
        if (typeof meta?.workerCount === "number")
          workerCount = Math.max(workerCount, meta.workerCount);
      },
      warn() {},
      error() {},
      debug() {},
    },
    producerConfig: resolveConfig({ browserGpuMode: "software" }),
  });
  const saved = {
    capture: process.env.HF_SEGMENTED_CAPTURE,
    frames: process.env.HF_SEGMENT_FRAMES,
  };
  process.env.HF_SEGMENTED_CAPTURE = String(segmented);
  process.env.HF_SEGMENT_FRAMES = String(SECOND_SESSION_FIRST);
  try {
    const output = join(root, `${name}.mp4`);
    await executeRenderJob(job, root, output);
    return { levels: frameLevels(output, WIDTH, HEIGHT), phases, workerCount };
  } finally {
    if (saved.capture === undefined) delete process.env.HF_SEGMENTED_CAPTURE;
    else process.env.HF_SEGMENTED_CAPTURE = saved.capture;
    if (saved.frames === undefined) delete process.env.HF_SEGMENT_FRAMES;
    else process.env.HF_SEGMENT_FRAMES = saved.frames;
  }
}

describe.skipIf(!HAS_FFMPEG)(
  "color-graded video at a capture session's first frame — real render (#5548)",
  () => {
    let reference: Render;
    let segmented: Render;
    let parallel: Render;

    beforeAll(async () => {
      root = mkdtempSync(join(tmpdir(), "hf-segmented-grading-"));
      mkdirSync(join(root, "assets"), { recursive: true });
      writeFileSync(join(root, "index.html"), COMPOSITION);
      const clip = spawnSync(
        FFMPEG,
        [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          `color=c=0x808080:size=${WIDTH}x${HEIGHT}:rate=${FPS}:duration=2`,
          "-pix_fmt",
          "yuv420p",
          "-c:v",
          "libx264",
          "-y",
          join(root, "assets", "clip.mp4"),
        ],
        { encoding: "utf-8" },
      );
      if (clip.status !== 0) throw new Error(`clip fixture failed: ${clip.stderr}`);

      reference = await render("reference", false, 1);
      segmented = await render("segmented", true, 2);
      parallel = await render("parallel", false, 2);
    }, 600_000);

    afterAll(() => {
      if (root) rmSync(root, { recursive: true, force: true });
    });

    it("renders each shape on the route it asks for", () => {
      expect(segmented.phases).toContain("capture_segmented");
      expect(reference.phases).not.toContain("capture_segmented");
      expect(parallel.phases).not.toContain("capture_segmented");
      expect(reference.workerCount).toBe(1);
      expect(segmented.workerCount).toBe(2);
      expect(parallel.workerCount).toBe(2);
      for (const { levels } of [reference, segmented, parallel]) {
        expect(levels).toHaveLength(FRAME_COUNT);
      }
    });

    it.each([
      ["a segment", () => segmented],
      ["a parallel worker", () => parallel],
    ])("renders the first frame of %s inside the clip like one session does", (_, shape) => {
      const level = shape().levels[SECOND_SESSION_FIRST]!;
      expect(Math.abs(level - reference.levels[SECOND_SESSION_FIRST]!)).toBeLessThan(3);
    });

    it("grades every frame of the clip, including its first", () => {
      const graded = reference.levels[CLIP_FIRST + 5]!;
      // Non-vacuous only if the grade visibly moves the clip off its source grey.
      expect(CLIP_GREY - graded).toBeGreaterThan(30);
      for (const { levels } of [reference, segmented, parallel]) {
        for (let i = CLIP_FIRST; i <= CLIP_LAST; i++) {
          expect(Math.abs(levels[i]! - graded), `frame ${i}`).toBeLessThan(3);
        }
      }
    });
  },
);
