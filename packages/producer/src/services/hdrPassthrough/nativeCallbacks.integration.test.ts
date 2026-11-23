// Page callbacks that run no page script, against a real Chrome page: a builtin, bound function,
// callable Proxy or WebAssembly export the page hands to the browser (a listener, an `on*`
// handler) or to the renderer and GSAP (a tween target's accessor or Proxy trap, a tween value, a
// runtime global's setter) runs on seeks where V8's call counts never see it. Page functions in
// the same places are the call counts' to see and must pass. Needs Chrome: integration lane.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findNativeCallbacks } from "./nativeCallbacks.js";

const GSAP = readFileSync(
  resolve(import.meta.dirname, "../../../../core/node_modules/gsap/dist/gsap.min.js"),
  "utf8",
);

const PAGE = `<!doctype html>
<html><body>
  <div id="root"><div id="trig">T</div><div id="pop" popover="manual">P</div><div id="host"></div>
  <details id="det"><summary>D</summary>x</details><div id="scroller" style="overflow:auto;height:20px"><div style="height:200px"></div></div></div>
</body></html>`;

/** A builtin that opens the popover when called, with no page function on the stack. */
const SHOW =
  'Reflect.apply.bind(null, HTMLElement.prototype.showPopover, document.getElementById("pop"), [])';

/** A WebAssembly export: `(func (export "f"))`. */
const WASM_EXPORT =
  "new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,7,5,1,1,102,0,0,10,4,1,2,0,11]))).exports.f";

describe("findNativeCallbacks in Chrome", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
  });

  beforeEach(async () => {
    await page?.close();
    page = await browser.newPage();
    await page.setContent(PAGE);
    await page.addScriptTag({ content: GSAP });
  });

  const run = (code: string) => page.addScriptTag({ content: code });
  const find = () => findNativeCallbacks(page as never);

  it("passes page functions wherever they are registered, and the platform's own accessors", async () => {
    await run(`
      const pop = document.getElementById("pop");
      document.getElementById("trig").addEventListener("click", function () {});
      document.getElementById("det").ontoggle = () => {};
      window.addEventListener("message", function () {});
      new MessageChannel().port1.onmessage = function () {};
      document.getElementById("host").attachShadow({ mode: "open" }).innerHTML = "<b>s</b>";
      document.getElementById("host").shadowRoot.firstChild.addEventListener("x", () => {});
      document.getElementById("trig").addEventListener("y", function () {}.bind(null));
      document.getElementById("trig").addEventListener("z", { handleEvent() {} });
      const target = {}; let on = 0;
      Object.defineProperty(target, "on", { get: () => on, set: (v) => { on = v; } });
      Object.defineProperty(window, "__hfTypegpuTime", { configurable: true, get() { return 0; }, set(t) {} });
      const tl = gsap.timeline({ paused: true });
      tl.set(target, { on: 1 }, 1).to("#trig", { opacity: 0.5, duration: 0.2, onUpdate() {} }, 0.5);
      tl.set("#scroller", { scrollTop: 40 }, 1);
      tl.set(new Proxy({ on: 0 }, { get: (t, k) => t[k] }), { on: 1 }, 1.5);
      window.__timelines = { main: tl };
    `);
    expect(await find()).toBeNull();
  });

  it.each<[string, string, string]>([
    [
      "a bound builtin listener",
      `document.getElementById("trig").addEventListener("x", HTMLElement.prototype.showPopover.bind(pop));`,
      'a "x" listener on the page that is native function showPopover',
    ],
    [
      "an on* handler set to a builtin",
      `document.getElementById("det").ontoggle = ${SHOW};`,
      'a "toggle" listener on the page that is native function apply',
    ],
    [
      "a listener object whose handleEvent is a builtin",
      `document.getElementById("trig").addEventListener("x", { handleEvent: Math.max });`,
      'a "x" listener on the page that is native function max',
    ],
    [
      "a builtin listener inside an open shadow root",
      `const s = document.getElementById("host").attachShadow({ mode: "open" }); s.innerHTML = "<b>s</b>"; s.firstChild.addEventListener("x", console.log);`,
      'a "x" listener on the page that is native function log',
    ],
    [
      "a one-shot builtin listener on window",
      `window.addEventListener("hf-later", ${SHOW}, { once: true });`,
      'a "hf-later" listener on Window that is native function apply',
    ],
    [
      "a builtin message handler on a port",
      `window.port = new MessageChannel().port1; window.port.onmessage = ${SHOW};`,
      'a "message" listener on MessagePort that is native function apply',
    ],
    [
      "a WebAssembly export as a listener",
      `document.getElementById("trig").addEventListener("x", ${WASM_EXPORT});`,
      'a "x" listener on the page that is native function $f',
    ],
    [
      "a callable Proxy with a builtin apply trap",
      `document.getElementById("trig").addEventListener("x", new Proxy(function () {}, { apply: ${SHOW} }));`,
      'a "x" listener on the page that is a Proxy whose apply trap is native function apply',
    ],
    [
      "a builtin setter on a tween target",
      `const target = {}; Object.defineProperty(target, "on", { get: Number, set: ${SHOW} }); window.__timelines = { main: gsap.timeline({ paused: true }).set(target, { on: 1 }, 1) };`,
      "getter tween target .on: native function Number",
    ],
    [
      "a Proxy tween target with a builtin trap",
      `window.__timelines = { main: gsap.timeline({ paused: true }).set(new Proxy({ on: 0 }, { get: ${SHOW} }), { on: 1 }, 1) };`,
      "tween target: a Proxy whose get trap is native function apply",
    ],
    [
      "a builtin function-based tween value",
      `window.__timelines = { main: gsap.timeline({ paused: true }).set("#trig", { attr: { "data-k": ${SHOW} } }, 1) };`,
      "tween vars.attr.data-k: native function apply",
    ],
    [
      "a builtin setter on a runtime seek-time global",
      `Object.defineProperty(window, "__hfTypegpuTime", { configurable: true, get: Number, set: ${SHOW} });`,
      "getter window.__hfTypegpuTime: native function Number",
    ],
    [
      "a timeline registry that is a Proxy with a builtin trap",
      `window.__timelines = new Proxy({}, { ownKeys: Reflect.ownKeys.bind(null, {}) });`,
      "window.__timelines: a Proxy whose ownKeys trap is native function ownKeys",
    ],
  ])("finds %s", async (_label, code, finding) => {
    await run(`{ const pop = document.getElementById("pop"); ${code} }`);
    const found = await find();
    expect(found).toContain(finding);
    expect(found).toMatch(/^\d+ page callback\(s\) that run no page script, first /);
  });

  it("calls no accessor it inspects", async () => {
    await run(`
      const target = {}; Object.defineProperty(target, "on", { get: ${SHOW}, set: ${SHOW} });
      window.__timelines = { main: gsap.timeline({ paused: true }).set("#trig", { opacity: 0 }, 1) };
      window.__timelines.main.vars.extra = target;
      Object.defineProperty(window, "__hfTypegpuTime", { configurable: true, get: ${SHOW}, set: ${SHOW} });
    `);
    expect(await find()).not.toBeNull();
    expect(
      await page.evaluate(() => document.getElementById("pop")!.matches(":popover-open")),
    ).toBe(false);
  });
});
