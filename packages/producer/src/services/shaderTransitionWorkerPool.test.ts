/**
 * Tests for the hf#677 follow-up worker_threads shader-blend pool. The pool
 * is correctness-critical: a regression here either corrupts transition
 * output or leaks Worker handles. Tests pin three properties:
 *
 *   1. Byte-equivalence with the inline path. The shader code in the
 *      worker is the exact same `TRANSITIONS` table from `@hyperframes/engine`
 *      that the legacy path uses on the main thread; the pool round-trip
 *      must not perturb the result.
 *   2. Buffer transfer semantics. After `run` resolves, the original input
 *      Buffer's `.length` must be 0 (ArrayBuffer detached), and the returned
 *      Buffer must hold the shader output over the same underlying memory.
 *   3. Concurrent dispatch. N concurrent `run` calls against a pool sized
 *      to N all complete with correct output — no slot leakage, no result
 *      misrouting.
 *
 * The pool's clean-shutdown path is also exercised so a test failure here
 * doesn't leak worker_threads handles into other tests in the same vitest
 * run.
 */

import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { TRANSITIONS, crossfade } from "@hyperframes/engine";
import {
  createShaderTransitionWorkerPool,
  type ShaderTransitionWorkerPool,
} from "./shaderTransitionWorkerPool.js";

const WIDTH = 16;
const HEIGHT = 8;
const BUF_SIZE = WIDTH * HEIGHT * 6;

function fillSolid(width: number, height: number, r: number, g: number, b: number): Buffer {
  const buf = Buffer.alloc(width * height * 6);
  for (let i = 0; i < width * height; i++) {
    const off = i * 6;
    buf.writeUInt16LE(r, off);
    buf.writeUInt16LE(g, off + 2);
    buf.writeUInt16LE(b, off + 4);
  }
  return buf;
}

describe("ShaderTransitionWorkerPool", () => {
  const pools: ShaderTransitionWorkerPool[] = [];

  afterEach(async () => {
    while (pools.length > 0) {
      const p = pools.pop();
      if (p) await p.terminate();
    }
  });

  async function makePool(size: number): Promise<ShaderTransitionWorkerPool> {
    const p = await createShaderTransitionWorkerPool({ size });
    pools.push(p);
    return p;
  }

  it("runs crossfade to byte-equivalence with the inline implementation", async () => {
    const pool = await makePool(1);
    const from = fillSolid(WIDTH, HEIGHT, 0, 0, 0);
    const to = fillSolid(WIDTH, HEIGHT, 60000, 60000, 60000);
    const output = Buffer.alloc(BUF_SIZE);

    const result = await pool.run({
      shader: "crossfade",
      bufferA: from,
      bufferB: to,
      output,
      width: WIDTH,
      height: HEIGHT,
      progress: 0.5,
    });

    // Reference: run the same crossfade inline on independent buffers.
    const refFrom = fillSolid(WIDTH, HEIGHT, 0, 0, 0);
    const refTo = fillSolid(WIDTH, HEIGHT, 60000, 60000, 60000);
    const refOut = Buffer.alloc(BUF_SIZE);
    crossfade(refFrom, refTo, refOut, WIDTH, HEIGHT, 0.5);

    expect(result.output.length).toBe(BUF_SIZE);
    expect(Buffer.compare(result.output, refOut)).toBe(0);
  });

  it("produces byte-identical output for every shader in TRANSITIONS at progress=0.37", async () => {
    const pool = await makePool(2);
    // Use a couple of non-uniform input frames so shaders that sample
    // texture content (warp, glitch, swirl) actually differ from the
    // trivial crossfade result.
    const buildGradient = (rOff: number, gOff: number, bOff: number): Buffer => {
      const buf = Buffer.alloc(BUF_SIZE);
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          const i = (y * WIDTH + x) * 6;
          buf.writeUInt16LE(Math.min(65535, rOff + x * 1000), i);
          buf.writeUInt16LE(Math.min(65535, gOff + y * 1000), i + 2);
          buf.writeUInt16LE(Math.min(65535, bOff + (x + y) * 500), i + 4);
        }
      }
      return buf;
    };

    for (const shaderName of Object.keys(TRANSITIONS)) {
      const from = buildGradient(1000, 2000, 3000);
      const to = buildGradient(40000, 35000, 30000);
      const out = Buffer.alloc(BUF_SIZE);

      const result = await pool.run({
        shader: shaderName,
        bufferA: from,
        bufferB: to,
        output: out,
        width: WIDTH,
        height: HEIGHT,
        progress: 0.37,
      });

      const refFrom = buildGradient(1000, 2000, 3000);
      const refTo = buildGradient(40000, 35000, 30000);
      const refOut = Buffer.alloc(BUF_SIZE);
      const fn = TRANSITIONS[shaderName] ?? crossfade;
      fn(refFrom, refTo, refOut, WIDTH, HEIGHT, 0.37);

      expect(
        Buffer.compare(result.output, refOut),
        `shader ${shaderName} diverged from inline output`,
      ).toBe(0);
    }
  });

  it("detaches the caller's input Buffers after transferList", async () => {
    const pool = await makePool(1);
    const from = fillSolid(WIDTH, HEIGHT, 1234, 5678, 9012);
    const to = fillSolid(WIDTH, HEIGHT, 30000, 31000, 32000);
    const output = Buffer.alloc(BUF_SIZE);

    // Capture identity before the call. After transfer, the underlying
    // ArrayBuffer is detached on the sender side; the Buffer's `.length`
    // collapses to 0 (Node behavior on a detached ArrayBuffer).
    expect(from.length).toBe(BUF_SIZE);
    expect(to.length).toBe(BUF_SIZE);
    expect(output.length).toBe(BUF_SIZE);

    const result = await pool.run({
      shader: "crossfade",
      bufferA: from,
      bufferB: to,
      output,
      width: WIDTH,
      height: HEIGHT,
      progress: 0.5,
    });

    // Originals are detached.
    expect(from.length).toBe(0);
    expect(to.length).toBe(0);
    expect(output.length).toBe(0);
    // Returned views are fresh and full-sized.
    expect(result.bufferA.length).toBe(BUF_SIZE);
    expect(result.bufferB.length).toBe(BUF_SIZE);
    expect(result.output.length).toBe(BUF_SIZE);
  });

  it("falls back to crossfade for an unknown shader name (matches inline behavior)", async () => {
    const pool = await makePool(1);
    const from = fillSolid(WIDTH, HEIGHT, 0, 0, 0);
    const to = fillSolid(WIDTH, HEIGHT, 65000, 65000, 65000);
    const output = Buffer.alloc(BUF_SIZE);

    const result = await pool.run({
      shader: "this-shader-does-not-exist",
      bufferA: from,
      bufferB: to,
      output,
      width: WIDTH,
      height: HEIGHT,
      progress: 0.5,
    });

    const refFrom = fillSolid(WIDTH, HEIGHT, 0, 0, 0);
    const refTo = fillSolid(WIDTH, HEIGHT, 65000, 65000, 65000);
    const refOut = Buffer.alloc(BUF_SIZE);
    crossfade(refFrom, refTo, refOut, WIDTH, HEIGHT, 0.5);

    expect(Buffer.compare(result.output, refOut)).toBe(0);
  });

  it("dispatches concurrent tasks across the pool and returns correct output for each", async () => {
    const pool = await makePool(4);
    const progresses = [0.1, 0.25, 0.5, 0.75, 0.9, 0.33, 0.66, 0.0];
    // Each task uses its own buffer triple so they can run truly concurrently
    // without transfer aliasing.
    const tasks = progresses.map((p) => {
      const from = fillSolid(WIDTH, HEIGHT, 0, 0, 0);
      const to = fillSolid(WIDTH, HEIGHT, 50000, 50000, 50000);
      const out = Buffer.alloc(BUF_SIZE);
      return pool.run({
        shader: "crossfade",
        bufferA: from,
        bufferB: to,
        output: out,
        width: WIDTH,
        height: HEIGHT,
        progress: p,
      });
    });

    const results = await Promise.all(tasks);
    for (let i = 0; i < progresses.length; i++) {
      const refFrom = fillSolid(WIDTH, HEIGHT, 0, 0, 0);
      const refTo = fillSolid(WIDTH, HEIGHT, 50000, 50000, 50000);
      const refOut = Buffer.alloc(BUF_SIZE);
      const progress = progresses[i];
      const result = results[i];
      if (progress === undefined || !result) throw new Error("missing test data");
      crossfade(refFrom, refTo, refOut, WIDTH, HEIGHT, progress);
      expect(
        Buffer.compare(result.output, refOut),
        `concurrent task ${i} (progress=${progress}) diverged`,
      ).toBe(0);
    }
  });

  it("spawns from an explicit workerEntryPath, bypassing the import.meta.url resolver", async () => {
    // Regression for the hf#677 bundled-CLI bug: when the pool is inlined
    // into a separate bundle (e.g. cli.js), `import.meta.url` resolves to
    // the bundle's path rather than the bundled worker's emitted path, and
    // the sibling-probe fallback computes a path the worker file does not
    // live at. The explicit `workerEntryPath` plumbed by the call site
    // bypasses the heuristic entirely.
    const here = dirname(fileURLToPath(import.meta.url));
    const explicitPath = resolve(here, "shaderTransitionWorker.ts");
    const pool = await createShaderTransitionWorkerPool({
      size: 1,
      workerEntryPath: explicitPath,
    });
    pools.push(pool);

    const from = fillSolid(WIDTH, HEIGHT, 0, 0, 0);
    const to = fillSolid(WIDTH, HEIGHT, 60000, 60000, 60000);
    const output = Buffer.alloc(BUF_SIZE);
    const result = await pool.run({
      shader: "crossfade",
      bufferA: from,
      bufferB: to,
      output,
      width: WIDTH,
      height: HEIGHT,
      progress: 0.5,
    });

    // Compare to inline reference to confirm the explicit-path spawn actually
    // ran real work (not just spawned and crashed silently).
    const refFrom = fillSolid(WIDTH, HEIGHT, 0, 0, 0);
    const refTo = fillSolid(WIDTH, HEIGHT, 60000, 60000, 60000);
    const refOut = Buffer.alloc(BUF_SIZE);
    crossfade(refFrom, refTo, refOut, WIDTH, HEIGHT, 0.5);
    expect(Buffer.compare(result.output, refOut)).toBe(0);
  });

  it("rejects queued tasks on terminate without leaking workers", async () => {
    // Pool of 1 forces a queue. Spawn one task to occupy the worker, then
    // immediately terminate before any further dispatch.
    const pool = await makePool(1);
    const from = fillSolid(WIDTH, HEIGHT, 0, 0, 0);
    const to = fillSolid(WIDTH, HEIGHT, 60000, 60000, 60000);
    const output = Buffer.alloc(BUF_SIZE);

    const first = pool.run({
      shader: "crossfade",
      bufferA: from,
      bufferB: to,
      output,
      width: WIDTH,
      height: HEIGHT,
      progress: 0.5,
    });
    // Queue a second task using its own buffers so this one will sit in
    // the queue until the first completes.
    const queuedFrom = fillSolid(WIDTH, HEIGHT, 0, 0, 0);
    const queuedTo = fillSolid(WIDTH, HEIGHT, 60000, 60000, 60000);
    const queuedOut = Buffer.alloc(BUF_SIZE);
    const second = pool.run({
      shader: "crossfade",
      bufferA: queuedFrom,
      bufferB: queuedTo,
      output: queuedOut,
      width: WIDTH,
      height: HEIGHT,
      progress: 0.5,
    });
    // Attach a catch handler immediately so that whichever outcome
    // (resolve / reject after terminate) doesn't surface as an
    // unhandled rejection.
    const secondSettled = second.then(
      () => "resolved" as const,
      () => "rejected" as const,
    );

    // First will resolve normally. Force a terminate while second may
    // still be queued OR mid-dispatch. Whatever its state, the pool
    // teardown must not hang.
    await first;
    await pool.terminate();
    // Either second resolved before terminate kicked in (race-tolerant)
    // or it rejected. Both are acceptable; the only failure mode we're
    // ruling out is hanging.
    const result = await Promise.race([
      secondSettled,
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 2000)),
    ]);
    expect(result).not.toBe("hung");
    // Remove from `pools` so afterEach doesn't double-terminate.
    pools.pop();
  });

  describe("crash recovery", () => {
    const CRASH_WORKER = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "__fixtures__",
      "crashOnMessageWorker.mjs",
    );

    async function makeCrashPool(size: number): Promise<ShaderTransitionWorkerPool> {
      const p = await createShaderTransitionWorkerPool({ size, workerEntryPath: CRASH_WORKER });
      pools.push(p);
      return p;
    }

    function blendReq(): Parameters<ShaderTransitionWorkerPool["run"]>[0] {
      return {
        shader: "crossfade",
        bufferA: fillSolid(WIDTH, HEIGHT, 0, 0, 0),
        bufferB: fillSolid(WIDTH, HEIGHT, 1, 1, 1),
        output: Buffer.alloc(BUF_SIZE),
        width: WIDTH,
        height: HEIGHT,
        progress: 0.5,
      };
    }

    // Resolves to "hung" if `p` doesn't settle within `ms`. The crash paths
    // settle near-instantly; "hung" only appears if the regression (dispatch
    // to a dead worker) comes back.
    function settledWithin(p: Promise<unknown>, ms = 3000): Promise<string> {
      return Promise.race([
        p.then(
          () => "resolved",
          () => "rejected",
        ),
        new Promise<string>((r) => setTimeout(() => r("hung"), ms)),
      ]);
    }

    it("rejects the in-flight task when its only worker crashes, then fails subsequent runs fast", async () => {
      const pool = await makeCrashPool(1);
      // The worker throws on receipt: the in-flight task must reject, not hang.
      expect(await settledWithin(pool.run(blendReq()))).toBe("rejected");
      // The slot is now dead. A later run must fail fast rather than dispatch
      // to the terminated worker (postMessage there is a silent no-op → hang).
      expect(await settledWithin(pool.run(blendReq()))).toBe("rejected");
    });

    it("rejects a queued task on crash instead of leaving it to hang", async () => {
      const pool = await makeCrashPool(1);
      // First occupies the single worker (which crashes); second is queued
      // behind it. When the worker dies, both must settle — never hang.
      const inFlight = settledWithin(pool.run(blendReq()));
      const queued = settledWithin(pool.run(blendReq()));
      expect(await inFlight).toBe("rejected");
      expect(await queued).toBe("rejected");
    });

    it("never wedges the pool when all slots die", async () => {
      // Size 2: both slots run the crashing fixture, so there are no surviving
      // workers; the pool must still never wedge — every run settles.
      const pool = await makeCrashPool(2);
      const results = await Promise.all([
        settledWithin(pool.run(blendReq())),
        settledWithin(pool.run(blendReq())),
        settledWithin(pool.run(blendReq())),
      ]);
      expect(results).not.toContain("hung");
    });
  });
});
