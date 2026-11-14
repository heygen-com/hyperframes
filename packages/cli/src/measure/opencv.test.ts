import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ffmpeg, loadOpenCvFirst, noTools } from "./diff.test-helpers.js";
import { flowMoves, flowSeries, similarity } from "./flow.js";
import { probeVideo } from "./media.js";
import { trackTemplate } from "./track.js";

const dir = mkdtempSync(join(tmpdir(), "hf-opencv-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("similarity", () => {
  it("recovers a shift, scale and turn despite outliers", () => {
    const [from, to]: [number[], number[]] = [[], []];
    const [s, a, tx, ty] = [1.1, (5 * Math.PI) / 180, 7, -3];
    for (let i = 0; i < 60; i++) {
      const [x, y] = [(i * 37) % 100, (i * 53) % 80];
      from.push(x, y);
      const outlier = i % 5 === 0;
      to.push(
        outlier ? x + 40 : s * (Math.cos(a) * x - Math.sin(a) * y) + tx,
        outlier ? y - 25 : s * (Math.sin(a) * x + Math.cos(a) * y) + ty,
      );
    }
    const fit = similarity(from, to)!;
    expect(fit.scale).toBeCloseTo(1.1, 3);
    expect(fit.rot).toBeCloseTo(5, 2);
    expect(fit.tx).toBeCloseTo(7, 2);
  });
});

describe.skipIf(noTools)("opencv tools", () => {
  loadOpenCvFirst();
  // A textured 48 px square slides 400 px right from 0.3 s to 1.3 s.
  const video = join(dir, "slide.mp4");
  if (!noTools) {
    execFileSync(ffmpeg!, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=48x48",
      "-frames:v",
      "1",
      join(dir, "tex.png"),
    ]);
    execFileSync(ffmpeg!, [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x202830:s=640x360:r=30:d=2"],
      ...["-loop", "1", "-i", join(dir, "tex.png"), "-filter_complex"],
      "[0][1]overlay=x='40+400*min(max((t-0.3)/1.0,0),1)':y=150:shortest=1",
      ...["-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "10", video],
    ]);
  }

  it("follows a template and fits its move", async () => {
    const r = await trackTemplate({
      info: probeVideo(video),
      at: 0,
      box: [40, 150, 48, 48],
      to: 2,
    });
    expect(r.lost).toBeNull();
    const move = r.moves.find((m) => m.prop === "x");
    expect(move).toMatchObject({ from: 64, to: 464, start_s: 0.3, duration_s: 1, ease: "none" });
  });

  it("reverses the slide from optical flow", async () => {
    const info = probeVideo(video);
    const rows = await flowSeries(info, 0, 2, [0, 100, 640, 160], 320);
    const [move] = flowMoves(rows, info.fps, [0, 100, 640, 160], 0);
    expect(move).toMatchObject({ kind: "tween", start_s: 0.3, duration_s: 1 });
    expect(Number(move!.x)).toBeGreaterThan(360);
    expect(Number(move!.x)).toBeLessThan(440);
  });
});
