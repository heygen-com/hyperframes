import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { injectVideoFramesBatch } from "@hyperframes/engine";

/** Colour channels of one screenshot pixel. Alpha is always opaque here, so it is dropped. */
type Rgb = { r: number; g: number; b: number };

/** A probe coordinate in screenshot space. */
type Point = readonly [x: number, y: number];

const VIDEO_ID = "v1";

// Solid blue 1x1 PNG, stretched over the whole video box by the UA default
// `object-fit: fill` — makes injected video content trivially distinguishable
// from the white page background and the red border in a screenshot.
const BLUE_PIXEL_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==";

const BOX_WIDTH = 200;
const BOX_HEIGHT = 120;
const BORDER_WIDTH = 8;
const CORNER_RADIUS = 24;

/** Mid-way down the left border edge, far below the rounded corner's arc. */
const BORDER_EDGE: Point = [BORDER_WIDTH / 2, BOX_HEIGHT / 2];
/** Dead centre of the box, well inside the injected frame's content. */
const VIDEO_CENTER: Point = [BOX_WIDTH / 2, BOX_HEIGHT / 2];
/** Inside the corner that both the border-radius curve and the clip-path inset remove. */
const CLIPPED_CORNER: Point = [1, 1];

async function readPixel(page: Page, screenshotBase64: string, [x, y]: Point): Promise<Rgb> {
  return page.evaluate(
    async (dataUri, probeX, probeY) => {
      const img = new Image();
      img.src = dataUri;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context unavailable");
      ctx.drawImage(img, 0, 0);
      const [r, g, b] = ctx.getImageData(probeX, probeY, 1, 1).data;
      if (r === undefined || g === undefined || b === undefined) {
        throw new Error(`no pixel data at (${probeX}, ${probeY})`);
      }
      return { r, g, b };
    },
    `data:image/png;base64,${screenshotBase64}`,
    x,
    y,
  );
}

/** Renders the styled `<video>`, substitutes its frame, and returns a base64 PNG screenshot. */
async function captureStyledVideoFrame(page: Page, videoAttributes: string): Promise<string> {
  await page.setContent(`<!doctype html>
    <style>html, body { margin: 0; padding: 0; background: #ffffff; }</style>
    <video
      id="${VIDEO_ID}"
      class="clip"
      muted
      ${videoAttributes}
      style="position:absolute;left:0;top:0;width:${BOX_WIDTH}px;height:${BOX_HEIGHT}px;object-fit:fill;
        border:${BORDER_WIDTH}px solid red;border-radius:${CORNER_RADIUS}px;
        clip-path:inset(0 round ${CORNER_RADIUS}px);"
    ></video>`);
  await injectVideoFramesBatch(page, [{ videoId: VIDEO_ID, dataUri: BLUE_PIXEL_DATA_URI }]);
  return page.screenshot({ type: "png", encoding: "base64" });
}

function expectRedBorder(pixel: Rgb): void {
  expect(pixel.r).toBeGreaterThan(180);
  expect(pixel.b).toBeLessThan(80);
}

function expectBlueVideoContent(pixel: Rgb): void {
  expect(pixel.b).toBeGreaterThan(180);
}

function expectWhitePageBackground(pixel: Rgb): void {
  expect(pixel.r).toBeGreaterThan(240);
  expect(pixel.g).toBeGreaterThan(240);
  expect(pixel.b).toBeGreaterThan(240);
}

describe("video border/border-radius/clip-path on the replacement render frame", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }, 30_000);

  beforeEach(async () => {
    page = await browser.newPage();
    await page.setViewport({ width: BOX_WIDTH, height: BOX_HEIGHT });
  });

  afterEach(async () => {
    await page?.close();
  });

  afterAll(async () => {
    await browser?.close();
  });

  // The border must reach the replacement <img>, not just the (now hidden)
  // <video> — this is the reported bug: border-width/style/color were absent
  // from injectVideoFramesBatch's copy allow-list, so the video's pixels filled
  // straight through where the border should be. border-radius and clip-path
  // were already on that allow-list and clip a replaced element's content
  // without needing `overflow: hidden`; both tests confirm that still holds.
  it("paints a static border and clips to border-radius/clip-path on an untimed <video class=clip>", async () => {
    const screenshot = await captureStyledVideoFrame(page, "");

    expectRedBorder(await readPixel(page, screenshot, BORDER_EDGE));
    expectBlueVideoContent(await readPixel(page, screenshot, VIDEO_CENTER));
    expectWhitePageBackground(await readPixel(page, screenshot, CLIPPED_CORNER));
  });

  it("paints the same border/radius/clip-path on a timed <video data-start> clip", async () => {
    const screenshot = await captureStyledVideoFrame(page, 'data-start="0" data-duration="5"');

    expectRedBorder(await readPixel(page, screenshot, BORDER_EDGE));
    expectBlueVideoContent(await readPixel(page, screenshot, VIDEO_CENTER));
    expectWhitePageBackground(await readPixel(page, screenshot, CLIPPED_CORNER));
  });

  // Regression case: border-width on the copy allow-list changes the
  // replacement <img>'s LAYOUT, not just its paint. A freshly created (or
  // re-styled) <img> sibling is briefly an in-flow flex item, and once it
  // carries a border it competes for space in the flex row and shrinks the
  // video's own box — so measuring the video after styling the <img> bakes in
  // the wrong, shrunk geometry. This layout shape (flex row, centered, video
  // width:100%, global border-box reset) is what a real fixture (style-9-prod)
  // hit in CI; the pixel-probe tests above use position:absolute layouts that
  // were never exposed to the bug, so they can't catch a regression here.
  it("keeps the replacement <img>'s box identical to the video's own box in a flex-centered layout", async () => {
    const FLEX_ROW_WIDTH = 500;
    const FLEX_ROW_HEIGHT = 300;

    await page.setViewport({ width: FLEX_ROW_WIDTH, height: FLEX_ROW_HEIGHT });
    await page.setContent(`<!doctype html>
      <style>
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #ffffff; }
        #aroll-container {
          display: flex; justify-content: center; align-items: center;
          width: ${FLEX_ROW_WIDTH}px; height: ${FLEX_ROW_HEIGHT}px;
        }
      </style>
      <div id="aroll-container">
        <video
          id="${VIDEO_ID}"
          class="clip"
          muted
          style="width:100%;height:150px;object-fit:fill;
            border:${BORDER_WIDTH}px solid red;border-radius:${CORNER_RADIUS}px;"
        ></video>
      </div>`);

    await injectVideoFramesBatch(page, [{ videoId: VIDEO_ID, dataUri: BLUE_PIXEL_DATA_URI }]);

    const { videoBox, imgBox } = await page.evaluate((videoId) => {
      const video = document.getElementById(videoId);
      const img = video?.nextElementSibling;
      if (!video || !img) throw new Error(`no replacement frame beside #${videoId}`);
      const roundedRect = (rect: DOMRect) => ({
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
      return {
        videoBox: roundedRect(video.getBoundingClientRect()),
        imgBox: roundedRect(img.getBoundingClientRect()),
      };
    }, VIDEO_ID);

    expect(imgBox).toEqual(videoBox);
    // The <img>'s geometry is frozen while it is still an in-flow flex sibling,
    // whereas the video's box is read afterwards (sibling back out of flow) and
    // so is unaffected either way — this only confirms the fixture really did
    // give the flex row room to shrink into.
    expect(videoBox.width).toBe(FLEX_ROW_WIDTH);
  });
});
