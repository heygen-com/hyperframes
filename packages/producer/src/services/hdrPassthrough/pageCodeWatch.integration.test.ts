// The page-code watch against a real Chrome page: V8's call counts must see every page function
// that runs after load (a setter on a runtime seek-time global, an accessor GSAP writes through, a
// custom element reacting to an attribute GSAP sets), however the page compiled it and whatever it
// named it, and none of the renderer's or GSAP's own.
// Needs Chrome: integration lane.

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { VIRTUAL_TIME_SHIM } from "../fileServer.js";
import { armPageCodeWatch, type PageCodeWatch } from "./pageCodeWatch.js";

const GSAP_PATH = resolve(
  import.meta.dirname,
  "../../../../core/node_modules/gsap/dist/gsap.min.js",
);
const GSAP = readFileSync(GSAP_PATH, "utf8");

/** A stand-in for the runtime: renderer code that seeks a timeline and assigns the seek-time global. */
const RUNTIME = `window.__runtimeSeek = (name, t) => {
  window.__timelines[name].seek(t);
  window.__hfTypegpuTime = t;
  if (typeof window.__hfBridgeHook === "function") window.__hfBridgeHook(t);
};
//# sourceURL=hyperframes://injected/0`;

/** A page-side setter on the seek-time global, as source text. */
const SETTER = `(() => { let time; Object.defineProperty(window, "__hfTypegpuTime", { configurable: true, get: () => time, set(t) { time = t; document.title = String(t >= 1); } }); })();`;

/** The composition's timelines, tagged the way the compiler tags its code. */
const COMPOSITION = `(() => {
  const proxy = {};
  let on = 0;
  Object.defineProperty(proxy, "on", { get: () => on, set(v) { on = v; } });
  const box = document.createElement("div");
  box.id = "box";
  document.body.appendChild(box);
  window.__timelines = {
    plain: gsap.timeline({ paused: true }).to("#box", { opacity: 0.5, duration: 1 }, 0),
    proxy: gsap.timeline({ paused: true }).set(proxy, { on: 1 }, 1),
  };
})();
//# sourceURL=hyperframes-composition://body`;

/** A custom element reacting to an attribute a registered timeline sets. */
const CUSTOM_ELEMENT = `(() => {
  customElements.define("hf-badge", class extends HTMLElement {
    static observedAttributes = ["data-on"];
    attributeChangedCallback() {}
  });
  const badge = document.createElement("hf-badge");
  document.body.appendChild(badge);
  window.__timelines.element = gsap.timeline({ paused: true }).set(badge, { attr: { "data-on": "1" } }, 1);
})();
//# sourceURL=hyperframes-composition://body`;

const inline = (text: string) => `<script>${text}</script>`;

interface PageSpec {
  /** Markup at the top of <head>, before the runtime. */
  head?: string;
  /** How GSAP is loaded; the served build by default. */
  gsap?: string;
  /** Extra files the server answers with. */
  files?: Record<string, string>;
  /** Markup at the end of <body>, after the composition. */
  body?: string;
}

describe("the page code watch in Chrome", () => {
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
      const path = request.url ?? "/";
      const file =
        path === "/"
          ? `<!doctype html><html><head>${inline(VIRTUAL_TIME_SHIM)}${inline(RUNTIME)}${spec.head ?? ""}${
              spec.gsap ?? '<script src="/gsap.min.js"></script>'
            }</head><body>${inline(COMPOSITION)}${spec.body ?? ""}</body></html>`
          : path === "/gsap.min.js"
            ? GSAP
            : spec.files?.[path];
      if (file === undefined) {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.setHeader("content-type", path === "/" ? "text/html" : "text/javascript");
      response.end(file);
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

  /** A loaded page whose watch counts from now. */
  async function load(
    next: PageSpec,
    rendererScripts = [VIRTUAL_TIME_SHIM, RUNTIME],
  ): Promise<PageCodeWatch> {
    spec = next;
    const watch = await armPageCodeWatch(page as never, rendererScripts);
    await page.goto(`${origin}/`);
    await watch.start();
    return watch;
  }

  /** What the watch reports over seeks of one registered timeline. */
  async function seeks(
    watch: PageCodeWatch,
    name: string,
    times: number[],
  ): Promise<string | null> {
    for (const t of times) {
      await page.evaluate(
        (n, at) => {
          (window as unknown as { __runtimeSeek: (n: string, t: number) => void }).__runtimeSeek(
            n,
            at,
          );
        },
        name,
        t,
      );
    }
    return watch.stop();
  }

  it("reports nothing while only the runtime, DevTools evaluations and GSAP run", async () => {
    expect(await seeks(await load({}), "plain", [0, 0.5, 1, 0.25])).toBeNull();
  });

  it("trusts a function the renderer added before the page loaded, by its text", async () => {
    spec = {};
    // Armed first, as the overlay session arms it when the page opens: the script is known by
    // the exact text the renderer sends.
    const watch = await armPageCodeWatch(page as never, [VIRTUAL_TIME_SHIM, RUNTIME]);
    await page.evaluateOnNewDocument(() => {
      (window as unknown as { __hfBridgeHook: () => void }).__hfBridgeHook = () => undefined;
    });
    await page.goto(`${origin}/`);
    await watch.start();
    expect(await seeks(watch, "plain", [0.5, 1.5])).toBeNull();
  });

  it("does not trust a script registered before the watch was armed, which it never saw sent", async () => {
    spec = {};
    await page.evaluateOnNewDocument(() => {
      (window as unknown as { __hfBridgeHook: () => void }).__hfBridgeHook = () => undefined;
    });
    const watch = await armPageCodeWatch(page as never, [VIRTUAL_TIME_SHIM, RUNTIME]);
    await page.goto(`${origin}/`);
    await watch.start();
    expect(await seeks(watch, "plain", [0.5])).toMatch(/page function\(s\) ran after load/);
  });

  it("trusts GSAP as the compiler inlines it", async () => {
    const src = "https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js";
    const watch = await load({
      gsap: inline(`/* inlined: ${src} */\n${GSAP}\n//# sourceURL=${src}\n`),
    });
    expect(await seeks(watch, "plain", [0.5, 1])).toBeNull();
  });

  it("does not count page code that ran before the watch started", async () => {
    spec = { head: inline(SETTER) };
    const watch = await armPageCodeWatch(page as never, [VIRTUAL_TIME_SHIM, RUNTIME]);
    await page.goto(`${origin}/`);
    await page.evaluate(() => {
      (window as unknown as { __hfTypegpuTime: number }).__hfTypegpuTime = 1.5;
    });
    await watch.start();
    expect(await watch.stop()).toBeNull();
  });

  it("refuses to report counts it never started", async () => {
    const watch = await armPageCodeWatch(page as never, [VIRTUAL_TIME_SHIM, RUNTIME]);
    expect(await watch.stop()).toBe("call counts never started");
  });

  it("finds an accessor a GSAP set() writes through", async () => {
    expect(await seeks(await load({}), "proxy", [0.5, 1.5])).toMatch(
      /page function\(s\) ran after load, first [gs]et in hyperframes-composition:\/\/body/,
    );
  });

  it("finds a custom element reacting to an attribute GSAP sets", async () => {
    expect(
      await seeks(await load({ body: inline(CUSTOM_ELEMENT) }), "element", [0.5, 1.5]),
    ).toMatch(/first attributeChangedCallback in hyperframes-composition:\/\/body/);
  });

  it.each([
    ["an inline script", inline(SETTER)],
    [
      "a dynamically inserted inline script",
      inline(
        `const s = document.createElement("script"); s.textContent = ${JSON.stringify(SETTER)}; document.head.appendChild(s);`,
      ),
    ],
    ["eval", inline(`eval(${JSON.stringify(SETTER)});`)],
    ["new Function", inline(`new Function(${JSON.stringify(SETTER)})();`)],
    [
      "a script named like the runtime",
      inline(`${SETTER}\n//# sourceURL=hyperframes://injected/0`),
    ],
    [
      "eval named like a DevTools evaluation",
      inline(`eval(${JSON.stringify(`${SETTER}\n//# sourceURL=pptr:evaluate;x`)});`),
    ],
    ["a file named like GSAP", '<script src="/assets/gsap-core.js"></script>'],
    [
      "a script named like GSAP",
      inline(
        `eval(${JSON.stringify(`${SETTER}\n//# sourceURL=${"https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"}`)});`,
      ),
    ],
  ])("finds a seek-time setter defined by %s", async (_label, head) => {
    const watch = await load({ head, files: { "/assets/gsap-core.js": SETTER } });
    expect(await seeks(watch, "plain", [0.5, 1.5])).toMatch(/page function\(s\) ran after load/);
  });

  // A name is never the renderer's word: a page script that takes one is the page's like any other,
  // counted when it runs and ignored when it does not.
  it.each(["hyperframes://injected/7", "pptr:evaluate;x", "hyperframes://position-seek-reapply"])(
    "counts a page script named %s as the page's",
    async (name) => {
      const idle = await load({ head: inline(`window.idle = () => 1;\n//# sourceURL=${name}`) });
      expect(await seeks(idle, "plain", [0.5])).toBeNull();
      await page.close();
      page = await browser.newPage();
      const busy = await load({
        head: inline(`window.__hfBridgeHook = () => 1;\n//# sourceURL=${name}`),
      });
      expect(await seeks(busy, "plain", [0.5])).toMatch(/page function\(s\) ran after load/);
    },
  );

  it("finds a javascript: URL named like a DevTools evaluation, even when it never runs again", async () => {
    const watch = await load({
      head: inline(
        'location.href = "javascript:void(window.ranOnce = 1)//# sourceURL=pptr:evaluate";',
      ),
    });
    expect(await seeks(watch, "plain", [0.5])).toMatch(/the renderer did not send/);
  });

  it("ends a disposed watch without reading it", async () => {
    const watch = await load({});
    await watch.dispose();
    expect(await watch.stop()).toBe("call counts already read");
  });
});
