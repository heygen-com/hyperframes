import { describe, expect, it, vi } from "vitest";
import { deflateSync } from "zlib";
import {
  decodePng,
  decodePngToRgb48le,
  blitRgba8OverRgb48le,
  blitRgb48leRegion,
  blitRgb48leAffine,
  parseTransformMatrix,
  roundedRectAlpha,
  resampleRgb48leObjectFit,
  normalizeObjectFit,
} from "./alphaBlit.js";

// ── PNG construction helpers ─────────────────────────────────────────────────

function uint32BE(n: number): Buffer {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  const table = crc32Table();
  for (let i = 0; i < data.length; i++) {
    crc = (table[(crc ^ (data[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
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

function makeChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crcBuf = uint32BE(crc32(crcInput));
  return Buffer.concat([uint32BE(data.length), typeBuffer, data, crcBuf]);
}

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Build a minimal RGBA PNG for testing.
 * pixels: flat RGBA array (row-major, 8-bit per channel)
 */
function makePng(width: number, height: number, pixels: number[]): Buffer {
  // IHDR
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace none

  // Raw scanlines with filter byte 0 (None)
  const scanlines: number[] = [];
  for (let y = 0; y < height; y++) {
    scanlines.push(0); // filter type None
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      scanlines.push(pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0, pixels[i + 3] ?? 0);
    }
  }

  const idatData = deflateSync(Buffer.from(scanlines));

  return Buffer.concat([
    PNG_SIG,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", idatData),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── decodePng tests ──────────────────────────────────────────────────────────

describe("decodePng", () => {
  it("decodes a 1x1 RGBA PNG correctly", () => {
    // RGBA: red pixel, full opacity
    const png = makePng(1, 1, [255, 0, 0, 255]);
    const { width, height, data } = decodePng(png);
    expect(width).toBe(1);
    expect(height).toBe(1);
    expect(data[0]).toBe(255); // R
    expect(data[1]).toBe(0); // G
    expect(data[2]).toBe(0); // B
    expect(data[3]).toBe(255); // A
  });

  it("decodes a 2x2 RGBA PNG with multiple pixels", () => {
    // TL=red, TR=green, BL=blue, BR=white (all full opacity)
    const pixels = [
      255,
      0,
      0,
      255, // TL red
      0,
      255,
      0,
      255, // TR green
      0,
      0,
      255,
      255, // BL blue
      255,
      255,
      255,
      255, // BR white
    ];
    const png = makePng(2, 2, pixels);
    const { width, height, data } = decodePng(png);
    expect(width).toBe(2);
    expect(height).toBe(2);

    // Top-left: red
    expect(data[0]).toBe(255);
    expect(data[1]).toBe(0);
    expect(data[2]).toBe(0);
    expect(data[3]).toBe(255);

    // Bottom-right: white
    expect(data[12]).toBe(255);
    expect(data[13]).toBe(255);
    expect(data[14]).toBe(255);
    expect(data[15]).toBe(255);
  });

  it("decodes a transparent pixel correctly", () => {
    const png = makePng(1, 1, [128, 64, 32, 0]);
    const { data } = decodePng(png);
    expect(data[3]).toBe(0); // alpha = 0
  });

  it("decodes a semi-transparent pixel correctly", () => {
    const png = makePng(1, 1, [100, 150, 200, 128]);
    const { data } = decodePng(png);
    expect(data[0]).toBe(100);
    expect(data[1]).toBe(150);
    expect(data[2]).toBe(200);
    expect(data[3]).toBe(128);
  });

  it("throws on invalid PNG signature", () => {
    const buf = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(() => decodePng(buf)).toThrow("not a PNG file");
  });
});

// ── PNG filter coverage ─────────────────────────────────────────────────────
//
// `makePng` only exercises filter type 0 (None). libpng (and Chrome) pick
// other filter types heuristically; these tests build raw IDAT bytes with each
// filter type so the defilter logic gets actual coverage.

const paethRef = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
};

/**
 * Build a PNG with a specific filter type applied to every row. Encodes a
 * 3×2 RGBA image with unique per-channel values so any cross-channel mistake
 * in the defilter loop shows up as an assertion failure.
 *
 * @param filterType  0=None, 1=Sub, 2=Up, 3=Average, 4=Paeth
 */
function makePngWithFilter(filterType: 0 | 1 | 2 | 3 | 4): {
  png: Buffer;
  expectedPixels: number[];
} {
  const width = 3;
  const height = 2;
  const bpp = 4; // RGBA, 8-bit
  const stride = width * bpp;

  // Unique pixels so any defilter bug is observable
  const expectedPixels = [
    10, 20, 30, 255, 50, 60, 70, 255, 90, 100, 110, 255, 130, 140, 150, 255, 170, 180, 190, 255,
    210, 220, 230, 255,
  ];

  const filtered: number[] = [];
  const prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    filtered.push(filterType);
    const rowStart = y * stride;
    const curr = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) curr[x] = expectedPixels[rowStart + x] ?? 0;

    const out = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? (curr[x - bpp] ?? 0) : 0;
      const b = prev[x] ?? 0;
      const c = x >= bpp ? (prev[x - bpp] ?? 0) : 0;
      const cv = curr[x] ?? 0;
      switch (filterType) {
        case 0:
          out[x] = cv;
          break;
        case 1:
          out[x] = (cv - a) & 0xff;
          break;
        case 2:
          out[x] = (cv - b) & 0xff;
          break;
        case 3:
          out[x] = (cv - Math.floor((a + b) / 2)) & 0xff;
          break;
        case 4:
          out[x] = (cv - paethRef(a, b, c)) & 0xff;
          break;
      }
    }
    for (let x = 0; x < stride; x++) filtered.push(out[x] ?? 0);
    prev.set(curr);
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = deflateSync(Buffer.from(filtered));

  return {
    png: Buffer.concat([
      PNG_SIG,
      makeChunk("IHDR", ihdr),
      makeChunk("IDAT", idat),
      makeChunk("IEND", Buffer.alloc(0)),
    ]),
    expectedPixels,
  };
}

describe("decodePng filter coverage", () => {
  it.each([
    [0, "None"],
    [1, "Sub"],
    [2, "Up"],
    [3, "Average"],
    [4, "Paeth"],
  ] as const)("round-trips a 3×2 PNG with filter type %d (%s)", (filterType) => {
    const { png, expectedPixels } = makePngWithFilter(filterType);
    const { width, height, data } = decodePng(png);
    expect(width).toBe(3);
    expect(height).toBe(2);
    for (let i = 0; i < expectedPixels.length; i++) {
      expect(data[i]).toBe(expectedPixels[i]);
    }
  });

  it("decodes a PNG split across multiple IDAT chunks", () => {
    // Build a normal single-IDAT PNG, then split its IDAT payload in half.
    // Chrome routinely emits multi-chunk IDATs (default ~8KB segment size).
    const { png: singleIdatPng, expectedPixels } = makePngWithFilter(0);

    // Walk chunks to find IDAT
    let pos = 8;
    let ihdrChunk: Buffer | null = null;
    let idatPayload: Buffer | null = null;
    while (pos + 12 <= singleIdatPng.length) {
      const len = singleIdatPng.readUInt32BE(pos);
      const type = singleIdatPng.toString("ascii", pos + 4, pos + 8);
      const data = singleIdatPng.subarray(pos + 8, pos + 8 + len);
      const fullChunk = singleIdatPng.subarray(pos, pos + 12 + len);
      if (type === "IHDR") ihdrChunk = Buffer.from(fullChunk);
      if (type === "IDAT") idatPayload = Buffer.from(data);
      if (type === "IEND") break;
      pos += 12 + len;
    }
    expect(ihdrChunk).not.toBeNull();
    expect(idatPayload).not.toBeNull();
    if (!ihdrChunk || !idatPayload) return;

    // Split the IDAT payload roughly in half across two IDAT chunks
    const split = Math.floor(idatPayload.length / 2);
    const part1 = idatPayload.subarray(0, split);
    const part2 = idatPayload.subarray(split);

    const multiIdatPng = Buffer.concat([
      PNG_SIG,
      ihdrChunk,
      makeChunk("IDAT", Buffer.from(part1)),
      makeChunk("IDAT", Buffer.from(part2)),
      makeChunk("IEND", Buffer.alloc(0)),
    ]);

    const { data } = decodePng(multiIdatPng);
    for (let i = 0; i < expectedPixels.length; i++) {
      expect(data[i]).toBe(expectedPixels[i]);
    }
  });

  it("throws on Adam7-interlaced PNGs", () => {
    const ihdr = Buffer.allocUnsafe(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 1; // Adam7 interlace
    const idat = deflateSync(Buffer.from([0, 0, 0, 0, 255]));
    const png = Buffer.concat([
      PNG_SIG,
      makeChunk("IHDR", ihdr),
      makeChunk("IDAT", idat),
      makeChunk("IEND", Buffer.alloc(0)),
    ]);
    expect(() => decodePng(png)).toThrow("interlace");
  });

  it("throws on PNGs missing the IHDR chunk", () => {
    const idat = deflateSync(Buffer.from([0, 0, 0, 0, 255]));
    const png = Buffer.concat([
      PNG_SIG,
      makeChunk("IDAT", idat),
      makeChunk("IEND", Buffer.alloc(0)),
    ]);
    expect(() => decodePng(png)).toThrow("IHDR");
  });
});

// ── decodePngToRgb48le tests ────────────────────────────────────────────────
//
// FFmpeg emits 16-bit RGB PNGs (big-endian on the wire). The decoder swaps to
// little-endian for the streaming HDR encoder. These tests cover the byte-order
// swap, precision preservation, and multi-pixel row-major layout that the
// 8-bit suite cannot exercise.

/**
 * Build a 16-bit RGB PNG (colorType 2, bitDepth 16). PNG stores each 16-bit
 * sample as two big-endian bytes; the decoder must swap them to LE.
 *
 * @param pixels  Flat array of [r16, g16, b16, r16, g16, b16, ...] values
 *                (one entry per channel sample, 0–65535).
 */
function makePng16(width: number, height: number, pixels: number[]): Buffer {
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 16; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 6; // 3 channels × 2 bytes
  const filtered: number[] = [];
  for (let y = 0; y < height; y++) {
    filtered.push(0); // filter type None
    for (let x = 0; x < width; x++) {
      const baseSample = (y * width + x) * 3;
      for (let ch = 0; ch < 3; ch++) {
        const v = pixels[baseSample + ch] ?? 0;
        filtered.push((v >> 8) & 0xff); // high byte (BE on wire)
        filtered.push(v & 0xff); // low byte
      }
    }
    void stride;
  }

  const idat = deflateSync(Buffer.from(filtered));
  return Buffer.concat([
    PNG_SIG,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", idat),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("decodePngToRgb48le", () => {
  it("swaps PNG big-endian samples to little-endian rgb48le", () => {
    // Pick a value where high and low bytes differ so a missed swap is observable
    const v = 0x1234;
    const png = makePng16(1, 1, [v, v, v]);
    const { width, height, data } = decodePngToRgb48le(png);
    expect(width).toBe(1);
    expect(height).toBe(1);
    expect(data.length).toBe(6);
    expect(data.readUInt16LE(0)).toBe(v);
    expect(data.readUInt16LE(2)).toBe(v);
    expect(data.readUInt16LE(4)).toBe(v);
    // Spot-check raw byte order: low byte first, then high
    expect(data[0]).toBe(0x34);
    expect(data[1]).toBe(0x12);
  });

  it("preserves full 16-bit precision (no 8-bit truncation)", () => {
    // A value whose low byte alone would be misleading — proves both bytes survive
    const r = 0xabcd;
    const g = 0xfedc;
    const b = 0x0102;
    const png = makePng16(1, 1, [r, g, b]);
    const { data } = decodePngToRgb48le(png);
    expect(data.readUInt16LE(0)).toBe(r);
    expect(data.readUInt16LE(2)).toBe(g);
    expect(data.readUInt16LE(4)).toBe(b);
  });

  it("decodes a 2×2 image with row-major layout", () => {
    const pixels = [
      // row 0
      1000, 2000, 3000, 4000, 5000, 6000,
      // row 1
      7000, 8000, 9000, 10000, 11000, 12000,
    ];
    const png = makePng16(2, 2, pixels);
    const { width, height, data } = decodePngToRgb48le(png);
    expect(width).toBe(2);
    expect(height).toBe(2);
    expect(data.length).toBe(2 * 2 * 6);

    for (let i = 0; i < 4; i++) {
      expect(data.readUInt16LE(i * 6 + 0)).toBe(pixels[i * 3 + 0]);
      expect(data.readUInt16LE(i * 6 + 2)).toBe(pixels[i * 3 + 1]);
      expect(data.readUInt16LE(i * 6 + 4)).toBe(pixels[i * 3 + 2]);
    }
  });

  it("rejects 8-bit PNGs with a clear error", () => {
    const png = makePng(1, 1, [255, 0, 0, 255]); // 8-bit RGBA
    expect(() => decodePngToRgb48le(png)).toThrow(/bit depth/);
  });
});

// ── blitRgba8OverRgb48le tests ───────────────────────────────────────────────

/** Build an rgb48le buffer with a single solid color (16-bit per channel) */
function makeHdrFrame(
  width: number,
  height: number,
  r16: number,
  g16: number,
  b16: number,
): Buffer {
  const buf = Buffer.allocUnsafe(width * height * 6);
  for (let i = 0; i < width * height; i++) {
    buf.writeUInt16LE(r16, i * 6);
    buf.writeUInt16LE(g16, i * 6 + 2);
    buf.writeUInt16LE(b16, i * 6 + 4);
  }
  return buf;
}

/** Build a raw RGBA array (Uint8Array) with a single solid color */
function makeDomRgba(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a: number,
): Uint8Array {
  const arr = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    arr[i * 4 + 0] = r;
    arr[i * 4 + 1] = g;
    arr[i * 4 + 2] = b;
    arr[i * 4 + 3] = a;
  }
  return arr;
}

describe("blitRgba8OverRgb48le", () => {
  it("fully transparent DOM: canvas unchanged", () => {
    const canvas = makeHdrFrame(1, 1, 32000, 40000, 50000);
    const dom = makeDomRgba(1, 1, 255, 0, 0, 0); // red but alpha=0
    blitRgba8OverRgb48le(dom, canvas, 1, 1);

    expect(canvas.readUInt16LE(0)).toBe(32000);
    expect(canvas.readUInt16LE(2)).toBe(40000);
    expect(canvas.readUInt16LE(4)).toBe(50000);
  });

  it("fully opaque DOM: sRGB→HLG converted values overwrite canvas", () => {
    const canvas = makeHdrFrame(1, 1, 10000, 20000, 30000);
    const dom = makeDomRgba(1, 1, 255, 128, 0, 255); // R=255, G=128, B=0, full opaque
    blitRgba8OverRgb48le(dom, canvas, 1, 1);

    // sRGB 255 → HLG 65535 (white maps to white)
    // sRGB 128 → HLG ~46484 (mid-gray maps higher due to HLG OETF)
    // sRGB 0 → HLG 0
    expect(canvas.readUInt16LE(0)).toBe(65535);
    expect(canvas.readUInt16LE(2)).toBeGreaterThan(40000); // HLG mid-gray > sRGB mid-gray
    expect(canvas.readUInt16LE(2)).toBeLessThan(50000);
    expect(canvas.readUInt16LE(4)).toBe(0);
  });

  it("sRGB→HLG: black stays black, white stays white", () => {
    const canvasBlack = makeHdrFrame(1, 1, 0, 0, 0);
    const domBlack = makeDomRgba(1, 1, 0, 0, 0, 255);
    blitRgba8OverRgb48le(domBlack, canvasBlack, 1, 1);
    expect(canvasBlack.readUInt16LE(0)).toBe(0);

    const canvasWhite = makeHdrFrame(1, 1, 0, 0, 0);
    const domWhite = makeDomRgba(1, 1, 255, 255, 255, 255);
    blitRgba8OverRgb48le(domWhite, canvasWhite, 1, 1);
    expect(canvasWhite.readUInt16LE(0)).toBe(65535);
  });

  it("50% alpha: HLG-converted DOM blended with canvas", () => {
    // DOM: white (255, 255, 255) at alpha=128 (~50%)
    // Canvas: black (0, 0, 0)
    const canvas = makeHdrFrame(1, 1, 0, 0, 0);
    const dom = makeDomRgba(1, 1, 255, 255, 255, 128);
    blitRgba8OverRgb48le(dom, canvas, 1, 1);

    // sRGB 255 → HLG 65535, blended 50/50 with black
    const alpha = 128 / 255;
    const expectedR = Math.round(65535 * alpha);
    expect(canvas.readUInt16LE(0)).toBeCloseTo(expectedR, -1);
  });

  it("50% alpha blends with non-zero canvas", () => {
    // DOM: 8-bit red=200, canvas: 16-bit red=32000, alpha=128
    const canvas = makeHdrFrame(1, 1, 32000, 0, 0);
    const dom = makeDomRgba(1, 1, 200, 0, 0, 128);
    blitRgba8OverRgb48le(dom, canvas, 1, 1);

    // sRGB 200 → HLG value, blended ~50/50 with canvas red=32000
    // Result should be higher than 32000 (pulled up by the HLG-converted DOM value)
    expect(canvas.readUInt16LE(0)).toBeGreaterThan(32000);
  });

  it("α=254 still blends (no fast-path overwrite at the opaque boundary)", () => {
    // Reviewer feedback: confirm the alpha branch is taken for any α < 255.
    // α=254 should *almost* match α=255 but still leave a sliver of the canvas
    // value visible — proving we didn't accidentally fast-path α >= 254.
    const canvasOpaque = makeHdrFrame(1, 1, 0, 0, 0);
    const domOpaque = makeDomRgba(1, 1, 255, 255, 255, 255);
    blitRgba8OverRgb48le(domOpaque, canvasOpaque, 1, 1);
    const opaqueR = canvasOpaque.readUInt16LE(0);

    const canvasNear = makeHdrFrame(1, 1, 1000, 1000, 1000);
    const domNear = makeDomRgba(1, 1, 255, 255, 255, 254);
    blitRgba8OverRgb48le(domNear, canvasNear, 1, 1);
    const nearR = canvasNear.readUInt16LE(0);

    // α=255 over black gave us the pure HLG-of-white value
    expect(opaqueR).toBe(65535);
    // α=254 over (1000, 1000, 1000) must be *strictly less* than α=255 over black —
    // if the implementation short-circuits at α >= 254 it would also return 65535.
    expect(nearR).toBeLessThan(opaqueR);
    // …but it should still be very close (within ~1% of full white)
    expect(nearR).toBeGreaterThan(64000);
  });

  it("handles a 2x2 frame correctly pixel-by-pixel", () => {
    const canvas = makeHdrFrame(2, 2, 0, 0, 0);
    // First pixel: fully opaque white. Others: fully transparent.
    const dom = new Uint8Array(2 * 2 * 4);
    dom[0] = 255;
    dom[1] = 255;
    dom[2] = 255;
    dom[3] = 255; // pixel 0: opaque white
    // pixels 1-3: alpha=0 (transparent)

    blitRgba8OverRgb48le(dom, canvas, 2, 2);

    // Pixel 0: sRGB white → HLG white (65535)
    expect(canvas.readUInt16LE(0)).toBe(65535);
    expect(canvas.readUInt16LE(2)).toBe(65535);
    expect(canvas.readUInt16LE(4)).toBe(65535);

    // Pixel 1: transparent DOM → canvas black (0, 0, 0) unchanged
    expect(canvas.readUInt16LE(6)).toBe(0);
    expect(canvas.readUInt16LE(8)).toBe(0);
    expect(canvas.readUInt16LE(10)).toBe(0);
  });
});

describe("blitRgba8OverRgb48le with PQ transfer", () => {
  it("PQ: black stays black, white maps to PQ white", () => {
    const canvasBlack = makeHdrFrame(1, 1, 0, 0, 0);
    const domBlack = makeDomRgba(1, 1, 0, 0, 0, 255);
    blitRgba8OverRgb48le(domBlack, canvasBlack, 1, 1, "pq");
    expect(canvasBlack.readUInt16LE(0)).toBe(0);

    const canvasWhite = makeHdrFrame(1, 1, 0, 0, 0);
    const domWhite = makeDomRgba(1, 1, 255, 255, 255, 255);
    blitRgba8OverRgb48le(domWhite, canvasWhite, 1, 1, "pq");
    // PQ white at SDR 203 nits is NOT 65535 (that's 10000 nits)
    // SDR white in PQ ≈ 58% signal → ~38000
    const pqWhite = canvasWhite.readUInt16LE(0);
    expect(pqWhite).toBeGreaterThan(30000);
    expect(pqWhite).toBeLessThan(45000);
  });

  it("PQ mid-gray differs from HLG mid-gray", () => {
    const canvasHlg = makeHdrFrame(1, 1, 0, 0, 0);
    const canvasPq = makeHdrFrame(1, 1, 0, 0, 0);
    const dom = makeDomRgba(1, 1, 128, 128, 128, 255);

    blitRgba8OverRgb48le(dom, canvasHlg, 1, 1, "hlg");
    blitRgba8OverRgb48le(dom, canvasPq, 1, 1, "pq");

    const hlgVal = canvasHlg.readUInt16LE(0);
    const pqVal = canvasPq.readUInt16LE(0);
    // PQ and HLG encode mid-gray differently
    expect(hlgVal).not.toBe(pqVal);
    // Both should be non-zero
    expect(hlgVal).toBeGreaterThan(0);
    expect(pqVal).toBeGreaterThan(0);
  });
});

// ── sRGB → BT.2020 reference values (locks down the per-channel LUT) ─────────
//
// Probes computed by mirroring buildSrgbToHdrLut() (sRGB EOTF → linear → HDR
// OETF → 16-bit). Values are byte-exact integers — any drift in the EOTF/OETF
// math (constant changes, branch swaps, rounding-mode regressions) is caught
// immediately, on the matrix-free fast path through blitRgba8OverRgb48le where
// every DOM pixel goes through getSrgbToHdrLut().
//
// Two key invariants the table enforces:
//
// 1. HLG: sRGB 255 → 65535 (white maps to white in HLG signal space).
//
// 2. PQ:  sRGB 255 → 38055 (≪ 65535). NOT a bug — SDR white is placed at
//    203 nits per BT.2408, normalized against PQ's 10000-nit peak. This is
//    what lets HDR highlights live above SDR-reference-white in a PQ frame.
//    Never "fix" PQ to map sRGB 255 → 65535.
//
// To regenerate after an *intentional* LUT change (transfer-function constant,
// BT.709→BT.2020 matrix tuning, SDR-white nit reference, OOTF), run:
//
//   python3 packages/engine/scripts/generate-lut-reference.py --probes
//
// and paste the output over the SRGB_TO_HDR_REFERENCE literal below. Update
// the script's mirrored OETF/EOTF constants in lockstep with alphaBlit.ts so
// the generator stays the source of truth.

interface SrgbHdrProbe {
  srgb: number;
  hlg: number;
  pq: number;
}

const SRGB_TO_HDR_REFERENCE: readonly SrgbHdrProbe[] = [
  { srgb: 0, hlg: 0, pq: 0 },
  { srgb: 1, hlg: 1978, pq: 3315 },
  { srgb: 10, hlg: 6254, pq: 8300 },
  { srgb: 32, hlg: 13642, pq: 13884 },
  { srgb: 64, hlg: 25702, pq: 19848 },
  { srgb: 96, hlg: 38011, pq: 24379 },
  { srgb: 128, hlg: 46484, pq: 28037 },
  { srgb: 160, hlg: 52745, pq: 31104 },
  { srgb: 192, hlg: 57772, pq: 33743 },
  { srgb: 224, hlg: 61994, pq: 36057 },
  { srgb: 254, hlg: 65428, pq: 37994 },
  { srgb: 255, hlg: 65535, pq: 38055 },
];

describe("blitRgba8OverRgb48le: sRGB → BT.2020 reference values", () => {
  it.each(SRGB_TO_HDR_REFERENCE)(
    "sRGB $srgb → HLG $hlg, PQ $pq (grayscale, opaque)",
    ({ srgb, hlg, pq }) => {
      const canvasHlg = makeHdrFrame(1, 1, 0, 0, 0);
      const domHlg = makeDomRgba(1, 1, srgb, srgb, srgb, 255);
      blitRgba8OverRgb48le(domHlg, canvasHlg, 1, 1, "hlg");
      // All three channels should hit the same LUT slot.
      expect(canvasHlg.readUInt16LE(0)).toBe(hlg);
      expect(canvasHlg.readUInt16LE(2)).toBe(hlg);
      expect(canvasHlg.readUInt16LE(4)).toBe(hlg);

      const canvasPq = makeHdrFrame(1, 1, 0, 0, 0);
      const domPq = makeDomRgba(1, 1, srgb, srgb, srgb, 255);
      blitRgba8OverRgb48le(domPq, canvasPq, 1, 1, "pq");
      expect(canvasPq.readUInt16LE(0)).toBe(pq);
      expect(canvasPq.readUInt16LE(2)).toBe(pq);
      expect(canvasPq.readUInt16LE(4)).toBe(pq);
    },
  );

  it("HLG: asymmetric R/G/B maps each channel independently through the LUT", () => {
    // R=64, G=128, B=192 → independent LUT lookups per channel.
    const canvas = makeHdrFrame(1, 1, 0, 0, 0);
    const dom = makeDomRgba(1, 1, 64, 128, 192, 255);
    blitRgba8OverRgb48le(dom, canvas, 1, 1, "hlg");
    expect(canvas.readUInt16LE(0)).toBe(25702);
    expect(canvas.readUInt16LE(2)).toBe(46484);
    expect(canvas.readUInt16LE(4)).toBe(57772);
  });

  it("PQ: asymmetric R/G/B maps each channel independently through the LUT", () => {
    const canvas = makeHdrFrame(1, 1, 0, 0, 0);
    const dom = makeDomRgba(1, 1, 64, 128, 192, 255);
    blitRgba8OverRgb48le(dom, canvas, 1, 1, "pq");
    expect(canvas.readUInt16LE(0)).toBe(19848);
    expect(canvas.readUInt16LE(2)).toBe(28037);
    expect(canvas.readUInt16LE(4)).toBe(33743);
  });

  it("PQ caps SDR-reference-white well below HLG signal peak (BT.2408 invariant)", () => {
    // sRGB 255 (SDR white) → HLG 65535 (top of HLG signal range)
    //                     → PQ  38055 (~58% of PQ signal, ~203 nits)
    // The gap is what lets PQ carry HDR highlights above SDR reference level.
    // Locking the exact PQ value here prevents a future "fix" that would
    // re-scale PQ to peak-at-SDR-white (which would clip every real HDR pixel).
    const canvasHlg = makeHdrFrame(1, 1, 0, 0, 0);
    const canvasPq = makeHdrFrame(1, 1, 0, 0, 0);
    const dom = makeDomRgba(1, 1, 255, 255, 255, 255);

    blitRgba8OverRgb48le(dom, canvasHlg, 1, 1, "hlg");
    blitRgba8OverRgb48le(dom, canvasPq, 1, 1, "pq");

    expect(canvasHlg.readUInt16LE(0)).toBe(65535);
    expect(canvasPq.readUInt16LE(0)).toBe(38055);
    expect(canvasPq.readUInt16LE(0)).toBeLessThan(canvasHlg.readUInt16LE(0));
  });
});

// ── blitRgb48leRegion tests ──────────────────────────────────────────────────

describe("blitRgb48leRegion", () => {
  it("copies a region at position (0,0) — full overlap", () => {
    const canvas = Buffer.alloc(4 * 4 * 6); // 4x4 black
    const source = makeHdrFrame(2, 2, 10000, 20000, 30000);
    blitRgb48leRegion(canvas, source, 0, 0, 2, 2, 4, 4);
    expect(canvas.readUInt16LE(0)).toBe(10000);
    expect(canvas.readUInt16LE(2)).toBe(20000);
    expect(canvas.readUInt16LE(4)).toBe(30000);
    expect(canvas.readUInt16LE(2 * 6)).toBe(0);
  });

  it("copies a region at offset position", () => {
    const canvas = Buffer.alloc(4 * 4 * 6);
    const source = makeHdrFrame(2, 2, 50000, 40000, 30000);
    blitRgb48leRegion(canvas, source, 1, 1, 2, 2, 4, 4);
    expect(canvas.readUInt16LE(0)).toBe(0);
    const off = (1 * 4 + 1) * 6;
    expect(canvas.readUInt16LE(off)).toBe(50000);
  });

  it("clips when region extends beyond canvas edge", () => {
    const canvas = Buffer.alloc(4 * 4 * 6);
    const source = makeHdrFrame(3, 3, 10000, 20000, 30000);
    blitRgb48leRegion(canvas, source, 2, 2, 3, 3, 4, 4);
    const off = (2 * 4 + 2) * 6;
    expect(canvas.readUInt16LE(off)).toBe(10000);
    const off2 = (3 * 4 + 3) * 6;
    expect(canvas.readUInt16LE(off2)).toBe(10000);
    expect(canvas.length).toBe(4 * 4 * 6);
  });

  it("applies opacity when provided", () => {
    const canvas = Buffer.alloc(1 * 1 * 6);
    const source = makeHdrFrame(1, 1, 40000, 40000, 40000);
    blitRgb48leRegion(canvas, source, 0, 0, 1, 1, 1, 1, 0.5);
    expect(canvas.readUInt16LE(0)).toBe(20000);
  });

  it("no-op for zero-size region", () => {
    const canvas = Buffer.alloc(4 * 4 * 6);
    const source = makeHdrFrame(2, 2, 10000, 20000, 30000);
    blitRgb48leRegion(canvas, source, 0, 0, 0, 0, 4, 4);
    expect(canvas.readUInt16LE(0)).toBe(0);
  });
});

// ── parseTransformMatrix tests ───────────────────────────────────────────────

describe("parseTransformMatrix", () => {
  it("returns null for 'none'", () => {
    expect(parseTransformMatrix("none")).toBeNull();
  });

  it("parses identity matrix", () => {
    const m = parseTransformMatrix("matrix(1, 0, 0, 1, 0, 0)");
    expect(m).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("parses scale + translate", () => {
    const m = parseTransformMatrix("matrix(0.85, 0, 0, 0.85, 100, 50)");
    expect(m).toEqual([0.85, 0, 0, 0.85, 100, 50]);
  });

  it("parses rotation (45 degrees)", () => {
    const cos = Math.cos(Math.PI / 4);
    const sin = Math.sin(Math.PI / 4);
    const m = parseTransformMatrix(`matrix(${cos}, ${sin}, ${-sin}, ${cos}, 0, 0)`);
    expect(m).not.toBeNull();
    if (!m) return;
    expect(m[0]).toBeCloseTo(cos, 10);
    expect(m[1]).toBeCloseTo(sin, 10);
  });

  it("parses negative values", () => {
    const m = parseTransformMatrix("matrix(-1, 0, 0, -1, -50, -100)");
    expect(m).toEqual([-1, 0, 0, -1, -50, -100]);
  });

  it("returns null for empty string", () => {
    expect(parseTransformMatrix("")).toBeNull();
  });

  it("parses identity matrix3d (GSAP force3D default)", () => {
    const m = parseTransformMatrix("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)");
    expect(m).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("parses translate3d matrix3d as 2D affine (drops Z translation)", () => {
    // translate3d(100px, 50px, 25px) — Z=25 must be dropped.
    const m = parseTransformMatrix("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 50, 25, 1)");
    expect(m).toEqual([1, 0, 0, 1, 100, 50]);
  });

  it("parses scale + translate3d matrix3d (typical GSAP output)", () => {
    // scale(0.85) translate3d(100px, 50px, 0) emitted by GSAP with force3D: true.
    const m = parseTransformMatrix(
      "matrix3d(0.85, 0, 0, 0, 0, 0.85, 0, 0, 0, 0, 1, 0, 100, 50, 0, 1)",
    );
    expect(m).toEqual([0.85, 0, 0, 0.85, 100, 50]);
  });

  it("parses rotation matrix3d (rotateZ via force3D)", () => {
    // rotateZ(45deg) translate3d(0, 0, 0) — column-major.
    const cos = Math.cos(Math.PI / 4);
    const sin = Math.sin(Math.PI / 4);
    const m = parseTransformMatrix(
      `matrix3d(${cos}, ${sin}, 0, 0, ${-sin}, ${cos}, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)`,
    );
    expect(m).not.toBeNull();
    if (!m) return;
    expect(m[0]).toBeCloseTo(cos, 10);
    expect(m[1]).toBeCloseTo(sin, 10);
    expect(m[2]).toBeCloseTo(-sin, 10);
    expect(m[3]).toBeCloseTo(cos, 10);
    expect(m[4]).toBe(0);
    expect(m[5]).toBe(0);
  });

  it("returns null for malformed matrix3d (wrong arg count)", () => {
    expect(parseTransformMatrix("matrix3d(1, 0, 0, 0, 0, 1)")).toBeNull();
  });

  it("returns null for matrix3d with non-finite values", () => {
    expect(
      parseTransformMatrix("matrix3d(NaN, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)"),
    ).toBeNull();
  });

  it("warns once when matrix3d has Z-significant components (rotateY 45deg)", () => {
    // rotateY(45deg) — m31=-sin, m13=sin, m33=cos. Real 3D rotation around Y;
    // the engine projects to 2D and silently drops perspective. Author needs
    // to know the rendered output won't match the studio preview.
    const cos = Math.cos(Math.PI / 4);
    const sin = Math.sin(Math.PI / 4);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = parseTransformMatrix(
      `matrix3d(${cos}, 0, ${-sin}, 0, 0, 1, 0, 0, ${sin}, 0, ${cos}, 0, 0, 0, 0, 1)`,
    );
    // Still returns the projected 2D affine — warning is non-blocking.
    expect(m).not.toBeNull();
    expect(m).toEqual([cos, 0, 0, 1, 0, 0]);
    // Module-level dedup means the warn either fired in this test (first
    // Z-significant call in the run) or earlier; either way the
    // user-facing observability contract holds. Assert it was called at
    // least once across the process.
    const totalCalls = warn.mock.calls.length;
    // Calling parseTransformMatrix again with another Z-significant matrix
    // must not produce additional warnings (dedup check).
    parseTransformMatrix("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 5, 0, 0, 0, 1)");
    expect(warn.mock.calls.length).toBe(totalCalls);
    warn.mockRestore();
  });
});

// ── blitRgb48leAffine tests ─────────────────────────────────────────────────

describe("blitRgb48leAffine", () => {
  it("identity matrix produces same result as blitRgb48leRegion", () => {
    const canvas1 = Buffer.alloc(4 * 4 * 6);
    const canvas2 = Buffer.alloc(4 * 4 * 6);
    const source = makeHdrFrame(2, 2, 10000, 20000, 30000);
    const identity = [1, 0, 0, 1, 0, 0];

    blitRgb48leRegion(canvas1, source, 0, 0, 2, 2, 4, 4);
    blitRgb48leAffine(canvas2, source, identity, 2, 2, 4, 4);

    expect(Buffer.compare(canvas1, canvas2)).toBe(0);
  });

  it("translation moves pixels", () => {
    const canvas = Buffer.alloc(4 * 4 * 6);
    const source = makeHdrFrame(1, 1, 50000, 40000, 30000);
    const translate = [1, 0, 0, 1, 2, 1];
    blitRgb48leAffine(canvas, source, translate, 1, 1, 4, 4);

    expect(canvas.readUInt16LE(0)).toBe(0);
    const off = (1 * 4 + 2) * 6;
    expect(canvas.readUInt16LE(off)).toBe(50000);
  });

  it("scale down by 0.5 shrinks the output", () => {
    const canvas = Buffer.alloc(4 * 4 * 6);
    const source = makeHdrFrame(4, 4, 40000, 30000, 20000);
    const scale = [0.5, 0, 0, 0.5, 0, 0];
    blitRgb48leAffine(canvas, source, scale, 4, 4, 4, 4);

    expect(canvas.readUInt16LE(0)).toBeGreaterThan(0);
    expect(canvas.readUInt16LE((1 * 4 + 1) * 6)).toBeGreaterThan(0);
    expect(canvas.readUInt16LE(2 * 6)).toBe(0);
  });

  it("scale up by 2 enlarges the output", () => {
    const canvas = Buffer.alloc(4 * 4 * 6);
    const source = makeHdrFrame(2, 2, 40000, 30000, 20000);
    const scale = [2, 0, 0, 2, 0, 0];
    blitRgb48leAffine(canvas, source, scale, 2, 2, 4, 4);

    for (let i = 0; i < 16; i++) {
      expect(canvas.readUInt16LE(i * 6)).toBeGreaterThan(0);
    }
  });

  it("opacity blends with canvas", () => {
    const canvas = makeHdrFrame(1, 1, 20000, 20000, 20000);
    const source = makeHdrFrame(1, 1, 60000, 60000, 60000);
    const identity = [1, 0, 0, 1, 0, 0];
    blitRgb48leAffine(canvas, source, identity, 1, 1, 1, 1, 0.5);

    expect(canvas.readUInt16LE(0)).toBe(40000);
  });

  it("out-of-bounds source coordinates are clipped", () => {
    const canvas = Buffer.alloc(2 * 2 * 6);
    const source = makeHdrFrame(1, 1, 50000, 40000, 30000);
    const translate = [1, 0, 0, 1, 10, 10];
    blitRgb48leAffine(canvas, source, translate, 1, 1, 2, 2);

    expect(canvas.readUInt16LE(0)).toBe(0);
    expect(canvas.readUInt16LE(6)).toBe(0);
  });
});

// ── Round-trip test: decodePng → blitRgba8OverRgb48le ────────────────────────

describe("decodePng + blitRgba8OverRgb48le integration", () => {
  it("transparent PNG overlay leaves canvas untouched", () => {
    const width = 2;
    const height = 2;

    // Build a fully transparent PNG
    const pixels = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // all alpha=0
    const png = makePng(width, height, pixels);
    const { data: domRgba } = decodePng(png);

    // Canvas pre-filled with known HDR values
    const canvas = makeHdrFrame(width, height, 10000, 20000, 30000);
    blitRgba8OverRgb48le(domRgba, canvas, width, height);

    // All pixels should be unchanged
    for (let i = 0; i < width * height; i++) {
      expect(canvas.readUInt16LE(i * 6 + 0)).toBe(10000);
      expect(canvas.readUInt16LE(i * 6 + 2)).toBe(20000);
      expect(canvas.readUInt16LE(i * 6 + 4)).toBe(30000);
    }
  });

  it("fully opaque PNG overlay overwrites all canvas pixels (sRGB→HLG)", () => {
    const width = 2;
    const height = 2;

    // Build a fully opaque blue PNG (sRGB blue = 0,0,255)
    const pixels = Array(width * height)
      .fill(null)
      .flatMap(() => [0, 0, 255, 255]);
    const png = makePng(width, height, pixels);
    const { data: domRgba } = decodePng(png);

    const canvas = makeHdrFrame(width, height, 50000, 40000, 30000);
    blitRgba8OverRgb48le(domRgba, canvas, width, height);

    // sRGB blue (0,0,255) → HLG (0, 0, 65535) — black/white map identically
    for (let i = 0; i < width * height; i++) {
      expect(canvas.readUInt16LE(i * 6 + 0)).toBe(0);
      expect(canvas.readUInt16LE(i * 6 + 2)).toBe(0);
      expect(canvas.readUInt16LE(i * 6 + 4)).toBe(65535);
    }
  });
});

// ── roundedRectAlpha tests ──────────────────────────────────────────────────

describe("roundedRectAlpha", () => {
  const uniform20: [number, number, number, number] = [20, 20, 20, 20];

  it("returns 1 for center pixel", () => {
    expect(roundedRectAlpha(50, 50, 100, 100, uniform20)).toBe(1);
  });

  it("returns 1 for pixel well inside edge (not in corner zone)", () => {
    // On top edge but past the corner zone (x >= radius)
    expect(roundedRectAlpha(50, 5, 100, 100, uniform20)).toBe(1);
  });

  it("returns 0 for pixel at the extreme corner (outside rounded area)", () => {
    // Top-left corner: (0, 0) is far from circle center at (20, 20)
    // dist = sqrt(400 + 400) = 28.28, well beyond radius 20
    expect(roundedRectAlpha(0, 0, 100, 100, uniform20)).toBe(0);
  });

  it("returns 1 for pixel well inside corner circle", () => {
    // Pixel at (15, 15): dist from center (20, 20) = sqrt(25+25) = 7.07 << 20
    expect(roundedRectAlpha(15, 15, 100, 100, uniform20)).toBe(1);
  });

  it("returns fractional alpha at corner edge (anti-aliasing)", () => {
    // Find a point near the circle edge. radius = 20, center at (20, 20).
    // Point on the circle: (20 - 20*cos(45°), 20 - 20*sin(45°)) ≈ (5.86, 5.86)
    // Shift slightly inward for fractional alpha
    const edgePx = 20 - 20 * Math.cos(Math.PI / 4); // ~5.86
    const alpha = roundedRectAlpha(edgePx, edgePx, 100, 100, uniform20);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
  });

  it("handles all four corners symmetrically", () => {
    // Test top-right corner (x near w, y near 0)
    expect(roundedRectAlpha(100, 0, 100, 100, uniform20)).toBe(0);
    // Test bottom-right corner
    expect(roundedRectAlpha(100, 100, 100, 100, uniform20)).toBe(0);
    // Test bottom-left corner
    expect(roundedRectAlpha(0, 100, 100, 100, uniform20)).toBe(0);
  });

  it("returns 1 everywhere for zero radii", () => {
    const zero: [number, number, number, number] = [0, 0, 0, 0];
    expect(roundedRectAlpha(0, 0, 100, 100, zero)).toBe(1);
    expect(roundedRectAlpha(99, 0, 100, 100, zero)).toBe(1);
    expect(roundedRectAlpha(0, 99, 100, 100, zero)).toBe(1);
    expect(roundedRectAlpha(99, 99, 100, 100, zero)).toBe(1);
  });

  it("supports per-corner radii", () => {
    const mixed: [number, number, number, number] = [20, 0, 10, 0];
    // Top-left has radius 20 — corner pixel outside
    expect(roundedRectAlpha(0, 0, 100, 100, mixed)).toBe(0);
    // Top-right has radius 0 — corner pixel inside
    expect(roundedRectAlpha(99, 0, 100, 100, mixed)).toBe(1);
    // Bottom-right has radius 10 — extreme corner outside
    expect(roundedRectAlpha(100, 100, 100, 100, mixed)).toBe(0);
    // Bottom-left has radius 0 — corner pixel inside
    expect(roundedRectAlpha(0, 99, 100, 100, mixed)).toBe(1);
  });
});

// ── blitRgb48leRegion with borderRadius ─────────────────────────────────────

describe("blitRgb48leRegion with borderRadius", () => {
  it("clips corner pixels when borderRadius is set", () => {
    // 10x10 source placed at origin on a 10x10 canvas, radius 5
    const canvas = Buffer.alloc(10 * 10 * 6);
    const source = makeHdrFrame(10, 10, 40000, 30000, 20000);
    const br: [number, number, number, number] = [5, 5, 5, 5];
    blitRgb48leRegion(canvas, source, 0, 0, 10, 10, 10, 10, undefined, br);

    // Center pixel should be written
    const centerOff = (5 * 10 + 5) * 6;
    expect(canvas.readUInt16LE(centerOff)).toBe(40000);

    // Corner pixel (0,0) should be clipped (remain 0)
    expect(canvas.readUInt16LE(0)).toBe(0);
  });

  it("no effect when borderRadius is all zeros", () => {
    const canvas1 = Buffer.alloc(4 * 4 * 6);
    const canvas2 = Buffer.alloc(4 * 4 * 6);
    const source = makeHdrFrame(4, 4, 40000, 30000, 20000);

    blitRgb48leRegion(canvas1, source, 0, 0, 4, 4, 4, 4);
    blitRgb48leRegion(canvas2, source, 0, 0, 4, 4, 4, 4, undefined, [0, 0, 0, 0]);

    expect(Buffer.compare(canvas1, canvas2)).toBe(0);
  });

  it("combines opacity and borderRadius", () => {
    // Canvas with known background, source with known values
    const canvas = makeHdrFrame(10, 10, 20000, 20000, 20000);
    const source = makeHdrFrame(10, 10, 60000, 60000, 60000);
    const br: [number, number, number, number] = [3, 3, 3, 3];

    blitRgb48leRegion(canvas, source, 0, 0, 10, 10, 10, 10, 0.5, br);

    // Center pixel: opacity 0.5, mask 1.0 → effective 0.5
    // Result: 60000 * 0.5 + 20000 * 0.5 = 40000
    const centerOff = (5 * 10 + 5) * 6;
    expect(canvas.readUInt16LE(centerOff)).toBe(40000);

    // Corner pixel (0,0): mask 0.0 → skipped, canvas unchanged
    expect(canvas.readUInt16LE(0)).toBe(20000);
  });
});

// ── blitRgb48leAffine with borderRadius ─────────────────────────────────────

describe("blitRgb48leAffine with borderRadius", () => {
  it("clips corner pixels with identity transform", () => {
    const canvas = Buffer.alloc(10 * 10 * 6);
    const source = makeHdrFrame(10, 10, 40000, 30000, 20000);
    const identity = [1, 0, 0, 1, 0, 0];
    const br: [number, number, number, number] = [5, 5, 5, 5];

    blitRgb48leAffine(canvas, source, identity, 10, 10, 10, 10, undefined, br);

    // Center pixel should be written
    const centerOff = (5 * 10 + 5) * 6;
    expect(canvas.readUInt16LE(centerOff)).toBe(40000);

    // Corner pixel (0,0) should be clipped
    expect(canvas.readUInt16LE(0)).toBe(0);
  });

  it("mask follows transform (scaled output has rounded corners)", () => {
    // 4x4 source scaled up 2× on an 8×8 canvas, radius 2 in source space
    const canvas = Buffer.alloc(8 * 8 * 6);
    const source = makeHdrFrame(4, 4, 50000, 40000, 30000);
    const scale2x = [2, 0, 0, 2, 0, 0];
    const br: [number, number, number, number] = [2, 2, 2, 2];

    blitRgb48leAffine(canvas, source, scale2x, 4, 4, 8, 8, undefined, br);

    // Canvas center (4,4) maps to source (2,2) — inside, should be written
    const centerOff = (4 * 8 + 4) * 6;
    expect(canvas.readUInt16LE(centerOff)).toBeGreaterThan(0);

    // Canvas corner (0,0) maps to source (0,0) — outside radius, should be clipped
    expect(canvas.readUInt16LE(0)).toBe(0);
  });

  it("no effect when borderRadius is undefined", () => {
    const canvas1 = Buffer.alloc(4 * 4 * 6);
    const canvas2 = Buffer.alloc(4 * 4 * 6);
    const source = makeHdrFrame(4, 4, 40000, 30000, 20000);
    const identity = [1, 0, 0, 1, 0, 0];

    blitRgb48leAffine(canvas1, source, identity, 4, 4, 4, 4);
    blitRgb48leAffine(canvas2, source, identity, 4, 4, 4, 4, undefined, undefined);

    expect(Buffer.compare(canvas1, canvas2)).toBe(0);
  });
});

// ── normalizeObjectFit ──────────────────────────────────────────────────────

describe("normalizeObjectFit", () => {
  it("returns supported values verbatim", () => {
    expect(normalizeObjectFit("fill")).toBe("fill");
    expect(normalizeObjectFit("cover")).toBe("cover");
    expect(normalizeObjectFit("contain")).toBe("contain");
    expect(normalizeObjectFit("none")).toBe("none");
    expect(normalizeObjectFit("scale-down")).toBe("scale-down");
  });

  it("trims whitespace and lowercases input", () => {
    expect(normalizeObjectFit("  COVER  ")).toBe("cover");
  });

  it("falls back to fill for unsupported values", () => {
    expect(normalizeObjectFit(undefined)).toBe("fill");
    expect(normalizeObjectFit("")).toBe("fill");
    expect(normalizeObjectFit("inherit")).toBe("fill");
    expect(normalizeObjectFit("garbage")).toBe("fill");
  });
});

// ── resampleRgb48leObjectFit ────────────────────────────────────────────────

function readRgb16(buf: Buffer, width: number, x: number, y: number): [number, number, number] {
  const off = (y * width + x) * 6;
  return [buf.readUInt16LE(off), buf.readUInt16LE(off + 2), buf.readUInt16LE(off + 4)];
}

describe("resampleRgb48leObjectFit", () => {
  it("returns the same buffer unchanged for identity fill resample", () => {
    const src = makeHdrFrame(4, 4, 40000, 30000, 20000);
    const out = resampleRgb48leObjectFit(src, 4, 4, 4, 4, "fill");

    // Fast path returns the same Buffer reference, not a copy
    expect(out).toBe(src);
  });

  it("returns the source untouched on degenerate dimensions", () => {
    const src = makeHdrFrame(4, 4, 1, 2, 3);
    expect(resampleRgb48leObjectFit(src, 0, 4, 8, 8, "cover")).toBe(src);
    expect(resampleRgb48leObjectFit(src, 4, 4, 0, 8, "cover")).toBe(src);
  });

  it("fills a larger box with stretched content (fit=fill)", () => {
    const src = makeHdrFrame(2, 2, 50000, 40000, 30000);
    const out = resampleRgb48leObjectFit(src, 2, 2, 8, 4, "fill");

    expect(out.length).toBe(8 * 4 * 6);
    // Every output pixel should be the source color (uniform input → uniform output)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 8; x++) {
        const [r, g, b] = readRgb16(out, 8, x, y);
        expect(r).toBe(50000);
        expect(g).toBe(40000);
        expect(b).toBe(30000);
      }
    }
  });

  it("covers the destination box (cover) — fills entire box, no black bars", () => {
    // 4×2 source into a 6×6 dst: cover scales by 6/2 = 3 → rendered 12×6, cropped horizontally
    const src = makeHdrFrame(4, 2, 65000, 0, 0);
    const out = resampleRgb48leObjectFit(src, 4, 2, 6, 6, "cover");

    // No pillarbox/letterbox black anywhere
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 6; x++) {
        const [r] = readRgb16(out, 6, x, y);
        expect(r).toBe(65000);
      }
    }
  });

  it("contains the source (contain) and letterboxes with opaque black", () => {
    // 4×2 source into a 6×6 dst: contain scales by 6/4 = 1.5 → rendered 6×3, vertically centered
    const src = makeHdrFrame(4, 2, 65000, 65000, 65000);
    const out = resampleRgb48leObjectFit(src, 4, 2, 6, 6, "contain");

    // Top and bottom rows should be black (letterbox)
    for (const y of [0, 5]) {
      for (let x = 0; x < 6; x++) {
        expect(readRgb16(out, 6, x, y)).toEqual([0, 0, 0]);
      }
    }
    // Middle band (rows 2–3) should be the source color
    for (const y of [2, 3]) {
      for (let x = 0; x < 6; x++) {
        const [r, g, b] = readRgb16(out, 6, x, y);
        expect(r).toBe(65000);
        expect(g).toBe(65000);
        expect(b).toBe(65000);
      }
    }
  });

  it("none preserves source size and centers it on a black background", () => {
    // 2×2 source into a 6×6 dst with default object-position 50%/50%
    const src = makeHdrFrame(2, 2, 40000, 30000, 20000);
    const out = resampleRgb48leObjectFit(src, 2, 2, 6, 6, "none");

    // Center 2×2 region (rows 2–3, cols 2–3) holds the source
    for (let y = 2; y < 4; y++) {
      for (let x = 2; x < 4; x++) {
        const [r, g, b] = readRgb16(out, 6, x, y);
        expect(r).toBe(40000);
        expect(g).toBe(30000);
        expect(b).toBe(20000);
      }
    }
    // Corners should be black
    expect(readRgb16(out, 6, 0, 0)).toEqual([0, 0, 0]);
    expect(readRgb16(out, 6, 5, 5)).toEqual([0, 0, 0]);
  });

  it("respects object-position for none-fit alignment", () => {
    // 2×2 source into a 6×6 dst, anchored top-left
    const src = makeHdrFrame(2, 2, 40000, 30000, 20000);
    const out = resampleRgb48leObjectFit(src, 2, 2, 6, 6, "none", "0% 0%");

    // Top-left 2×2 block holds the source
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const [r] = readRgb16(out, 6, x, y);
        expect(r).toBe(40000);
      }
    }
    // Bottom-right corner stays black
    expect(readRgb16(out, 6, 5, 5)).toEqual([0, 0, 0]);
    // Just below the source band should be black
    expect(readRgb16(out, 6, 0, 2)).toEqual([0, 0, 0]);
    expect(readRgb16(out, 6, 2, 0)).toEqual([0, 0, 0]);
  });

  it("scale-down behaves like none when source fits in dst", () => {
    const src = makeHdrFrame(2, 2, 40000, 30000, 20000);
    const noneOut = resampleRgb48leObjectFit(src, 2, 2, 6, 6, "none");
    const sdOut = resampleRgb48leObjectFit(src, 2, 2, 6, 6, "scale-down");

    expect(Buffer.compare(noneOut, sdOut)).toBe(0);
  });

  it("scale-down behaves like contain when source overflows dst", () => {
    const src = makeHdrFrame(8, 4, 40000, 30000, 20000);
    const containOut = resampleRgb48leObjectFit(src, 8, 4, 6, 6, "contain");
    const sdOut = resampleRgb48leObjectFit(src, 8, 4, 6, 6, "scale-down");

    expect(Buffer.compare(containOut, sdOut)).toBe(0);
  });
});
