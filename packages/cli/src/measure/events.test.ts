import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { cutClip, cutStill } from "../commands/measure/extract.js";
import { detectEvents, lookWindows } from "./events.js";
import { probeVideo, readFrames } from "./media.js";

const ffmpeg = findFFmpeg();
const noTools = !ffmpeg || !findFFprobe();
const dir = mkdtempSync(join(tmpdir(), "hf-events-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function clip(name: string, args: string[]): string {
  const out = join(dir, name);
  execFileSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-y", ...args, out]);
  return out;
}

describe.skipIf(noTools)("detectEvents", () => {
  // 25 fps, 3 s: a box appears at 0.52 s, the whole frame flashes white on frame 30 (1.2 s) only, the background
  // cuts from dark blue to dark green at 2.0 s.
  const video = noTools
    ? ""
    : clip("events.mp4", [
        ...["-f", "lavfi", "-i", "color=c=0x101830:s=320x180:r=25:d=2"],
        ...["-f", "lavfi", "-i", "color=c=0x103018:s=320x180:r=25:d=1"],
        "-filter_complex",
        "[0][1]concat=n=2:v=1[bg];[bg]" +
          "drawbox=x=200:y=100:w=60:h=40:color=white:t=fill:enable='gte(n,13)'," +
          "drawbox=x=0:y=0:w=320:h=180:color=white:t=fill:enable='eq(n,30)'[v]",
        ...["-map", "[v]", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "0"],
      ]);

  it("tells an appear, a one-frame flash, a cut and a hold apart, each on its frame", () => {
    const info = probeVideo(video);
    const found = detectEvents({
      info,
      start: 0,
      end: 3,
      roi: [0, 0, 320, 180],
      grid: { cols: 4, rows: 4 },
    });
    const of = (type: string) => found.events.filter((e) => e.type === type);
    expect(of("appear").map((e) => e.frame)).toEqual([13]);
    expect(of("appear")[0]!.cells).toEqual(["r2c2", "r2c3", "r3c2", "r3c3"]);
    expect(of("flash").map((e) => [e.frame, e.frames])).toEqual([[30, 1]]);
    expect(of("cut").map((e) => e.frame)).toEqual([50]);
    expect(of("hold").length).toBeGreaterThan(0);

    const windows = lookWindows(found.events, info.fps);
    expect(windows.map((w) => w.what[0]!.split(" ")[0])).toEqual(["appear", "flash", "cut"]);
    expect(windows[1]!.onset_frames).toEqual([30]);
  });
});

describe.skipIf(noTools)("extract", () => {
  // Every frame's luma is 40 + 3 × its frame number, with B-frames so the first frame does not start at 0.
  const video = noTools
    ? ""
    : clip("counter.mp4", [
        ...[
          "-f",
          "lavfi",
          "-i",
          "nullsrc=s=64x36:r=25:d=2",
          "-vf",
          "geq=lum='40+3*N':cb=128:cr=128",
        ],
        ...["-pix_fmt", "yuv420p", "-c:v", "libx264", "-qp", "0", "-bf", "3"],
      ]);
  // Grey output is full range; the clip's luma is limited range (16–235).
  const levelOf = (path: string) => {
    const { frames } = readFrames(path, { gray: true });
    return frames.map((f) =>
      Math.round((((f.reduce((s, v) => s + v, 0) / f.length) * 219) / 255 + 16 - 40) / 3),
    );
  };

  it("cuts the still shown at a time", async () => {
    const out = join(dir, "still.png");
    const r = await cutStill(probeVideo(video), 0.52, [8, 8, 32, 16], out);
    expect(r.frame).toBe(13);
    expect(levelOf(out)).toEqual([13]);
  });

  it("cuts a clip of exactly the frames in its window at 30 fps too", () => {
    const thirty = clip("counter30.mp4", [
      ...["-f", "lavfi", "-i", "nullsrc=s=64x36:r=30:d=4", "-vf", "geq=lum='40+3*N':cb=128:cr=128"],
      ...["-pix_fmt", "yuv420p", "-c:v", "libx264", "-qp", "0", "-bf", "3"],
    ]);
    const out = join(dir, "clip30.mp4");
    const r = cutClip(probeVideo(thirty), 31 / 30, 37 / 30, [0, 0, 32, 16], out, { crf: 0 });
    expect(r.frames).toBe(6);
    expect(levelOf(out)).toEqual([31, 32, 33, 34, 35, 36]);
  });

  it("cuts a clip of exactly the frames in its window", () => {
    const out = join(dir, "clip.mp4");
    const r = cutClip(probeVideo(video), 0.4, 0.8, [0, 0, 33, 17], out, { crf: 0 });
    expect(r.frames).toBe(10);
    expect(r.roi).toEqual([0, 0, 32, 16]);
    expect(levelOf(out)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });
});
