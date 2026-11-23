// `inspectSeekCallbacks` against the real virtual-time shim (and real GSAP) in a VM, the way a render
// page runs them: the shim first, then page scripts, then seeks.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createContext, Script } from "node:vm";
import { VIRTUAL_TIME_SHIM } from "../fileServer.js";
import { inspectSeekCallbacks } from "./eligibility.js";

const GSAP_SOURCE = readFileSync(
  createRequire(import.meta.resolve("@hyperframes/core")).resolve("gsap/dist/gsap.min.js"),
  "utf8",
);

interface Page {
  run: <T = unknown>(code: string) => T;
  /** Seeks frame by frame at 30 fps through `[fromMs, untilMs]`, as the layered path does. */
  seekFrames: (untilMs: number, fromMs?: number) => void;
  inspect: () => string | null;
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
  `).runInContext(context);
  new Script(VIRTUAL_TIME_SHIM).runInContext(context);
  if (options.gsap) new Script(GSAP_SOURCE).runInContext(context);
  const run = <T>(code: string) => new Script(code).runInContext(context) as T;
  return {
    run,
    seekFrames: (untilMs, fromMs = 0) =>
      run(
        `for (let f = Math.round(${fromMs} * 30 / 1000); f * 1000 / 30 <= ${untilMs}; f++) window.__HF_VIRTUAL_TIME__.seekToTime(f * 1000 / 30);`,
      ),
    inspect: () => {
      const g = globalThis as Record<string, unknown>;
      const previous = g.window;
      g.window = run("globalThis");
      try {
        return inspectSeekCallbacks();
      } finally {
        g.window = previous;
      }
    },
  };
}

describe("inspectSeekCallbacks", () => {
  it("finds nothing on a page whose code does not run on seeks", () => {
    const p = page();
    p.seekFrames(1000);
    expect(p.inspect()).toBeNull();
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
