import { describe, expect, it } from "vitest";
import { deflateSync } from "zlib";
import {
  diffGpuParityFrames,
  diffGpuParityPngs,
  verifyGpuParity,
  type RgbaFrame,
} from "./gpuParityDiff.js";

// ── Fixture helpers ─────────────────────────────────────────────────────────

/** Build an RGBA frame from a per-pixel fill function. */
function makeFrame(
  width: number,
  height: number,
  fill: (x: number, y: number) => number[],
): RgbaFrame {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgba = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = rgba[0] ?? 0;
      data[i + 1] = rgba[1] ?? 0;
      data[i + 2] = rgba[2] ?? 0;
      data[i + 3] = rgba[3] ?? 255;
    }
  }
  return { width, height, data };
}

/** Fill the given rectangle of an existing frame in-place. */
function paintRect(
  frame: RgbaFrame,
  rect: { x: number; y: number; w: number; h: number },
  rgba: [number, number, number, number],
): RgbaFrame {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * frame.width + x) * 4;
      frame.data[i] = rgba[0];
      frame.data[i + 1] = rgba[1];
      frame.data[i + 2] = rgba[2];
      frame.data[i + 3] = rgba[3];
    }
  }
  return frame;
}

// ── PNG construction (only for the decodePng integration test) ──────────────

function uint32BE(n: number): Buffer {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32BE(n, 0);
  return b;
}

let _crcTable: Uint32Array | undefined;
function crc32Table(): Uint32Array {
  if (_crcTable) return _crcTable;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  _crcTable = t;
  return t;
}
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  const table = crc32Table();
  for (let i = 0; i < data.length; i++) {
    crc = (table[(crc ^ (data[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function makeChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const crcBuf = uint32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([uint32BE(data.length), typeBuffer, data, crcBuf]);
}
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function makePng(width: number, height: number, pixels: number[]): Buffer {
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const scanlines: number[] = [];
  for (let y = 0; y < height; y++) {
    scanlines.push(0);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      scanlines.push(pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0, pixels[i + 3] ?? 0);
    }
  }
  const idat = deflateSync(Buffer.from(scanlines));
  return Buffer.concat([
    PNG_SIG,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", idat),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── diffGpuParityFrames ─────────────────────────────────────────────────────

describe("diffGpuParityFrames", () => {
  it("reports zero diff on identical frames", () => {
    const a = makeFrame(8, 8, () => [100, 150, 200, 255]);
    const b = makeFrame(8, 8, () => [100, 150, 200, 255]);
    const result = diffGpuParityFrames(a, b);
    expect(result.diffPixels).toBe(0);
    expect(result.diffFraction).toBe(0);
    expect(result.blackOnlyInA.pixels).toBe(0);
    expect(result.blackOnlyInA.boundingBox).toBeNull();
    expect(result.blackOnlyInB.pixels).toBe(0);
  });

  it("flags every pixel when frames differ everywhere beyond tolerance", () => {
    const a = makeFrame(4, 4, () => [10, 20, 30, 255]);
    const b = makeFrame(4, 4, () => [200, 200, 200, 255]);
    const result = diffGpuParityFrames(a, b);
    expect(result.diffPixels).toBe(16);
    expect(result.diffFraction).toBe(1);
  });

  it("tolerates sub-threshold channel jitter", () => {
    // ±7 on any channel — under default tolerance of 8 — should not count.
    const a = makeFrame(4, 4, () => [128, 128, 128, 255]);
    const b = makeFrame(4, 4, () => [135, 121, 135, 255]);
    const result = diffGpuParityFrames(a, b);
    expect(result.diffPixels).toBe(0);
  });

  it("detects a solid-black-in-A region absent from B (the field-bug pattern)", () => {
    // B has a red rectangle where A has solid black — hardware-GPU dropped
    // pixels in the shape's region.
    const b = makeFrame(20, 20, () => [200, 40, 40, 255]);
    const a = makeFrame(20, 20, () => [200, 40, 40, 255]);
    paintRect(a, { x: 5, y: 5, w: 8, h: 6 }, [0, 0, 0, 255]);

    const result = diffGpuParityFrames(a, b);
    expect(result.blackOnlyInA.pixels).toBe(48); // 8 * 6
    expect(result.blackOnlyInA.boundingBox).toEqual({ x: 5, y: 5, width: 8, height: 6 });
    expect(result.blackOnlyInB.pixels).toBe(0);
    expect(result.blackOnlyInB.boundingBox).toBeNull();
  });

  it("does NOT flag pixels that are legitimately black in both frames", () => {
    // Both frames share a solid-black region — this is real content, not a
    // capture bug. Must NOT count toward blackOnlyIn{A,B}.
    const fill = () => [180, 180, 180, 255];
    const a = makeFrame(20, 20, fill);
    const b = makeFrame(20, 20, fill);
    paintRect(a, { x: 4, y: 4, w: 10, h: 10 }, [0, 0, 0, 255]);
    paintRect(b, { x: 4, y: 4, w: 10, h: 10 }, [0, 0, 0, 255]);

    const result = diffGpuParityFrames(a, b);
    expect(result.blackOnlyInA.pixels).toBe(0);
    expect(result.blackOnlyInB.pixels).toBe(0);
    expect(result.blackOnlyInA.boundingBox).toBeNull();
    expect(result.blackOnlyInB.boundingBox).toBeNull();
    // Per-pixel diff should also be zero — frames are identical.
    expect(result.diffPixels).toBe(0);
  });

  it("computes a tight bounding box around the black-only-in-A region", () => {
    const b = makeFrame(32, 32, () => [255, 255, 255, 255]);
    const a = makeFrame(32, 32, () => [255, 255, 255, 255]);
    // Two rects — bbox must span both.
    paintRect(a, { x: 2, y: 3, w: 3, h: 3 }, [0, 0, 0, 255]);
    paintRect(a, { x: 20, y: 25, w: 5, h: 4 }, [0, 0, 0, 255]);

    const result = diffGpuParityFrames(a, b);
    expect(result.blackOnlyInA.pixels).toBe(3 * 3 + 5 * 4);
    expect(result.blackOnlyInA.boundingBox).toEqual({
      x: 2,
      y: 3,
      // From x=2 (inclusive) to x=24 (inclusive, last col of second rect)
      width: 24 - 2 + 1,
      // From y=3 (inclusive) to y=28 (inclusive, last row of second rect,
      // y=25 through y=28 for h=4)
      height: 28 - 3 + 1,
    });
  });

  it("flags the symmetric case (black-only-in-B) separately", () => {
    const a = makeFrame(10, 10, () => [200, 200, 200, 255]);
    const b = makeFrame(10, 10, () => [200, 200, 200, 255]);
    paintRect(b, { x: 1, y: 1, w: 2, h: 2 }, [0, 0, 0, 255]);

    const result = diffGpuParityFrames(a, b);
    expect(result.blackOnlyInA.pixels).toBe(0);
    expect(result.blackOnlyInB.pixels).toBe(4);
    expect(result.blackOnlyInB.boundingBox).toEqual({ x: 1, y: 1, width: 2, height: 2 });
  });

  it("throws with both sizes surfaced when dimensions mismatch", () => {
    const a = makeFrame(4, 4, () => [0, 0, 0, 255]);
    const b = makeFrame(5, 4, () => [0, 0, 0, 255]);
    expect(() => diffGpuParityFrames(a, b)).toThrow(/4x4.*5x4/);
  });

  it("throws when data length disagrees with declared dimensions", () => {
    const bad: RgbaFrame = { width: 4, height: 4, data: new Uint8Array(4 * 4 * 4 - 1) };
    const good = makeFrame(4, 4, () => [0, 0, 0, 255]);
    expect(() => diffGpuParityFrames(bad, good)).toThrow(/frame A data length/);
    expect(() => diffGpuParityFrames(good, bad)).toThrow(/frame B data length/);
  });

  it("throws when contentSumThreshold does not exceed blackSumThreshold", () => {
    const a = makeFrame(2, 2, () => [0, 0, 0, 255]);
    const b = makeFrame(2, 2, () => [0, 0, 0, 255]);
    expect(() =>
      diffGpuParityFrames(a, b, { blackSumThreshold: 30, contentSumThreshold: 20 }),
    ).toThrow(/must be strictly greater/);
  });

  it("respects a custom pixelChannelTolerance", () => {
    const a = makeFrame(4, 4, () => [100, 100, 100, 255]);
    const b = makeFrame(4, 4, () => [120, 100, 100, 255]);
    // Default tolerance 8 → this counts as differing (|120-100|=20 > 8).
    expect(diffGpuParityFrames(a, b).diffPixels).toBe(16);
    // Loosen tolerance past the delta → no pixels differ.
    expect(diffGpuParityFrames(a, b, { pixelChannelTolerance: 25 }).diffPixels).toBe(0);
  });
});

// ── verifyGpuParity ─────────────────────────────────────────────────────────

describe("verifyGpuParity", () => {
  it("returns ok=true when both frames render the same content", () => {
    const a = makeFrame(16, 16, () => [50, 60, 70, 255]);
    const b = makeFrame(16, 16, () => [50, 60, 70, 255]);
    const result = verifyGpuParity(a, b);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("");
    expect(result.diff.blackOnlyInA.pixels).toBe(0);
  });

  it("returns ok=false with a diagnostic reason when hardware-GPU frame drops a shape", () => {
    const b = makeFrame(50, 50, () => [180, 100, 100, 255]);
    const a = makeFrame(50, 50, () => [180, 100, 100, 255]);
    // 10x10 black rectangle in A → 100 pixels / 2500 = 4% ≫ 0.1% default.
    paintRect(a, { x: 10, y: 10, w: 10, h: 10 }, [0, 0, 0, 255]);

    const result = verifyGpuParity(a, b);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/hardware-GPU frame has 100 pixel/);
    expect(result.reason).toMatch(/bbox 10,10 10x10/);
  });

  it("returns ok=true for shared black content — must not false-positive on real black shapes", () => {
    const fill = () => [220, 220, 220, 255];
    const a = makeFrame(30, 30, fill);
    const b = makeFrame(30, 30, fill);
    paintRect(a, { x: 5, y: 5, w: 8, h: 8 }, [0, 0, 0, 255]);
    paintRect(b, { x: 5, y: 5, w: 8, h: 8 }, [0, 0, 0, 255]);
    const result = verifyGpuParity(a, b);
    expect(result.ok).toBe(true);
  });

  it("flags the inverse (black-only-in-B) with a distinct reason", () => {
    const a = makeFrame(50, 50, () => [180, 100, 100, 255]);
    const b = makeFrame(50, 50, () => [180, 100, 100, 255]);
    paintRect(b, { x: 5, y: 5, w: 10, h: 10 }, [0, 0, 0, 255]);
    const result = verifyGpuParity(a, b);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/software-GPU frame has 100 pixel/);
    expect(result.reason).toMatch(/inverse pattern/);
  });

  it("honors a stricter blackOnlyFractionThreshold", () => {
    const b = makeFrame(100, 100, () => [180, 100, 100, 255]);
    const a = makeFrame(100, 100, () => [180, 100, 100, 255]);
    // 5 pixels = 0.05% — below default 0.1% but above 0.01%.
    paintRect(a, { x: 0, y: 0, w: 5, h: 1 }, [0, 0, 0, 255]);
    expect(verifyGpuParity(a, b).ok).toBe(true);
    expect(verifyGpuParity(a, b, { blackOnlyFractionThreshold: 0.0001 }).ok).toBe(false);
  });
});

// ── diffGpuParityPngs (PNG-buffer wrapper) ──────────────────────────────────

describe("diffGpuParityPngs", () => {
  it("decodes and diffs PNG buffers end-to-end", () => {
    // 2x2 identical checkerboards.
    const pixels = [
      // TL red
      255, 0, 0, 255,
      // TR white
      255, 255, 255, 255,
      // BL white
      255, 255, 255, 255,
      // BR red
      255, 0, 0, 255,
    ];
    const pngA = makePng(2, 2, pixels);
    const pngB = makePng(2, 2, pixels);
    const result = diffGpuParityPngs(pngA, pngB);
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(result.diffPixels).toBe(0);
  });

  it("preserves the underlying decode error as `cause` when frame A is malformed", () => {
    const validPng = makePng(1, 1, [0, 0, 0, 255]);
    const badPng = Buffer.from("not a png at all");
    let caught: Error | undefined;
    try {
      diffGpuParityPngs(badPng, validPng);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).toMatch(/failed to decode frame A/);
    expect(caught?.cause).toBeDefined();
    const causeA = caught?.cause as Error | undefined;
    expect(causeA?.message).toMatch(/not a PNG file/);
  });

  it("preserves the underlying decode error as `cause` when frame B is malformed", () => {
    const validPng = makePng(1, 1, [0, 0, 0, 255]);
    const badPng = Buffer.from("also not a png");
    let caught: Error | undefined;
    try {
      diffGpuParityPngs(validPng, badPng);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).toMatch(/failed to decode frame B/);
    const causeB = caught?.cause as Error | undefined;
    expect(causeB?.message).toMatch(/not a PNG file/);
  });
});
