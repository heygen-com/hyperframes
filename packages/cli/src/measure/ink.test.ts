import { describe, expect, it } from "vitest";
import { measureInk } from "./ink.js";

/** A grey region with white boxes [x, y, w, h] standing in for letters. */
function region(w: number, h: number, boxes: [number, number, number, number][]): Uint8Array {
  const px = new Uint8Array(w * h * 3).fill(40);
  for (const [bx, by, bw, bh] of boxes)
    for (let y = by; y < by + bh; y++)
      for (let x = bx; x < bx + bw; x++) px.fill(255, (y * w + x) * 3, (y * w + x) * 3 + 3);
  return px;
}

describe("measureInk", () => {
  it("reports the ink bounds and one band per line, shifted to the region's place in the frame", () => {
    const px = region(120, 60, [
      [10, 8, 40, 12],
      [30, 36, 50, 12],
    ]);
    const ink = measureInk(px, [100, 200, 120, 60]);
    expect(ink?.bounds).toEqual([110, 208, 70, 40]);
    expect(ink?.lines).toEqual([
      { y: 208, height: 12 },
      { y: 236, height: 12 },
    ]);
  });

  it("is null when nothing stands out", () => {
    expect(measureInk(region(80, 40, []), [0, 0, 80, 40])).toBeNull();
  });
});
