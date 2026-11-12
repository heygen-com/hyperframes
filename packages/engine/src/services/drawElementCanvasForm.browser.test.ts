import { afterAll, beforeAll, describe, expect, it } from "vitest";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { resolveHeadlessShellPath } from "./browserManager.js";
import { closeTestChrome } from "./__fixtures__/loopback.js";
import { injectDrawElementCanvas } from "./drawElementService.js";

const chromePath = process.env.HF_DRAWABLE_TEST_CHROME ?? resolveHeadlessShellPath();
const COMPOSITION = '<div data-composition-id="film" style="width:64px;height:32px"></div>';
const ATTRIBUTE_ERROR = /requires the canvas to have|must have the 'drawable' attribute/;

/** Makes drawElementImage check only the 157 marks, throwing as Chrome 157 does without them. */
async function actLikeChrome157(page: Page): Promise<void> {
  await page.evaluate(() => {
    delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).layoutSubtree;
    (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).updateElementGeometry =
      () => {};
    CanvasRenderingContext2D.prototype.drawElementImage = function (el: Element) {
      if (this.canvas.getAttribute("content") !== "drawable") {
        throw new DOMException(
          "DrawElementImage requires the canvas to have the content=drawable attribute",
          "InvalidStateError",
        );
      }
      if (!el.hasAttribute("drawable")) {
        throw new DOMException(
          "Descendants passed to DrawElementImage must have the 'drawable' attribute",
          "InvalidStateError",
        );
      }
    };
  });
}

async function drawInjectedRoot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.getElementById("__hf_de_canvas") as HTMLCanvasElement;
    const root = document.querySelector("[data-composition-id]") as Element;
    try {
      canvas.getContext("2d")!.drawElementImage(root, 0, 0);
      return "";
    } catch (err) {
      return String(err);
    }
  });
}

describe.skipIf(!chromePath)("drawElement capture canvas form", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-features=CanvasDrawElement"],
    });
  });
  afterAll(() => closeTestChrome(browser));

  it.each([
    ["this Chrome", false],
    ["a Chrome that wants content=drawable (157+)", true],
  ])("is accepted by drawElementImage on %s", async (_name, like157) => {
    const page = await browser.newPage();
    try {
      await page.setContent(COMPOSITION);
      // A Chrome without the API would "pass" on a TypeError, so the API must be there.
      expect(
        await page.evaluate(() => "drawElementImage" in CanvasRenderingContext2D.prototype),
      ).toBe(true);
      if (like157) await actLikeChrome157(page);
      await injectDrawElementCanvas(page, 64, 32);
      // "No cached paint record" is fine here: the marks were accepted, nothing has painted yet.
      expect(await drawInjectedRoot(page)).not.toMatch(ATTRIBUTE_ERROR);
    } finally {
      await page.close();
    }
  });
});
