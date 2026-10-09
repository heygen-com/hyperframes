import assert from "node:assert/strict";
import { launchBrowser } from "../perf/runner.js";
import { startServer } from "../perf/server.js";

const server = startServer({ noCache: true });
const browser = await launchBrowser({ width: 611, height: 420 });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  // The player must have a size before load, or the composition renders unzoomed.
  await page.evaluateOnNewDocument(() => {
    document.addEventListener("DOMContentLoaded", () => {
      document.head.append(
        Object.assign(document.createElement("style"), {
          textContent: "hyperframes-player { height: 100vh }",
        }),
      );
    });
  });
  await page.goto(`${server.origin}/host.html?fixture=gsap-percent-centering`);
  await page.waitForFunction(() => window.__playerReady === true);
  const zoom = await page.evaluate(
    () => document.getElementById("player")!.shadowRoot!.querySelector("iframe")!.style.zoom,
  );
  assert(Number(zoom) > 0.3 && Number(zoom) < 0.33, `composition zoom ${zoom}`);
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
      const box = element.getBoundingClientRect();
      return { cache, center: [box.left + box.width / 2, box.top + box.height / 2] };
    }, id);
  // A centered layer sits at the composition center plus the x and y GSAP set on it.
  const centered = async (id: string, x = 40, y = 20) => {
    const { cache, center } = await read(id);
    assert.equal(cache.xPercent, -50, `${id} xPercent`);
    assert.equal(cache.yPercent, -50, `${id} yPercent`);
    assert(
      Math.abs(center[0]! - 960 - x) < 0.1 && Math.abs(center[1]! - 540 - y) < 0.1,
      `${id} ${center}`,
    );
  };
  await centered("target");
  await centered("sheet");
  await centered("origin");
  await centered("boxed", 0, 0);
  await frame.evaluate(() => {
    const gsap = window.gsap!;
    gsap.getProperty(document.getElementById("read")!, "y");
    gsap.set("#read", { x: 40, y: 20 });
    gsap.quickSetter(document.getElementById("quick")!, "y", "px")(20);
    gsap.set("#quick", { x: 40 });
  });
  await centered("read");
  await centered("quick");
  await frame.evaluate(() => window.__timelines.main.seek(4));
  assert.equal((await read("lazy")).cache.yPercent, -50, "lazy tween preserves centering");
  assert.equal((await read("explicit")).cache.xPercent, 25);
  assert.equal((await read("explicit")).cache.yPercent, -25);
  assert.equal((await read("pixels")).cache.yPercent, 0, "pixel translation stays pixels");
  const slide = await read("slide");
  assert.equal(slide.cache.xPercent, 0, "a non-centering percentage stays GSAP's pixels");
  assert(Math.abs(slide.center[0]! - 1130) < 0.1, `slide x: 0 slides in, ${slide.center}`);
  for (const id of ["hidden-set", "hidden-tween"]) {
    const { cache } = await read(id);
    assert(Number.isFinite(cache.x) && Number.isFinite(cache.y), `${id} ${JSON.stringify(cache)}`);
  }
  assert.equal(
    (await read("mover")).cache.x,
    250,
    "a hidden layer's tween keeps the timeline rendering",
  );
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
  await centered("target");
  await frame.evaluate(() => {
    document.getElementById("hidden")!.style.display = "block";
  });
  const percentSized = (await read("hidden-percent")).center;
  assert(
    Math.abs(percentSized[0]! - 960) < 0.5 && Math.abs(percentSized[1]! - 540) < 0.5,
    `a percent-sized layer parsed while hidden lands centered, ${percentSized}`,
  );
  assert.deepEqual(errors, [], "no composition errors");
  console.log(
    "GSAP centering under zoom (translate, stylesheet transform, origin first, read first, " +
      "quick setter, lazy tween, padding, hidden layers, reparse) and GSAP's own pixels for " +
      "other percentages: PASS",
  );
} finally {
  await browser.close();
  await server.stop();
}
