import { spawnSync } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireBrowser, drainBrowserPool, resolveHeadlessShellPath } from "./browserManager.js";
import { shouldDisableBrowserPoolForParallelWorker } from "./parallelCoordinator.js";
import { listenOnLoopback } from "./__fixtures__/loopback.js";

const chromePath = resolveHeadlessShellPath();
const hasBrowser = chromePath !== undefined && spawnSync(chromePath, ["--version"]).status === 0;

// heygen-com/hyperframes#5548: a media-heavy page holds every connection
// Chrome allows to one host, so a second worker page in the same browser
// never finished page.goto on Windows segmented capture.
describe.skipIf(!hasBrowser)("parallel worker browsers", () => {
  const MEDIA_ELEMENTS = 10;
  const openMedia = new Set<ServerResponse>();
  let origin = "";
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/media/")) {
      // Never finishes, like a long source still buffering.
      res.writeHead(200, { "Content-Type": "audio/mpeg" });
      res.write(Buffer.alloc(1024));
      openMedia.add(res);
      res.on("close", () => openMedia.delete(res));
      return;
    }
    const body =
      req.url === "/heavy"
        ? Array.from(
            { length: MEDIA_ELEMENTS },
            (_, i) => `<audio preload="auto" src="/media/${i}.mp3"></audio>`,
          ).join("")
        : "<p>worker</p>";
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<html><body>${body}</body></html>`);
  });

  beforeAll(async () => {
    origin = await listenOnLoopback(server);
  });

  afterAll(async () => {
    for (const res of openMedia) res.destroy();
    await drainBrowserPool();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("loads a second worker's page while the first page's media holds its connections", async () => {
    const config = {
      enableBrowserPool: !shouldDisableBrowserPoolForParallelWorker({ parallel: true }),
      forceScreenshot: true,
    };
    const args = [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--autoplay-policy=no-user-gesture-required",
    ];
    const first = await acquireBrowser(args, config);
    const second = await acquireBrowser(args, config);
    try {
      const heavy = await first.browser.newPage();
      await heavy.goto(`${origin}/heavy`);
      const deadline = Date.now() + 10_000;
      while (openMedia.size < 6 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(openMedia.size).toBeGreaterThanOrEqual(6);

      const page = await second.browser.newPage();
      await page.goto(`${origin}/worker`, { timeout: 20_000 });
      expect(await page.evaluate(() => document.body.textContent)).toBe("worker");
    } finally {
      await first.release();
      await second.release();
    }
  }, 45_000);
});
