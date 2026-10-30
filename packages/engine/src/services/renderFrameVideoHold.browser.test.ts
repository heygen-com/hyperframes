import { spawnSync } from "node:child_process";
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveHeadlessShellPath } from "./browserManager.js";
import { closeTestChrome, launchTestChrome } from "./__fixtures__/loopback.js";
import { holdRenderFrameVideos } from "./renderFrameVideoHold.js";

const chromePath = resolveHeadlessShellPath();
const hasBrowser = chromePath !== undefined && spawnSync(chromePath, ["--version"]).status === 0;

const pageUrl = (body: string) => `data:text/html,${encodeURIComponent(body)}`;

describe.skipIf(!hasBrowser)("videos the render replaces with extracted frames", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchTestChrome(chromePath);
  });
  afterAll(() => closeTestChrome(browser));

  it("are parsed at preload none, so only the others start loading", async () => {
    const page = await browser.newPage();
    try {
      await page.evaluateOnNewDocument(
        holdRenderFrameVideos,
        ["cut-1", "cut-2"],
        "data-hf-render-id",
      );
      await page.goto(
        pageUrl(
          `<video id="cut-1" src="/a.mp4"></video><div><video id="cut-2" src="/b.mp4"></video></div><video id="live" src="/c.mp4"></video>`,
        ),
      );
      const preloads = await page.evaluate(() =>
        Array.from(document.querySelectorAll("video")).map((v) => [v.id, v.preload]),
      );
      expect(preloads).toEqual([
        ["cut-1", "none"],
        ["cut-2", "none"],
        ["live", "metadata"],
      ]);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("are told apart by render id when two scenes share an id", async () => {
    const page = await browser.newPage();
    try {
      await page.evaluateOnNewDocument(holdRenderFrameVideos, ["clip"], "data-hf-render-id");
      await page.goto(
        pageUrl(
          `<video id="clip" data-hf-render-id="clip" src="/a.mp4"></video><video id="clip" data-hf-render-id="clip__hf2" src="/b.mp4"></video>`,
        ),
      );
      const preloads = await page.evaluate(() =>
        Array.from(document.querySelectorAll("video")).map((v) => v.preload),
      );
      expect(preloads).toEqual(["none", "metadata"]);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("are held when a sub-composition adds them after load", async () => {
    const page = await browser.newPage();
    try {
      await page.evaluateOnNewDocument(holdRenderFrameVideos, ["late"], "data-hf-render-id");
      await page.goto(pageUrl("<main></main>"));
      const preload = await page.evaluate(async () => {
        document.querySelector("main")!.innerHTML =
          `<section><video id="late" src="/d.mp4"></video></section>`;
        await new Promise((r) => setTimeout(r, 0));
        return (document.getElementById("late") as HTMLVideoElement).preload;
      });
      expect(preload).toBe("none");
    } finally {
      await page.close();
    }
  }, 60_000);
});
