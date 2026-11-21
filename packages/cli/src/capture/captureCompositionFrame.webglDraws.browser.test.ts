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
  // Count real texture uploads through the prototype so the seek gate (which
  // wraps the same prototype methods) decides whether an upload happens.
  window.uploads = 0;
  const proto = WebGLRenderingContext.prototype;
  const origTexImage2D = proto.texImage2D;
  proto.texImage2D = function (...args) {
    window.uploads += 1;
    return origTexImage2D.apply(this, args);
  };
  const upload = () => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([9, 9, 9, 255]));
  };
  let now = 0;
  window.seeks = [];
  window.__player = {
    renderSeek: (t) => {
      window.seeks.push(t);
      if (t === now) return;
      now = t;
      paint(t);
      upload();
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
const uploads = () => page.evaluate(() => Reflect.get(window, "uploads"));

it("skips WebGL draws on geometry seeks and repaints on the next pixel seek to the same time", async () => {
  await seekCompositionTimeline(page, 4, DENSE_GEOMETRY_SEEK_OPTIONS);
  expect(await red()).toBe(0);
  expect(await uploads()).toBe(0);

  await seekCompositionTimeline(page, 4, PIXEL_SEEK);
  expect(await red()).toBe(100);
  expect(await uploads()).toBe(1);
  expect(await seeks()).toEqual([4, 3.999, 4]);

  await seekCompositionTimeline(page, 6, PIXEL_SEEK);
  expect(await red()).toBe(150);
  expect(await uploads()).toBe(2);
  expect(await seeks()).toEqual([4, 3.999, 4, 6]);

  await page.evaluate(() => Reflect.apply(Reflect.get(window, "paint"), window, [2]));
  expect(await red()).toBe(50);
});
