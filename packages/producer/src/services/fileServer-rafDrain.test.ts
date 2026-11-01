/**
 * Tests for the capture-path rAF drain exposed by the virtual-time shim
 * (`buildVirtualTimeShim` in fileServer.ts).
 *
 * heygen-com/hyperframes#5888: `seekToTime` flushes the rAF queue exactly
 * once, so a deferred DOM update chained through several rAF turns lands one
 * rendered frame late per turn and early frames of each worker capture a
 * pre-settled DOM. The drain lives in the capture path — `seekToTime` keeps
 * its single flush — and only settles fresh work. Deferral is keyed on
 * registration lineage, not callback identity: a lineage born in an earlier
 * seek (a perpetual loop) keeps its one-turn-per-seek rate, while the same
 * function re-requested in a later seek opens a fresh lineage and settles.
 *
 * `hf.seek` calls `beginSeek()` before `renderSeek`, which is where timeline
 * hooks like GSAP onUpdate queue the deferred work a seek must settle; tests
 * mirror that call order. seekToTime still rolls the boundary itself for
 * callers without a renderSeek step (same-origin child frames).
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
  const context = createContext({ gc: () => Bun.gc(true) });
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

describe("virtual-time shim capture-path rAF drain", () => {
  it("settles a deferred self-chain registered during a seek, at that seek", () => {
    // The issue's minimal repro: an onUpdate hides text and schedules a reveal
    // through a finite chain of rAF turns. beginSeek arms the boundary before
    // renderSeek, so the chain registers under the incoming epoch as fresh
    // work: the seek's flush runs turn one and the capture-path drain runs
    // the remaining nine at the same virtual time.
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const state = run<{ afterSeek: number; afterDrain: number; visible: boolean }>(`(() => {
      var el = { calls: 0, visibility: "visible" };
      var pending = 10;
      function reveal() {
        el.calls++;
        if (--pending > 0) requestAnimationFrame(reveal);
        else el.visibility = "visible";
      }
      window.__HF_VIRTUAL_TIME__.beginSeek();
      el.visibility = "hidden";
      requestAnimationFrame(reveal);
      window.__HF_VIRTUAL_TIME__.seekToTime(41);
      var afterSeek = el.calls;
      window.__HF_VIRTUAL_TIME__.drainAnimationFrames();
      return { afterSeek: afterSeek, afterDrain: el.calls, visible: el.visibility === "visible" };
    })()`);
    expect(state.afterSeek).toBe(1);
    expect(state.afterDrain).toBe(10);
    expect(state.visible).toBe(true);
  });

  it("settles deferred work queued during a worker's very first seek", () => {
    // First frame of each worker range is where the bug bit: without the
    // beginSeek boundary the onUpdate registration lands at epoch 0 and the
    // drain would treat it as page-load lineage. hf.seek arms the boundary
    // before renderSeek, so the first captured frame drains like any other.
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const state = run<{ calls: number; visible: boolean }>(`(() => {
      var el = { calls: 0, visibility: "visible" };
      var pending = 10;
      function reveal() {
        el.calls++;
        if (--pending > 0) requestAnimationFrame(reveal);
        else el.visibility = "visible";
      }
      window.__HF_VIRTUAL_TIME__.beginSeek();
      el.visibility = "hidden";
      requestAnimationFrame(reveal);
      window.__HF_VIRTUAL_TIME__.seekToTime(0);
      window.__HF_VIRTUAL_TIME__.drainAnimationFrames();
      return { calls: el.calls, visible: el.visibility === "visible" };
    })()`);
    expect(state.calls).toBe(10);
    expect(state.visible).toBe(true);
  });

  it("still rolls the boundary inside seekToTime for callers without beginSeek", () => {
    // Same-origin child frames are driven through seekToTime directly, with
    // no renderSeek step: the boundary rolls there instead, and registrations
    // made since the last completed seek stay drainable at the next one.
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const calls = run<number>(`(() => {
      var calls = 0;
      var pending = 5;
      function step() { calls++; if (--pending > 0) requestAnimationFrame(step); }
      window.__HF_VIRTUAL_TIME__.seekToTime(0);
      requestAnimationFrame(step);
      window.__HF_VIRTUAL_TIME__.seekToTime(41);
      window.__HF_VIRTUAL_TIME__.drainAnimationFrames();
      return calls;
    })()`);
    expect(calls).toBe(5);
  });

  it("a page-load perpetual loop keeps exactly one turn per seek", () => {
    // The regression the rejected seek-side drain caused: `function tick(){
    // rotation++; requestAnimationFrame(tick) }` ran 64 turns per frame.
    // tick's lineage epoch is 0 (registered before the first seek), so the
    // drain always defers it — the maintainer's 24-runs-over-24-frames
    // contract, drain included.
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const runs = run<number>(`(() => {
      var runs = 0;
      function tick() { runs++; requestAnimationFrame(tick); }
      requestAnimationFrame(tick);
      for (var i = 0; i < 24; i++) {
        window.__HF_VIRTUAL_TIME__.beginSeek();
        window.__HF_VIRTUAL_TIME__.seekToTime(i * 41);
        window.__HF_VIRTUAL_TIME__.drainAnimationFrames();
      }
      return runs;
    })()`);
    expect(runs).toBe(24);
  });

  it("a perpetual driver spawning fresh deferred work does not trap it at epoch 0", () => {
    // The live repro shape: the onUpdate reveal registered inside GSAP's
    // ticker — a page-load perpetual driver — when the redundant t=0 seek
    // pushed the render into the ticker's turn. A spawned edge is not a loop
    // member, so the chain drains at the current seek while the driver keeps
    // its one-turn-per-seek pace.
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const state = run<{ calls: number; ticks: number; visible: boolean }>(`(() => {
      var el = { calls: 0, visibility: "visible" };
      var pending = 10;
      function reveal() {
        el.calls++;
        if (--pending > 0) requestAnimationFrame(reveal);
        else el.visibility = "visible";
      }
      var ticks = 0;
      function ticker() {
        ticks++;
        if (ticks === 1) requestAnimationFrame(reveal);
        requestAnimationFrame(ticker);
      }
      requestAnimationFrame(ticker);
      window.__HF_VIRTUAL_TIME__.beginSeek();
      window.__HF_VIRTUAL_TIME__.seekToTime(0);
      window.__HF_VIRTUAL_TIME__.drainAnimationFrames();
      return { calls: el.calls, ticks: ticks, visible: el.visibility === "visible" };
    })()`);
    expect(state.calls).toBe(10);
    expect(state.visible).toBe(true);
    expect(state.ticks).toBe(1);
  });

  it("a page-load callback ping-pong keeps alternating one turn per seek", () => {
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const runs = run<number>(`(() => {
      var runs = 0;
      function a() { runs++; requestAnimationFrame(b); }
      function b() { runs++; requestAnimationFrame(a); }
      requestAnimationFrame(a);
      for (var i = 0; i < 24; i++) {
        window.__HF_VIRTUAL_TIME__.beginSeek();
        window.__HF_VIRTUAL_TIME__.seekToTime(i * 41);
        window.__HF_VIRTUAL_TIME__.drainAnimationFrames();
      }
      return runs;
    })()`);
    // The a→b edge is discovered once (one bonus turn at the first drain);
    // afterwards the cycle and the previous-seek guard keep exactly one turn
    // per seek — 25 runs over 24 frames, never 64/frame.
    expect(runs).toBe(25);
  });

  it("a chain queued before the first seek keeps the old one-turn-per-seek pace", () => {
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const calls = run<number>(`(() => {
      var calls = 0;
      var pending = 10;
      function reveal() {
        calls++;
        if (--pending > 0) requestAnimationFrame(reveal);
      }
      requestAnimationFrame(reveal);
      for (var i = 0; i < 3; i++) {
        window.__HF_VIRTUAL_TIME__.beginSeek();
        window.__HF_VIRTUAL_TIME__.seekToTime(i * 41);
        window.__HF_VIRTUAL_TIME__.drainAnimationFrames();
      }
      return calls;
    })()`);
    // Epoch-0 lineage: indistinguishable from a page-load loop, so it stays
    // deferred — one turn per seek, identical to the pre-drain behavior.
    expect(calls).toBe(3);
  });

  it("a perpetual loop first registered during a seek is bounded by the rerun allowance", () => {
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const runs = run<number>(`(() => {
      var runs = 0;
      function tick() { runs++; requestAnimationFrame(tick); }
      window.__HF_VIRTUAL_TIME__.beginSeek();
      requestAnimationFrame(tick);
      window.__HF_VIRTUAL_TIME__.seekToTime(0);
      window.__HF_VIRTUAL_TIME__.drainAnimationFrames();
      for (var i = 1; i < 24; i++) {
        window.__HF_VIRTUAL_TIME__.beginSeek();
        window.__HF_VIRTUAL_TIME__.seekToTime(i * 41);
        window.__HF_VIRTUAL_TIME__.drainAnimationFrames();
      }
      return runs;
    })()`);
    // Fresh at seek 1, so the drain gives it at most RAF_DRAIN_MAX_RERUNS (16)
    // executions ever; afterwards the previous-seek guard defers it. Bounded:
    // 1 flush-run + 16 drain-runs + 23 later flush-runs = 40, never 64/frame.
    expect(runs).toBe(40);
  });

  it("a fresh callback queued beside an established loop still runs", () => {
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const state = run<{ applied: boolean; loopRuns: number }>(`(() => {
      var el = { applied: false };
      var loopRuns = 0;
      function tick() { loopRuns++; requestAnimationFrame(tick); }
      requestAnimationFrame(tick);
      window.__HF_VIRTUAL_TIME__.beginSeek();
      window.__HF_VIRTUAL_TIME__.seekToTime(0);
      window.__HF_VIRTUAL_TIME__.drainAnimationFrames();
      window.__HF_VIRTUAL_TIME__.beginSeek();
      requestAnimationFrame(function() { el.applied = true; });
      window.__HF_VIRTUAL_TIME__.seekToTime(41);
      window.__HF_VIRTUAL_TIME__.drainAnimationFrames();
      return { applied: el.applied, loopRuns: loopRuns };
    })()`);
    expect(state.applied).toBe(true);
    expect(state.loopRuns).toBe(2);
  });

  it("caps a non-converging queue of distinct callbacks", () => {
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const ran = run<number>(`(() => {
      var runs = 0;
      window.__HF_VIRTUAL_TIME__.beginSeek();
      requestAnimationFrame(function step() {
        runs++;
        requestAnimationFrame(function() { step(); });
      });
      window.__HF_VIRTUAL_TIME__.seekToTime(41);
      window.__HF_VIRTUAL_TIME__.drainAnimationFrames();
      return runs;
    })()`);
    // Every turn registers a fresh closure, so the guards never fire; the
    // turn cap (64) is the bound.
    expect(ran).toBeLessThanOrEqual(65);
    expect(ran).toBeGreaterThan(1);
  });

  it("reports drain stats on __HF_VIRTUAL_TIME__.lastDrain", () => {
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const stats = run<{ flush: object; drain: { turns: number; ran: number; pending: number } }>(
      `(() => {
      window.__HF_VIRTUAL_TIME__.beginSeek();
      var pending = 3;
      function step() { if (--pending > 0) requestAnimationFrame(step); }
      requestAnimationFrame(step);
      window.__HF_VIRTUAL_TIME__.seekToTime(41);
      var flush = window.__HF_VIRTUAL_TIME__.lastDrain;
      var drain = window.__HF_VIRTUAL_TIME__.drainAnimationFrames();
      return { flush: flush, drain: drain };
    })()`,
    );
    expect(stats.flush).toEqual({ turns: 1, ran: 1, pending: 1 });
    expect(stats.drain).toEqual({ turns: 2, ran: 2, pending: 0 });
  });

  it("drains without advancing virtual time", () => {
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const observed = run<{ time: number; applied: boolean }>(`(() => {
      var el = { applied: false };
      var pending = 4;
      window.__HF_VIRTUAL_TIME__.beginSeek();
      requestAnimationFrame(function step() { if (--pending > 0) requestAnimationFrame(step); else el.applied = true; });
      window.__HF_VIRTUAL_TIME__.seekToTime(77);
      window.__HF_VIRTUAL_TIME__.drainAnimationFrames();
      return { time: window.__HF_VIRTUAL_TIME__.getTime(), applied: el.applied };
    })()`);
    expect(observed.time).toBe(77);
    expect(observed.applied).toBe(true);
  });

  it("keeps cancelled entries cancelled across drain turns", () => {
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const ran = run<number>(`(() => {
      var runs = 0;
      window.__HF_VIRTUAL_TIME__.beginSeek();
      var id = requestAnimationFrame(function() { runs++; });
      cancelAnimationFrame(id);
      window.__HF_VIRTUAL_TIME__.seekToTime(41);
      window.__HF_VIRTUAL_TIME__.drainAnimationFrames();
      return runs;
    })()`);
    expect(ran).toBe(0);
  });

  it("settles the same finite callback re-requested on consecutive seeks", () => {
    // The review repro: one reusable `reveal` fn, each renderSeek resets a
    // five-turn reveal and requests it anew. Deferral by callback identity
    // left turns 2-5 pending from the second seek on (first screenshot green,
    // the rest red). Lineage is per registration: the re-request opens a
    // fresh lineage and settles all five turns every seek.
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const state = run<{ perSeek: number[]; visible: boolean[] }>(`(() => {
      var el = { visibility: "hidden" };
      var pending = 0, calls = 0;
      function reveal() {
        calls++;
        if (--pending > 0) requestAnimationFrame(reveal);
        else el.visibility = "visible";
      }
      var perSeek = [], visible = [];
      for (var s = 0; s < 3; s++) {
        window.__HF_VIRTUAL_TIME__.beginSeek();
        el.visibility = "hidden";
        pending = 5;
        calls = 0;
        requestAnimationFrame(reveal);
        window.__HF_VIRTUAL_TIME__.seekToTime(s * 41);
        window.__HF_VIRTUAL_TIME__.drainAnimationFrames();
        perSeek.push(calls);
        visible.push(el.visibility === "visible");
      }
      return { perSeek: perSeek, visible: visible };
    })()`);
    expect(state.perSeek).toEqual([5, 5, 5]);
    expect(state.visible).toEqual([true, true, true]);
  });

  it("settles a finite callback a loop driver re-spawns on consecutive seeks", () => {
    // Sibling path through a persistent driver: a page-load ticker requests
    // the same reveal each seek. A repeated spawn edge is a fresh invocation
    // each time, not loop membership — it must still settle every seek.
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const state = run<{ perSeek: number[]; visible: boolean[] }>(`(() => {
      var el = { visibility: "hidden" };
      var pending = 0, calls = 0;
      function reveal() {
        calls++;
        if (--pending > 0) requestAnimationFrame(reveal);
        else el.visibility = "visible";
      }
      function ticker() {
        pending = 5;
        requestAnimationFrame(reveal);
        requestAnimationFrame(ticker);
      }
      requestAnimationFrame(ticker);
      var perSeek = [], visible = [];
      for (var s = 0; s < 3; s++) {
        window.__HF_VIRTUAL_TIME__.beginSeek();
        el.visibility = "hidden";
        calls = 0;
        window.__HF_VIRTUAL_TIME__.seekToTime(s * 41);
        window.__HF_VIRTUAL_TIME__.drainAnimationFrames();
        perSeek.push(calls);
        visible.push(el.visibility === "visible");
      }
      return { perSeek: perSeek, visible: visible };
    })()`);
    expect(state.perSeek).toEqual([5, 5, 5]);
    expect(state.visible).toEqual([true, true, true]);
  });

  it("releases a completed invocation's bookkeeping across many seeks", () => {
    // Retention control: run accounting lives on the lineage object and dies
    // with its last entry, so 200 completed two-turn invocations leave their
    // callbacks collectible after a forced GC. The queued ancestor history
    // is likewise bounded at RAF_LINEAGE_MAX_ANCESTORS records per entry,
    // not the whole history of seeks.
    const { run } = runShim(buildVirtualTimeShim({ seedRandomFromFrame: false }));
    const state = run<{ alive: number; total: number }>(`(() => {
      var refs = [];
      for (var s = 0; s < 200; s++) {
        var step = (function() {
          var left = 2;
          return function step() { if (--left > 0) requestAnimationFrame(step); };
        })();
        refs.push(new WeakRef(step));
        window.__HF_VIRTUAL_TIME__.beginSeek();
        requestAnimationFrame(step);
        window.__HF_VIRTUAL_TIME__.seekToTime(s * 41);
        window.__HF_VIRTUAL_TIME__.drainAnimationFrames();
      }
      step = null;
      gc();
      gc();
      var alive = 0;
      for (var i = 0; i < refs.length; i++) if (refs[i].deref()) alive++;
      return { alive: alive, total: refs.length };
    })()`);
    expect(state.total).toBe(200);
    // A handful of survivors is conservative-scanner noise (dead stack slots
    // keep random indices alive for a job); the prior per-callback accounting
    // deterministically retained all 200.
    expect(state.alive).toBeLessThanOrEqual(8);
  });
});
