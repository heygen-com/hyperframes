// `chromaSubsampling` reaches both halves of the real orchestrator: a "444" render is encoded
// yuv444p and captured at full chroma resolution, and the default stays yuv420p. The helper tests
// can't catch the option being dropped before the encoder preset or the capture surface; a JPEG
// capture would still encode as yuv444p but carry 4:2:0 colour. Needs Chrome + ffmpeg:
// integration lane.

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFfprobeBinary, resolveConfig } from "@hyperframes/engine";
import { createRenderJob, executeRenderJob } from "../renderOrchestrator.js";
import { FFMPEG, HAS_FFMPEG } from "./frameLevelsTestFixtures.js";

const FFPROBE = getFfprobeBinary();
const WIDTH = 160;
const HEIGHT = 90;
const FPS = 30;
// A red/blue edge at an odd x splits a 4:2:0 chroma pair (x 10 and 11), so only a full-resolution
// capture can give the two pixels different colours.
const EDGE_X = 11;
const EDGE_ROW = 70;

// Thin coloured text on a contrasting background: the content 4:4:4 exists for.
const INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <script src="assets/gsap.min.js"></script>
  <style>
    * { margin: 0; padding: 0; }
    body { overflow: hidden; background: #1030c0; }
    #label { position: absolute; top: 30px; left: 10px; font: 16px sans-serif; color: #ff2020; }
    #edge { position: absolute; top: 60px; left: ${EDGE_X}px; width: 40px; height: 20px; background: #ff2020; }
  </style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="0.5"
    data-width="${WIDTH}" data-height="${HEIGHT}" data-fps="${FPS}">
    <span id="label">Red on blue</span>
    <div id="edge"></div>
  </div>
  <script>window.__timelines["main"] = gsap.timeline({ paused: true }).set({}, {}, 0.5);</script>
</body>
</html>
`;

/**
 * `inputPath` is a separate parameter, not the argv's last element, so the
 * `--` terminator stays the penultimate literal token — see
 * `src/utils/ffprobeArgvContract.test.ts`.
 */
function ffprobe(inputPath: string, args: readonly string[]): string {
  const argv = ["-v", "error", ...args, "--", inputPath];
  const result = spawnSync(FFPROBE, argv, { encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(`ffprobe failed (${String(result.status)}): ${result.stderr}`);
  }
  return result.stdout.trim();
}

function pixelFormat(videoPath: string): string {
  return ffprobe(videoPath, [
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=pix_fmt",
    "-of",
    "default=nw=1:nk=1",
  ]);
}

/** Cb of frame 0 at (x, y), decoded at full chroma resolution. */
function chromaBlueAt(videoPath: string, x: number, y: number): number {
  const result = spawnSync(
    FFMPEG,
    [
      "-v",
      "error",
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "yuv444p",
      "-",
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${String(result.stderr)}`);
  const cbPlane = WIDTH * HEIGHT;
  return result.stdout[cbPlane + y * WIDTH + x]!;
}

let root: string;

async function render(name: string, chromaSubsampling?: "420" | "444"): Promise<string> {
  const job = createRenderJob({
    fps: FPS,
    quality: "draft",
    format: "mp4",
    hdrMode: "force-sdr",
    workers: 1,
    ...(chromaSubsampling ? { chromaSubsampling } : {}),
    producerConfig: resolveConfig({ browserGpuMode: "software" }),
  });
  const output = join(root, `${name}.mp4`);
  await executeRenderJob(job, root, output);
  return output;
}

describe.skipIf(!HAS_FFMPEG)("chromaSubsampling through a real render", () => {
  let output444: string;
  let outputDefault: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "hf-chroma-"));
    mkdirSync(join(root, "assets"), { recursive: true });
    copyFileSync(
      resolve(import.meta.dirname, "../../../../core/node_modules/gsap/dist/gsap.min.js"),
      join(root, "assets/gsap.min.js"),
    );
    writeFileSync(join(root, "index.html"), INDEX);
    output444 = await render("chroma-444", "444");
    outputDefault = await render("chroma-default");
  }, 180_000);

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('encodes yuv444p when chromaSubsampling is "444"', () => {
    expect(pixelFormat(output444)).toBe("yuv444p");
  });

  it('captures full-resolution chroma when chromaSubsampling is "444"', () => {
    const background = chromaBlueAt(output444, EDGE_X - 1, EDGE_ROW);
    const edge = chromaBlueAt(output444, EDGE_X, EDGE_ROW);
    expect(background - edge).toBeGreaterThan(60);
  });

  it("keeps yuv420p by default", () => {
    expect(pixelFormat(outputDefault)).toBe("yuv420p");
  });
});
