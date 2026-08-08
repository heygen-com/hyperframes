import { describe, expect, it } from "vitest";
import {
  boundsDeviation,
  inkBounds,
  meanAbsDiff,
  meanSignedDiff,
  parseSsimAll,
  redCyanOverlayRaw,
} from "./referenceDiff.js";

/** Dark canvas with one bright rectangle of ink. */
function frameWithBox(
  width: number,
  height: number,
  box: { x: number; y: number; w: number; h: number },
): Uint8Array {
  const plane = new Uint8Array(width * height).fill(10);
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) plane[y * width + x] = 240;
  }
  return plane;
}

describe("inkBounds", () => {
  it("brackets the ink and ignores the background", () => {
    const bounds = inkBounds(frameWithBox(40, 20, { x: 10, y: 4, w: 8, h: 6 }), 40, 20);
    expect(bounds).toMatchObject({ x0: 10, y0: 4, x1: 17, y1: 9, width: 8, height: 6 });
    expect(bounds.cx).toBe(14);
    expect(bounds.cy).toBe(7);
    expect(bounds.empty).toBe(false);
  });

  it("reports empty for a flat frame", () => {
    expect(inkBounds(new Uint8Array(40 * 20).fill(128), 40, 20).empty).toBe(true);
  });
});

describe("boundsDeviation", () => {
  it("measures replica-minus-reference size and centre offsets", () => {
    const reference = inkBounds(frameWithBox(40, 20, { x: 10, y: 4, w: 8, h: 6 }), 40, 20);
    const replica = inkBounds(frameWithBox(40, 20, { x: 14, y: 4, w: 12, h: 6 }), 40, 20);
    const deviation = boundsDeviation(reference, replica);
    expect(deviation.dw).toBe(4);
    expect(deviation.dh).toBe(0);
    expect(deviation.dcx).toBe(6);
    expect(deviation.dcy).toBe(0);
    expect(deviation.scale).toBe(1.5);
  });

  it("reports zero scale when the reference has no ink", () => {
    const empty = inkBounds(new Uint8Array(16).fill(128), 4, 4);
    const replica = inkBounds(frameWithBox(4, 4, { x: 1, y: 1, w: 2, h: 2 }), 4, 4);
    expect(boundsDeviation(empty, replica).scale).toBe(0);
  });
});

describe("meanAbsDiff", () => {
  it("is 0 for identical planes and 1 for inverted ones", () => {
    const plane = frameWithBox(8, 8, { x: 2, y: 2, w: 3, h: 3 });
    expect(meanAbsDiff(plane, plane)).toBe(0);
    expect(meanAbsDiff(new Uint8Array(64).fill(0), new Uint8Array(64).fill(255))).toBe(1);
  });
});

describe("meanSignedDiff", () => {
  it("matches meanAbsDiff when the replica is uniformly brighter", () => {
    const reference = new Uint8Array(64).fill(100);
    const replica = new Uint8Array(64).fill(110);
    expect(meanSignedDiff(reference, replica)).toBeCloseTo(meanAbsDiff(reference, replica), 6);
  });

  it("cancels to ~0 when the deviation is localized in both directions", () => {
    const reference = new Uint8Array(64).fill(100);
    const replica = new Uint8Array(64).fill(100);
    replica[0] = 200;
    replica[1] = 0;
    expect(meanSignedDiff(reference, replica)).toBeCloseTo(0, 6);
    expect(meanAbsDiff(reference, replica)).toBeGreaterThan(0);
  });
});

describe("redCyanOverlayRaw", () => {
  it("puts the reference in red and the replica in green+blue", () => {
    const overlay = redCyanOverlayRaw(new Uint8Array([200, 0]), new Uint8Array([0, 100]), 2, 1);
    expect([...overlay]).toEqual([200, 0, 0, 0, 100, 100]);
  });
});

describe("parseSsimAll", () => {
  it("reads the last All: value ffmpeg printed", () => {
    const stderr = "[Parsed_ssim_0 @ 0x1] SSIM Y:0.97 U:0.99 V:0.99 All:0.9612 (14.10)\n";
    expect(parseSsimAll(stderr)).toBeCloseTo(0.9612, 4);
  });

  it("returns null when ffmpeg printed no SSIM line", () => {
    expect(parseSsimAll("Invalid argument\n")).toBeNull();
  });
});
