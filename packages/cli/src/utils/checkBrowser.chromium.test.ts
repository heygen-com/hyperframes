import { afterAll, beforeAll, describe, expect, it } from "vitest";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { collectSeekClock } from "./checkBrowser.js";

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

// Objects with GSAP's duration()/time()/getChildren() shape; GSAP itself is not a repo dependency.
const PAGE = `<body>
<div id="box" style="width:10px;height:10px;animation:slide 4s linear paused"></div>
<style>@keyframes slide { to { transform: translateX(100px) } }</style>
<script>
  const clock = (end) => { let now = 0; return { duration: () => end, time: () => now, seek: (t) => (now = t) }; };
  window.registered = clock(4);
  window.orphan = clock(4);
  window.__timelines = { main: window.registered, empty: clock(0) };
  window.gsap = { globalTimeline: { getChildren: () => [window.orphan] } };
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
      for (const animation of document.getAnimations()) animation.currentTime = t * 1000;
    }, time);
    return collectSeekClock(page);
  }

  it("keeps one id per animation across samples and skips empty timelines", async () => {
    page = await browser.newPage();
    await page.setContent(PAGE);

    const first = await seekTo(1);
    await page.evaluate(() => {
      const late = { duration: () => 2, time: () => 0 };
      Reflect.set(window, "__timelines", { late, ...Reflect.get(window, "__timelines") });
    });
    const second = await seekTo(2);

    expect(first.map(({ time, end }) => [time, end])).toEqual([
      [1, 4],
      [0, 4],
      [1000, 4000],
    ]);
    const [late, ...rest] = second;
    expect(rest.map(({ id }) => id)).toEqual(first.map(({ id }) => id));
    expect(first.map(({ id }) => id)).not.toContain(late?.id);
    expect(second.map(({ time }) => time)).toEqual([0, 2, 0, 2000]);
    await page.close();
  });

  it("reports nothing on a page with no animations", async () => {
    page = await browser.newPage();
    await page.setContent("<body><h1>Hello</h1></body>");

    expect(await collectSeekClock(page)).toEqual([]);
    await page.close();
  });
});
