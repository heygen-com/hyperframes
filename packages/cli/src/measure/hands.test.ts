import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import {
  MEDIAPIPE_DIR,
  followHand,
  handFrames,
  handPath,
  pageFile,
  pickHand,
  placeHand,
  readHands,
  type Hand,
} from "./hands.js";
import { Fix, probeVideo, runFfmpeg } from "./media.js";

const media = !!findFFmpeg() && !!findFFprobe();
const dir = mkdtempSync(join(tmpdir(), "hf-hands-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A hand whose 21 landmarks all sit at (x, y), then the ones in `moved` put elsewhere. */
function hand(side: string, x: number, y: number, moved: Record<number, [number, number]> = {}) {
  const points = Array.from({ length: 21 }, (_, i): [number, number] => moved[i] ?? [x, y]);
  return { side, points } satisfies Hand;
}

/** A hand that spans `w` x `h` from (x, y): its wrist at one corner, its little finger's tip at the other. */
const sized = (side: string, x: number, y: number, w: number, h: number) =>
  hand(side, x, y, { 20: [x + w, y + h] });

describe("placeHand", () => {
  it("puts the palm at the mean of the wrist and the four knuckles, with the hand's size", () => {
    const h = hand("Left", 0.5, 0.5, {
      0: [0.4, 0.6],
      5: [0.42, 0.5],
      9: [0.44, 0.48],
      13: [0.46, 0.5],
      17: [0.48, 0.52],
      // A fingertip far from the palm widens the hand and leaves the palm where it is.
      12: [0.6, 0.2],
    });
    expect(placeHand(h, "palm")).toEqual([0.44, 0.52, 0.2, 0.4]);
  });

  it("gives the index fingertip, and the pinch midway between it and the thumb's tip", () => {
    const h = hand("Right", 0.5, 0.5, { 4: [0.3, 0.4], 8: [0.35, 0.3] });
    expect(placeHand(h, "index_tip")).toEqual([0.35, 0.3]);
    expect(placeHand(h, "pinch")).toEqual([0.325, 0.35]);
  });

  it("rounds to four places", () => {
    const h = hand("Right", 0.5, 0.5, { 8: [0.123449, 0.98766] });
    expect(placeHand(h, "index_tip")).toEqual([0.1234, 0.9877]);
  });
});

describe("pickHand", () => {
  const small = sized("Left", 0.1, 0.1, 0.05, 0.05);
  const big = sized("Right", 0.5, 0.5, 0.2, 0.2);
  const bigger = sized("Right", 0.3, 0.3, 0.3, 0.2);

  it("follows the largest hand by default", () => {
    expect(pickHand([small, big], "largest")).toBe(big);
    expect(pickHand([big, small], "largest")).toBe(big);
  });

  it("follows the largest hand with the side asked for, however large the other is", () => {
    expect(pickHand([small, big], "left")).toBe(small);
    expect(pickHand([big, bigger, small], "right")).toBe(bigger);
  });

  it("keeps the first of two hands the same size", () => {
    // Quarters, so both areas are the same number exactly.
    const [one, twin] = [
      sized("Right", 0.5, 0.25, 0.25, 0.25),
      sized("Left", 0.25, 0.5, 0.25, 0.25),
    ];
    expect(pickHand([one, twin], "largest")).toBe(one);
    expect(pickHand([twin, one], "largest")).toBe(twin);
  });

  it("finds none when no hand, or none on that side, is in the frame", () => {
    expect(pickHand([], "largest")).toBeNull();
    expect(pickHand([big], "left")).toBeNull();
  });
});

describe("handPath", () => {
  it("leaves a frame without the hand null between the frames that have it", () => {
    const left = (x: number) => hand("Left", x, 0.5, { 8: [x, 0.25] });
    const frames = [[left(0.2)], [], [hand("Right", 0.9, 0.9)], [left(0.4)]];
    expect(handPath(frames, "index_tip", "left")).toEqual([[0.2, 0.25], null, null, [0.4, 0.25]]);
    expect(handPath(frames, "index_tip", "largest")[2]).toEqual([0.9, 0.9]);
  });
});

describe("readHands", () => {
  it("takes what the page answers", () => {
    const answer: unknown = JSON.parse(JSON.stringify([hand("Left", 0.5, 0.5)]));
    expect(readHands(answer)).toEqual([hand("Left", 0.5, 0.5)]);
    expect(readHands([])).toEqual([]);
  });

  it("refuses an answer that is not hands of 21 landmarks", () => {
    const short = { side: "Left", points: [[0.5, 0.5]] };
    const unlabelled = { points: hand("Left", 0.5, 0.5).points };
    const holed = { side: "Left", points: hand("Left", 0.5, 0.5).points.map(() => [0.5, null]) };
    for (const bad of [null, "hands", [short], [unlabelled], [holed]])
      expect(() => readHands(bad)).toThrow(/shape/);
  });
});

describe("pageFile", () => {
  it("answers the page, the pinned files and the stretch's frames, and nothing else", () => {
    expect(pageFile("/", dir)?.text).toContain("HandLandmarker");
    expect(pageFile("/vision_wasm_internal.wasm", dir)).toEqual({
      type: "application/wasm",
      file: join(MEDIAPIPE_DIR, "vision_wasm_internal.wasm"),
    });
    expect(pageFile("/frames/t00012.jpg", dir)).toEqual({
      type: "image/jpeg",
      file: join(dir, "t00012.jpg"),
    });
    for (const path of ["/frames/../t00012.jpg", "/frames/notes.txt", "/etc/passwd", "/frames/"])
      expect(pageFile(path, dir)).toBeNull();
  });
});

describe.skipIf(!media)("handFrames", () => {
  it("writes the stretch at the asked rate, 480 wide, one frame a step from its start", () => {
    const video = join(dir, "clip.mp4");
    runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x240:rate=30:duration=2",
      "-pix_fmt",
      "yuv420p",
      video,
    ]);
    const out = mkdtempSync(join(dir, "frames-"));
    const names = handFrames(probeVideo(video), 0.5, 1.5, 15, out);
    expect(names).toHaveLength(15);
    expect(names[0]).toBe("t00001.jpg");
    expect(names.at(-1)).toBe("t00015.jpg");
    const first = probeVideo(join(out, "t00001.jpg"));
    expect([first.width, first.height]).toEqual([480, 360]);
  });

  it("refuses a stretch longer than it follows before reading a frame", async () => {
    const video = join(dir, "long.mp4");
    runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=gray:size=64x64:rate=5:duration=16",
      "-pix_fmt",
      "yuv420p",
      video,
    ]);
    const opts = { point: "palm", which: "largest", fps: 15 } as const;
    const refused = followHand(probeVideo(video), 0, 16, opts);
    await expect(refused).rejects.toBeInstanceOf(Fix);
    await expect(refused).rejects.toMatchObject({ fix: "--start 0 --end 15" });
  });
});
