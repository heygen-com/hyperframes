import { describe, expect, it } from "vitest";
import { confirmsCut, cutsIn, findCuts, SIG_H, SIG_W } from "./cuts.js";

/** Frame changes: `base` everywhere, with the given changes at their frames. */
const changes = (n: number, base: number, at: Record<number, number>) =>
  Array.from({ length: n }, (_, i) => (i === 0 ? 0 : (at[i] ?? base)));

describe("cutsIn", () => {
  it("finds a hard cut and a two-frame whip as one cut", () => {
    expect(cutsIn(changes(60, 1, { 20: 40, 40: 30, 41: 25 }))).toEqual([
      { frame: 20, frames: 1, change: 40 },
      { frame: 40, frames: 2, change: 30 },
    ]);
  });

  it("finds a soft same-angle punch-in that nothing near it rivals", () => {
    // dan 9.743 s: 11.3 grey levels against neighbours of about 1.
    expect(cutsIn(changes(60, 1, { 30: 11.3 }))).toEqual([
      { frame: 30, frames: 1, change: 11.3, soft: true },
    ]);
  });

  it("leaves a smaller change among moving frames or a stepped animation alone", () => {
    // Hands moving: neighbours up to 5, so 11 is not alone.
    expect(cutsIn(changes(60, 1, { 25: 5, 30: 11 }))).toEqual([]);
    // A 15 fps animation in a 30 fps file changes every other frame by about as much.
    const stepped = Array.from({ length: 60 }, (_, i) => (i % 2 ? 0 : 10.5));
    expect(cutsIn(stepped)).toEqual([]);
    expect(cutsIn(changes(60, 1, { 30: 9 }))).toEqual([]);
  });
});

describe("confirmsCut", () => {
  it("matches a soft cut with a clear change within a frame on the other side", () => {
    const cut = { frame: 30, frames: 1, change: 11.3, soft: true as const };
    expect(confirmsCut(changes(60, 1, { 31: 7 }), cut)).toBe(true);
    expect(confirmsCut(changes(60, 1, { 32: 7 }), cut)).toBe(false);
    expect(confirmsCut(changes(60, 1, { 30: 4 }), cut)).toBe(false);
    expect(confirmsCut(changes(60, 2, { 30: 7 }), cut)).toBe(false);
  });
});

describe("findCuts", () => {
  it("reads changes from grey frames", () => {
    const frame = (v: number) => new Uint8Array(SIG_W * SIG_H).fill(v);
    const frames = [
      ...Array.from({ length: 20 }, () => frame(100)),
      ...Array.from({ length: 20 }, () => frame(140)),
    ];
    expect(findCuts(frames)).toEqual([{ frame: 20, frames: 1, change: 40 }]);
  });
});
