/**
 * Tests for the rAF drain inside the virtual-time shim's `seekToTime`
 * (`buildVirtualTimeShim` in fileServer.ts).
 *
 * heygen-com/hyperframes#5888: one flush per seek runs each queued rAF
 * callback exactly once, so a callback that re-registers — a deferred DOM
 * reveal chained through several rAF turns — lands one rendered frame late
 * per turn and early frames of each worker capture a pre-settled DOM. The
 * shim now drains the queue to quiescence at the seeked virtual time, with
 * turn/execution caps bounding queues that never converge.
 *
 * The shim is executed inside `node:vm` with a synthetic `window` so tests
 * don't need real Chrome — same harness as fileServer-seededRandom.test.ts.
 */

import { describe, expect, it } from "bun:test";
import { Script, createContext, type Context } from "node:vm";
import { buildVirtualTimeShim } from "./fileServer.js";

function runShim(shimSource: string): {
  run: <T = unknown>(code: string) => T;
} {
  const context = createContext({});
  new Script(`
    globalThis.window = globalThis;
    globalThis.setTimeout = (cb, ms) => 0;
    globalThis.clearTimeout = (id) => undefined;
    globalThis.setInterval = (cb, ms) => 0;
    globalThis.clearInterval = (id) => undefined;
    globalThis.performance = { now: () => 0 };
    globalThis.requestAnimationFrame = undefined;
    globalThis.cancelAnimationFrame = undefined;
    globalThis.crypto = { getRandomValues: (arr) => arr };
  `).runInContext(context as Context);
  const run = <T>(code: string): T => new Script(code).runInContext(context) as T;
  run(shimSource);
  return { run };
}

describe("virtual-time shim rAF drain", () => {
  it("settles a finite deferred-reveal chain at the seeked time", () => {
    // The issue's minimal repro: an onUpdate hides text and schedules a reveal
    // through a finite chain of rAF turns. With flush-once semantics the text
    // stays hidden for ~10 rendered frames; the drain must run every turn of
    // the chain inside one seek.
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const state = run<{ visibility: string; turns: number }>(`(() => {
      var el = { visibility: "visible", calls: 0 };
      var pending = 10;
      function reveal() {
        el.calls++;
        if (--pending > 0) requestAnimationFrame(reveal);
        else el.visibility = "visible";
      }
      el.visibility = "hidden";
      requestAnimationFrame(reveal);
      window.__HF_VIRTUAL_TIME__.seekToTime(41);
      return { visibility: el.visibility, turns: el.calls };
    })()`);
    expect(state.visibility).toBe("visible");
    expect(state.turns).toBe(10);
  });

  it("runs a single-shot deferred callback at the seeked time, not one frame late", () => {
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const state = run<{ applied: boolean; atMs: number }>(`(() => {
      var el = { applied: false, atMs: -1 };
      requestAnimationFrame(function(ts) { el.applied = true; el.atMs = ts; });
      window.__HF_VIRTUAL_TIME__.seekToTime(500);
      return { applied: el.applied, atMs: el.atMs };
    })()`);
    expect(state.applied).toBe(true);
    expect(state.atMs).toBe(500);
  });

  it("bounds a perpetual self-rescheduling loop to the turn cap per seek", () => {
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const observed = run<{ firstSeekRuns: number; secondSeekRuns: number; pending: number }>(
      `(() => {
      var runs = 0;
      function loop() { runs++; requestAnimationFrame(loop); }
      requestAnimationFrame(loop);
      window.__HF_VIRTUAL_TIME__.seekToTime(0);
      var firstSeekRuns = runs;
      window.__HF_VIRTUAL_TIME__.seekToTime(41);
      var stats = window.__HF_VIRTUAL_TIME__.lastDrain;
      return { firstSeekRuns: firstSeekRuns, secondSeekRuns: runs - firstSeekRuns, pending: stats.pending };
    })()`,
    );
    // A never-empty queue stops at the cap instead of spinning forever, and
    // the still-pending callback is reported so callers can see the cap hit.
    expect(observed.firstSeekRuns).toBe(64);
    expect(observed.secondSeekRuns).toBe(64);
    expect(observed.pending).toBe(1);
  });

  it("caps total executions against fan-out growth", () => {
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const ran = run<number>(`(() => {
      var runs = 0;
      function fork() { runs++; requestAnimationFrame(fork); requestAnimationFrame(fork); }
      requestAnimationFrame(fork);
      window.__HF_VIRTUAL_TIME__.seekToTime(0);
      return runs;
    })()`);
    // 1 + 2 + 4 + ... — the ran cap (2048) stops the exponential queue before
    // the turn cap does.
    expect(ran).toBeLessThanOrEqual(2048);
    expect(ran).toBeGreaterThan(64);
  });

  it("reports drain stats on __HF_VIRTUAL_TIME__.lastDrain", () => {
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const stats = run<{ turns: number; ran: number; pending: number }>(`(() => {
      var pending = 3;
      function step() { if (--pending > 0) requestAnimationFrame(step); }
      requestAnimationFrame(step);
      window.__HF_VIRTUAL_TIME__.seekToTime(0);
      return window.__HF_VIRTUAL_TIME__.lastDrain;
    })()`);
    expect(stats.turns).toBe(3);
    expect(stats.ran).toBe(3);
    expect(stats.pending).toBe(0);
  });

  it("explicit drainAnimationFrames drains without advancing virtual time", () => {
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const observed = run<{ time: number; applied: boolean }>(`(() => {
      var el = { applied: false };
      var pending = 4;
      function step() { if (--pending > 0) requestAnimationFrame(step); else el.applied = true; }
      requestAnimationFrame(step);
      window.__HF_VIRTUAL_TIME__.seekToTime(77);   // drains the chain already
      var appliedAfterSeek = el.applied;
      requestAnimationFrame(function() { el.applied = true; });
      window.__HF_VIRTUAL_TIME__.drainAnimationFrames();
      return { time: window.__HF_VIRTUAL_TIME__.getTime(), applied: el.applied && appliedAfterSeek };
    })()`);
    expect(observed.time).toBe(77);
    expect(observed.applied).toBe(true);
  });

  it("keeps cancelled entries cancelled across drain turns", () => {
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const ran = run<number>(`(() => {
      var runs = 0;
      var id = requestAnimationFrame(function() { runs++; });
      cancelAnimationFrame(id);
      window.__HF_VIRTUAL_TIME__.seekToTime(0);
      return runs;
    })()`);
    expect(ran).toBe(0);
  });
});
