import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import puppeteer, { type Browser } from "puppeteer-core";
import { resolveHeadlessShellPath } from "./browserManager.js";
import { applyVideoMetadataHints } from "./frameCapture.js";

const chromePath = resolveHeadlessShellPath();
const hasBrowser = chromePath !== undefined && spawnSync(chromePath, ["--version"]).status === 0;

// Boxes Chrome gives these styles once a 640x360 video's metadata has loaded.
const cases = {
  noSize: { style: "", box: "640x360" },
  widthOnly: { style: "width:200px", box: "200x112.5" },
  heightOnly: { style: "height:90px", box: "160x90" },
  bothSizes: { style: "width:200px;height:300px;object-fit:cover", box: "200x300" },
  maxWidthOnly: { style: "max-width:100px", box: "100x56.25" },
  // A flex item may not shrink below its natural width, so its border overflows the 400px row.
  borderedFlexItem: { style: "width:100%;border:8px solid", box: "416x241" },
};
const ids = Object.keys(cases);

describe.skipIf(!hasBrowser)("applyVideoMetadataHints in Chrome", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  });
  afterAll(async () => {
    await browser?.close();
  });

  it("lays out a video without loaded metadata as it would with it", async () => {
    const page = await browser.newPage();
    const videos = Object.entries(cases).map(
      ([id, { style }]) =>
        `<div style="display:flex;align-items:center;width:400px"><video id="${id}" style="${style}"></video></div>`,
    );
    await page.setContent(`<body style="margin:0">${videos.join("")}</body>`);

    await applyVideoMetadataHints(
      page,
      ids.map((id) => ({ id, width: 640, height: 360 })),
    );

    const boxes = await page.evaluate((videoIds) => {
      return Object.fromEntries(
        videoIds.map((id) => {
          const rect = document.getElementById(id)!.getBoundingClientRect();
          return [id, `${rect.width}x${rect.height}`];
        }),
      );
    }, ids);
    expect(boxes).toEqual(
      Object.fromEntries(Object.entries(cases).map(([id, { box }]) => [id, box])),
    );
    await page.close();
  });
});
