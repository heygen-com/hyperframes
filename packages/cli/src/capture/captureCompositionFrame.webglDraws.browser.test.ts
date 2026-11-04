import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ensureBrowser } from "../browser/manager.js";
import { DENSE_GEOMETRY_SEEK_OPTIONS, seekCompositionTimeline } from "./captureCompositionFrame.js";

// Red channel = time * 25. Like GSAP, seeking to the current time renders nothing.
const PAGE = `<canvas id="c" width="4" height="4"></canvas>
<script>
  const gl = document.getElementById("c").getContext("webgl", { preserveDrawingBuffer: true });
  const paint = (t) => {
    gl.clearColor((t * 25) / 255, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };
  let now = 0;
  window.seeks = [];
  window.__player = {
    renderSeek: (t) => {
      window.seeks.push(t);
      if (t === now) return;
      now = t;
      paint(t);
    },
  };
  window.paint = paint;
  window.red = () => {
    const px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px[0];
  };
  paint(0);
</script>`;

const PIXEL_SEEK = { animationFrameSettle: "none", waitForFontsMs: 0 } as const;

let browser: Browser;
let page: Page;

beforeAll(async () => {
  const { executablePath } = await ensureBrowser();
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  page = await browser.newPage();
  await page.setContent(PAGE);
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

const red = () => page.evaluate(() => Reflect.apply(Reflect.get(window, "red"), window, []));
const seeks = () => page.evaluate(() => [...Reflect.get(window, "seeks")]);

it("skips WebGL draws on geometry seeks and repaints on the next pixel seek to the same time", async () => {
  await seekCompositionTimeline(page, 4, DENSE_GEOMETRY_SEEK_OPTIONS);
  expect(await red()).toBe(0);

  await seekCompositionTimeline(page, 4, PIXEL_SEEK);
  expect(await red()).toBe(100);
  expect(await seeks()).toEqual([4, 3.999, 4]);

  await seekCompositionTimeline(page, 6, PIXEL_SEEK);
  expect(await red()).toBe(150);
  expect(await seeks()).toEqual([4, 3.999, 4, 6]);

  await page.evaluate(() => Reflect.apply(Reflect.get(window, "paint"), window, [2]));
  expect(await red()).toBe(50);
});
