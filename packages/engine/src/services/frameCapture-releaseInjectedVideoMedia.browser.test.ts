import { spawnSync } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "puppeteer-core";
import { resolveHeadlessShellPath } from "./browserManager.js";
import {
  applyVideoMetadataHints,
  releasableVideoIds,
  releaseInjectedVideoMedia,
} from "./frameCapture.js";
import { listenOnLoopback, launchTestChrome } from "./__fixtures__/loopback.js";

const chromePath = resolveHeadlessShellPath();
const hasBrowser = chromePath !== undefined && spawnSync(chromePath, ["--version"]).status === 0;

describe("releasableVideoIds", () => {
  it("keeps the media of a skipped video no poster sizes, such as a native HDR one", () => {
    expect(
      releasableVideoIds({
        skipReadinessVideoIds: ["hdr", "sdr"],
        videoMetadataHints: [{ id: "sdr", width: 640, height: 360 }],
      } as Parameters<typeof releasableVideoIds>[0]),
    ).toEqual(["sdr"]);
  });
});

describe.skipIf(!hasBrowser)("releaseInjectedVideoMedia in Chrome", () => {
  const openMedia = new Set<ServerResponse>();
  let origin = "";
  let browser: Browser;
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/media/")) {
      res.writeHead(200, { "Content-Type": "video/mp4" });
      res.write(Buffer.alloc(1024));
      openMedia.add(res);
      res.on("close", () => openMedia.delete(res));
      return;
    }
    const videos = ["a", "b", "c", "live"].map(
      (id) =>
        `<video id="${id}" preload="auto" src="/media/${id}.mp4" style="width:200px"></video>`,
    );
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<html><body style="margin:0">${videos.join("")}</body></html>`);
  });

  beforeAll(async () => {
    origin = await listenOnLoopback(server);
    browser = await launchTestChrome(chromePath);
  });
  afterAll(async () => {
    for (const res of openMedia) res.destroy();
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("drops the media of videos whose frames come from FFmpeg and keeps their layout", async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/`);
    const deadline = Date.now() + 10_000;
    while (openMedia.size < 4 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(openMedia.size).toBe(4);
    const injected = ["a", "b", "c"];
    await applyVideoMetadataHints(
      page,
      injected.map((id) => ({ id, width: 640, height: 360 })),
    );

    await releaseInjectedVideoMedia(page, injected);

    const released = await page.evaluate((ids) => {
      return ids.map((id) => {
        const video = document.getElementById(id) as HTMLVideoElement;
        const box = video.getBoundingClientRect();
        return `${id}:${video.networkState}:${box.width}x${box.height}`;
      });
    }, injected);
    expect(released).toEqual(["a:0:200x112.5", "b:0:200x112.5", "c:0:200x112.5"]);
    const releaseDeadline = Date.now() + 10_000;
    while (openMedia.size > 1 && Date.now() < releaseDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(openMedia.size).toBe(1);
    expect(await page.$eval("#live", (video) => (video as HTMLVideoElement).currentSrc)).toBe(
      `${origin}/media/live.mp4`,
    );
    await page.close();
  }, 30_000);
});
