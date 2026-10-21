/**
 * Tests for `settlePostSeekDomUpdates` — the per-seek readiness barrier in
 * prepareFrameForCapture (heygen-com/hyperframes#5888).
 *
 * The `page.evaluate` callbacks run in a synthetic page context so the
 * browser-side body executes in Node against a controllable
 * `__HF_VIRTUAL_TIME__` shim, `document`, and media stubs — same pattern as
 * frameCapture-videoReady.test.ts.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { settlePostSeekDomUpdates } from "./frameCapture.js";

type EvalFn = (arg: unknown) => Promise<unknown>;

interface FakeVt {
  queue: Array<() => void>;
  drainCalls: number;
  paintCalls: number;
  lastDrain: { turns: number; ran: number; pending: number };
  drainAnimationFrames: () => { turns: number; ran: number; pending: number };
  originalRequestAnimationFrame: (cb: (time: number) => void) => number;
  originalSetTimeout: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
}

function makeFakeVt({ paintImmediately = true } = {}): FakeVt {
  const queue: Array<() => void> = [];
  const fake: FakeVt = {
    queue,
    drainCalls: 0,
    paintCalls: 0,
    lastDrain: { turns: 0, ran: 0, pending: 0 },
    drainAnimationFrames() {
      fake.drainCalls++;
      let turns = 0;
      let ran = 0;
      while (queue.length && turns < 64 && ran < 2048) {
        const batch = queue.splice(0, queue.length);
        ran += batch.length;
        turns++;
        for (const cb of batch) cb();
      }
      fake.lastDrain = { turns, ran, pending: queue.length };
      return fake.lastDrain;
    },
    originalRequestAnimationFrame(cb) {
      fake.paintCalls++;
      if (paintImmediately) setTimeout(() => cb(0), 0);
      return fake.paintCalls;
    },
    originalSetTimeout(cb, ms) {
      return setTimeout(cb, ms);
    },
  };
  return fake;
}

/** Installs synthetic page globals, runs the evaluate body, then restores. */
function makePage(doc: object, extras: Record<string, unknown> = {}) {
  return {
    evaluate: async (fn: EvalFn, arg?: unknown) => {
      const g = globalThis as Record<string, unknown>;
      const saved: Record<string, unknown> = {};
      for (const key of [
        "document",
        "__HF_VIRTUAL_TIME__",
        "__hfDecodeDynamicCssBackgroundImages",
      ]) {
        saved[key] = g[key];
      }
      g.document = doc;
      for (const [k, v] of Object.entries(extras)) g[k] = v;
      try {
        return await fn(arg);
      } finally {
        for (const key of Object.keys(saved)) {
          if (saved[key] === undefined) delete g[key];
          else g[key] = saved[key];
        }
        // __hf_seek_settle_decoded intentionally survives: the settle stores
        // its decoded-image WeakMap on the page context across seeks.
      }
    },
  } as never;
}

const cleanDoc = {
  documentElement: { offsetHeight: 0 },
  fonts: { status: "loaded", ready: Promise.resolve() },
  querySelectorAll: () => [],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("settlePostSeekDomUpdates", () => {
  it("drains deferred work queued after the seek at the same virtual time", async () => {
    const vt = makeFakeVt();
    let applied = false;
    let pending = 5;
    const step = (): void => {
      if (--pending > 0) vt.queue.push(step);
      else applied = true;
    };
    vt.queue.push(step);
    const stats = (await settlePostSeekDomUpdates(
      makePage(cleanDoc, { __HF_VIRTUAL_TIME__: vt }),
      true,
    )) as { drainedRan: number; drainPending: number };
    expect(applied).toBe(true);
    expect(stats.drainedRan).toBe(5);
    expect(stats.drainPending).toBe(0);
  });

  it("re-decodes dynamic CSS backgrounds only when the drain ran work", async () => {
    const vt = makeFakeVt();
    const bgDecode = vi.fn(() => Promise.resolve());
    vt.queue.push(() => undefined);
    await settlePostSeekDomUpdates(
      makePage(cleanDoc, {
        __HF_VIRTUAL_TIME__: vt,
        __hfDecodeDynamicCssBackgroundImages: bgDecode,
      }),
      true,
    );
    expect(bgDecode).toHaveBeenCalledTimes(1);

    // Simulate the next seek having drained nothing — seekToTime refreshes
    // lastDrain before each settle in production.
    vt.lastDrain = { turns: 0, ran: 0, pending: 0 };
    const cleanStats = (await settlePostSeekDomUpdates(
      makePage(cleanDoc, {
        __HF_VIRTUAL_TIME__: vt,
        __hfDecodeDynamicCssBackgroundImages: bgDecode,
      }),
      true,
    )) as { paintsCommitted: number };
    // A drained-clean queue: no second decode pass, and no paint commit.
    expect(bgDecode).toHaveBeenCalledTimes(1);
    expect(cleanStats.paintsCommitted).toBe(0);
  });

  it("commits two native paints when deferred work ran and the compositor free-runs", async () => {
    const vt = makeFakeVt();
    // Simulate the drain inside __hf.seek itself having run work.
    vt.lastDrain = { turns: 3, ran: 3, pending: 0 };
    const stats = (await settlePostSeekDomUpdates(
      makePage(cleanDoc, { __HF_VIRTUAL_TIME__: vt }),
      true,
    )) as { paintsCommitted: number };
    expect(stats.paintsCommitted).toBe(2);
    expect(vt.paintCalls).toBe(2);
  });

  it("skips the paint wait for BeginFrame-driven capture sessions", async () => {
    const vt = makeFakeVt();
    vt.lastDrain = { turns: 3, ran: 3, pending: 0 };
    const stats = (await settlePostSeekDomUpdates(
      makePage(cleanDoc, { __HF_VIRTUAL_TIME__: vt }),
      false,
    )) as { paintsCommitted: number };
    expect(stats.paintsCommitted).toBe(0);
    expect(vt.paintCalls).toBe(0);
  });

  it("no-ops when the virtual-time shim is absent or predates the drain API", async () => {
    const stats = await settlePostSeekDomUpdates(makePage(cleanDoc), true);
    expect(stats).toEqual({
      drainedRan: 0,
      drainPending: 0,
      fontsPending: false,
      imagesDecoded: 0,
      paintsCommitted: 0,
    });
  });

  it("decodes newly active images once and remembers them across seeks", async () => {
    const vt = makeFakeVt();
    vt.lastDrain = { turns: 1, ran: 1, pending: 0 };
    const decoded = vi.fn(() => Promise.resolve());
    // A loaded img and a still-loading one both get decode() calls; the
    // src-keyed WeakMap then skips both on the next seek.
    const fresh = {
      complete: true,
      naturalWidth: 10,
      src: "a.png",
      getAttribute: () => "a.png",
      decode: decoded,
    };
    const inflight = {
      complete: false,
      naturalWidth: 0,
      src: "b.png",
      getAttribute: () => "b.png",
      decode: decoded,
    };
    const doc = {
      ...cleanDoc,
      querySelectorAll: (sel: string) => (sel === "img" ? [fresh, inflight] : []),
    };
    const page = makePage(doc, { __HF_VIRTUAL_TIME__: vt });
    const first = (await settlePostSeekDomUpdates(page, true)) as { imagesDecoded: number };
    const second = (await settlePostSeekDomUpdates(page, true)) as { imagesDecoded: number };
    expect(first.imagesDecoded).toBe(2);
    expect(decoded).toHaveBeenCalledTimes(2);
    expect(second.imagesDecoded).toBe(0);
  });
});
