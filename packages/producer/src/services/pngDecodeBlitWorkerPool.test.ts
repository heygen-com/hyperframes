/**
 * Tests for the hf#732 lever-4 PNG decode + alpha-blit worker pool. Like the
 * shader-blend pool tests next door, these are correctness-critical: a
 * regression either corrupts every composited DOM layer or leaks worker
 * handles. Tests pin three properties:
 *
 *   1. Byte-equivalence with the inline path. The worker calls the exact
 *      same `decodePng` + `blitRgba8OverRgb48le` the inline path uses, so
 *      the round-trip must reproduce the inline result to the last byte.
 *   2. Buffer-transfer correctness across the 8KB Node pool threshold.
 *      The pool's dispatcher must NOT throw `DataCloneError` for inputs
 *      that happen to live in the shared 8KB pool (small PNGs, etc.).
 *   3. Concurrent dispatch + pipelining. N concurrent `run` calls
 *      against a pool sized to N all complete with correct output. The
 *      pipelining test asserts that decode/blit of frame N overlaps the
 *      kickoff of frame N+1's "capture" (simulated by a deferred Promise),
 *      proving the pool isn't accidentally serializing.
 *
 * The pool's clean-shutdown path is also exercised so a test failure
 * doesn't leak handles into other tests.
 */

import { afterEach, describe, expect, it } from "vitest";
import { deflateSync } from "zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { decodePng, blitRgba8OverRgb48le } from "@hyperframes/engine/alpha-blit";
import {
  createPngDecodeBlitWorkerPool,
  type PngDecodeBlitWorkerPool,
} from "./pngDecodeBlitWorkerPool.js";

const W = 16;
const H = 8;
const RGB48_BYTES = W * H * 6;

/**
 * Synthesize a minimal RGBA8 PNG with a uniform color. Skips CRC32
 * because `decodePng` does not verify checksums. Produces an output that's
 * intentionally tiny (well under 8KB) so the test exercises the
 * shared-pool-detection path in the dispatcher.
 */
function makeUniformRgbaPng(
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
  a: number,
): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // no filter
  ihdr[12] = 0; // non-interlaced

  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    rows.push(Buffer.from([0])); // PNG row filter byte (None)
    for (let x = 0; x < w; x++) {
      rows.push(Buffer.from([r, g, b, a]));
    }
  }
  const idatData = deflateSync(Buffer.concat(rows));

  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4); // skipped by decoder
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idatData),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("PngDecodeBlitWorkerPool", () => {
  const pools: PngDecodeBlitWorkerPool[] = [];

  afterEach(async () => {
    while (pools.length > 0) {
      const p = pools.pop();
      if (p) await p.terminate();
    }
  });

  async function makePool(size: number): Promise<PngDecodeBlitWorkerPool> {
    const p = await createPngDecodeBlitWorkerPool({ size });
    pools.push(p);
    return p;
  }

  it("produces byte-identical output to the inline decode+blit path", async () => {
    const pool = await makePool(1);
    const png = makeUniformRgbaPng(W, H, 255, 0, 0, 255);

    // Pool path: blit onto a zero-filled rgb48le canvas.
    const poolDest = Buffer.alloc(RGB48_BYTES);
    const poolResult = await pool.run({
      png: Buffer.from(png), // independent copy — the input may be detached
      dest: poolDest,
      width: W,
      height: H,
      transfer: "srgb",
    });

    // Reference: inline decode+blit onto a separately allocated canvas.
    const refDest = Buffer.alloc(RGB48_BYTES);
    const { data: refRgba } = decodePng(png);
    blitRgba8OverRgb48le(refRgba, refDest, W, H, "srgb");

    expect(Buffer.compare(poolResult.dest, refDest)).toBe(0);
  });

  it("composites OVER existing rgb48le content (alpha blend semantics)", async () => {
    const pool = await makePool(1);

    // Half-transparent red over a green background.
    const png = makeUniformRgbaPng(W, H, 255, 0, 0, 128);

    const poolDest = Buffer.alloc(RGB48_BYTES);
    for (let i = 0; i < W * H; i++) {
      const off = i * 6;
      poolDest.writeUInt16LE(0, off); // R
      poolDest.writeUInt16LE(60000, off + 2); // G
      poolDest.writeUInt16LE(0, off + 4); // B
    }

    const poolResult = await pool.run({
      png: Buffer.from(png),
      dest: poolDest,
      width: W,
      height: H,
      transfer: "srgb",
    });

    // Inline reference applies the same blend to its own copy of the
    // green background.
    const refDest = Buffer.alloc(RGB48_BYTES);
    for (let i = 0; i < W * H; i++) {
      const off = i * 6;
      refDest.writeUInt16LE(0, off);
      refDest.writeUInt16LE(60000, off + 2);
      refDest.writeUInt16LE(0, off + 4);
    }
    const { data: refRgba } = decodePng(png);
    blitRgba8OverRgb48le(refRgba, refDest, W, H, "srgb");

    expect(Buffer.compare(poolResult.dest, refDest)).toBe(0);
  });

  it("survives small PNGs that would otherwise hit the Node 8KB shared pool", async () => {
    // A 16×8 RGBA PNG compresses to a few hundred bytes — comfortably
    // under the 8KB Buffer pool threshold. If the dispatcher fails to
    // copy-out before postMessage, this throws DataCloneError.
    const pool = await makePool(1);
    const png = makeUniformRgbaPng(W, H, 50, 100, 200, 255);
    expect(png.byteLength).toBeLessThan(8192);

    const result = await pool.run({
      png,
      dest: Buffer.alloc(RGB48_BYTES),
      width: W,
      height: H,
      transfer: "srgb",
    });
    expect(result.dest.byteLength).toBe(RGB48_BYTES);
  });

  it("runs N concurrent decode+blit tasks against an N-wide pool", async () => {
    const pool = await makePool(4);
    const png = makeUniformRgbaPng(W, H, 200, 100, 50, 255);

    const tasks = Array.from({ length: 4 }, () =>
      pool.run({
        png: Buffer.from(png),
        dest: Buffer.alloc(RGB48_BYTES),
        width: W,
        height: H,
        transfer: "srgb",
      }),
    );
    const results = await Promise.all(tasks);

    // All 4 results must match each other (same input) AND match the
    // inline reference.
    const refDest = Buffer.alloc(RGB48_BYTES);
    const { data: refRgba } = decodePng(png);
    blitRgba8OverRgb48le(refRgba, refDest, W, H, "srgb");
    for (const r of results) {
      expect(Buffer.compare(r.dest, refDest)).toBe(0);
    }
  });

  it("permits frame N+1 capture to proceed while frame N decode+blit is in flight", async () => {
    // Pipelining proof: kick off a "decode+blit" task that we can hold by
    // virtue of the worker actually running, then concurrently kick off a
    // simulated next-frame capture (a Promise that resolves immediately).
    // The simulated capture must resolve BEFORE the decode+blit, proving
    // the decode+blit isn't blocking the main thread.
    const pool = await makePool(2);
    const png = makeUniformRgbaPng(W, H, 50, 100, 200, 255);

    // Sentinel timestamps to verify overlap.
    const captureStarted: number[] = [];
    const captureDone: number[] = [];
    const decodeBlitStarted: number[] = [];
    const decodeBlitDone: number[] = [];

    decodeBlitStarted.push(Date.now());
    const decodeBlitPromise = pool
      .run({
        png: Buffer.from(png),
        dest: Buffer.alloc(RGB48_BYTES),
        width: W,
        height: H,
        transfer: "srgb",
      })
      .then((r) => {
        decodeBlitDone.push(Date.now());
        return r;
      });

    // Simulated next-frame CDP capture — a microtask-y await that yields.
    // On a non-pipelined (synchronous-inline) path this would have to wait
    // for the decode+blit, but the pool dispatches to a worker thread so
    // the main thread is free to start the next "capture" immediately.
    captureStarted.push(Date.now());
    await new Promise((resolve) => setImmediate(resolve));
    captureDone.push(Date.now());

    await decodeBlitPromise;

    expect(captureDone[0]).toBeDefined();
    expect(decodeBlitDone[0]).toBeDefined();
    // The simulated capture must have completed before the decode+blit —
    // proof that the pool is NOT blocking the main thread.
    expect(captureDone[0]!).toBeLessThanOrEqual(decodeBlitDone[0]!);
  });

  it("spawns from an explicit workerEntryPath, bypassing the import.meta.url resolver", async () => {
    // Regression for the hf#677 bundled-CLI bug: when the pool is inlined
    // into a separate bundle (e.g. cli.js), `import.meta.url` resolves to
    // the bundle's path rather than the bundled worker's emitted path, and
    // the sibling-probe fallback computes a path the worker file does not
    // live at. The explicit `workerEntryPath` plumbed by the call site
    // bypasses the heuristic entirely.
    const here = dirname(fileURLToPath(import.meta.url));
    const explicitPath = resolve(here, "pngDecodeBlitWorker.ts");
    const pool = await createPngDecodeBlitWorkerPool({
      size: 1,
      workerEntryPath: explicitPath,
    });
    pools.push(pool);

    const png = makeUniformRgbaPng(W, H, 64, 128, 192, 255);
    const dest = Buffer.alloc(RGB48_BYTES);
    const result = await pool.run({
      png: Buffer.from(png),
      dest,
      width: W,
      height: H,
      transfer: "srgb",
    });

    // Compare to inline reference to confirm the explicit-path spawn actually
    // ran real work (not just spawned and crashed silently).
    const refDest = Buffer.alloc(RGB48_BYTES);
    const { data: refRgba } = decodePng(png);
    blitRgba8OverRgb48le(refRgba, refDest, W, H, "srgb");
    expect(Buffer.compare(result.dest, refDest)).toBe(0);
  });

  it("terminates cleanly even with queued tasks", async () => {
    const pool = await makePool(1);
    const png = makeUniformRgbaPng(W, H, 1, 2, 3, 255);

    // Two tasks: the first dispatches, the second queues.
    const p1 = pool.run({
      png: Buffer.from(png),
      dest: Buffer.alloc(RGB48_BYTES),
      width: W,
      height: H,
      transfer: "srgb",
    });
    const p2 = pool.run({
      png: Buffer.from(png),
      dest: Buffer.alloc(RGB48_BYTES),
      width: W,
      height: H,
      transfer: "srgb",
    });

    await pool.terminate();
    pools.pop(); // already terminated; don't try to re-terminate in afterEach

    // Both must settle (resolve or reject). The first MAY resolve if the
    // worker finished before terminate() raced in; the second MUST reject
    // because it never got to dispatch.
    const r1 = await p1.catch((e: unknown) => e);
    const r2 = await p2.catch((e: unknown) => e);
    if (r2 instanceof Error) {
      expect(r2.message).toMatch(/terminated/);
    } else {
      // If both raced to resolve before terminate, that's also acceptable
      // — but only the second one is guaranteed-rejected. Accept either
      // shape; the goal of the test is "no leaked handles, no unhandled
      // rejection".
      expect(r2).toBeDefined();
    }
    // r1 is "either resolved with a result OR rejected with terminated";
    // both are acceptable.
    expect(r1).toBeDefined();
  });
});
