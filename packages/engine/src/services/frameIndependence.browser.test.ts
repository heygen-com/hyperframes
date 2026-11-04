import { spawnSync } from "node:child_process";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodePng } from "../utils/alphaBlit.js";
import { buildChromeArgs, resolveHeadlessShellPath } from "./browserManager.js";
import { closeTestChrome } from "./__fixtures__/loopback.js";
import { pageScreenshotCapture } from "./screenshotService.js";

const chromePath = resolveHeadlessShellPath();
const hasBrowser = chromePath !== undefined && spawnSync(chromePath, ["--version"]).status === 0;

const WIDTH = 640;
const HEIGHT = 360;
const FRAMES = 60;
const FPS = 30;
const CAPTURE = { width: WIDTH, height: HEIGHT, fps: { num: FPS, den: 1 }, format: "png" } as const;

// Why screenshot browsers launch with --disable-partial-raster. Partial raster redraws only the
// invalidated part of a tile over its previous contents, and antialiased edges inside that region
// come out slightly different from a whole raster. A frame's pixels then depend on which frames the
// page drew first, so 1 and 3 workers disagree from the second worker's first frame onward, as do
// repeated and backward seeks. A whole tile redraw is a function of the content alone.
//
// HF#7111's scene: rotated boxes beside text whose opacity changes every frame.
const SCENE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden}
.card{position:absolute;background:#f7f5ef;overflow:hidden}
.card p{position:absolute;inset:0;margin:0;font:700 16px/22px Arial;color:#222;word-break:break-all;text-align:center}
.card span{opacity:0}
</style></head><body>
<div style="position:relative;width:${WIDTH}px;height:${HEIGHT}px;background:#303030;overflow:hidden">
<div class="card" style="left:110px;top:230px;width:200px;height:90px;transform:rotate(4deg)"><p>${"<span>j</span>".repeat(60)}</p></div>
<div class="card" style="left:360px;top:60px;width:200px;height:180px;transform:rotate(-3deg)"><div style="position:absolute;left:8px;top:8px;right:8px;bottom:30px;background:#6e6e6e"></div><p style="top:auto;height:22px;bottom:4px">AAAA</p></div>
</div></body></html>`;

async function captureAt(page: Page, frame: number): Promise<Buffer> {
  await page.evaluate((time: number) => {
    document.querySelectorAll("span").forEach((span, i) => {
      const progress = (time - 0.2 - i * 0.02) / 0.05;
      span.style.opacity = String(Math.min(1, Math.max(0, progress)));
    });
  }, frame / FPS);
  const png = await pageScreenshotCapture(page, CAPTURE);
  return Buffer.from(decodePng(png).data);
}

/** The frames that differ from the same frame drawn on a page with no history. */
async function framesDifferingFromFresh(
  browser: Browser,
  shots: ReadonlyMap<number, Buffer>,
): Promise<number[]> {
  const differing: number[] = [];
  for (const [frame, pixels] of shots) {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT });
    await page.setContent(SCENE);
    const fresh = await captureAt(page, frame);
    await page.close();
    if (!fresh.equals(pixels)) differing.push(frame);
  }
  return differing;
}

// The GPU modes a test machine can launch: Metal exists on every macOS runner, and SwiftShader
// exists everywhere.
const gpuModes =
  process.platform === "darwin" ? (["hardware", "software"] as const) : (["software"] as const);

describe.skipIf(!hasBrowser).each(gpuModes)(
  "frame independence on %s screenshot capture",
  (mode) => {
    let browser: Browser | undefined;

    beforeAll(async () => {
      browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: true,
        args: buildChromeArgs(
          { width: WIDTH, height: HEIGHT, captureMode: "screenshot" },
          { browserGpuMode: mode },
        ),
      });
    });

    afterAll(async () => {
      await closeTestChrome(browser);
    });

    async function drawnInOrder(order: readonly number[]): Promise<Map<number, Buffer>> {
      if (!browser) throw new Error("browser not launched");
      const page = await browser.newPage();
      await page.setViewport({ width: WIDTH, height: HEIGHT });
      await page.setContent(SCENE);
      const shots = new Map<number, Buffer>();
      for (const frame of order) shots.set(frame, await captureAt(page, frame));
      await page.close();
      return shots;
    }

    it("draws each frame of a forward run the same as on a page with no history", async () => {
      const order = Array.from({ length: FRAMES }, (_, frame) => frame);
      const shots = await drawnInOrder(order);
      expect(await framesDifferingFromFresh(browser as Browser, shots)).toEqual([]);
    }, 120_000);

    it("draws a frame reached backward the same as on a page with no history", async () => {
      const order = Array.from({ length: FRAMES }, (_, i) => FRAMES - 1 - i);
      const shots = await drawnInOrder(order);
      expect(await framesDifferingFromFresh(browser as Browser, shots)).toEqual([]);
    }, 120_000);
  },
);
