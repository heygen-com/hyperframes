/**
 * Tests for the seeded `Math.random` / `crypto.getRandomValues` in `VIRTUAL_TIME_SHIM`.
 *
 * The shim is executed inside `node:vm` with a synthetic `window`/`Math` so
 * tests don't need real Chrome.
 */

import { describe, expect, it } from "bun:test";
import { Script, createContext, type Context } from "node:vm";
import { VIRTUAL_TIME_SHIM } from "./fileServer.js";

/**
 * Build a fresh VM context with its own globals (its own Math, its own
 * crypto, …) and run the shim inside it. Each context's Math is independent,
 * so we can run two shims back-to-back and have their `Math.random` overrides
 * not clobber each other.
 *
 * The shim is a browser-style IIFE that touches `window.*`. We set the VM's
 * `window` to its own globalThis so `window.setTimeout = ...` mutates the VM
 * globals (matching browser semantics) and our test code can read
 * `window.__HF_VIRTUAL_TIME__` afterward.
 */
function makeShimContext(): {
  context: Context;
  run: <T = unknown>(code: string) => T;
} {
  const context = createContext({});
  const bootstrap = `
    globalThis.window = globalThis;
    globalThis.setTimeout = (cb, ms) => 0;
    globalThis.clearTimeout = (id) => undefined;
    globalThis.setInterval = (cb, ms) => 0;
    globalThis.clearInterval = (id) => undefined;
    globalThis.performance = { now: () => 0 };
    globalThis.requestAnimationFrame = undefined;
    globalThis.cancelAnimationFrame = undefined;
    // Provide a synthetic crypto.getRandomValues so the shim can detect it
    // and replace it. Default is a no-op that returns the buffer unchanged.
    globalThis.crypto = { getRandomValues: (arr) => arr };
  `;
  new Script(bootstrap).runInContext(context);
  const run = <T>(code: string): T => new Script(code).runInContext(context) as T;
  return { context, run };
}

function runShim(shimSource: string): {
  run: <T = unknown>(code: string) => T;
} {
  const ctx = makeShimContext();
  ctx.run(shimSource);
  return ctx;
}

describe("VIRTUAL_TIME_SHIM seeded randomness", () => {
  it("replaces Math.random with a non-native PRNG", () => {
    const shim = VIRTUAL_TIME_SHIM;
    const { run } = runShim(shim);
    const isNative = run<boolean>(`/\\[native code\\]/.test(Math.random.toString())`);
    expect(isNative).toBe(false);
  });

  it("produces identical Math.random sequences across two fresh VMs at the same time", () => {
    const shim = VIRTUAL_TIME_SHIM;
    const drawSequence = `(() => {
      window.__HF_VIRTUAL_TIME__.seekToTime(1234);
      const seq = [];
      for (let i = 0; i < 16; i++) seq.push(Math.random());
      return seq;
    })()`;
    const seqA = runShim(shim).run<number[]>(drawSequence);
    const seqB = runShim(shim).run<number[]>(drawSequence);
    expect(seqA).toEqual(seqB);
    // Sanity: the sequence isn't degenerate.
    expect(new Set(seqA).size).toBeGreaterThan(8);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("re-seeking to the same time produces the same Math.random sequence", () => {
    // The core determinism contract for retries: same (planDir, chunkIndex) →
    // same frame N → same seekToTime(t_N) → same Math.random outputs.
    const shim = VIRTUAL_TIME_SHIM;
    const { run } = runShim(shim);
    const observed = run<{ first: number[]; second: number[] }>(`(() => {
      window.__HF_VIRTUAL_TIME__.seekToTime(42);
      const first = [Math.random(), Math.random(), Math.random()];
      window.__HF_VIRTUAL_TIME__.seekToTime(999);
      Math.random(); Math.random();
      window.__HF_VIRTUAL_TIME__.seekToTime(42);
      const second = [Math.random(), Math.random(), Math.random()];
      return { first, second };
    })()`);
    expect(observed.second).toEqual(observed.first);
  });

  it("different times produce different Math.random sequences", () => {
    const shim = VIRTUAL_TIME_SHIM;
    const { run } = runShim(shim);
    const observed = run<{ t0: number[]; t1: number[] }>(`(() => {
      window.__HF_VIRTUAL_TIME__.seekToTime(0);
      const t0 = [Math.random(), Math.random(), Math.random()];
      window.__HF_VIRTUAL_TIME__.seekToTime(1);
      const t1 = [Math.random(), Math.random(), Math.random()];
      return { t0, t1 };
    })()`);
    expect(observed.t1).not.toEqual(observed.t0);
  });

  it("seeded crypto.getRandomValues writes deterministic bytes", () => {
    const shim = VIRTUAL_TIME_SHIM;
    const drawBytes = `(() => {
      window.__HF_VIRTUAL_TIME__.seekToTime(7);
      const buf = new Uint8Array(64);
      window.crypto.getRandomValues(buf);
      return Array.from(buf);
    })()`;
    const a = runShim(shim).run<number[]>(drawBytes);
    const b = runShim(shim).run<number[]>(drawBytes);
    expect(a).toEqual(b);
    expect(a.some((v) => v !== 0)).toBe(true);
  });

  it("seeded crypto.getRandomValues handles odd byte lengths", () => {
    const shim = VIRTUAL_TIME_SHIM;
    const { run } = runShim(shim);
    const lengths = run<number[]>(`(() => {
      window.__HF_VIRTUAL_TIME__.seekToTime(3);
      const out = [];
      for (const len of [1, 2, 3, 4, 5, 7, 31, 33]) {
        const buf = new Uint8Array(len);
        window.crypto.getRandomValues(buf);
        out.push(buf.byteLength);
      }
      return out;
    })()`);
    expect(lengths).toEqual([1, 2, 3, 4, 5, 7, 31, 33]);
  });

  it("draws the same Math.random sequence at page load in two fresh pages", () => {
    // A GSAP stagger { from: "random" } draws its order when the page script runs, before any seek.
    const drawAtLoad = `(() => {
      const seq = [];
      for (let i = 0; i < 16; i++) seq.push(Math.random());
      return seq;
    })()`;
    const seqA = runShim(VIRTUAL_TIME_SHIM).run<number[]>(drawAtLoad);
    const seqB = runShim(VIRTUAL_TIME_SHIM).run<number[]>(drawAtLoad);
    expect(seqA).toEqual(seqB);
  });
});
