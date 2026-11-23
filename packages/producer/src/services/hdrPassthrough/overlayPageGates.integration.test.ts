// The overlay page gates against a real Chrome page: what the page registers, compiles, replaces
// and hands GSAP or the browser is found from outside the page, without the page seeing anything
// of it; content outside the allowlists declines wherever it sits.
// Needs Chrome: integration lane.

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { VIRTUAL_TIME_SHIM } from "../fileServer.js";
import { inspectPageContent, inspectPageState } from "./overlayPageGates.js";
import { armPageCodeWatch, attachPageCodeWatch, type PageCodeWatch } from "./pageCodeWatch.js";

const GSAP = readFileSync(
  resolve(import.meta.dirname, "../../../../core/node_modules/gsap/dist/gsap.min.js"),
  "utf8",
);

/** A stand-in for the runtime: renderer code that observes the DOM and pads the timeline. */
const RUNTIME = `window.__hfRuntimeObserver = new MutationObserver(function () {});
window.__hfPad = function (tl) { tl.to({}, { duration: 3, data: "filler" }); };
//# sourceURL=hyperframes://injected/1`;

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
function gif(frames: number): Buffer {
  const header = [...ascii("GIF89a"), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255];
  const frame = [0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 1, 0];
  return Buffer.from([...header, ...Array.from({ length: frames }, () => frame).flat(), 0x3b]);
}

/** Overlay markup and timelines every page shares: a caption GSAP fades in. */
const OVERLAY = `<div id="root"><video id="video"></video><div id="cue">Hello</div></div>`;
const TIMELINE = `<script>
  const tl = gsap.timeline({ paused: true });
  tl.to("#cue", { opacity: 0.5, duration: 0.2 }, 1);
  window.__hfPad(tl);
  window.__timelines = { main: tl };
</script>`;

interface PageSpec {
  /** Markup after the renderer's scripts and GSAP, before the overlay. */
  head?: string;
  /** Markup after the overlay and the timeline. */
  body?: string;
  style?: string;
}

const inline = (text: string) => `<script>${text}</script>`;

describe("the overlay page gates in Chrome", () => {
  let browser: Browser;
  let server: Server;
  let origin: string;
  let spec: PageSpec = {};
  let page: Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    // fallow-ignore-next-line complexity
    server = createServer((request, response) => {
      const path = (request.url ?? "/").split("?")[0];
      if (path === "/") {
        response.setHeader("content-type", "text/html");
        response.end(
          `<!doctype html><html><head>${inline(VIRTUAL_TIME_SHIM)}${inline(RUNTIME)}` +
            `<script src="/gsap.min.js"></script><style>${spec.style ?? ""}</style>${spec.head ?? ""}` +
            `</head><body>${OVERLAY}${TIMELINE}${spec.body ?? ""}</body></html>`,
        );
      } else if (path === "/gsap.min.js") {
        response.setHeader("content-type", "text/javascript");
        response.end(GSAP);
      } else if (path === "/still.gif" || path === "/moving.gif") {
        response.setHeader("content-type", "image/gif");
        response.end(gif(path === "/still.gif" ? 1 : 3));
      } else {
        response.statusCode = 404;
        response.end();
      }
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise((done) => server?.close(done));
  });

  beforeEach(async () => {
    await page?.close();
    page = await browser.newPage();
    spec = {};
  });

  /** A loaded page whose watch was armed before it navigated, as the overlay session's is. */
  async function load(next: PageSpec, settleMs = 150): Promise<PageCodeWatch> {
    spec = next;
    const watch = await armPageCodeWatch(page as never, [VIRTUAL_TIME_SHIM, RUNTIME]);
    attachPageCodeWatch(page as never, watch);
    await page.goto(`${origin}/`);
    await new Promise((done) => setTimeout(done, settleMs));
    await watch.start();
    return watch;
  }
  const state = () => inspectPageState(page as never);
  const content = () => inspectPageContent(page as never, "video", true);

  it("passes a page that only uses GSAP on elements, the runtime and static content", async () => {
    await load({
      style: "#cue::before { content: url(/still.gif); } #cue::marker { color: red; }",
      body: '<img src="/still.gif"><script>Array.prototype.last = function () { return this[this.length - 1]; };</script>',
    });
    expect(await state()).toBeNull();
    expect(await content()).toBeNull();
  });

  it.each([
    [
      "SubtleCrypto#digest",
      "SubtleCrypto.prototype.digest = Promise.resolve.bind(Promise, new ArrayBuffer(32));",
    ],
    ["TextEncoder#encode", "TextEncoder.prototype.encode = Uint8Array.of.bind(Uint8Array);"],
    ["JSON.stringify", 'JSON.stringify = String.bind(null, "x");'],
    ["Object.getOwnPropertyNames", "Object.getOwnPropertyNames = Array.of.bind(Array);"],
    ["Element#matches", "Element.prototype.matches = Boolean.bind(null, false);"],
    ["Array#filter", "Array.prototype.filter = Array.prototype.map;"],
    [
      "a getter on Object.prototype",
      'Object.defineProperty(Object.prototype, "onUpdate", { get: Math.max, configurable: true });',
    ],
  ])("declines a page that replaced %s with a builtin", async (_name, swap) => {
    await load({ head: inline(swap) });
    expect(await state()).toMatchObject({
      reason: "seek_callback",
      detail: expect.stringMatching(/builtin\(s\) the page replaced/),
    });
  });

  it.each([
    [
      "location.href",
      'location.href = "javascript:void(window.ran = 1)//# sourceURL=pptr:evaluate";',
    ],
    [
      "a clicked anchor",
      'const a = document.createElement("a"); a.href = "javascript:void(window.ran = 1)//# sourceURL=pptr:evaluate"; document.body.appendChild(a); a.click(); a.remove();',
    ],
    ["a string timer", 'setTimeout("window.ran = 1", 0);'],
  ])("declines code compiled from %s, whatever it is named", async (_name, code) => {
    await load({ body: inline(code) }, 400);
    expect(await page.evaluate(() => (window as unknown as { ran?: number }).ran)).toBe(1);
    expect(await state()).toMatchObject({
      reason: "seek_callback",
      detail: expect.stringMatching(/the renderer did not send|string timer/),
    });
  });

  it.each([
    [
      "a MutationObserver with a page callback",
      "new MutationObserver(function () {});",
      "MutationObserver",
    ],
    [
      "a MutationObserver with a builtin callback",
      "new MutationObserver(HTMLElement.prototype.showPopover.bind(document.body));",
      "MutationObserver",
    ],
    [
      "a ResizeObserver built by Reflect",
      "Reflect.construct(ResizeObserver, [Math.max]);",
      "ResizeObserver",
    ],
    [
      "a custom element definition",
      'customElements.define("x-badge", class extends HTMLElement {});',
      "custom element",
    ],
    [
      "a worker",
      'new Worker(URL.createObjectURL(new Blob(["1"], { type: "text/javascript" })));',
      "Worker",
    ],
    [
      "an offscreen canvas",
      'document.createElement("canvas").transferControlToOffscreen();',
      "offscreen canvas",
    ],
    ["an animation frame", "requestAnimationFrame(function () {});", "requestAnimationFrame"],
    ["a builtin timer callback", "setTimeout(Math.max, 10);", "timer whose callback is"],
    ["a string timer", 'setTimeout("1", 10);', "string timer"],
  ])("declines %s registered while the page loads", async (_name, code, detail) => {
    await load({ body: inline(code) });
    expect(await state()).toMatchObject({
      reason: "seek_callback",
      detail: expect.stringContaining(detail),
    });
  });

  it("passes a page timer whose callback is page script", async () => {
    await load({ body: inline("setTimeout(function () { window.waited = 1; }, 10);") });
    expect(await state()).toBeNull();
  });

  it("never runs the page's Error getters, and leaves the observer constructors as they were", async () => {
    await load({
      head: inline(
        `window.touched = 0;
         for (const key of ["name", "message", "stack"]) {
           Object.defineProperty(Error.prototype, key, { configurable: true, get() { window.touched++; return ""; } });
         }
         window.text = String(MutationObserver) + "|" + String(customElements.define) + "|" + MutationObserver.name;`,
      ),
      body: inline("(function loop() { requestAnimationFrame(loop); })();"),
    });
    expect(await state()).toMatchObject({ reason: "seek_callback" });
    expect(await page.evaluate(() => (window as unknown as { touched: number }).touched)).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { text: string }).text)).toBe(
      "function MutationObserver() { [native code] }|function define() { [native code] }|MutationObserver",
    );
  });

  it.each([
    [
      "a builtin listener on window",
      'window.addEventListener("hf-seek", HTMLElement.prototype.showPopover.bind(document.body));',
      "listener",
    ],
    [
      "a tween of a plain object",
      "window.__timelines.main.to(window.meter = { level: 0 }, { level: 1, duration: 0.2 }, 2);",
      "not an element",
    ],
    ["a builtin GSAP ticker listener", "gsap.ticker.add(Math.max);", "ticker listener"],
    ["a delayedCall", "gsap.delayedCall(1, function () {});", "global timeline"],
    [
      "a builtin tween callback",
      'window.__timelines.main.to("#cue", { x: 1, duration: 0.1, onUpdate: Math.max }, 2);',
      "native function max",
    ],
  ])("declines %s", async (_name, code, detail) => {
    await load({ body: inline(code) });
    expect(await state()).toMatchObject({
      reason: "seek_callback",
      detail: expect.stringContaining(detail),
    });
  });

  it.each([
    [
      "an animated GIF in ::picker-icon",
      {
        style:
          "select { appearance: base-select; } select::picker-icon { content: url(/moving.gif); }",
        body: "<select><option>a</option></select>",
      },
      "overlay_unsupported",
    ],
    [
      "an animated GIF in ::scroll-button()",
      {
        style:
          "#sc { overflow: auto; width: 100px; } #sc::scroll-button(right) { content: url(/moving.gif); }",
        body: '<div id="sc">x</div>',
      },
      "overlay_unsupported",
    ],
    [
      "an animated GIF a stylesheet paints",
      { style: "#cue { background: url(/moving.gif); }" },
      "overlay_non_gsap_animation",
    ],
    [
      "a worker's canvas in an open shadow root",
      {
        body: inline(
          'const host = document.createElement("div"); document.body.appendChild(host); host.attachShadow({ mode: "open" }).innerHTML = "<canvas></canvas>";',
        ),
      },
      "overlay_unsupported",
    ],
    ["a text field (its caret blinks)", { body: '<input value="x">' }, "overlay_unsupported"],
    [
      "a paint() worklet image",
      { style: "#cue { background-image: paint(counter); }" },
      "overlay_unsupported",
    ],
  ])("declines %s", async (_name, page, reason) => {
    await load(page, 300);
    expect(await content()).toMatchObject({ reason });
  });

  // Every way an element or pseudo-element can paint an image, in the document and in an open
  // shadow root, as a URL or as data: the image is judged by its bytes, not by where it is used.
  const DATA_GIF = `data:image/gif;base64,${gif(3).toString("base64")}`;
  it.each<[string, (url: string) => PageSpec]>([
    ["an <img>", (url) => ({ body: `<img src="${url}">` })],
    ["a ::before content image", (url) => ({ style: `#cue::before { content: url(${url}); }` })],
    [
      "an ::after background",
      (url) => ({ style: `#cue::after { content: ""; background-image: url(${url}); }` }),
    ],
    [
      "a list-style image",
      (url) => ({ style: `ul { list-style-image: url(${url}); }`, body: "<ul><li>x</li></ul>" }),
    ],
    [
      "a border image",
      (url) => ({ style: `#cue { border: 4px solid; border-image: url(${url}) 1; }` }),
    ],
    ["a mask image", (url) => ({ style: `#cue { mask-image: url(${url}); }` })],
    [
      "an <img> inside an open shadow root",
      (url) => ({
        body: inline(
          `const host = document.createElement("div"); document.body.appendChild(host); host.attachShadow({ mode: "open" }).innerHTML = '<img src="${url}">';`,
        ),
      }),
    ],
  ])("declines an animated GIF painted as %s", async (_name, make) => {
    for (const url of ["/moving.gif", DATA_GIF]) {
      await page.close();
      page = await browser.newPage();
      await load(make(url), 300);
      expect(await content()).toMatchObject({
        reason: "overlay_non_gsap_animation",
        detail: expect.stringContaining("an animated GIF"),
      });
    }
  });
});
