import { afterAll, beforeAll, describe, expect, it } from "vitest";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { measuredInMotion, readContrastMotion } from "./contrastMotion.js";
import { collectSeekClock, createPageDriver } from "./checkBrowser.js";

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

// Objects with GSAP's total*() and reversed() shape; GSAP itself is not a repo dependency.
const PAGE = `<body>
<style>
  @keyframes slide { to { transform: translateX(100px) } }
  #forever { animation: slide 1s linear infinite paused }
  #scrolled { animation: slide linear both; animation-timeline: scroll(root) }
  #viewed { animation: slide linear both; animation-timeline: view() }
</style>
<div id="forever"></div>
<div id="scrolled"></div>
<div id="viewed"></div>
<div id="reverse"></div>
<div id="held"></div>
<div id="parked"></div>
<div id="rewound"></div>
<script>
  const clock = (total, at, reversed = false) => {
    let now = at;
    return {
      totalDuration: () => total,
      totalTime: () => now,
      totalProgress: () => now / total,
      reversed: () => reversed,
      seek: (t) => (now = t),
    };
  };
  window.registered = clock(4, 0);
  window.__timelines = { main: window.registered, empty: clock(0, 0) };
  // A yoyo that finished: its one-iteration time() is back at 0, its totalTime() is at the end.
  const finishedYoyo = clock(0.2, 0.2);
  const finishedReversed = clock(4, 0, true);
  window.gsap = { globalTimeline: { getChildren: () => [finishedYoyo, finishedReversed] } };
  const reverse = document.getElementById("reverse").animate(
    [{ opacity: 0 }, { opacity: 1 }],
    { duration: 9000, fill: "both" },
  );
  reverse.playbackRate = -1;
  reverse.finish();
  // Paused at its end, the way a seek leaves it: never "finished", still done.
  const held = document.getElementById("held").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 3000, fill: "forwards" });
  held.pause();
  held.currentTime = 3000;
  // Reversed and paused: at its end it has not started, at 0 it is complete.
  const backwards = (id, at) => {
    const animation = document.getElementById(id).animate([{ opacity: 0 }, { opacity: 1 }], { duration: 3000, fill: "both" });
    animation.playbackRate = -1;
    animation.pause();
    animation.currentTime = at;
  };
  backwards("parked", 3000);
  backwards("rewound", 0);
  // A registered timeline with only the one-iteration methods, which the runtime accepts.
  window.__timelines.partial = { duration: () => 4, time: () => 1 };
  window.__timelines.partialEnded = { duration: () => 4, time: () => 4 };
  // Seekable but with no way to read its time: not evidence either way.
  window.__timelines.seekOnly = { duration: () => 4, seek: () => {} };
  // Plain values where GSAP has methods must not stop the read.
  window.__timelines.plainDuration = { duration: 4, seek: () => {} };
  window.__timelines.plainReversed = { totalDuration: () => 4, totalTime: () => 4, reversed: false };
</script>
</body>`;

describe.runIf(executablePath)("collectSeekClock in Chromium", () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    browser = await puppeteer.launch({ executablePath, args: ["--no-sandbox"] });
  });
  afterAll(async () => {
    await browser?.close();
  });

  async function seekTo(time: number) {
    await page.evaluate((t) => {
      Reflect.get(window, "registered").seek(t);
      const forever = document.getElementById("forever")?.getAnimations()[0];
      if (forever) forever.currentTime = t * 1000;
    }, time);
    return collectSeekClock(page);
  }

  it("marks finished clocks done, an infinite one never, and keeps ids across samples", async () => {
    page = await browser.newPage();
    await page.setContent(PAGE);

    const first = await seekTo(1);
    await page.evaluate(() => {
      const late = { totalDuration: () => 2, totalTime: () => 0, totalProgress: () => 0 };
      Reflect.set(window, "__timelines", { late, ...Reflect.get(window, "__timelines") });
    });
    const second = await seekTo(2);

    expect(first.map(({ time, done }) => [time, done])).toEqual([
      [1, false],
      [1, false],
      [4, true],
      [4, true],
      [0.2, true],
      [0, true],
      [1000, false],
      [0, true],
      [3000, true],
      [3000, false],
      [0, true],
    ]);
    const [late, ...rest] = second;
    expect(rest.map(({ id }) => id)).toEqual(first.map(({ id }) => id));
    expect(first.map(({ id }) => id)).not.toContain(late?.id);
    expect(second.map(({ time }) => time)).toEqual([0, 2, 1, 4, 4, 0.2, 0, 2000, 0, 3000, 3000, 0]);
    await page.close();
  });

  it("skips a seek's WebGL draws unless the caller asks to paint them", async () => {
    page = await browser.newPage();
    await page.setContent(`<script>
      window.draws = 0;
      window.WebGLRenderingContext = function () {};
      window.WebGLRenderingContext.prototype.drawArrays = () => { window.draws += 1; };
      window.__hf = { seek: () => new window.WebGLRenderingContext().drawArrays() };
    </script>`);
    const driver = createPageDriver(page);
    const drawn = () => page.evaluate(() => Reflect.get(window, "draws"));

    await driver.seekGeometry(1);
    expect(await drawn()).toBe(0);
    await driver.seekGeometry(2, { draws: true });
    expect(await drawn()).toBe(1);
    await page.close();
  });

  it("reports nothing on a page with no animations", async () => {
    page = await browser.newPage();
    await page.setContent("<body><h1>Hello</h1></body>");

    expect(await collectSeekClock(page)).toEqual([]);
    await page.close();
  });

  it("reads real GSAP motion after a repeated seek without moving the clock", async () => {
    page = await browser.newPage();
    try {
      await page.setContent('<div id="card"><span id="label">Text</span></div>');
      const coreRequire = createRequire(resolve(__dirname, "../../../core/package.json"));
      await page.addScriptTag({ path: coreRequire.resolve("gsap/dist/gsap.js") });
      await page.evaluate(() => {
        const gsap = Reflect.get(window, "gsap");
        const root = gsap.timeline({ paused: true, repeat: 1, yoyo: true });
        root.to("#card", { x: 100, duration: 1 }, 1).to({}, { duration: 1 }, 3);
        root.totalTime(6.5, true);
        Reflect.set(window, "__timelines", { root });
        Reflect.set(window, "__contrastAuditRestores", [{ el: document.getElementById("label") }]);
      });
      const sample = (await page.evaluate(readContrastMotion))[0];
      expect(sample && measuredInMotion(sample)).toBe(true);
      expect(await page.evaluate(() => Reflect.get(window, "__timelines").root.totalTime())).toBe(
        6.5,
      );
    } finally {
      await page.close();
    }
  });
});
