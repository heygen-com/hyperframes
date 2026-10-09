import assert from "node:assert/strict";
import { launchBrowser } from "../perf/runner.js";
import { startServer } from "../perf/server.js";

const server = startServer({ noCache: true });
const browser = await launchBrowser({ width: 611, height: 420 });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  // Size the player before it first measures, or the composition's scripts run at another zoom.
  await page.evaluateOnNewDocument(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync("hyperframes-player { height: 100vh }");
    document.adoptedStyleSheets = [sheet];
  });
  await page.evaluateOnNewDocument(() => {
    if (window !== window.top)
      addEventListener("DOMContentLoaded", () => {
        Object.assign(window, { __parseDensity: devicePixelRatio });
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
  const parseDensity = await frame.evaluate(
    () => (window as { __parseDensity?: number }).__parseDensity,
  );
  assert.equal(String(parseDensity?.toFixed(4)), Number(zoom).toFixed(4), "scripts run zoomed");
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
  // Layers without a sized box are left to GSAP: no restored percentage, finite pixels.
  for (const id of ["hidden-set", "hidden-tween", "hidden-percent", "inline"]) {
    const { cache } = await read(id);
    assert(Number.isFinite(cache.x) && Number.isFinite(cache.y), `${id} ${JSON.stringify(cache)}`);
    assert(cache.xPercent === 0 && cache.yPercent === 0, `${id} ${JSON.stringify(cache)}`);
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
  assert.equal(
    (await read("offset")).cache.yPercent,
    0,
    "a centered layer with a pixel offset is GSAP's",
  );
  // GSAP's reparse reads its own pixel output, which it never infers as centering; that stays GSAP's.
  await frame.evaluate(() => {
    const target = document.getElementById("target")!;
    window.gsap!.core.getCache(target).uncache = 1;
    window.gsap!.getProperty(target, "x");
  });
  assert.equal((await read("target")).cache.yPercent, 0, "reparse is left to GSAP");
  assert.deepEqual(errors, [], "no composition errors");
  console.log(
    "GSAP centering under zoom (translate, stylesheet transform, origin first, read first, " +
      "quick setter, lazy tween, padding, hidden layers) and GSAP's own parse for other " +
      "percentages, pixel offsets and reparse: PASS",
  );
} finally {
  await browser.close();
  await server.stop();
}
