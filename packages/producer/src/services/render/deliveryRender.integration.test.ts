/** Two real mp4 renders, plain and with a keyframe interval and peak cap (ffprobe). Needs Chrome + ffmpeg. */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFfmpegBinary, getFfprobeBinary, resolveConfig } from "@hyperframes/engine";
import { createRenderJob, executeRenderJob } from "../renderOrchestrator.js";

const FFMPEG = getFfmpegBinary();
const FFPROBE = getFfprobeBinary();
const HAS_FFMPEG = spawnSync(FFMPEG, ["-version"], { encoding: "utf-8" }).status === 0;

const DURATION_SECONDS = 8;
const FPS = 30;
const CAP_BITS_PER_SECOND = 300_000;

const COMPOSITION = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { overflow: hidden; background: #111; }
    video { position: absolute; inset: 0; width: 320px; height: 180px; }
  </style>
</head>
<body>
  <div id="root" data-composition-id="delivery" data-start="0" data-duration="${DURATION_SECONDS}"
    data-width="320" data-height="180" data-fps="${FPS}" data-no-timeline>
    <video src="assets/noise.mp4" data-start="0" data-duration="${DURATION_SECONDS}" data-track-index="1" muted playsinline></video>
  </div>
</body>
</html>
`;

function run(command: string, args: readonly string[]): string {
  const result = spawnSync(command, args, { encoding: "utf-8" });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function packets(file: string): { time: number; bytes: number; key: boolean }[] {
  const rows = run(FFPROBE, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "packet=pts_time,size,flags",
    "-of",
    "csv=p=0",
    "--",
    file,
  ]);
  return rows
    .split("\n")
    .map((line) => line.split(","))
    .map(([time, size, flags]) => ({
      time: Number(time),
      bytes: Number(size),
      key: flags!.includes("K"),
    }))
    .sort((a, b) => a.time - b.time);
}

/** Worst excess of any packet window's bits over `rate * window + buffer`; <= 0 means the bound holds. */
function worstExcess(file: string, rate: number, buffer: number): number {
  const p = packets(file);
  let worst = -Infinity;
  for (let i = 0; i < p.length; i++) {
    let bits = 0;
    for (let j = i; j < p.length; j++) {
      bits += p[j]!.bytes * 8;
      worst = Math.max(worst, bits - (rate * (p[j]!.time - p[i]!.time + 1 / FPS) + buffer));
    }
  }
  return worst;
}

describe.skipIf(!HAS_FFMPEG)("mp4 delivery options — real render", () => {
  let root: string;
  let plain: string;
  let delivery: string;

  async function render(output: string, extra: Record<string, unknown>): Promise<void> {
    const job = createRenderJob({
      fps: FPS,
      quality: "draft",
      format: "mp4",
      hdrMode: "force-sdr",
      workers: 1,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      producerConfig: resolveConfig({ browserGpuMode: "software" }),
      ...extra,
    });
    await executeRenderJob(job, root, output);
  }

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "hf-delivery-render-"));
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "index.html"), COMPOSITION);
    run(FFMPEG, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=320x180:rate=${FPS}:duration=${DURATION_SECONDS},noise=alls=60:allf=t`,
      "-pix_fmt",
      "yuv420p",
      "-y",
      join(root, "assets", "noise.mp4"),
    ]);
    plain = join(root, "plain.mp4");
    delivery = join(root, "delivery.mp4");
    await render(plain, {});
    await render(delivery, { keyframeIntervalSeconds: 2, maxBitrate: String(CAP_BITS_PER_SECOND) });
  }, 900_000);

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("puts a keyframe every interval, which a plain render does not", () => {
    const keys = (file: string) =>
      packets(file)
        .filter((p) => p.key)
        .map((p) => Math.round(p.time * 1000) / 1000);
    expect(keys(delivery)).toEqual([0, 2, 4, 6]);
    expect(keys(plain)).not.toEqual([0, 2, 4, 6]);
  });

  it("holds the peak bitrate cap, which a plain render exceeds", () => {
    const buffer = 2 * CAP_BITS_PER_SECOND;
    expect(worstExcess(plain, CAP_BITS_PER_SECOND, buffer)).toBeGreaterThan(0);
    expect(worstExcess(delivery, CAP_BITS_PER_SECOND, buffer)).toBeLessThanOrEqual(0);
  });
});
