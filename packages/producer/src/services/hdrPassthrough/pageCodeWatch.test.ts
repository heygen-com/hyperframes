import { describe, expect, it } from "bun:test";
import {
  armPageCodeWatch,
  findPageCodeInCoverage,
  type ScriptCoverageLike,
} from "./pageCodeWatch.js";
import type { ParsedScriptEvent, ScriptOrigin } from "./scriptOrigins.js";

const script = (
  scriptId: string,
  url: string,
  ...counts: Array<[string, number]>
): ScriptCoverageLike => ({
  scriptId,
  url,
  functions: counts.map(([functionName, count]) => ({
    functionName,
    ranges: [{ count }],
  })),
});

/** Origins by script id; anything unlisted is the page's. */
const origins =
  (known: Record<string, ScriptOrigin>) =>
  async (scriptId: string): Promise<ScriptOrigin> =>
    known[scriptId] ?? "page";

describe("findPageCodeInCoverage", () => {
  it("is null when only the renderer and GSAP ran", async () => {
    expect(
      await findPageCodeInCoverage(
        [
          script("11", "hyperframes://injected/1", ["seekToTime", 30], ["flushAnimationFrame", 30]),
          script("13", "http://127.0.0.1:4100/assets/gsap.min.js", ["render", 90]),
          script("70", "pptr:evaluate;x", ["collectOverlayPageFingerprint", 90]),
          script("4", "", ["window.__hfMediaId", 90]),
          // Page functions that did not run.
          script("20", "hyperframes-composition://body", ["", 0], ["build", 0]),
        ],
        origins({ "11": "renderer", "13": "gsap", "70": "renderer", "4": "renderer" }),
      ),
    ).toBeNull();
  });

  it("goes by origin, not by URL", async () => {
    // A page script named like the renderer's or like GSAP, and an unnamed eval.
    const ran = [
      script("30", "hyperframes://injected/0", ["set", 3]),
      script("31", "http://127.0.0.1:4100/assets/gsap.min.js", ["set", 2]),
      script("32", "", ["", 1]),
    ];
    expect(await findPageCodeInCoverage(ran, origins({}))).toBe(
      "3 page function(s) ran after load, first set in hyperframes://injected/0",
    );
  });

  it("names a page setter the runtime assigns on every seek", async () => {
    expect(
      await findPageCodeInCoverage(
        [
          script("11", "hyperframes://injected/1", ["seekToTime", 90]),
          script("20", "hyperframes-composition://body", ["", 0], ["set", 90], ["apply", 90]),
        ],
        origins({ "11": "renderer" }),
      ),
    ).toBe("2 page function(s) ran after load, first set in hyperframes-composition://body");
  });

  it("names an unnamed function by its script id", async () => {
    expect(await findPageCodeInCoverage([script("42", "", ["", 1])], origins({}))).toBe(
      "1 page function(s) ran after load, first an anonymous function in script 42",
    );
  });

  it("only reads origins of scripts in which something ran", async () => {
    const asked: string[] = [];
    await findPageCodeInCoverage(
      [script("1", "a", ["f", 0]), script("2", "b", ["g", 1])],
      async (scriptId) => {
        asked.push(scriptId);
        return "renderer";
      },
    );
    expect(asked).toEqual(["2"]);
  });
});

/**
 * A page whose one DevTools session records every command and, on
 * `Debugger.enable`, replays the scripts the page holds by then, as Chrome
 * does: with their realm and no stack.
 */
function fakeCapturePage(live: ParsedScriptEvent[]) {
  const sent: string[] = [];
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const results: Record<string, unknown> = {
    "Page.getFrameTree": { frameTree: { frame: { id: "MAIN" } } },
    "Page.addScriptToEvaluateOnNewDocument": { identifier: "1" },
    "Runtime.evaluate": { result: { objectId: "capture" } },
    "Profiler.takePreciseCoverage": { result: [] },
  };
  const client = {
    on(name: string, fn: (event: unknown) => void) {
      listeners.set(name, (listeners.get(name) ?? new Set()).add(fn));
    },
    off(name: string, fn: (event: unknown) => void) {
      listeners.get(name)?.delete(fn);
    },
    async send(method: string) {
      sent.push(method);
      if (method === "Debugger.enable") {
        for (const event of live)
          for (const fn of listeners.get("Debugger.scriptParsed") ?? []) fn(event);
      }
      return results[method] ?? {};
    },
  };
  const page = {
    mainFrame: () => ({}),
    createCDPSession: async () => client,
  };
  /** An event another user of the session sees, such as the engine enabling the debugger to name a throw site. */
  const emit = (name: string, event: unknown) => {
    for (const fn of listeners.get(name) ?? []) fn(event);
  };
  return { page: page as never, sent, emit };
}

describe("armPageCodeWatch on the capture page", () => {
  const main = { isDefault: true, type: "default", frameId: "MAIN" };
  const replayed = (
    scriptId: string,
    extra: Partial<ParsedScriptEvent> = {},
  ): ParsedScriptEvent => ({
    scriptId,
    url: "",
    executionContextId: 3,
    executionContextAuxData: main,
    ...extra,
  });

  it("sends nothing to the debugger while the page loads", async () => {
    const { page, sent } = fakeCapturePage([]);
    const watch = await armPageCodeWatch(page, [], "capture");
    expect(sent.filter((method) => method.startsWith("Debugger."))).toEqual([]);
    // Unstarted, the record declines rather than read as empty.
    expect(watch.origins.failure()).toBe("script record never started");
    await watch.dispose();
  });

  it("counts calls before it enables the debugger, then deactivates its breakpoints", async () => {
    const { page, sent } = fakeCapturePage([]);
    const watch = await armPageCodeWatch(page, [], "capture");
    sent.length = 0;
    await watch.start();
    const at = (method: string) => sent.indexOf(method);
    expect(at("Profiler.startPreciseCoverage")).toBeGreaterThanOrEqual(0);
    expect(at("Profiler.takePreciseCoverage")).toBeLessThan(at("Debugger.enable"));
    expect(at("Debugger.enable")).toBeLessThan(at("Debugger.setBreakpointsActive"));
    expect(watch.origins.failure()).toBeUndefined();
    expect(watch.registrations.failure()).toBeUndefined();
    await watch.dispose();
  });

  it("knows the scripts the page loaded by replay, by text alone", async () => {
    const { page } = fakeCapturePage([
      // An eval or an inserted script the page made while it loaded: no embedding document.
      replayed("10"),
      replayed("11", { embedderName: "http://127.0.0.1/index.html" }),
      replayed("12", {
        executionContextAuxData: { isDefault: false, type: "isolated", frameId: "MAIN" },
      }),
    ]);
    const watch = await armPageCodeWatch(page, [], "capture");
    await watch.start();
    expect(watch.origins.kindOf("10")).toBe("unobserved");
    expect(await watch.origins.originOf("10")).toBe("page");
    expect(await watch.origins.originOf("11")).toBe("page");
    expect(await watch.origins.originOf("12")).toBe("renderer");
    expect(await watch.origins.findUntrustedCompiles()).toBeNull();
    await watch.dispose();
  });

  it("ignores compiles another debugger session reported while the page loaded", async () => {
    const { page, emit } = fakeCapturePage([]);
    const watch = await armPageCodeWatch(page, [], "capture");
    // A string timer the page ran while it loaded, seen while the engine had the debugger on.
    emit("Debugger.scriptParsed", replayed("30"));
    await watch.start();
    expect(watch.origins.kindOf("30")).toBeUndefined();
    expect(await watch.origins.findUntrustedCompiles()).toBeNull();
    await watch.dispose();
  });

  it("still declines a script another realm held when the page was ready", async () => {
    const child = { isDefault: true, type: "default", frameId: "CHILD" };
    const { page } = fakeCapturePage([replayed("20", { executionContextAuxData: child })]);
    const watch = await armPageCodeWatch(page, [], "capture");
    await watch.start();
    expect(await watch.origins.findUntrustedCompiles()).toMatch(/another realm/);
    await watch.dispose();
  });
});
