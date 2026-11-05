import { describe, expect, it } from "bun:test";
import { Script, createContext } from "node:vm";
import { VIRTUAL_TIME_SHIM } from "./fileServer.js";

interface ShimPage {
  run: <T = unknown>(code: string) => T;
  /** Fire every timer the page scheduled, in order, as the browser would. */
  runTimers: () => void;
}

function loadShim({ pendingSetup = true } = {}): ShimPage {
  const context = createContext({});
  new Script(`
    globalThis.window = globalThis;
    globalThis.__timers = [];
    globalThis.setTimeout = (cb) => { __timers.push(cb); return __timers.length; };
    globalThis.clearTimeout = () => undefined;
    globalThis.setInterval = () => 0;
    globalThis.clearInterval = () => undefined;
    globalThis.performance = { now: () => 0 };
    globalThis.requestAnimationFrame = undefined;
    globalThis.cancelAnimationFrame = undefined;
    globalThis.calls = [];
  `).runInContext(context);
  new Script(VIRTUAL_TIME_SHIM).runInContext(context);
  if (pendingSetup) {
    new Script("window.__hf = { buildReady: { scene: new Promise(() => {}) } };").runInContext(
      context,
    );
  }
  const run = <T>(code: string): T => new Script(code).runInContext(context) as T;
  return { run, runTimers: () => run("__timers.splice(0).forEach((cb) => cb())") };
}

describe("virtual-time shim: animation frames before capture starts", () => {
  it("gives setup that awaits a frame a real tick at the frozen time", () => {
    const page = loadShim();
    page.run(`requestAnimationFrame((t) => calls.push(["setup", t]))`);
    expect(page.run("calls.length")).toBe(0);
    page.runTimers();
    expect(page.run("JSON.stringify(calls)")).toBe('[["setup",0]]');
  });

  it("leaves pre-capture frames for the first seek when no setup is registered", () => {
    const page = loadShim({ pendingSetup: false });
    page.run(`requestAnimationFrame((t) => calls.push(t))`);
    page.runTimers();
    expect(page.run("calls.length")).toBe(0);
    page.run("__HF_VIRTUAL_TIME__.seekToTime(0)");
    expect(page.run("JSON.stringify(calls)")).toBe("[0]");
  });

  it("honors cancelAnimationFrame for a pre-capture frame", () => {
    const page = loadShim();
    page.run(`cancelAnimationFrame(requestAnimationFrame(() => calls.push("cancelled")))`);
    page.runTimers();
    expect(page.run("calls.length")).toBe(0);
  });

  it("runs a frame still pending at the first seek once, in the seek's flush", () => {
    const page = loadShim();
    page.run(`requestAnimationFrame((t) => calls.push(t))`);
    page.run("__HF_VIRTUAL_TIME__.seekToTime(500)");
    page.runTimers();
    expect(page.run("JSON.stringify(calls)")).toBe("[500]");
  });

  it("queues frames for the next seek once capture has started", () => {
    const page = loadShim();
    page.run("__HF_VIRTUAL_TIME__.seekToTime(0)");
    page.run(`requestAnimationFrame((t) => calls.push(t))`);
    page.runTimers();
    expect(page.run("calls.length")).toBe(0);
    page.run("__HF_VIRTUAL_TIME__.seekToTime(1000)");
    expect(page.run("JSON.stringify(calls)")).toBe("[1000]");
  });
});
