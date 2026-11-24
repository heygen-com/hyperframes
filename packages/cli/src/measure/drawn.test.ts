import { describe, expect, it } from "vitest";
import { DRAWN_MIN_MEAN, drawnVerdict, scoreDrawnFrame } from "./drawn.js";

const [W, H] = [160, 48];

/** A crop: a background, then bars standing in for letters (x, width) in one colour. */
function crop(
  background: (x: number, y: number) => [number, number, number],
  bars: [number, number][],
  ink: [number, number, number] = [255, 255, 255],
  dy = 0,
): Uint8Array {
  const px = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const on = y >= 10 + dy && y < 38 + dy && bars.some(([a, w]) => x >= a && x < a + w);
      px.set(on ? ink : background(x, y), (y * W + x) * 3);
    }
  return px;
}

// Two different backgrounds behind the same letters: a warm room and a cool, striped one.
const room = (x: number, y: number): [number, number, number] => [90 + (x % 7), 60 + (y % 5), 40];
const street = (x: number, _y: number): [number, number, number] => [
  30,
  70 + ((x >> 3) % 2) * 25,
  110,
];
const word: [number, number][] = [10, 30, 50, 70, 90, 110, 130].map((x) => [x, 8]);

describe("scoreDrawnFrame", () => {
  it("scores the same letters over a different background as a match", () => {
    const f = scoreDrawnFrame(crop(room, word), crop(street, word), W, H);
    expect(f.score).toBeGreaterThan(DRAWN_MIN_MEAN);
    expect(f.offset).toEqual([0, 0]);
  });

  it("forgives a pixel or two of offset and says how far", () => {
    const f = scoreDrawnFrame(crop(room, word), crop(street, word, undefined, 2), W, H);
    expect(f.score).toBeGreaterThan(DRAWN_MIN_MEAN);
    expect(f.offset).toEqual([0, 2]);
  });

  it("fails lighter weight, wider tracking, a doubled letter and another fill", () => {
    const light = word.map(([x]): [number, number] => [x, 4]);
    const wide = word.map(([x, w], i): [number, number] => [x + i * 3, w]);
    const doubled = [...word, ...word.map(([x, w]): [number, number] => [x + 12, w])];
    for (const yours of [
      crop(street, light),
      crop(street, wide),
      crop(street, doubled),
      crop(street, word, [250, 210, 0]),
    ])
      expect(scoreDrawnFrame(crop(room, word), yours, W, H).score).toBeLessThan(DRAWN_MIN_MEAN);
  });

  it("scores a missing element as nothing matched, and nothing on both sides as no frame", () => {
    expect(scoreDrawnFrame(crop(room, word), crop(street, []), W, H).score).toBeLessThan(0.5);
    const flat = () => [128, 128, 128] as [number, number, number];
    expect(scoreDrawnFrame(crop(flat, []), crop(flat, []), W, H).score).toBeNull();
  });
});

describe("drawnVerdict", () => {
  it("passes on the mean and the 5th percentile of the frames, and reports ink weight", () => {
    const good = scoreDrawnFrame(crop(room, word), crop(street, word), W, H);
    const gone = scoreDrawnFrame(crop(room, word), crop(street, []), W, H);
    const v = drawnVerdict([0, 0, W, H], [0, 1], Array(10).fill(good));
    expect(v).toMatchObject({ pass: true, frames: 10, ink: 1 });
    const bad = drawnVerdict([0, 0, W, H], [0, 1], [...Array(9).fill(good), gone]);
    expect(bad.pass).toBe(false);
    expect(drawnVerdict([0, 0, W, H], [0, 1], [])).toMatchObject({ pass: null, frames: 0 });
  });
});
