import assert from "node:assert/strict";
import { launchBrowser } from "../perf/runner.js";
import { startServer } from "../perf/server.js";

const server = startServer({ noCache: true });
const browser = await launchBrowser({ width: 611, height: 420 });
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error("composition error:", error));
  await page.goto(`${server.origin}/host.html?fixture=gsap-percent-centering`);
  await page.waitForFunction(() => window.__playerReady === true);
  const frame = page.frames().find((candidate) => candidate.url().includes("/fixtures/"));
  assert(frame, "composition frame loaded");
  const read = async (id: string) =>
    frame.evaluate((targetId) => {
      const element = document.getElementById(targetId)!;
      const gsap = window.gsap!;
      const cache = Object.fromEntries(
        ["x", "y", "xPercent", "yPercent"].map((property) => [
          property,
          gsap.getProperty(element, property),
        ]),
      );
      return { cache, top: element.getBoundingClientRect().top };
    }, id);
  const initial = await read("target");
  assert.equal(initial.cache.xPercent, -50);
  assert.equal(initial.cache.yPercent, -50);
  assert(Math.abs(initial.top - 446.5) < 0.1, `startup top ${initial.top}`);
  await frame.evaluate(() => window.__timelines.main.seek(4));
  assert.equal((await read("lazy")).cache.yPercent, -50, "lazy tween preserves centering");
  assert.equal((await read("explicit")).cache.xPercent, 25);
  assert.equal((await read("explicit")).cache.yPercent, -25);
  assert.equal((await read("pixels")).cache.yPercent, 0, "pixel translation stays pixels");
  assert.equal((await read("combined")).cache.xPercent, -70);
  assert.equal((await read("combined")).cache.yPercent, -60);
  const content = await read("content");
  assert.equal(content.cache.yPercent, -50);
  assert(Math.abs(content.top - 446.5) < 0.1, `content-box top ${content.top}`);
  assert.equal(
    await frame.evaluate(() => document.getElementById("opacity")!.style.translate),
    "",
    "opacity leaves independent translation untouched",
  );
  await frame.evaluate(() => {
    const target = document.getElementById("target")!;
    window.gsap!.core.getCache(target).uncache = 1;
    window.gsap!.set(target, { x: 40, y: 20 });
  });
  assert.equal((await read("target")).cache.yPercent, -50, "reparse preserves percentages");
  console.log(
    "GSAP percentage startup, lazy initialization, explicit values, pixels and reparse: PASS",
  );
} finally {
  await browser.close();
  await server.stop();
}
