import { describe, expect, test } from "bun:test";
import { convertTransfer } from "@hyperframes/engine";
import { createHdrImageTransferCache } from "./hdrImageTransferCache.ts";

/**
 * Build a deterministic rgb48le buffer for `pixelCount` pixels.
 * Each pixel is 3 channels × 2 bytes = 6 bytes. Values vary per pixel/channel
 * so the LUT-based `convertTransfer` produces bytes that differ from the
 * source.
 */
function makeSourceBuffer(pixelCount: number, seed = 0): Buffer {
  const buf = Buffer.alloc(pixelCount * 6);
  for (let i = 0; i < pixelCount; i++) {
    const off = i * 6;
    // Spread values across the 16-bit range so HLG↔PQ LUT lookups land on
    // mid-curve entries that are guaranteed to differ from the input.
    buf.writeUInt16LE((seed + i * 257) & 0xff_ff, off);
    buf.writeUInt16LE((seed + i * 521 + 1) & 0xff_ff, off + 2);
    buf.writeUInt16LE((seed + i * 1031 + 2) & 0xff_ff, off + 4);
  }
  return buf;
}

function expectedConverted(source: Buffer, from: "hlg" | "pq", to: "hlg" | "pq"): Buffer {
  const copy = Buffer.from(source);
  convertTransfer(copy, from, to);
  return copy;
}

describe("hdrImageTransferCache", () => {
  test("returns source buffer unchanged when sourceTransfer === targetTransfer", () => {
    const cache = createHdrImageTransferCache();
    const source = makeSourceBuffer(4);

    const result = cache.getConverted("img1", "pq", "pq", source);

    expect(result).toBe(source);
    expect(cache.size()).toBe(0);
    expect(cache.bytesUsed()).toBe(0);
  });

  test("first miss converts and caches", () => {
    const cache = createHdrImageTransferCache();
    const source = makeSourceBuffer(4);
    const expected = expectedConverted(source, "hlg", "pq");

    const result = cache.getConverted("img1", "hlg", "pq", source);

    expect(result).not.toBe(source);
    expect(Buffer.compare(result, expected)).toBe(0);
    expect(cache.size()).toBe(1);
    expect(cache.bytesUsed()).toBe(source.byteLength);
  });

  test("second hit returns cached buffer reference", () => {
    const cache = createHdrImageTransferCache();
    const source = makeSourceBuffer(4);

    const first = cache.getConverted("img1", "hlg", "pq", source);
    const second = cache.getConverted("img1", "hlg", "pq", source);

    expect(second).toBe(first);
    expect(cache.size()).toBe(1);
  });

  test("does not re-run convertTransfer on cache hit", () => {
    const cache = createHdrImageTransferCache();
    const source = makeSourceBuffer(4);

    const first = cache.getConverted("img1", "hlg", "pq", source);
    const snapshot = Buffer.from(first);
    cache.getConverted("img1", "hlg", "pq", source);

    expect(Buffer.compare(first, snapshot)).toBe(0);
  });

  test("different target transfers for same imageId are cached independently", () => {
    const cache = createHdrImageTransferCache();
    const source = makeSourceBuffer(4);

    const toPq = cache.getConverted("img1", "hlg", "pq", source);
    const toHlg = cache.getConverted("img1", "pq", "hlg", source);

    expect(toPq).not.toBe(toHlg);
    expect(Buffer.compare(toPq, expectedConverted(source, "hlg", "pq"))).toBe(0);
    expect(Buffer.compare(toHlg, expectedConverted(source, "pq", "hlg"))).toBe(0);
    expect(cache.size()).toBe(2);
  });

  test("different imageIds are cached independently", () => {
    const cache = createHdrImageTransferCache();
    const a = makeSourceBuffer(4, 100);
    const b = makeSourceBuffer(4, 200);

    const convA = cache.getConverted("a", "hlg", "pq", a);
    const convB = cache.getConverted("b", "hlg", "pq", b);

    expect(convA).not.toBe(convB);
    expect(Buffer.compare(convA, expectedConverted(a, "hlg", "pq"))).toBe(0);
    expect(Buffer.compare(convB, expectedConverted(b, "hlg", "pq"))).toBe(0);
    expect(cache.size()).toBe(2);
  });

  // ── Byte-budget eviction ──────────────────────────────────────────────

  test("evicts LRU entries when byte budget exceeded", () => {
    // Each buffer = 100 pixels × 6 bytes = 600 bytes.
    // Budget = 1200 → fits 2 entries.
    const cache = createHdrImageTransferCache({ maxBytes: 1200 });
    const a = makeSourceBuffer(100, 1);
    const b = makeSourceBuffer(100, 2);
    const c = makeSourceBuffer(100, 3);

    const convA1 = cache.getConverted("a", "hlg", "pq", a);
    cache.getConverted("b", "hlg", "pq", b);
    expect(cache.size()).toBe(2);
    expect(cache.bytesUsed()).toBe(1200);

    // Inserting c should evict a (LRU).
    cache.getConverted("c", "hlg", "pq", c);
    expect(cache.size()).toBe(2);
    expect(cache.bytesUsed()).toBe(1200);

    // a was evicted — re-requesting produces a fresh conversion.
    const convA2 = cache.getConverted("a", "hlg", "pq", a);
    expect(convA2).not.toBe(convA1);
    expect(Buffer.compare(convA2, expectedConverted(a, "hlg", "pq"))).toBe(0);
  });

  test("large buffer evicts multiple smaller entries", () => {
    // 3 small entries (200 bytes each = 600 total), budget = 800.
    // Then one 600-byte entry should evict 2 of the 3 smalls.
    const cache = createHdrImageTransferCache({ maxBytes: 800 });
    const small = makeSourceBuffer(33, 1); // 33*6=198 bytes
    const small2 = makeSourceBuffer(33, 2);
    const small3 = makeSourceBuffer(33, 3);
    const big = makeSourceBuffer(100, 4); // 600 bytes

    cache.getConverted("s1", "hlg", "pq", small);
    cache.getConverted("s2", "hlg", "pq", small2);
    cache.getConverted("s3", "hlg", "pq", small3);
    expect(cache.size()).toBe(3);

    // big (600) + existing (594) > 800 → evict until room.
    cache.getConverted("big", "hlg", "pq", big);
    expect(cache.bytesUsed()).toBeLessThanOrEqual(800);
    expect(cache.size()).toBeLessThan(4);
  });

  test("access promotes entry to most-recently-used under byte budget", () => {
    const cache = createHdrImageTransferCache({ maxBytes: 1200 });
    const a = makeSourceBuffer(100, 1); // 600 bytes
    const b = makeSourceBuffer(100, 2);
    const c = makeSourceBuffer(100, 3);

    const convA1 = cache.getConverted("a", "hlg", "pq", a);
    cache.getConverted("b", "hlg", "pq", b);

    // Promote a to MRU.
    const convA2 = cache.getConverted("a", "hlg", "pq", a);
    expect(convA2).toBe(convA1);

    // Insert c — b is now LRU and should be evicted, not a.
    cache.getConverted("c", "hlg", "pq", c);

    // a should still be cached (was promoted).
    const convA3 = cache.getConverted("a", "hlg", "pq", a);
    expect(convA3).toBe(convA1);

    // b was evicted — fresh conversion.
    const convB2 = cache.getConverted("b", "hlg", "pq", b);
    expect(Buffer.compare(convB2, expectedConverted(b, "hlg", "pq"))).toBe(0);
    expect(cache.size()).toBe(2);
  });

  test("maxBytes: 0 disables caching but still returns correct converted bytes", () => {
    const cache = createHdrImageTransferCache({ maxBytes: 0 });
    const source = makeSourceBuffer(4);
    const expected = expectedConverted(source, "hlg", "pq");

    const first = cache.getConverted("img1", "hlg", "pq", source);
    const second = cache.getConverted("img1", "hlg", "pq", source);

    expect(first).not.toBe(second);
    expect(Buffer.compare(first, expected)).toBe(0);
    expect(Buffer.compare(second, expected)).toBe(0);
    expect(cache.size()).toBe(0);
    expect(cache.bytesUsed()).toBe(0);
  });

  test("bytesUsed tracks cumulative size accurately", () => {
    const cache = createHdrImageTransferCache({ maxBytes: 10000 });
    const a = makeSourceBuffer(50, 1); // 300 bytes
    const b = makeSourceBuffer(100, 2); // 600 bytes

    cache.getConverted("a", "hlg", "pq", a);
    expect(cache.bytesUsed()).toBe(300);

    cache.getConverted("b", "hlg", "pq", b);
    expect(cache.bytesUsed()).toBe(900);
  });

  test("bytesUsed decreases on eviction", () => {
    const cache = createHdrImageTransferCache({ maxBytes: 600 });
    const a = makeSourceBuffer(50, 1); // 300 bytes
    const b = makeSourceBuffer(50, 2); // 300 bytes
    const c = makeSourceBuffer(50, 3); // 300 bytes

    cache.getConverted("a", "hlg", "pq", a);
    cache.getConverted("b", "hlg", "pq", b);
    expect(cache.bytesUsed()).toBe(600);

    cache.getConverted("c", "hlg", "pq", c);
    expect(cache.bytesUsed()).toBe(600);
    expect(cache.size()).toBe(2);
  });

  test("single buffer larger than budget still works (cache-through)", () => {
    const cache = createHdrImageTransferCache({ maxBytes: 100 });
    const big = makeSourceBuffer(100, 1); // 600 bytes > 100 budget
    const expected = expectedConverted(big, "hlg", "pq");

    const result = cache.getConverted("big", "hlg", "pq", big);

    expect(Buffer.compare(result, expected)).toBe(0);
    // Too large to cache — behaves like passthrough.
    expect(cache.size()).toBe(0);
    expect(cache.bytesUsed()).toBe(0);
  });

  // ── Source-buffer-immutability ────────────────────────────────────────

  test("cached buffer is independent from the source buffer", () => {
    const cache = createHdrImageTransferCache();
    const source = makeSourceBuffer(4);
    const sourceSnapshot = Buffer.from(source);

    const cached = cache.getConverted("img1", "hlg", "pq", source);
    source.fill(0);

    expect(cache.getConverted("img1", "hlg", "pq", source)).toBe(cached);
    expect(Buffer.compare(cached, expectedConverted(sourceSnapshot, "hlg", "pq"))).toBe(0);
  });

  test("does not mutate the source buffer on a convert+cache miss", () => {
    const cache = createHdrImageTransferCache();
    const source = makeSourceBuffer(4);
    const sourceSnapshot = Buffer.from(source);

    cache.getConverted("img1", "hlg", "pq", source);

    expect(Buffer.compare(source, sourceSnapshot)).toBe(0);
  });

  test("does not mutate the source buffer on a convert+cache miss with maxBytes=0 passthrough", () => {
    const cache = createHdrImageTransferCache({ maxBytes: 0 });
    const source = makeSourceBuffer(4);
    const sourceSnapshot = Buffer.from(source);

    const result = cache.getConverted("img1", "hlg", "pq", source);

    expect(Buffer.compare(source, sourceSnapshot)).toBe(0);
    expect(result).not.toBe(source);
    expect(Buffer.compare(result, expectedConverted(sourceSnapshot, "hlg", "pq"))).toBe(0);
    expect(cache.size()).toBe(0);
  });

  test("does not mutate the source buffer on a cache hit", () => {
    const cache = createHdrImageTransferCache();
    const source = makeSourceBuffer(4);
    const sourceSnapshot = Buffer.from(source);

    cache.getConverted("img1", "hlg", "pq", source);
    cache.getConverted("img1", "hlg", "pq", source);

    expect(Buffer.compare(source, sourceSnapshot)).toBe(0);
  });

  // ── Validation ────────────────────────────────────────────────────────

  test("rejects invalid maxBytes", () => {
    expect(() => createHdrImageTransferCache({ maxBytes: -1 })).toThrow();
    expect(() => createHdrImageTransferCache({ maxBytes: 1.5 })).toThrow();
    expect(() => createHdrImageTransferCache({ maxBytes: Number.NaN })).toThrow();
  });

  test("default maxBytes accommodates typical 1080p compositions", () => {
    const cache = createHdrImageTransferCache();
    // 1080p rgb48le = 1920*1080*6 = ~12.4MB per entry.
    const px1080p = 1920 * 1080;
    const source = makeSourceBuffer(px1080p);

    for (let i = 0; i < 16; i++) {
      cache.getConverted(`img${i}`, "hlg", "pq", source);
    }
    // Default 200MB budget → fits ~16 entries at 1080p.
    expect(cache.size()).toBe(16);

    const first = cache.getConverted("img0", "hlg", "pq", source);
    expect(Buffer.compare(first, expectedConverted(source, "hlg", "pq"))).toBe(0);
  });

  test("default maxBytes limits 4K entries to safe count", () => {
    const cache = createHdrImageTransferCache();
    // 4K rgb48le = 3840*2160*6 = ~49.8MB per entry.
    const px4k = 3840 * 2160;
    const source = makeSourceBuffer(px4k);

    for (let i = 0; i < 8; i++) {
      cache.getConverted(`img${i}`, "hlg", "pq", source);
    }
    // 200MB / ~50MB = ~4 entries max. 8 inserts should cap at 4.
    expect(cache.size()).toBeLessThanOrEqual(4);
    expect(cache.bytesUsed()).toBeLessThanOrEqual(200 * 1024 * 1024);
  });
});
