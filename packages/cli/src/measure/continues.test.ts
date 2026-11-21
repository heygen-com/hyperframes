import { describe, expect, it } from "vitest";
import { continuedShots, sameSetup, setupLikeness } from "./continues.js";
import { findCuts, SIG_H, SIG_W, type Cut } from "./cuts.js";

/** A room: 40 boxes of seeded sizes and grey levels on a mid-grey wall, so every part of the frame has edges. */
function room(seed: number): Uint8Array {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const f = new Uint8Array(SIG_W * SIG_H).fill(120);
  for (let k = 0; k < 40; k++) {
    const [x0, y0] = [Math.floor(next() * SIG_W), Math.floor(next() * SIG_H)];
    const [w, h, level] = [4 + Math.floor(next() * 14), 3 + Math.floor(next() * 10), next() * 255];
    for (let y = y0; y < Math.min(SIG_H, y0 + h); y++)
      for (let x = x0; x < Math.min(SIG_W, x0 + w); x++) f[y * SIG_W + x] = level;
  }
  return f;
}

/** `f` with a box of `level` drawn over it: a person standing at x, or a title. */
function over(f: Uint8Array, x0: number, y0: number, w: number, h: number, level = 20) {
  const out = Uint8Array.from(f);
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out[y * SIG_W + x] = level;
  return out;
}

const person = (f: Uint8Array, x: number) => over(f, x, 14, 6, 16);

/** `f` scaled by `s` about the centre and shifted right by `dx` pixels, edges held. */
function moved(f: Uint8Array, s: number, dx = 0): Uint8Array {
  const out = new Uint8Array(f.length);
  const [cx, cy] = [(SIG_W - 1) / 2, (SIG_H - 1) / 2];
  for (let y = 0; y < SIG_H; y++)
    for (let x = 0; x < SIG_W; x++) {
      const sx = Math.min(SIG_W - 1, Math.max(0, Math.round((x - cx - dx) / s + cx)));
      const sy = Math.min(SIG_H - 1, Math.max(0, Math.round((y - cy) / s + cy)));
      out[y * SIG_W + x] = f[sy * SIG_W + sx]!;
    }
  return out;
}

const hold = (f: Uint8Array, n: number) => Array.from({ length: n }, () => f);
const cut = (frame: number, frames = 1): Cut => ({ frame, frames, change: 40 });

describe("sameSetup", () => {
  const wide = room(1);
  const other = room(2);

  it("knows a setup again when the person in it has moved and the exposure has drifted", () => {
    const later = person(wide, 41).map((v) => Math.min(255, v * 1.1 + 6));
    expect(sameSetup([person(wide, 9)], [later])).toBe(true);
    expect(setupLikeness([wide], [wide])).toEqual({ textured: 48, agreeing: 48 });
  });

  it("tells two scenes apart, with or without the same person in the same place", () => {
    expect(sameSetup([wide], [other])).toBe(false);
    expect(sameSetup([person(wide, 25)], [person(other, 25)])).toBe(false);
  });

  it("allows a title over part of the frame", () => {
    expect(sameSetup([over(wide, 16, 0, 32, 6, 250)], [person(wide, 33)])).toBe(true);
  });

  it("allows a pixel of drift, and refuses a punch-in on the same scene", () => {
    expect(sameSetup([wide], [moved(wide, 1, 1)])).toBe(true);
    expect(sameSetup([wide], [moved(wide, 1.3)])).toBe(false);
  });

  it("refuses a flat card against anything, itself included: there is nothing to compare", () => {
    const card = new Uint8Array(SIG_W * SIG_H).fill(160);
    expect(sameSetup([card], [wide])).toBe(false);
    expect(sameSetup([wide], [card])).toBe(false);
    expect(sameSetup([card], [card])).toBe(false);
  });

  it("refuses a split screen that keeps its top half and changes its bottom half", () => {
    const split = (bottom: Uint8Array) =>
      wide.map((v, i) => (i < (SIG_W * SIG_H) / 2 ? v : bottom[i]!));
    // The kept half agrees, less a cell at the seam: about half the frame, well under the bar.
    expect(setupLikeness([split(other)], [split(room(3))])).toEqual({ textured: 48, agreeing: 23 });
    expect(sameSetup([split(other)], [split(room(3))])).toBe(false);
    expect(sameSetup([split(other)], [split(other)])).toBe(true);
  });

  it("reads the median of three frames, so one flashed frame at a cut does not count", () => {
    const flash = new Uint8Array(SIG_W * SIG_H).fill(250);
    expect(sameSetup([wide, wide, wide], [flash, wide, wide])).toBe(true);
    expect(sameSetup([wide], [flash])).toBe(false);
  });
});

describe("continuedShots", () => {
  const wide = room(1);
  const insert = room(2);
  const third = room(3);

  it("names the shot a take resumes after an insert, the person further along", () => {
    // A wide shot, a close-up cut into it, and the wide shot again.
    const frames = [
      ...hold(person(wide, 9), 20),
      ...hold(insert, 10),
      ...hold(person(wide, 41), 20),
    ];
    const cuts = findCuts(frames);
    expect(cuts.map((c) => c.frame)).toEqual([20, 30]);
    expect(continuedShots(frames, cuts)).toEqual([undefined, undefined, 0]);
  });

  it("names nothing among three different shots, or for a single shot", () => {
    const frames = [...hold(wide, 10), ...hold(insert, 10), ...hold(third, 10)];
    expect(continuedShots(frames, [cut(10), cut(20)])).toEqual([undefined, undefined, undefined]);
    expect(continuedShots(hold(wide, 10), [])).toEqual([undefined]);
  });

  it("names the most recent shot of the setup, where the take was left", () => {
    // Wide, a jump cut in the wide take, an insert, the wide take again.
    const frames = [
      ...hold(person(wide, 9), 10),
      ...hold(person(wide, 25), 10),
      ...hold(insert, 10),
      ...hold(person(wide, 41), 10),
    ];
    expect(continuedShots(frames, [cut(10), cut(20), cut(30)])).toEqual([
      undefined,
      undefined,
      undefined,
      1,
    ]);
  });

  it("leaves a jump cut alone: a shot that matches the one before it resumes nothing", () => {
    // Wide, an insert, wide again, then a jump cut in that wide take.
    const frames = [
      ...hold(person(wide, 9), 10),
      ...hold(insert, 10),
      ...hold(person(wide, 25), 10),
      ...hold(person(wide, 41), 10),
    ];
    expect(continuedShots(frames, [cut(10), cut(20), cut(30)])).toEqual([
      undefined,
      undefined,
      0,
      undefined,
    ]);
  });

  it("follows two setups cut back and forth", () => {
    const frames = [wide, insert, wide, insert, wide].flatMap((f) => hold(f, 10));
    expect(continuedShots(frames, [cut(10), cut(20), cut(30), cut(40)])).toEqual([
      undefined,
      undefined,
      0,
      1,
      2,
    ]);
  });

  it("compares where a shot was left with where the next one starts, not its first frames", () => {
    // The wide shot pans away to another view before the insert: the take was left there, so nothing resumes.
    const frames = [...hold(wide, 10), ...hold(third, 10), ...hold(insert, 10), ...hold(wide, 10)];
    expect(continuedShots(frames, [cut(20), cut(30)])).toEqual([undefined, undefined, undefined]);
  });

  it("starts a shot after its transition: a three-frame dissolve back into the take still resumes it", () => {
    const mix = (k: number) => wide.map((v, i) => (insert[i]! * (3 - k) + v * k) / 3);
    const frames = [...hold(wide, 10), ...hold(insert, 10), mix(1), mix(2), ...hold(wide, 10)];
    expect(continuedShots(frames, [cut(10), cut(20, 3)])).toEqual([undefined, undefined, 0]);
  });
});
