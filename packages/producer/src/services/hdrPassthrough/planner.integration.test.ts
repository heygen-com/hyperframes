// The planner's in-page driver scan against a real Chrome page: animations the runtime never
// seeks must be found inside open shadow roots too, where `document.querySelectorAll` and
// `document.getAnimations()` do not reach, and animated images wherever an element or one of its
// pseudo-elements paints one. Needs Chrome: integration lane.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findAnimatedImages, findUnseekedAnimationDrivers } from "./planner.js";

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

/** A 1x1 GIF with `frames` frames, as a data URL: two or more animate. */
function gif(frames: number): string {
  const header = [
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255,
  ];
  const frame = [0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0];
  const bytes = [...header, ...Array.from({ length: frames }, () => frame).flat(), 0x3b];
  return `data:image/gif;base64,${Buffer.from(bytes).toString("base64")}`;
}

describe("findAnimatedImages in Chrome", () => {
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
  });

  const images = (markup: string, shadow = "") =>
    page
      .setContent(`<!doctype html><html><body>${markup}<div id="host"></div></body></html>`)
      .then(() =>
        page.evaluate((inner) => {
          if (inner)
            document.getElementById("host")!.attachShadow({ mode: "open" }).innerHTML = inner;
        }, shadow),
      )
      .then(() => page.evaluate(findAnimatedImages));

  it("finds nothing for still images painted every way", async () => {
    const still = gif(1);
    expect(
      await images(
        `<style>#a::before { content: url(${still}); } #b { list-style-image: url(${still}); } #c { border: 4px solid; border-image: url(${still}) 1; } #d { mask-image: url(${still}); }</style><div id="a"></div><ul id="b"><li>x</li></ul><div id="c"></div><div id="d">m</div><img src="${still}">`,
        `<img src="${still}">`,
      ),
    ).toEqual([]);
  });

  it.each<[string, (url: string) => [string, string?]]>([
    ["an <img>", (url) => [`<img src="${url}">`]],
    [
      "a ::before content image",
      (url) => [`<style>#a::before { content: url(${url}); }</style><div id="a"></div>`],
    ],
    [
      "an ::after background",
      (url) => [
        `<style>#a::after { content: ""; background-image: url(${url}); }</style><div id="a"></div>`,
      ],
    ],
    [
      "a list-style image",
      (url) => [`<style>ul { list-style-image: url(${url}); }</style><ul><li>x</li></ul>`],
    ],
    [
      "a border image",
      (url) => [
        `<style>#a { border: 4px solid; border-image: url(${url}) 1; }</style><div id="a"></div>`,
      ],
    ],
    [
      "a mask image",
      (url) => [`<style>#a { mask-image: url(${url}); }</style><div id="a">m</div>`],
    ],
    ["an <img> inside an open shadow root", (url) => ["", `<img src="${url}">`]],
    [
      "a background inside an open shadow root",
      (url) => ["", `<div style="background-image: url(${url})">b</div>`],
    ],
  ])("finds an animated GIF as %s", async (_label, markup) => {
    const [light, shadow] = markup(gif(2));
    const found = await images(light, shadow);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^animated GIF data:image\/gif;base64,/);
  });

  it("finds a CSS paint worklet, which runs page code of its own on every paint", async () => {
    // `paint()` parses only in a secure context, which a served localhost page is.
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<style>#a { background-image: paint(counter); }</style><div id="a"></div>');
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
      expect(await page.evaluate(findAnimatedImages)).toEqual(["CSS paint worklet (1)"]);
    } finally {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
  }, 30_000);
});
