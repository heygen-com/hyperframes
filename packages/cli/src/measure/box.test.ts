import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { boxAt, boxRange } from "./box.js";
import { probeVideo, type Roi } from "./media.js";

const ffmpeg = findFFmpeg();
const dir = mkdtempSync(join(tmpdir(), "hf-box-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function clip(name: string, overlayX: string): string {
  const out = join(dir, name);
  execFileSync(ffmpeg!, [
    ...["-nostdin", "-v", "error", "-y"],
    ...["-f", "lavfi", "-i", "color=0x101820:s=320x180:d=1.2:r=30"],
    ...["-f", "lavfi", "-i", "color=0xff8000:s=60x30:d=1.2:r=30"],
    ...["-filter_complex", `[0][1]overlay=x='${overlayX}':y=40`],
    ...["-pix_fmt", "yuv444p", "-c:v", "libx264", "-crf", "0", out],
  ]);
  return out;
}

const options = (video: string) => {
  const roi: Roi = [0, 0, 320, 180];
  return { video, info: probeVideo(video), roi, color: "auto", tol: 40, dir };
};

describe.skipIf(!ffmpeg || !findFFprobe())("box", () => {
  it("finds a coloured box by its colour at one time", () => {
    const r = boxAt(options(clip("still.mp4", "100")), 0.5);
    expect(r.color).toMatch(/^#f[0-9a-f]8/);
    const want = { x: 100, y: 40, w: 60, h: 30 };
    for (const k of ["x", "y", "w", "h"] as const)
      expect(Math.abs(r.box[k] - want[k])).toBeLessThanOrEqual(2);
  });

  it("tracks a linear slide as one x move", () => {
    const r = boxRange(options(clip("slide.mp4", "20+400*min(max(t-0.3,0),0.5)")), 0, 1.2, true);
    expect(r.first_seen_s).toBe(0);
    const moves = "moves" in r ? r.moves : [];
    const xs = moves.filter((m) => m.prop === "x");
    expect(xs).toHaveLength(1);
    expect(moves.filter((m) => m.prop === "w" || m.prop === "h")).toHaveLength(0);
    expect(xs[0]!.start_s).toBeCloseTo(0.3, 1);
  });
});
