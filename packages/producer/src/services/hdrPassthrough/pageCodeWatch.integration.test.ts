// The page-code watch against a real Chrome page: V8's call counts must see every page function a
// seek runs (a setter on a runtime seek-time global, an accessor GSAP writes through, a custom
// element reacting to an attribute GSAP sets) and none of the renderer's or GSAP's own.
// Needs Chrome: integration lane.

import { resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { watchPageCode } from "./pageCodeWatch.js";

const GSAP_PATH = resolve(
  import.meta.dirname,
  "../../../../core/node_modules/gsap/dist/gsap.min.js",
);

/** The composition's own code, tagged the way the compiler tags it. */
const COMPOSITION = `
  (() => {
    let time;
    Object.defineProperty(window, "__hfTypegpuTime", {
      configurable: true,
      get: () => time,
      set(t) {
        time = t;
        if (t >= 1 && t < 2) CSS.highlights.set("hf", new Highlight());
        else CSS.highlights.delete("hf");
      },
    });
    const proxy = {};
    let on = 0;
    Object.defineProperty(proxy, "on", { get: () => on, set(v) { on = v; } });
    customElements.define("hf-badge", class extends HTMLElement {
      static observedAttributes = ["data-on"];
      attributeChangedCallback() {}
    });
    const badge = document.createElement("hf-badge");
    document.body.appendChild(badge);
    const box = document.createElement("div");
    box.id = "box";
    document.body.appendChild(box);
    window.__timelines = {
      plain: gsap.timeline({ paused: true }).to("#box", { opacity: 0.5, duration: 1 }, 0),
      proxy: gsap.timeline({ paused: true }).set(proxy, { on: 1 }, 1),
      element: gsap.timeline({ paused: true }).set(badge, { attr: { "data-on": "1" } }, 1),
    };
  })();
//# sourceURL=hyperframes-composition://body`;

/** A stand-in for the runtime's seek: renderer code that assigns the seek-time global. */
const RUNTIME = `
  window.__runtimeSeek = (name, t) => {
    window.__timelines[name].seek(t);
    if (name === "setter") window.__hfTypegpuTime = t;
  };
//# sourceURL=hyperframes://injected/0`;

describe("watchPageCode in Chrome", () => {
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
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ path: GSAP_PATH });
    await page.addScriptTag({ content: COMPOSITION });
    await page.addScriptTag({ content: RUNTIME });
  });

  /** What the watch reports over seeks of one registered timeline. */
  async function watchSeeks(name: string, times: number[]): Promise<string | null> {
    const watch = await watchPageCode(page as never);
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

  it("reports nothing while only the runtime and GSAP run", async () => {
    expect(await watchSeeks("plain", [0, 0.5, 1, 0.25])).toBeNull();
  });

  it("does not count page code that ran before the watch started", async () => {
    await page.evaluate(() => {
      (window as unknown as { __hfTypegpuTime: number }).__hfTypegpuTime = 1.5;
    });
    expect(await watchSeeks("plain", [0.5])).toBeNull();
  });

  it("finds a setter on a runtime seek-time global", async () => {
    await page.evaluate(() => {
      const w = window as unknown as { __timelines: Record<string, unknown> };
      w.__timelines.setter = w.__timelines.plain;
    });
    expect(await watchSeeks("setter", [0.5, 1.5])).toMatch(
      /page function\(s\) ran on seeks, first set in hyperframes-composition:\/\/body/,
    );
  });

  it("finds an accessor a GSAP set() writes through", async () => {
    expect(await watchSeeks("proxy", [0.5, 1.5])).toMatch(/hyperframes-composition:\/\/body/);
  });

  it("finds a custom element reacting to an attribute GSAP sets", async () => {
    expect(await watchSeeks("element", [0.5, 1.5])).toMatch(
      /first attributeChangedCallback in hyperframes-composition:\/\/body/,
    );
  });

  it("reads each record once and can be disposed", async () => {
    const watch = await watchPageCode(page as never);
    await watch.dispose();
    const next = await watchPageCode(page as never);
    expect(await next.stop()).toBeNull();
  });
});
