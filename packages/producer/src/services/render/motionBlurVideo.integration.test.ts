// Motion blur over a <video>, rendered for real (#5144): held video rows match blur-off, the
// bar smears, and a sub-composition cut keeps its video. Needs Chrome + ffmpeg: integration lane.

import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  decodePng,
  getFfmpegBinary,
  resolveConfig,
  type MotionBlurOptions,
} from "@hyperframes/engine";
import { createRenderJob, executeRenderJob } from "../renderOrchestrator.js";

const FFMPEG = getFfmpegBinary();
const HAS_FFMPEG = spawnSync(FFMPEG, ["-version"], { encoding: "utf-8" }).status === 0;

const WIDTH = 160;
const HEIGHT = 90;
const FPS = 30;
const DURATION_SECONDS = 0.5;
const FRAME_COUNT = DURATION_SECONDS * FPS;
// The bar covers rows BAR_TOP..HEIGHT; every row above it is video only.
const BAR_TOP = 60;

const COMPOSITION = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { overflow: hidden; }
    #clip {
      position: absolute; left: 0; top: 0; width: ${WIDTH}px; height: ${HEIGHT}px;
      animation: drift ${DURATION_SECONDS}s linear both;
    }
    @keyframes drift { from { transform: translateX(0); } to { transform: translateX(-30px); } }
    #bar {
      position: absolute; left: 0; top: ${BAR_TOP}px; width: 20px; height: ${HEIGHT - BAR_TOP}px;
      background: #fff; animation: slide ${DURATION_SECONDS}s linear both;
    }
    @keyframes slide { from { transform: translateX(0); } to { transform: translateX(140px); } }
  </style>
</head>
<body>
  <div
    id="root"
    data-composition-id="motion-blur-video"
    data-start="0"
    data-duration="${DURATION_SECONDS}"
    data-width="${WIDTH}"
    data-height="${HEIGHT}"
    data-fps="${FPS}"
    data-no-timeline
  >
    <video id="clip" class="clip" src="assets/clip.mp4" data-start="0" data-duration="${DURATION_SECONDS}" data-track-index="0" muted playsinline></video>
    <div id="bar"></div>
  </div>
</body>
</html>
`;

// The repo's two-scene fixture: two sub-composition hosts, each a full-frame video, cut at
// 1 s. Its media is swapped for a generated clip.
const CUT_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../tests/nested-sequential-video-local-start/src",
);
const CUT_FPS = 24;
const CUT_FRAME = 24;
const CUT_FRAME_COUNT = 48;

let root: string;

async function renderFrames(
  name: string,
  motionBlur?: MotionBlurOptions,
  projectDir = root,
  fps = FPS,
): Promise<Buffer[]> {
  const outputDir = join(root, name);
  const job = createRenderJob({
    fps,
    quality: "draft",
    format: "png-sequence",
    hdrMode: "force-sdr",
    workers: 1,
    motionBlur,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    producerConfig: resolveConfig({ browserGpuMode: "software" }),
  });
  await executeRenderJob(job, projectDir, outputDir);
  return readdirSync(outputDir)
    .filter((file) => file.endsWith(".png"))
    .sort()
    .map((file) => readFileSync(join(outputDir, file)));
}

/** Mean of a PNG frame's RGB channels, 0-255. */
function meanLevel(png: Buffer): number {
  const { data } = decodePng(png);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += data[i]! + data[i + 1]! + data[i + 2]!;
  return sum / ((data.length / 4) * 3);
}

/** The RGBA bytes of rows [top, bottom) of a PNG frame. */
function rows(png: Buffer, top: number, bottom: number): Buffer {
  const { width, data } = decodePng(png);
  return Buffer.from(data.subarray(top * width * 4, bottom * width * 4));
}

describe.skipIf(!HAS_FFMPEG)("motion blur over video — real render (#5144)", () => {
  let plain: Buffer[];
  let blurred: Buffer[];
  let blurredAgain: Buffer[];
  let cutPlain: Buffer[];
  let cutBlurred: Buffer[];

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "hf-motion-blur-video-"));
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "index.html"), COMPOSITION);
    // testsrc2 changes every frame, so a sample that picked a neighbouring video frame
    // would change the video rows.
    const clip = spawnSync(
      FFMPEG,
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}:duration=1`,
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        "-g",
        "1",
        "-y",
        join(root, "assets", "clip.mp4"),
      ],
      { encoding: "utf-8" },
    );
    if (clip.status !== 0) throw new Error(`clip fixture failed: ${clip.stderr}`);

    const cutDir = join(root, "cut");
    cpSync(CUT_FIXTURE, cutDir, { recursive: true, filter: (src) => !src.endsWith(".mp4") });
    mkdirSync(join(cutDir, "media"), { recursive: true });
    const cutClip = spawnSync(
      FFMPEG,
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `testsrc2=size=${WIDTH}x${HEIGHT}:rate=${CUT_FPS}:duration=2`,
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        "-g",
        "1",
        "-y",
        join(cutDir, "media", "source.mp4"),
      ],
      { encoding: "utf-8" },
    );
    if (cutClip.status !== 0) throw new Error(`cut clip fixture failed: ${cutClip.stderr}`);

    const blur: MotionBlurOptions = { samplesPerFrame: 8 };
    plain = await renderFrames("plain");
    blurred = await renderFrames("blurred", blur);
    blurredAgain = await renderFrames("blurred-again", blur);
    cutPlain = await renderFrames("cut-plain", undefined, cutDir, CUT_FPS);
    cutBlurred = await renderFrames("cut-blurred", blur, cutDir, CUT_FPS);
  }, 600_000);

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("renders every frame with blur on", () => {
    expect(plain).toHaveLength(FRAME_COUNT);
    expect(blurred).toHaveLength(FRAME_COUNT);
  });

  it("keeps the video rows identical to the unblurred render on every frame", () => {
    // Non-vacuous only if the footage actually moves between frames.
    expect(rows(plain[6]!, 0, BAR_TOP).equals(rows(plain[7]!, 0, BAR_TOP))).toBe(false);
    for (let i = 0; i < FRAME_COUNT; i++) {
      expect(rows(blurred[i]!, 0, BAR_TOP).equals(rows(plain[i]!, 0, BAR_TOP)), `frame ${i}`).toBe(
        true,
      );
    }
  });

  it("smears the moving bar", () => {
    for (const i of [4, 7, 10]) {
      expect(
        rows(blurred[i]!, BAR_TOP, HEIGHT).equals(rows(plain[i]!, BAR_TOP, HEIGHT)),
        `frame ${i}`,
      ).toBe(false);
    }
  });

  it("keeps both scenes' video through a sub-composition cut", () => {
    expect(cutBlurred).toHaveLength(CUT_FRAME_COUNT);
    for (let i = 0; i < CUT_FRAME_COUNT; i++) {
      if (i === CUT_FRAME) continue;
      const blurredPixels = rows(cutBlurred[i]!, 0, HEIGHT);
      expect(blurredPixels.equals(rows(cutPlain[i]!, 0, HEIGHT)), `frame ${i}`).toBe(true);
    }
    // The cut frame blends scene A's last frame into scene B's first; it must not dim.
    const plainLevel = meanLevel(cutPlain[CUT_FRAME]!);
    expect(plainLevel).toBeGreaterThan(50);
    expect(Math.abs(meanLevel(cutBlurred[CUT_FRAME]!) - plainLevel)).toBeLessThan(plainLevel * 0.1);
  });

  it("is deterministic", () => {
    expect(blurredAgain).toHaveLength(FRAME_COUNT);
    for (let i = 0; i < FRAME_COUNT; i++) {
      expect(blurredAgain[i]!.equals(blurred[i]!), `frame ${i}`).toBe(true);
    }
  });
});
