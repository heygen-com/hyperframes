import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { faceSummary, faceVerdict } from "./face.js";
import { flowMoves, flowSeries, similarity } from "./flow.js";
import { probeVideo } from "./media.js";
import { OPENCV_DIR } from "./opencv.js";
import { trackTemplate } from "./track.js";

// opencv.js is downloaded on first use. Tests run in a home folder of their own, so they borrow this machine's
// verified cache when it has one and skip otherwise, rather than download 11 MB on every CI box.
const cached = join(userInfo().homedir, ".cache", "hyperframes", "opencv", "4.10.0");
if (existsSync(join(cached, "opencv.js")) && !existsSync(join(OPENCV_DIR, "opencv.js")))
  cpSync(cached, OPENCV_DIR, { recursive: true });
const ready = !!findFFmpeg() && !!findFFprobe() && existsSync(join(OPENCV_DIR, "opencv.js"));
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

describe("faces", () => {
  it("grades the subject's face by its height", () => {
    expect(faceVerdict(0.3)).toBe("pass");
    expect(faceVerdict(0.1)).toBe("warn");
    expect(faceVerdict(0.1, true)).toBe("fail");
    expect(faceVerdict(null)).toBe("unmeasured");
    const r = faceSummary([
      {
        frame: 0,
        t: 0,
        boxes: [
          [0.4, 0.2, 0.2, 0.3],
          [0.1, 0.1, 0.05, 0.08],
        ],
      },
      { frame: 5, t: 0.2, boxes: [] },
    ]);
    expect(r.face_height).toBe(0.3);
    expect(r.verdict).toBe("unmeasured");
  });
});

describe.skipIf(!ready)("opencv tools", () => {
  // A textured 48 px square slides 400 px right from 0.3 s to 1.3 s.
  const video = join(dir, "slide.mp4");
  if (ready) {
    const ff = findFFmpeg()!;
    execFileSync(ff, [
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
    execFileSync(ff, [
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
