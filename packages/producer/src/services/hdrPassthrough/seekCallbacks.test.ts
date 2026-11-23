// `inspectSeekCallbacks` against the real virtual-time shim with the passthrough's callback record (and real GSAP) in a VM, the way a render
// page runs them: the shim first, then page scripts, then seeks.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createContext, Script } from "node:vm";
import { virtualTimeShimFor } from "../fileServer.js";
import { inspectGsapGlobalTimeline, inspectSeekCallbacks } from "./eligibility.js";

const GSAP_SOURCE = readFileSync(
  createRequire(import.meta.resolve("@hyperframes/core")).resolve("gsap/dist/gsap.min.js"),
  "utf8",
);

interface Page {
  run: <T = unknown>(code: string) => T;
  /** Seeks frame by frame at 30 fps through `[fromMs, untilMs]`, as the layered path does. */
  seekFrames: (untilMs: number, fromMs?: number) => void;
  inspect: () => string | null;
  inspectGlobal: () => string | null;
}

function page(options: { gsap?: boolean } = {}): Page {
  const context = createContext({});
  new Script(`
    globalThis.window = globalThis;
    globalThis.setTimeout = () => 0;
    globalThis.clearTimeout = () => undefined;
    globalThis.setInterval = () => 0;
    globalThis.clearInterval = () => undefined;
    globalThis.performance = { now: () => 0 };
    globalThis.document = { createElement: () => ({ style: {} }), documentElement: { style: {} } };
    globalThis.navigator = { userAgent: "" };
    globalThis.__renderReady = true;
    globalThis.MutationObserver = class MutationObserver { constructor(callback) { this.callback = callback; } };
    globalThis.CustomElementRegistry = class CustomElementRegistry { define() {} };
    globalThis.customElements = new CustomElementRegistry();
  `).runInContext(context);
  new Script(virtualTimeShimFor({ experimentalHdrPassthrough: true })).runInContext(context);
  if (options.gsap) new Script(GSAP_SOURCE).runInContext(context);
  const run = <T>(code: string) => new Script(code).runInContext(context) as T;
  return {
    run,
    seekFrames: (untilMs, fromMs = 0) =>
      run(
        `for (let f = Math.round(${fromMs} * 30 / 1000); f * 1000 / 30 <= ${untilMs}; f++) window.__HF_VIRTUAL_TIME__.seekToTime(f * 1000 / 30);`,
      ),
    inspect: () => inPage(run, inspectSeekCallbacks),
    inspectGlobal: () => inPage(run, inspectGsapGlobalTimeline),
  };
}

function inPage<T>(run: (code: string) => unknown, fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const previous = g.window;
  g.window = run("globalThis");
  try {
    return fn();
  } finally {
    g.window = previous;
  }
}

describe("inspectSeekCallbacks", () => {
  it("finds nothing on a page whose code does not run on seeks", () => {
    const p = page();
    p.seekFrames(1000);
    expect(p.inspect()).toBeNull();
  });

  it("passes an observer whose callback is a page function, which the call counts see", () => {
    const p = page();
    p.run("new MutationObserver(function () {});");
    expect(p.inspect()).toBeNull();
  });

  it("finds an observer whose callback is a bound builtin, which no call count sees", () => {
    const p = page();
    p.run("new MutationObserver(Math.max.bind(null, 1));");
    expect(p.inspect()).toBe(
      "1 observer(s) with a callback that runs no page script (MutationObserver)",
    );
  });

  it("finds a custom element definition, whose reactions nothing reads back", () => {
    const p = page();
    p.run('customElements.define("hf-x", class {});');
    expect(p.inspect()).toBe("1 custom element definition(s)");
  });

  it("finds a requestAnimationFrame loop that counts seeks", () => {
    const p = page();
    p.run(
      "window.n = 0; requestAnimationFrame(function loop() { window.n++; requestAnimationFrame(loop); });",
    );
    p.seekFrames(1000);
    expect(p.run("n")).toBe(31);
    expect(p.inspect()).toBe("1 requestAnimationFrame callback(s)");
  });

  it("still counts a one-shot frame callback after it has run", () => {
    const p = page();
    p.run("requestAnimationFrame(() => { window.shown = true; });");
    p.seekFrames(100);
    expect(p.run("shown")).toBe(true);
    expect(p.run("window.__HF_VIRTUAL_TIME__.callbackActivity().pendingFrames.length")).toBe(0);
    expect(p.inspect()).toBe("1 requestAnimationFrame callback(s)");
  });

  it("finds a film-time interval, and one that already fired and was cleared", () => {
    const p = page();
    p.seekFrames(0);
    p.run("window.marks = ''; window.id = setInterval(() => { window.marks += '#'; }, 500);");
    p.seekFrames(1000);
    expect(p.run("marks")).toBe("##");
    expect(p.inspect()).toBe("1 film-time timer(s), 1 pending");
    p.run("clearInterval(window.id)");
    expect(p.inspect()).toBe("1 film-time timer(s), 0 pending");
  });

  it("declines a string timer, which compiles page code with nothing on the stack", () => {
    const p = page();
    p.run('setTimeout("window.fromString = 1", 0);');
    expect(p.inspect()).toBe("1 string timer(s)");
    // Before rendering starts and after: both are counted.
    p.seekFrames(100);
    p.run('setInterval("window.fromString = 2", 50);');
    expect(p.inspect()).toBe("2 string timer(s)");
  });

  it("leaves out callbacks the renderer's own scripts register", () => {
    const p = page();
    // The runtime and the bridge are injected as hyperframes://injected/<n>; the compiler adds
    // other hyperframes:// scripts.
    p.run(
      "requestAnimationFrame(function runtimeLoop() { requestAnimationFrame(runtimeLoop); });\n//# sourceURL=hyperframes://injected/2",
    );
    p.seekFrames(0);
    p.run("setInterval(() => {}, 100);\n//# sourceURL=hyperframes://position-seek-reapply");
    p.seekFrames(500);
    expect(p.inspect()).toBeNull();
    // The composition's own inline code is not the renderer's.
    p.run("requestAnimationFrame(() => {});\n//# sourceURL=hyperframes-composition://body");
    expect(p.inspect()).toBe("1 requestAnimationFrame callback(s)");
  });

  it("leaves out a timer set before rendering started (it runs on the wall clock)", () => {
    const p = page();
    p.run("window.__renderReady = false; setTimeout(() => {}, 100);");
    expect(p.inspect()).toBeNull();
  });

  describe("with GSAP", () => {
    it("tells GSAP's own ticker apart and leaves it running", () => {
      const p = page({ gsap: true });
      p.run(
        "window.tl = gsap.timeline({ paused: true }); tl.to({ x: 0 }, { x: 1, duration: 1 }, 0);",
      );
      p.seekFrames(500);
      const pending = "window.__HF_VIRTUAL_TIME__.callbackActivity().pendingFrames.length";
      expect(p.run(pending)).toBe(1);
      expect(p.inspect()).toBeNull();
      // The ticker still has its frame and still ticks on the next seek.
      expect(p.run(pending)).toBe(1);
      const frame = p.run<number>("gsap.ticker.frame");
      p.seekFrames(1000, 533);
      expect(p.run<number>("gsap.ticker.frame")).toBeGreaterThan(frame);
    });

    it("tells an asleep ticker apart and leaves it asleep", () => {
      const p = page({ gsap: true });
      p.run("gsap.timeline({ paused: true }); gsap.ticker.sleep();");
      p.seekFrames(300);
      const pending = "window.__HF_VIRTUAL_TIME__.callbackActivity().pendingFrames.length";
      expect(p.run(pending)).toBe(0);
      expect(p.inspect()).toBeNull();
      expect(p.run(pending)).toBe(0);
    });

    it("finds a listener added to GSAP's ticker", () => {
      const p = page({ gsap: true });
      p.run("window.ticks = 0; gsap.ticker.add(() => { window.ticks++; });");
      p.seekFrames(500);
      expect(p.inspect()).toBe("1 GSAP ticker listener(s)");
    });

    it("finds a requestAnimationFrame loop next to GSAP's ticker", () => {
      const p = page({ gsap: true });
      p.run(
        "gsap.timeline({ paused: true }); requestAnimationFrame(function loop() { requestAnimationFrame(loop); });",
      );
      p.seekFrames(500);
      expect(p.inspect()).toBe("1 requestAnimationFrame callback(s)");
    });
  });

  describe("GSAP's global timeline", () => {
    // A registered, paused root as the runtime expects, plus whatever the case adds.
    const registered =
      "window.tl = gsap.timeline({ paused: true }); tl.to({ x: 0 }, { x: 1, duration: 1 }, 0); window.__timelines = { main: tl };";

    it("finds nothing next to registered timelines and a gsap.set", () => {
      const p = page({ gsap: true });
      p.run(
        `${registered} gsap.set({ y: 0 }, { y: 1 }); gsap.timeline({ paused: true }).to({ z: 0 }, { z: 1 });`,
      );
      expect(p.inspectGlobal()).toBeNull();
      p.seekFrames(1000);
      expect(p.inspectGlobal()).toBeNull();
      expect(p.inspect()).toBeNull();
    });

    it("finds a delayedCall, which fires on the ticker's clock and is then gone", () => {
      const p = page({ gsap: true });
      p.run(
        `${registered} window.fired = []; gsap.delayedCall(1.5, () => { window.fired.push(window.__HF_VIRTUAL_TIME__.getTime()); });`,
      );
      expect(p.inspectGlobal()).toBe(
        "1 GSAP animation(s) on the global timeline outside the registered timelines (delayedCall at 1.500s)",
      );
      // The inspect that runs after the seeks (the seek_callback slot) reports it too while it is pending.
      p.seekFrames(500);
      expect(p.inspect()).toBeNull();
      expect(p.inspectGlobal()).not.toBeNull();
      // Out of order, as eligibility and capture seek, it fires on the first long jump; afterwards
      // nothing on the page shows it ever existed, so eligibility reads this before its first seek.
      p.run("gsap.ticker.lagSmoothing(0); window.__HF_VIRTUAL_TIME__.seekToTime(2900);");
      expect(p.run<number[]>("fired")).toEqual([2900]);
      expect(p.inspectGlobal()).toBeNull();
    });

    it("finds a playing tween of a plain object and an unregistered timeline", () => {
      const plain = page({ gsap: true });
      plain.run(`${registered} gsap.to({ n: 0 }, { n: 10, duration: 2, onUpdate: () => {} });`);
      expect(plain.inspectGlobal()).toBe(
        "1 GSAP animation(s) on the global timeline outside the registered timelines (tween at 0.000s)",
      );
      const timeline = page({ gsap: true });
      timeline.run(`${registered} gsap.timeline().to({ n: 0 }, { n: 1, duration: 1 });`);
      expect(timeline.inspectGlobal()).toContain("(timeline at 0.000s)");
    });

    it("finds a callback in a paused timeline that is not registered", () => {
      const p = page({ gsap: true });
      p.run(`${registered} gsap.timeline({ paused: true }).call(() => {}, [], 1);`);
      expect(p.inspectGlobal()).toContain("1 GSAP animation(s) on the global timeline");
    });

    it("reads a registered timeline behind the runtime's proxy", () => {
      const p = page({ gsap: true });
      p.run(
        "window.tl = gsap.timeline(); tl.to({ x: 0 }, { x: 1, duration: 1 }); window.__timelines = { main: { __hfReal: tl } };",
      );
      expect(p.inspectGlobal()).toBeNull();
    });
  });

  it("declines when the shim keeps no record", () => {
    const g = globalThis as Record<string, unknown>;
    const previous = g.window;
    g.window = {};
    try {
      expect(inspectSeekCallbacks()).toBe("no virtual-time callback record");
    } finally {
      g.window = previous;
    }
  });
});
