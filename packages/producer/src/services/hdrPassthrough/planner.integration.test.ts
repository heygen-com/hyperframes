// The planner's in-page driver scan against a real Chrome page: animations the runtime never
// seeks must be found inside open shadow roots too, where `document.querySelectorAll` and
// `document.getAnimations()` do not reach. Needs Chrome: integration lane.

import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findUnseekedAnimationDrivers } from "./planner.js";

describe("findUnseekedAnimationDrivers in Chrome", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
  });

  beforeEach(async () => {
    await page?.close();
    page = await browser.newPage();
    await page.setContent('<!doctype html><html><body><div id="host"></div></body></html>');
  });

  const drivers = () => page.evaluate(findUnseekedAnimationDrivers);

  it("finds nothing on a static page with an open shadow root", async () => {
    await page.evaluate(() => {
      document.getElementById("host")!.attachShadow({ mode: "open" }).innerHTML = "<b>static</b>";
    });
    expect(await drivers()).toEqual([]);
  });

  it("finds a CSS animation inside an open shadow root", async () => {
    await page.evaluate(() => {
      document.getElementById("host")!.attachShadow({ mode: "open" }).innerHTML =
        "<style>@keyframes p { from { opacity: 1 } to { opacity: 0 } } div { animation: p 1s infinite; }</style><div>x</div>";
    });
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    expect(await drivers()).toEqual(["CSS/WAAPI animation in a shadow root (1)"]);
  });

  it("finds SVG SMIL inside a nested shadow root", async () => {
    await page.evaluate(() => {
      const outer = document.getElementById("host")!.attachShadow({ mode: "open" });
      outer.innerHTML = '<div id="inner"></div>';
      outer.getElementById("inner")!.attachShadow({ mode: "open" }).innerHTML =
        '<svg><circle r="4"><animate attributeName="r" values="1;4" dur="1s" repeatCount="indefinite" /></circle></svg>';
    });
    expect(await drivers()).toEqual(["SVG SMIL (1 element)"]);
  });
});
