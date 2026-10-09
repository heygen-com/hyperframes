import { afterAll, beforeAll, describe, expect, it } from "vitest";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { collectSeekClock } from "./checkBrowser.js";

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

// Objects with GSAP's total*() and reversed() shape; GSAP itself is not a repo dependency.
const PAGE = `<body>
<style>
  @keyframes slide { to { transform: translateX(100px) } }
  #forever { animation: slide 1s linear infinite paused }
</style>
<div id="forever"></div>
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
    expect(second.map(({ time }) => time)).toEqual([0, 2, 1, 4, 0.2, 0, 2000, 0, 3000, 3000, 0]);
    await page.close();
  });

  it("reports nothing on a page with no animations", async () => {
    page = await browser.newPage();
    await page.setContent("<body><h1>Hello</h1></body>");

    expect(await collectSeekClock(page)).toEqual([]);
    await page.close();
  });
});
