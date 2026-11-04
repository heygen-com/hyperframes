import { describe, expect, it } from "vitest";
import {
  compareTiles,
  meanFrame,
  tileTouches,
  tilesOutsideRegion,
  trailMask,
  withinSymptomBand,
  type Rgba,
} from "./blurDifferential.js";

const SIZE = 64;

function frame(gray = 0): Rgba {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
    data[i + 3] = 255;
  }
  return { width: SIZE, height: SIZE, data };
}

function withRect(base: Rgba, x: number, y: number, w: number, h: number, gray = 255): Rgba {
  const out = { ...base, data: base.data.slice() };
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      const i = (row * SIZE + col) * 4;
      out.data[i] = gray;
      out.data[i + 1] = gray;
      out.data[i + 2] = gray;
    }
  }
  return out;
}

function maskAt(mask: Uint8Array, x: number, y: number): number {
  return mask[y * SIZE + x] ?? -1;
}

function leftHalfMask(): Uint8Array {
  const mask = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) mask.fill(1, y * SIZE, y * SIZE + SIZE / 2);
  return mask;
}

describe("trailMask", () => {
  it("marks the pixels that change across the frames, dilated", () => {
    const a = withRect(frame(), 10, 20, 4, 4);
    const b = withRect(frame(), 18, 20, 4, 4);
    const mask = trailMask([a, b], 3);
    expect(maskAt(mask, 10, 20)).toBe(1);
    expect(maskAt(mask, 21, 23)).toBe(1);
    expect(maskAt(mask, 7, 17)).toBe(1);
    expect(maskAt(mask, 24, 26)).toBe(1);
    expect(maskAt(mask, 6, 20)).toBe(0);
    expect(maskAt(mask, 25, 20)).toBe(0);
    expect(maskAt(mask, 15, 27)).toBe(0);
    expect(maskAt(mask, 15, 16)).toBe(0);
    expect(maskAt(mask, 60, 60)).toBe(0);
  });

  it("does not mark differences of 2 or less", () => {
    const a = frame(100);
    const b = frame(102);
    expect(trailMask([a, b], 0).every((v) => v === 0)).toBe(true);
    expect(trailMask([a, frame(103)], 0).every((v) => v === 1)).toBe(true);
  });

  it("of identical frames is empty", () => {
    const a = withRect(frame(), 10, 10, 8, 8);
    expect(trailMask([a, a, a], 4).every((v) => v === 0)).toBe(true);
  });

  it("throws on mismatched sizes", () => {
    const small = { width: 32, height: 32, data: new Uint8Array(32 * 32 * 4) };
    expect(() => trailMask([frame(), small], 2)).toThrow(/size/i);
  });
});

describe("meanFrame", () => {
  it("averages per channel", () => {
    const mean = meanFrame([frame(0), frame(255)]);
    expect(mean.width).toBe(SIZE);
    expect(mean.height).toBe(SIZE);
    expect(mean.data[0]).toBe(128);
    expect(mean.data[1]).toBe(128);
    expect(mean.data[2]).toBe(128);
    expect(mean.data[3]).toBe(255);
  });

  it("throws on mismatched sizes", () => {
    const small = { width: 32, height: 32, data: new Uint8Array(32 * 32 * 4) };
    expect(() => meanFrame([frame(), small])).toThrow(/size/i);
  });
});

describe("compareTiles", () => {
  it("outside ignores a difference inside the mask", () => {
    const reference = frame();
    const actual = withRect(frame(), 4, 4, 8, 8);
    const mask = new Uint8Array(SIZE * SIZE);
    for (let y = 0; y < 16; y++) mask.fill(1, y * SIZE, y * SIZE + 16);
    const result = compareTiles(reference, actual, mask, "outside");
    expect(result.bad).toEqual([]);
    expect(result.worstMae).toBe(0);
    expect(result.checkedBlocks).toBe(15);
    expect(result.blocks).toBe(16);
  });

  it("outside flags a displaced block outside the mask", () => {
    const reference = withRect(frame(), 0, 8, 24, 24);
    const actual = withRect(frame(), 40, 8, 24, 24);
    const result = compareTiles(reference, actual, new Uint8Array(SIZE * SIZE), "outside");
    expect(result.bad.length).toBeGreaterThan(0);
    const block = result.bad.find((b) => b.x === 0 && b.y === 16);
    expect(block).toBeDefined();
    expect(block?.mae).toBeGreaterThan(8);
    expect(result.bad.some((b) => b.x === 48 && b.y === 16)).toBe(true);
    expect(result.worstMae).toBe(255);
  });

  it("inside flags a missing half of a moving element", () => {
    const first = withRect(frame(), 8, 24, 32, 16);
    const second = withRect(frame(), 24, 24, 32, 16);
    const reference = meanFrame([first, second]);
    const mask = trailMask([first, second], 2);
    const fullActual = meanFrame([first, second]);
    expect(compareTiles(reference, fullActual, mask, "inside").bad).toEqual([]);

    const halfActual = withRect(fullActual, 32, 24, 24, 16, 0);
    const result = compareTiles(reference, halfActual, mask, "inside");
    expect(result.bad.length).toBeGreaterThanOrEqual(1);
    expect(result.bad.every((b) => b.mae > 8)).toBe(true);
  });

  it("tolerates anti-aliasing-sized noise", () => {
    const reference = withRect(frame(100), 20, 20, 16, 16, 200);
    const actual = { ...reference, data: reference.data.slice() };
    for (let i = 0; i < actual.data.length; i += 4) {
      const delta = (i / 4) % 2 === 0 ? 3 : -3;
      for (let c = 0; c < 3; c++) actual.data[i + c] = (actual.data[i + c] ?? 0) + delta;
    }
    const mask = new Uint8Array(SIZE * SIZE);
    for (let y = 16; y < 40; y++) mask.fill(1, y * SIZE + 16, y * SIZE + 40);
    for (const region of ["outside", "inside"] as const) {
      const result = compareTiles(reference, actual, mask, region);
      expect(result.bad).toEqual([]);
      expect(result.checkedBlocks).toBeGreaterThan(0);
      expect(result.worstMae).toBeLessThanOrEqual(3);
    }
  });

  it("reports checkedFraction as the share of pixels in checked tiles", () => {
    const mask = leftHalfMask();
    const outside = compareTiles(frame(), frame(), mask, "outside");
    const inside = compareTiles(frame(), frame(), mask, "inside");
    expect(outside.checkedFraction).toBe(0.5);
    expect(inside.checkedFraction).toBe(0.5);
    expect(outside.checkedBlocks + inside.checkedBlocks).toBe(outside.blocks);
  });

  it("honours block and maxMae options", () => {
    const reference = frame();
    const actual = withRect(frame(), 0, 0, 8, 8, 20);
    const mask = new Uint8Array(SIZE * SIZE);
    expect(compareTiles(reference, actual, mask, "outside", { block: 8 }).bad).toEqual([
      { x: 0, y: 0, mae: 20 },
    ]);
    expect(compareTiles(reference, actual, mask, "outside", { block: 8, maxMae: 20 }).bad).toEqual(
      [],
    );
  });

  it("throws on mismatched sizes", () => {
    const small = { width: 32, height: 32, data: new Uint8Array(32 * 32 * 4) };
    const mask = new Uint8Array(SIZE * SIZE);
    expect(() => compareTiles(frame(), small, mask, "outside")).toThrow(/size/i);
    expect(() => compareTiles(frame(), frame(), new Uint8Array(10), "outside")).toThrow(/mask/i);
  });
});

describe("pinned-symptom helpers", () => {
  const rect = { x: 10, y: 10, width: 20, height: 20 };

  it("scales the CSS-pixel rect and its tolerance by the device pixel ratio", () => {
    // dpr 2: the rect spans device px 20..60 and the 2 px tolerance becomes 4 px, so 16..64.
    expect(tileTouches({ x: 64, y: 20 }, 16, rect, 2)).toBe(false);
    expect(tileTouches({ x: 48, y: 20 }, 16, rect, 2)).toBe(true);
    expect(tileTouches({ x: 1, y: 20 }, 16, rect, 2)).toBe(true);
    expect(tileTouches({ x: 0, y: 20 }, 16, rect, 2)).toBe(false);
    // The same device-pixel tile at dpr 1 sits far outside the unscaled rect.
    expect(tileTouches({ x: 48, y: 20 }, 16, rect, 1)).toBe(false);
  });

  it("lists the bad tiles that miss the rect", () => {
    const touching = { x: 0, y: 0, mae: 5 };
    const far = { x: 160, y: 160, mae: 9 };
    expect(tilesOutsideRegion([touching, far], 16, rect, 1)).toEqual([far]);
    expect(tilesOutsideRegion([touching], 16, rect, 1)).toEqual([]);
  });

  it("accepts a worst MAE from half to double the measured one", () => {
    expect(withinSymptomBand(5, 10)).toBe(true);
    expect(withinSymptomBand(20, 10)).toBe(true);
    expect(withinSymptomBand(4.9, 10)).toBe(false);
    expect(withinSymptomBand(20.1, 10)).toBe(false);
  });
});
