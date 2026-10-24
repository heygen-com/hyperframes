import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Browser, Page } from "puppeteer-core";
import { resolveHeadlessShellPath } from "./browserManager.js";
import { injectVideoFramesBatch } from "./screenshotService.js";
import { closeTestChrome, listenOnLoopback, launchTestChrome } from "./__fixtures__/loopback.js";

const chromePath = resolveHeadlessShellPath();
const hasBrowser = chromePath !== undefined && spawnSync(chromePath, ["--version"]).status === 0;

describe.skipIf(!hasBrowser)("video frame transport in Chrome", () => {
  let browser: Browser;
  let page: Page;
  let origin: string;
  let redPng: string;
  let blueJpeg: string;
  let unexpectedFrameRequests = 0;
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/slow")) return;
    if (req.url === "/external.png") {
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "max-age=600" });
      res.end(Buffer.from(redPng.split(",")[1] ?? "", "base64"));
      return;
    }
    if (req.url?.startsWith("/__hyperframes_video_frames__/")) unexpectedFrameRequests++;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      '<html><body><div style="position:relative;width:4px;height:4px"><video id="a" style="width:4px;height:4px"></video><video id="b" style="width:4px;height:4px"></video></div></body></html>',
    );
  });

  beforeAll(async () => {
    origin = await listenOnLoopback(server);
    browser = await launchTestChrome(chromePath);
  });
  beforeEach(async () => {
    if (page) await page.close();
    page = await browser.newPage();
    await page.goto(origin);
    [redPng, blueJpeg] = await Promise.all([
      frameDataUri("red"),
      frameDataUri("blue", "image/jpeg"),
    ]);
    unexpectedFrameRequests = 0;
  });
  afterAll(async () => {
    await closeTestChrome(browser);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const frameDataUri = (color: string, format = "image/png") =>
    page.evaluate(
      (fill, mime) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 4;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("No 2D context");
        ctx.fillStyle = fill;
        ctx.fillRect(0, 0, 4, 4);
        return canvas.toDataURL(mime, 1);
      },
      color,
      format,
    );

  const pixels = () =>
    page.evaluate(() => {
      const canvas = new OffscreenCanvas(4, 4);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No 2D context");
      return Array.from(
        document.querySelectorAll<HTMLImageElement>("img.__render_frame__"),
        (img) => {
          ctx.clearRect(0, 0, 4, 4);
          ctx.drawImage(img, 0, 0);
          return { src: img.src, rgba: Array.from(ctx.getImageData(0, 0, 1, 1).data) };
        },
      );
    });

  it("delivers independent decoded frames without retaining inline image URLs", async () => {
    const headers: string[] = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "image")
        headers.push(response.headers()["cache-control"] ?? "");
    });
    await injectVideoFramesBatch(page, [
      { videoId: "a", dataUri: redPng },
      { videoId: "b", dataUri: blueJpeg },
    ]);
    const first = await pixels();
    expect(first.map((img) => img.rgba)).toEqual([
      [255, 0, 0, 255],
      [0, 0, 254, 255],
    ]);
    expect(first.every((img) => img.src.startsWith(origin))).toBe(true);
    expect(headers).toEqual(["no-store", "no-store"]);
    await injectVideoFramesBatch(page, [{ videoId: "a", dataUri: blueJpeg }]);
    expect((await pixels())[0]?.rgba).toEqual([0, 0, 254, 255]);
    expect(await page.evaluate(async (url) => (await fetch(url)).status, first[0]?.src ?? "")).toBe(
      404,
    );
    expect(unexpectedFrameRequests).toBe(0);
  });

  it("publishes a replacement only after its full-resolution decode completes", async () => {
    await injectVideoFramesBatch(page, [{ videoId: "a", dataUri: blueJpeg }]);
    await page.addStyleTag({ content: ".__render_frame__ { visibility: visible !important }" });
    await page.evaluate(() => {
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = async function () {
        document.documentElement.setAttribute("data-decode-pending", "1");
        await new Promise<void>((resolve) =>
          window.addEventListener("release-frame-decode", () => resolve(), { once: true }),
        );
        await decode.call(this);
      };
    });
    const injection = injectVideoFramesBatch(page, [{ videoId: "a", dataUri: redPng }]);
    try {
      await page.waitForSelector('[data-decode-pending="1"]');
      const visibility = await page.evaluate(() => {
        const img = document.querySelector<HTMLImageElement>("img.__render_frame__");
        if (!img) throw new Error("No replacement frame");
        return getComputedStyle(img).visibility;
      });
      expect(visibility).toBe("hidden");
    } finally {
      await page.evaluate(() => window.dispatchEvent(new Event("release-frame-decode")));
      await injection;
    }
    expect((await pixels())[0]?.rgba).toEqual([255, 0, 0, 255]);
    expect(
      await page.evaluate(() => {
        const img = document.querySelector("img");
        if (!img) throw new Error("No replacement frame");
        return getComputedStyle(img).visibility;
      }),
    ).toBe("visible");
  });

  it("loads frames even while all same-origin download connections are busy", async () => {
    await page.evaluate(() => {
      for (let i = 0; i < 6; i++) void fetch(`/slow${i}.mp4`);
    });
    await injectVideoFramesBatch(page, [{ videoId: "a", dataUri: redPng }]);
    expect((await pixels())[0]?.rgba).toEqual([255, 0, 0, 255]);
  }, 5000);

  it.each(["HTTP", "about:blank"])(
    "preserves PNG alpha and GPU uploads from %s",
    async (source) => {
      if (source === "about:blank") {
        const content = await page.content();
        await page.close();
        page = await browser.newPage();
        await page.setContent(content);
        expect(page.url()).toBe("about:blank");
      }
      const translucent = await frameDataUri("rgba(255,0,0,0.5)");
      await injectVideoFramesBatch(page, [{ videoId: "a", dataUri: translucent }]);
      expect((await pixels())[0]?.rgba).toEqual([255, 0, 0, 128]);
      expect(
        await page.evaluate(() => {
          const canvas = document.createElement("canvas");
          const gl = canvas.getContext("webgl");
          const img = document.querySelector("img");
          if (!gl || !img) throw new Error("No GPU texture source");
          gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          return gl.getError();
        }),
      ).toBe(0);
    },
  );

  it("releases failed frames and preserves the video-specific decode error", async () => {
    await expect(
      injectVideoFramesBatch(page, [{ videoId: "a", dataUri: "data:image/png;base64,AAAA" }]),
    ).rejects.toThrow('Video frame for "a" failed to load (inline frame)');
    const src = await page.evaluate(() => document.querySelector("img")?.src ?? "");
    expect(await page.evaluate(async (url) => (await fetch(url)).status, src)).toBe(404);
  });

  it("keeps caller-provided frame URLs unchanged", async () => {
    const src = `${origin}/external.png`;
    await injectVideoFramesBatch(page, [{ videoId: "a", dataUri: src }]);
    expect((await pixels())[0]).toEqual({ src, rgba: [255, 0, 0, 255] });
  });
});
