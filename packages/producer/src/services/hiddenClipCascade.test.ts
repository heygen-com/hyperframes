import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
import type {} from "../../../core/src/runtime/window";

const RUNTIME_PATH = resolve(import.meta.dirname, "../../../core/dist/hyperframe.runtime.iife.js");
const PREVIEW_HEAD = `<meta name="hyperframes-studio-preview">`;
const WIDTH = 320;
const HEIGHT = 180;

// A sub-composition's `#ground { visibility: visible !important }`, as the compiler rescopes it under its
// root, outweighs any attribute-only selector and once painted over every earlier scene.
const LATE_SCENE_WITH_ID_IMPORTANT = `
  <style>[data-composition-id="late"] #ground { background: rgb(255, 0, 0); visibility: visible !important; }</style>
  <div data-composition-id="late" class="clip" data-start="2" data-duration="1" style="position:absolute;inset:0">
    <div id="ground" style="position:absolute;inset:0"></div>
  </div>`;

async function openFilm(browser: Browser, head: string): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });
  await page.setContent(`<!doctype html>${head}
    <style>html, body { margin: 0; background: rgb(128, 128, 128); }</style>
    <div data-composition-id="root" data-start="0" data-duration="3" data-width="${WIDTH}" data-height="${HEIGHT}"
      style="position:relative;width:${WIDTH}px;height:${HEIGHT}px">${LATE_SCENE_WITH_ID_IMPORTANT}</div>`);
  await page.addScriptTag({ content: readFileSync(RUNTIME_PATH, "utf8") });
  await page.waitForFunction(() => window.__playerReady && window.__renderReady);
  return page;
}

async function redPixelsAt(page: Page, time: number): Promise<number> {
  await page.evaluate((t) => window.__player!.renderSeek!(t), time);
  const shot = await page.screenshot({ encoding: "base64" });
  return page.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const context = new OffscreenCanvas(image.width, image.height).getContext("2d")!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    let red = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! > 200) red++;
    return red;
  }, shot);
}

describe("hidden clip contents cascade", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
  });

  it.each([
    ["a render", ""],
    ["a preview", PREVIEW_HEAD],
  ])(
    "keeps a later scene's id-selected visibility:visible !important layer hidden until it starts in %s",
    async (_, head) => {
      const page = await openFilm(browser, head);
      try {
        expect(await redPixelsAt(page, 1)).toBe(0);
        expect(await redPixelsAt(page, 2.5)).toBe(WIDTH * HEIGHT);
      } finally {
        await page.close();
      }
    },
    30_000,
  );
});
