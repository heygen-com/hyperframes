import { describe, expect, it } from "vitest";
import { newFramesIn, slideOutWatched, type Shot } from "./slideOutWatch.js";

const shot = (hash: string, clockBefore: number, clockAfter: number): Shot => ({
  hash,
  clockBefore,
  clockAfter,
});
const SLIDE_OUT = { startS: 1.6, endS: 2 };
const HOLD = [shot("in", 0, 0.2), shot("hold", 0.2, 0.43), shot("hold", 0.43, 1.55)];

describe("watching a preview through its slide-out", () => {
  it("keeps watching when one shot spans the whole start of the slide-out", () => {
    const spanning = [...HOLD, shot("out", 1.55, 1.85)];
    expect(newFramesIn(spanning, SLIDE_OUT)).toBe(0);
    expect(slideOutWatched(spanning, SLIDE_OUT)).toBe(false);
    const next = [...spanning, shot("out2", 1.85, 1.95)];
    expect(slideOutWatched(next, SLIDE_OUT)).toBe(true);
  });

  it("stops once a shot taken inside the slide-out shows a frame the hold never showed", () => {
    const shots = [...HOLD, shot("hold", 1.55, 1.62), shot("out", 1.62, 1.84)];
    expect(newFramesIn(shots, SLIDE_OUT)).toBe(1);
    expect(slideOutWatched(shots, SLIDE_OUT)).toBe(true);
  });

  it("counts no new frame for a frozen preview, and ignores the frame after the end of the film", () => {
    const frozen = [...HOLD, shot("hold", 1.55, 1.62), shot("hold", 1.62, 1.96), shot("end", 2, 2)];
    expect(newFramesIn(frozen, SLIDE_OUT)).toBe(0);
    expect(slideOutWatched(frozen.slice(0, 3), SLIDE_OUT)).toBe(false);
    expect(slideOutWatched(frozen, SLIDE_OUT)).toBe(true);
    expect(newFramesIn(frozen, SLIDE_OUT)).toBe(0);
  });
});
