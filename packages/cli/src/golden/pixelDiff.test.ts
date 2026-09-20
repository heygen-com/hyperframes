import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  decodeRawImage,
  diffPngs,
  diffRawImages,
  writeRawImagePng,
  type RawImage,
} from "./pixelDiff.js";

type Rgba = [number, number, number, number];

function solid(width: number, height: number, rgba: Rgba): RawImage {
  const data = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set(rgba, offset);
  }
  return { width, height, data };
}

function setPixel(image: RawImage, x: number, y: number, rgba: Rgba): void {
  image.data.set(rgba, (y * image.width + x) * 4);
}

function getPixel(image: { width: number; data: Uint8Array }, x: number, y: number): Rgba {
  const offset = (y * image.width + x) * 4;
  return [
    image.data[offset]!,
    image.data[offset + 1]!,
    image.data[offset + 2]!,
    image.data[offset + 3]!,
  ];
}

const WHITE: Rgba = [255, 255, 255, 255];
const BLACK: Rgba = [0, 0, 0, 255];

describe("diffRawImages", () => {
  it("reports zero differences for identical images", () => {
    const a = solid(8, 6, [12, 34, 56, 255]);
    const b = solid(8, 6, [12, 34, 56, 255]);
    const result = diffRawImages(a, b);
    expect(result.diffPixels).toBe(0);
    expect(result.aaPixels).toBe(0);
    expect(result.diffRatio).toBe(0);
    expect(result.maxDelta).toBe(0);
    expect(result.dimensionMismatch).toBe(false);
    expect(result.totalPixels).toBe(48);
  });

  it("counts an isolated changed pixel and reports its channel delta", () => {
    const a = solid(8, 8, WHITE);
    const b = solid(8, 8, WHITE);
    setPixel(b, 3, 4, [255, 0, 0, 255]);
    const result = diffRawImages(a, b);
    expect(result.diffPixels).toBe(1);
    expect(result.maxDelta).toBe(255);
    expect(result.diffRatio).toBeCloseTo(1 / 64, 10);
  });

  it("absorbs sub-threshold channel drift", () => {
    const a = solid(4, 4, [100, 100, 100, 255]);
    const b = solid(4, 4, [120, 100, 100, 255]);
    // threshold 0.1 → tolerance 26 per channel, drift of 20 passes...
    expect(diffRawImages(a, b, { threshold: 0.1 }).diffPixels).toBe(0);
    // ...but a zero threshold counts every drifted pixel.
    const strict = diffRawImages(a, b, { threshold: 0 });
    expect(strict.diffPixels).toBe(16);
    expect(strict.maxDelta).toBe(20);
  });

  it("classifies a one-pixel edge shift as anti-aliasing and can be told not to", () => {
    // Vertical black/white edge, shifted right by one column in `current`.
    const baseline = solid(10, 10, WHITE);
    const current = solid(10, 10, WHITE);
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 4; x++) setPixel(baseline, x, y, BLACK);
      for (let x = 0; x < 5; x++) setPixel(current, x, y, BLACK);
    }
    const lenient = diffRawImages(baseline, current);
    expect(lenient.diffPixels).toBe(0);
    expect(lenient.aaPixels).toBe(10);

    const strict = diffRawImages(baseline, current, { ignoreAntialiasing: false });
    expect(strict.diffPixels).toBe(10);
    expect(strict.aaPixels).toBe(0);
  });

  it("does not classify a genuinely new color as anti-aliasing", () => {
    const baseline = solid(10, 10, WHITE);
    const current = solid(10, 10, WHITE);
    // 3×3 red block: no white-image neighborhood ever contains red.
    for (let y = 4; y < 7; y++) {
      for (let x = 4; x < 7; x++) setPixel(current, x, y, [255, 0, 0, 255]);
    }
    const result = diffRawImages(baseline, current);
    expect(result.diffPixels).toBe(9);
    expect(result.aaPixels).toBe(0);
  });

  it("treats mismatched dimensions as a total failure", () => {
    const a = solid(8, 8, WHITE);
    const b = solid(9, 8, WHITE);
    const result = diffRawImages(a, b);
    expect(result.dimensionMismatch).toBe(true);
    expect(result.diffRatio).toBe(1);
    expect(result.maxDelta).toBe(255);
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
  });

  it("paints counted diffs red and unchanged pixels as a pale backdrop", () => {
    const a = solid(6, 6, WHITE);
    const b = solid(6, 6, WHITE);
    setPixel(b, 2, 2, BLACK);
    const result = diffRawImages(a, b);
    expect(getPixel({ width: result.width, data: result.diff }, 2, 2)).toEqual([255, 0, 64, 255]);
    const [r, g, bChan] = getPixel({ width: result.width, data: result.diff }, 0, 0);
    expect(r).toBe(g);
    expect(g).toBe(bChan);
    expect(r).toBeGreaterThan(180);
  });
});

describe("PNG round trip", () => {
  it("diffs PNG files and re-encodes the visualization losslessly", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-pixel-diff-test-"));
    try {
      const baselinePath = join(dir, "baseline.png");
      const currentPath = join(dir, "current.png");
      await sharp({
        create: { width: 12, height: 8, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
      })
        .png()
        .toFile(baselinePath);
      // Same canvas with a 4×4 red patch composited into the corner.
      await sharp({
        create: { width: 12, height: 8, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
      })
        .composite([
          {
            input: {
              create: {
                width: 4,
                height: 4,
                channels: 4,
                background: { r: 255, g: 0, b: 0, alpha: 1 },
              },
            },
            left: 0,
            top: 0,
          },
        ])
        .png()
        .toFile(currentPath);

      const result = await diffPngs(baselinePath, currentPath, { ignoreAntialiasing: false });
      expect(result.diffPixels).toBe(16);
      expect(result.maxDelta).toBe(255);

      const diffPath = join(dir, "diff.png");
      await writeRawImagePng(
        { width: result.width, height: result.height, data: result.diff },
        diffPath,
      );
      const decoded = await decodeRawImage(diffPath);
      expect(decoded.width).toBe(12);
      expect(decoded.height).toBe(8);
      expect(getPixel(decoded, 1, 1)).toEqual([255, 0, 64, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
