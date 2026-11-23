import { describe, expect, it } from "bun:test";
import { createContext, Script } from "node:vm";
import { VIRTUAL_TIME_SHIM, virtualTimeShimFor } from "./fileServer.js";

type Page = { run: <T = unknown>(code: string) => T };

// The shim in a fresh VM whose own timers only record that they were asked for.
function page(shim: string = VIRTUAL_TIME_SHIM): Page {
  const context = createContext({});
  new Script(`
    globalThis.window = globalThis;
    globalThis.realTimers = [];
    globalThis.setTimeout = (cb, ms) => { realTimers.push(ms); return realTimers.length; };
    globalThis.clearTimeout = () => undefined;
    globalThis.setInterval = (cb, ms) => { realTimers.push(ms); return realTimers.length; };
    globalThis.clearInterval = () => undefined;
    globalThis.performance = { now: () => 0 };
    globalThis.__renderReady = true;
  `).runInContext(context);
  new Script(shim).runInContext(context);
  return { run: <T>(code: string) => new Script(code).runInContext(context) as T };
}

const RECORD_SHIM = virtualTimeShimFor({ experimentalHdrPassthrough: true });

// Seeks frame by frame at 30 fps up to `untilMs`, as the renderer does before each capture.
const seekFrames = (untilMs: number) =>
  `for (let f = 0; f * 1000 / 30 <= ${untilMs}; f++) window.__HF_VIRTUAL_TIME__.seekToTime(f * 1000 / 30);`;

describe("virtual-time shim timers", () => {
  it("leaves timers set before the first seek on the wall clock", () => {
    const { run } = page();
    run("window.fired = 0; setTimeout(() => window.fired++, 100);");
    run(seekFrames(1000));
    expect(run("realTimers")).toEqual([100]);
    expect(run("fired")).toBe(0);
  });

  it("leaves timers on the wall clock while seeks come before the page reports ready", () => {
    const { run } = page();
    run("window.__renderReady = false; window.__HF_VIRTUAL_TIME__.seekToTime(0);");
    run("window.fired = 0; setTimeout(() => window.fired++, 50);");
    run(seekFrames(1000));
    expect(run("realTimers")).toEqual([50]);
    expect(run("fired")).toBe(0);
  });

  it("fires a 100 ms chain set during rendering every 100 ms of film time", () => {
    const { run } = page();
    run("window.__HF_VIRTUAL_TIME__.seekToTime(0);");
    run(
      `window.at = []; (function step() { setTimeout(() => { at.push(Date.now()); step(); }, 100); })();`,
    );
    run(seekFrames(1000));
    expect(run("at")).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    expect(run("realTimers")).toEqual([]);
  });

  it("fires a timer due on a fractional frame time on that frame", () => {
    const { run } = page();
    run("window.__HF_VIRTUAL_TIME__.seekToTime(1000 / 30);");
    run(`window.frames = []; window.f = 1;
      (function step() { setTimeout(() => { frames.push(f); step(); }, 100); })();`);
    run("for (f = 2; f <= 31; f++) window.__HF_VIRTUAL_TIME__.seekToTime(f * 1000 / 30);");
    expect(run("frames")).toEqual([4, 7, 10, 13, 16, 19, 22, 25, 28, 31]);
  });

  it("fires an interval on film time until it is cleared", () => {
    const { run } = page();
    run("window.__HF_VIRTUAL_TIME__.seekToTime(0);");
    run("window.at = []; window.id = setInterval(() => at.push(performance.now()), 250);");
    run(seekFrames(600));
    run("clearInterval(id);");
    run(seekFrames(2000));
    expect(run("at")).toEqual([250, 500]);
  });

  it("drops a cleared timeout", () => {
    const { run } = page();
    run("window.__HF_VIRTUAL_TIME__.seekToTime(0);");
    run("window.fired = 0; clearTimeout(setTimeout(() => fired++, 10));");
    run(seekFrames(100));
    expect(run("fired")).toBe(0);
  });

  it("gives a zero-delay chain 1 ms per step, so a seek ends", () => {
    const { run } = page();
    run("window.__HF_VIRTUAL_TIME__.seekToTime(0);");
    run("window.fired = 0; (function spin() { setTimeout(() => { fired++; spin(); }, 0); })();");
    run("window.__HF_VIRTUAL_TIME__.seekToTime(10);");
    expect(run("fired")).toBe(11);
  });

  it("keeps the film's timer schedule on a worker whose first frame is past the start", () => {
    const { run } = page();
    run(`window.at = [];
      requestAnimationFrame(() => (function step() { setTimeout(() => { at.push(Date.now()); step(); }, 100); })());`);
    run("window.__HF_VIRTUAL_TIME__.seekToTime(4000 / 30);");
    expect(run("at")).toEqual([100]);
    run("for (let f = 5; f <= 30; f++) window.__HF_VIRTUAL_TIME__.seekToTime(f * 1000 / 30);");
    expect(run("at")).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
  });

  it("runs due timers before the frame's animation callbacks", () => {
    const { run } = page();
    run("window.__HF_VIRTUAL_TIME__.seekToTime(0);");
    run(`window.order = []; setTimeout(() => order.push("timer"), 20);
      requestAnimationFrame(() => order.push("frame"));`);
    run("window.__HF_VIRTUAL_TIME__.seekToTime(1000 / 30);");
    expect(run("order")).toEqual(["timer", "frame"]);
  });
});

// With the HDR passthrough on, the shim's callback record reads its callers' stacks to tell page code from the renderer's. The page must never see
// that: its own stack hooks do not run, and are left exactly as it set them.
describe("virtual-time shim caller stacks", () => {
  const activity = "window.__HF_VIRTUAL_TIME__.callbackActivity()";

  it("never runs a throwing Error.prepareStackTrace the page installs", () => {
    const { run } = page(RECORD_SHIM);
    run(`window.hookCalls = 0;
      window.hook = function () { hookCalls++; throw new TypeError("stack formatting disabled"); };
      Error.prepareStackTrace = hook;`);
    run("requestAnimationFrame(() => {}); requestAnimationFrame(() => {});");
    run("window.__HF_VIRTUAL_TIME__.seekToTime(0);");
    run("setTimeout(() => {}, 10); setInterval(() => {}, 20);");
    expect(run("hookCalls")).toBe(0);
    expect(run("Error.prepareStackTrace === hook")).toBe(true);
    // Still recorded as the page's own.
    expect(run(`${activity}.frameCallbacks.length`)).toBe(2);
    expect(run(`${activity}.filmTimers`)).toBe(2);
  });

  it("leaves a counting hook and the stack limit as the page set them", () => {
    const { run } = page(RECORD_SHIM);
    run(`window.hookCalls = 0;
      Error.prepareStackTrace = function (error, frames) { hookCalls++; return "pst"; };
      Error.stackTraceLimit = 2;`);
    run("for (let i = 0; i < 5; i++) requestAnimationFrame(() => {});");
    expect(run("hookCalls")).toBe(0);
    expect(run("Error.stackTraceLimit")).toBe(2);
    expect(run("new Error().stack")).toBe("pst");
    expect(run("hookCalls")).toBe(1);
  });

  it("leaves no hook behind on a page that set none", () => {
    const { run } = page(RECORD_SHIM);
    run("requestAnimationFrame(() => {});");
    expect(run("Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace')")).toBeUndefined();
  });

  it("counts the caller as page code when the hook cannot be set aside", () => {
    const { run } = page(RECORD_SHIM);
    run(`window.hookCalls = 0;
      Object.defineProperty(Error, "prepareStackTrace", {
        value: function () { hookCalls++; throw new TypeError("no"); },
        writable: false,
        configurable: false,
      });`);
    run("requestAnimationFrame(() => {});\n//# sourceURL=hyperframes://injected/2");
    expect(run("hookCalls")).toBe(0);
    expect(run(`${activity}.frameCallbacks.length`)).toBe(1);
  });
});
