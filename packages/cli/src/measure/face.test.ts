import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { againstStart, faceBoxes, faceFit, minWindow, readSamples, sampleFrames } from "./face.js";
import { probeVideo, runFfmpeg } from "./media.js";
import { OPENCV_DIR } from "./opencv.js";

// As in opencv.test.ts: borrow this machine's verified opencv.js cache, skip without one.
const cached = join(userInfo().homedir, ".cache", "hyperframes", "opencv", "4.10.0");
if (existsSync(join(cached, "opencv.js")) && !existsSync(join(OPENCV_DIR, "opencv.js")))
  cpSync(cached, OPENCV_DIR, { recursive: true });
const media = !!findFFmpeg() && !!findFFprobe();
const opencv = media && existsSync(join(OPENCV_DIR, "opencv.js"));
const dir = mkdtempSync(join(tmpdir(), "hf-face-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("sampleFrames", () => {
  it("spreads the samples evenly, the last frame included, each once", () => {
    expect(sampleFrames(30, 0, 1, 4)).toEqual([0, 10, 19, 29]);
    expect(sampleFrames(30, 2, 2.1, 12)).toEqual([60, 61, 62]);
    expect(sampleFrames(24, 1, 1.01, 8)).toEqual([24]);
  });
});

describe("minWindow", () => {
  it("is a step of the cascades' 20 px x 1.1 ladder, no larger than the share", () => {
    expect(minWindow(1280, 0)).toBe(20);
    expect(minWindow(400, 0.04)).toBe(20);
    // 4% of 1280 is 51.2 px: 20 x 1.1^9 = 47.2 is the last step under it.
    expect(minWindow(1280, 0.04)).toBe(47);
    expect(minWindow(1080, 0.04)).toBe(43);
  });
});

describe("againstStart", () => {
  it("reads a generated shot from its own start and a full render on film time", () => {
    // A 5.2 s HeyGen shot for the original's 9.5-12.27 s: its face is at 0-2.77 s of the clip, not 9.5.
    expect(againstStart(5.17, 12.27, 9.5)).toBe(0);
    // A shot longer than the window but shorter than the film is still its own clip.
    expect(againstStart(7.29, 12.27, 2.77)).toBe(0);
    expect(againstStart(12.27, 12.27, 9.5)).toBe(9.5);
    expect(againstStart(12.3, 12.27, 9.5)).toBe(9.5);
  });
});

describe("faceFit", () => {
  const at = (t: number, ...boxes: number[][]) => ({ t, boxes });
  const canvas = { width: 720, height: 1280 };

  it("gives the scale about the centre and the x, y that land the clip's face on the original's", () => {
    // The clip's face, 0.1 high at (0.5, 0.4); the original's twice the size, 10 px right and 20 px up of where
    // scaling about the centre puts it: centre y 640 + 2 (512 - 640) - 20 = 364.
    const clip = [0, 0.5, 1, 1.5].map((t) => at(t, [0.45, 0.35, 0.1, 0.1]));
    const [w, h] = [0.2, 0.2];
    const [cx, cy] = [(360 + 10) / 720, 364 / 1280];
    const original = [0, 0.5, 1, 1.5].map((t) =>
      at(t, [cx - w / 2, cy - h / 2, w, h], [0.05, 0.05, 0.03, 0.03]),
    );
    const fit = faceFit(original, clip, canvas, canvas);
    expect(fit.moments).toBe(4);
    expect(fit.transform).toEqual({ scale: 2, x: 10, y: -20 });
    expect(fit.residual).toBe(0);
  });

  it("fits a clip of another size through object-fit: cover, and shrugs off a stray moment", () => {
    // 768x1344 under a 720x1280 canvas: cover scales it by 1280/1344 and crops its sides; its face then sits
    // where the original's is, at the same height, so nothing moves.
    const s0 = 1280 / 1344;
    const ox = (720 - 768 * s0) / 2;
    const [fx, fy, fh] = [360, 500, 200];
    const clipBox = [
      (fx - ox - fh / 2) / (768 * s0),
      (fy - fh / 2) / 1280,
      fh / (768 * s0),
      fh / 1280,
    ];
    const origBox = [(fx - fh / 2) / 720, (fy - fh / 2) / 1280, fh / 720, fh / 1280];
    const clip = [0, 0.25, 0.5, 0.75, 1].map((t) => at(t, clipBox));
    const original = [0, 0.25, 0.5, 0.75, 1].map((t, i) =>
      at(t + 0.02, i === 2 ? [0.1, 0.1, 0.4, 0.4] : origBox),
    );
    const fit = faceFit(original, clip, canvas, { width: 768, height: 1344 });
    expect(fit.transform).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("gives no transform without faces on both sides at enough moments", () => {
    const fit = faceFit(
      [at(0, [0.4, 0.3, 0.2, 0.1]), at(1)],
      [at(0, [0.4, 0.3, 0.2, 0.1]), at(1, [0.4, 0.3, 0.2, 0.1])],
      canvas,
      canvas,
    );
    expect(fit).toEqual({ moments: 1, transform: null });
    // Moments farther apart than a tenth of a second do not pair.
    expect(
      faceFit(
        [at(0, [0.4, 0.3, 0.2, 0.1]), at(1, [0.4, 0.3, 0.2, 0.1])],
        [at(0.5, [0.4, 0.3, 0.2, 0.1]), at(1.5, [0.4, 0.3, 0.2, 0.1])],
        canvas,
        canvas,
      ).transform,
    ).toBeNull();
  });
});

describe.skipIf(!media)("readSamples", () => {
  // Every frame different, keyframes 2.5 s apart and B-frames: what a seek has to get right.
  const video = join(dir, "frames.mp4");
  if (media)
    execFileSync(findFFmpeg()!, [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x96:r=30:d=8"],
      ...["-c:v", "libx264", "-g", "75", "-bf", "2", "-pix_fmt", "yuv420p", video],
    ]);

  it("seeks to the same frames that decoding from the start picks", () => {
    const info = probeVideo(video);
    // Nearby samples (one pass) and samples seconds apart (a seek each), off and on keyframes.
    const ks = [1, 2, 40, 74, 75, 76, 140, 141, 210, 239];
    const got = readSamples(info, ks, 80, 48);
    const raw = runFfmpeg([
      ...["-i", video, "-an", "-vf"],
      `select=${ks.map((k) => `eq(n\\,${k})`).join("+")},scale=80:48,format=gray`,
      ...["-fps_mode", "passthrough", "-f", "rawvideo", "-"],
    ]);
    expect(got).toHaveLength(ks.length);
    got.forEach((f, i) =>
      expect(Buffer.compare(f, raw.subarray(i * 80 * 48, (i + 1) * 80 * 48))).toBe(0),
    );
  });
});

describe.skipIf(!opencv)("faceBoxes", () => {
  const video = join(dir, "blank.mp4");
  if (opencv)
    execFileSync(findFFmpeg()!, [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x406080:s=320x568:r=30:d=4"],
      ...["-c:v", "libx264", "-pix_fmt", "yuv420p", video],
    ]);

  it("labels every sampled frame and finds no face in a blank one", async () => {
    const r = await faceBoxes(probeVideo(video), 1, 3, 5);
    expect(r.map((s) => s.frame)).toEqual([30, 45, 60, 74, 89]);
    expect(r.map((s) => s.t)).toEqual([1, 1.5, 2, 2.467, 2.967]);
    expect(r.every((s) => s.boxes.length === 0)).toBe(true);
  });
});
