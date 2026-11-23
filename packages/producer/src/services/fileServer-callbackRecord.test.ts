// The HDR passthrough's callback record in the virtual-time shim: served only with the passthrough
// on, and invisible to the page when it is (a render that falls back to the layered path must
// render exactly as it would with the flag off).

import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { createContext, Script } from "node:vm";
import { VIRTUAL_TIME_SHIM, virtualTimeShimFor, withCallbackRecord } from "./fileServer.js";

const RECORD_SHIM = virtualTimeShimFor({ experimentalHdrPassthrough: true });

/** `VIRTUAL_TIME_SHIM`'s literal text in a fileServer.ts source, as `String.raw` reads it. */
function shimLiteral(source: string): string | null {
  const open = "const VIRTUAL_TIME_SHIM = String.raw`";
  const start = source.indexOf(open);
  if (start < 0) return null;
  const end = source.indexOf("})();`;", start);
  return end < 0 ? null : source.slice(start + open.length, end + "})();".length);
}

/** origin/main's fileServer.ts, or null outside a git checkout that has it. */
function mainFileServerSource(): string | null {
  try {
    return execFileSync(
      "git",
      ["show", "origin/main:packages/producer/src/services/fileServer.ts"],
      {
        cwd: import.meta.dirname,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  } catch {
    return null;
  }
}

describe("virtualTimeShimFor", () => {
  it("serves the shim unchanged with the passthrough off", () => {
    expect(virtualTimeShimFor({})).toBe(VIRTUAL_TIME_SHIM);
    expect(virtualTimeShimFor({ experimentalHdrPassthrough: false })).toBe(VIRTUAL_TIME_SHIM);
    expect(VIRTUAL_TIME_SHIM).not.toContain("callbackActivity");
    expect(VIRTUAL_TIME_SHIM).not.toContain("calledByPage");
  });

  const mainSource = mainFileServerSource();
  it.skipIf(mainSource === null)("serves origin/main's shim text with the passthrough off", () => {
    const literal = shimLiteral(mainSource ?? "");
    expect(literal).not.toBeNull();
    expect(virtualTimeShimFor({ experimentalHdrPassthrough: false })).toBe(literal as string);
  });

  it("splices the record into the shim with the passthrough on", () => {
    expect(RECORD_SHIM).not.toBe(VIRTUAL_TIME_SHIM);
    expect(RECORD_SHIM).toContain("callbackActivity");
    expect(RECORD_SHIM).toBe(withCallbackRecord(VIRTUAL_TIME_SHIM));
  });

  it("refuses a shim whose anchors moved", () => {
    expect(() => withCallbackRecord("(function() {})();")).toThrow(/anchor not found/);
  });
});

type Run = <T = unknown>(code: string) => T;

/** Stand-ins for the platform's observers and custom element registry, kept as `__original`. */
const PLATFORM_STUBS = `
  globalThis.MutationObserver = class MutationObserver { constructor(callback) { this.callback = callback; } };
  globalThis.WebKitMutationObserver = MutationObserver;
  globalThis.ResizeObserver = class ResizeObserver { constructor(callback) { this.callback = callback; } };
  globalThis.CustomElementRegistry = class CustomElementRegistry { define(name, constructor) { this[name] = constructor; } };
  globalThis.customElements = new CustomElementRegistry();
  globalThis.__original = { MutationObserver, ResizeObserver, define: CustomElementRegistry.prototype.define };
`;

function page(shim: string, setup = ""): Run {
  const context = createContext({});
  new Script(`
    globalThis.window = globalThis;
    globalThis.setTimeout = () => 1;
    globalThis.clearTimeout = () => undefined;
    globalThis.setInterval = () => 1;
    globalThis.clearInterval = () => undefined;
    globalThis.performance = { now: () => 0 };
    globalThis.__renderReady = true;
    ${PLATFORM_STUBS}
  `).runInContext(context);
  new Script(shim).runInContext(context);
  const run: Run = <T>(code: string) => new Script(code).runInContext(context) as T;
  if (setup) run(setup);
  return run;
}

// Page script that replaces or watches everything a shim could reach for, and counts each use.
const INSTRUMENT = `
  window.calls = {};
  const apply = Reflect.apply;
  const count = (name) => { calls[name] = (calls[name] || 0) + 1; };
  let inside = false;
  const wrap = (owner, key, name) => {
    const original = owner[key];
    owner[key] = function () {
      if (!inside) { inside = true; try { count(name); } finally { inside = false; } }
      return apply(original, this, arguments);
    };
  };
  wrap(Array.prototype, "indexOf", "Array#indexOf");
  wrap(Array.prototype, "push", "Array#push");
  wrap(Array.prototype, "slice", "Array#slice");
  wrap(Array.prototype, "filter", "Array#filter");
  wrap(Array.prototype, "includes", "Array#includes");
  wrap(String.prototype, "split", "String#split");
  wrap(String.prototype, "indexOf", "String#indexOf");
  wrap(String.prototype, "lastIndexOf", "String#lastIndexOf");
  wrap(String.prototype, "slice", "String#slice");
  wrap(RegExp.prototype, "test", "RegExp#test");
  wrap(RegExp.prototype, "exec", "RegExp#exec");
  wrap(Function.prototype, "call", "Function#call");
  wrap(Function.prototype, "apply", "Function#apply");
  wrap(Function.prototype, "bind", "Function#bind");
  wrap(Object, "defineProperty", "Object.defineProperty");
  wrap(Object, "getOwnPropertyDescriptor", "Object.getOwnPropertyDescriptor");
  wrap(Object.prototype, "hasOwnProperty", "Object#hasOwnProperty");
  const define = Object.defineProperty;
  for (const key of ["get", "set", "value", "writable", "enumerable", "configurable"]) {
    define(Object.prototype, key, { __proto__: null, configurable: true, get() { if (!inside) count("Object#" + key); return undefined; } });
  }
  Error.prepareStackTrace = function (error, frames) { if (!inside) count("Error.prepareStackTrace"); return "hooked"; };
  /(page)-match/.test("page-match");
`;

// The same page activity on both shims: registrations of every kind, then seeks.
const ACTIVITY = `
  requestAnimationFrame(function a() {});
  requestAnimationFrame(function b() {});
  const repeat = function c() {};
  requestAnimationFrame(repeat);
  requestAnimationFrame(repeat);
  setTimeout("window.fromString = 1", 0);
  window.__HF_VIRTUAL_TIME__.seekToTime(0);
  setTimeout(function d() {}, 10);
  setInterval(function e() {}, 20);
  window.__HF_VIRTUAL_TIME__.seekToTime(100);
  requestAnimationFrame(function f() {});
  new MutationObserver(function g() {});
  new MutationObserver(Math.max);
  new ResizeObserver(Math.max.bind(null));
  class Counted extends MutationObserver {}
  new Counted(function h() {});
  customElements.define("hf-x", class {});
`;

describe("the callback record is invisible to the page", () => {
  it("calls nothing the page replaced or watches beyond what the shim itself calls", () => {
    const plain = page(VIRTUAL_TIME_SHIM, INSTRUMENT);
    const recorded = page(RECORD_SHIM, INSTRUMENT);
    // Freeze the instrumentation's own bookkeeping before the activity runs.
    const snapshot = (run: Run) => run<string>("JSON.stringify(calls)");
    expect(snapshot(recorded)).toBe(snapshot(plain));
    plain(ACTIVITY);
    recorded(ACTIVITY);
    expect(JSON.parse(snapshot(recorded))).toEqual(JSON.parse(snapshot(plain)));
  });

  it("leaves RegExp's last match as the page's", () => {
    const recorded = page(RECORD_SHIM, INSTRUMENT);
    recorded(ACTIVITY);
    expect(recorded("RegExp.$1")).toBe("page");
  });

  it("still records the page's callbacks and timers under that instrumentation", () => {
    const recorded = page(RECORD_SHIM, INSTRUMENT);
    recorded(ACTIVITY);
    const activity = recorded<{
      frameCallbacks: unknown[];
      filmTimers: number;
      stringTimers: number;
    }>("window.__HF_VIRTUAL_TIME__.callbackActivity()");
    expect(activity.frameCallbacks.length).toBe(4);
    expect(activity.filmTimers).toBe(2);
    expect(activity.stringTimers).toBe(1);
  });
});

describe("the callback record's observers and custom elements", () => {
  const activity = "window.__HF_VIRTUAL_TIME__.callbackActivity()";

  it("leaves the platform's constructors alone with the passthrough off", () => {
    const run = page(VIRTUAL_TIME_SHIM);
    expect(run("MutationObserver === __original.MutationObserver")).toBe(true);
    expect(run("CustomElementRegistry.prototype.define === __original.define")).toBe(true);
  });

  it("counts observers whose callback runs no page script, and every definition", () => {
    const run = page(RECORD_SHIM);
    run(`
      new MutationObserver(function () {});
      new ResizeObserver(() => {});
      new MutationObserver(Math.max);
      new WebKitMutationObserver(Function.prototype.call.bind(Math.max));
      new ResizeObserver(new Proxy(function () {}, {}));
      new MutationObserver();
      customElements.define("hf-a", class {});
      customElements.define("hf-b", class {});
    `);
    expect(run(`${activity}.nativeObservers`)).toBe(4);
    expect(run(`${activity}.nativeObserverKinds`)).toEqual([
      "MutationObserver",
      "MutationObserver",
      "ResizeObserver",
      "MutationObserver",
    ]);
    expect(run(`${activity}.customElementDefinitions`)).toBe(2);
  });

  it("keeps a wrapped constructor behaving and looking like the original", () => {
    const run = page(RECORD_SHIM);
    expect(run("MutationObserver === __original.MutationObserver")).toBe(false);
    expect(run("MutationObserver.prototype.constructor === MutationObserver")).toBe(true);
    expect(run("WebKitMutationObserver === MutationObserver")).toBe(true);
    expect(run("MutationObserver.name")).toBe("MutationObserver");
    expect(run("MutationObserver.prototype === __original.MutationObserver.prototype")).toBe(true);
    expect(run("new MutationObserver(Math.min).callback === Math.min")).toBe(true);
    expect(run("new MutationObserver(Math.min) instanceof MutationObserver")).toBe(true);
    expect(
      run(
        "(class extends MutationObserver {}) && new (class extends MutationObserver {})(Math.min).callback === Math.min",
      ),
    ).toBe(true);
    const descriptor = run<PropertyDescriptor>(
      "Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver')",
    );
    expect([descriptor.writable, descriptor.enumerable, descriptor.configurable]).toEqual([
      true,
      true,
      true,
    ]);
    run(`customElements.define("hf-c", Math.min);`);
    expect(run(`customElements["hf-c"] === Math.min`)).toBe(true);
  });
});

describe("the callback record's caller", () => {
  const activity = "window.__HF_VIRTUAL_TIME__.callbackActivity()";

  it.each([
    ["the renderer's injected script", "//# sourceURL=hyperframes://injected/0", 0],
    ["a DevTools evaluation", "//# sourceURL=pptr:evaluate;x", 0],
    ["the composition", "//# sourceURL=hyperframes-composition://body", 1],
    ["the compiler's seek reapply", "//# sourceURL=hyperframes://position-seek-reapply", 0],
    ["a compiler script it cannot vouch for", "//# sourceURL=hyperframes://position-edits", 1],
    ["an unnamed script", "", 1],
  ])("attributes a registration from %s", (_label, sourceUrl, pageCallbacks) => {
    const run = page(RECORD_SHIM);
    run(`requestAnimationFrame(function () {});\n${sourceUrl}`);
    expect(run(`${activity}.frameCallbacks.length`)).toBe(pageCallbacks);
  });

  it("counts code evaluated from a renderer script as the page's", () => {
    const run = page(RECORD_SHIM);
    run(
      `window.evalIn = function (code) { return eval(code); };\n//# sourceURL=hyperframes://injected/0`,
    );
    run(`evalIn("requestAnimationFrame(function () {})");`);
    run(`evalIn("new Function('requestAnimationFrame(function () {})')()");`);
    expect(run(`${activity}.frameCallbacks.length`)).toBe(2);
  });

  it("counts a page function named like a renderer frame as the page's", () => {
    const run = page(RECORD_SHIM);
    run(`const f = function () { requestAnimationFrame(function () {}); };
      Object.defineProperty(f, "name", { value: "x (hyperframes://injected/0:1:1)" });
      f();`);
    expect(run(`${activity}.frameCallbacks.length`)).toBe(1);
  });
});
