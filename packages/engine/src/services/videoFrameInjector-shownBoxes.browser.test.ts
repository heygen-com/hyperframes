import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "puppeteer-core";
import { resolveHeadlessShellPath } from "./browserManager.js";
import { measureVideoShownBoxes } from "./videoFrameInjector.js";
import { closeTestChrome, launchTestChrome } from "./__fixtures__/loopback.js";

const chromePath = resolveHeadlessShellPath();
const hasBrowser = chromePath !== undefined && spawnSync(chromePath, ["--version"]).status === 0;

// `#zoom` grows from 400x225 at t=0 to 800x450 at t=1; `#late` is only laid out from t=0.5.
const page1 = `<body style="margin:0">
  <video id="zoom" style="position:absolute;width:400px;height:225px;transform-origin:0 0"></video>
  <video id="late" style="position:absolute;top:500px;width:320px;height:180px;display:none"></video>
  <video id="graded" data-color-grading="warm" style="width:200px;height:100px"></video>
  <video id="natural" style="width:200px;height:100px;object-fit:none"></video>
  <script>
    window.__hf = { seek(t) {
      document.getElementById("zoom").style.transform = "scale(" + (1 + t) + ")";
      document.getElementById("late").style.display = t >= 0.5 ? "block" : "none";
    } };
  </script>
</body>`;

describe.skipIf(!hasBrowser)("measureVideoShownBoxes in Chrome", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await launchTestChrome(chromePath);
  });
  afterAll(() => closeTestChrome(browser));

  async function open(html: string, deviceScaleFactor: number): Promise<Page> {
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 800, deviceScaleFactor });
    await page.setContent(html);
    return page;
  }

  it("returns each video's largest box over the seeked times, in device pixels", async () => {
    const page = await open(page1, 2);
    const ids = ["zoom", "late", "graded", "natural", "missing"];
    const boxes = await measureVideoShownBoxes(page, ids, [0, 0.25, 1]);
    expect(Object.fromEntries(boxes)).toEqual({
      zoom: { width: 1600, height: 900 },
      late: { width: 640, height: 360 },
    });
    await page.close();
  });

  it("keeps every video full size when the page has a canvas that could sample it", async () => {
    const page = await open(
      page1.replace("<script>", '<canvas width="10" height="10"></canvas><script>'),
      1,
    );
    expect((await measureVideoShownBoxes(page, ["zoom", "late"], [0, 1])).size).toBe(0);
    await page.close();
  });
});
