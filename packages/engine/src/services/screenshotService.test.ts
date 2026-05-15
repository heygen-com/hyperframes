// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { parseHTML } from "linkedom";
import { type Page } from "puppeteer-core";
import {
  pageScreenshotCapture,
  cdpSessionCache,
  injectVideoFramesBatch,
} from "./screenshotService.js";

// Stub a Page + CDPSession just enough that pageScreenshotCapture can call
// `client.send("Page.captureScreenshot", ...)` and we can inspect the args.
function makeFakePageWithCdp(send: (method: string, params: object) => Promise<{ data: string }>) {
  const fakeSession = { send } as unknown as import("puppeteer-core").CDPSession;
  // Stub a Page object — the WeakMap cache is the only Page-thing used in the
  // path under test, so we can pre-seed it and skip page.createCDPSession().
  const fakePage = {} as Page;
  cdpSessionCache.set(fakePage, fakeSession);
  return fakePage;
}

describe("pageScreenshotCapture supersample plumbing", () => {
  // Minimal 1×1 transparent PNG, base64. The function returns Buffer.from(data, "base64")
  // and we never inspect the bytes — only the params we pass to client.send.
  const ONE_PIXEL_PNG_B64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

  it("passes `clip` with scale 1 when deviceScaleFactor is undefined (default 1)", async () => {
    const send = vi.fn().mockResolvedValue({ data: ONE_PIXEL_PNG_B64 });
    const page = makeFakePageWithCdp(send);

    await pageScreenshotCapture(page, {
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      format: "jpeg",
      quality: 80,
    });

    expect(send).toHaveBeenCalledWith(
      "Page.captureScreenshot",
      expect.objectContaining({
        clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
      }),
    );
  });

  it("passes `clip` with scale 1 when deviceScaleFactor is exactly 1", async () => {
    const send = vi.fn().mockResolvedValue({ data: ONE_PIXEL_PNG_B64 });
    const page = makeFakePageWithCdp(send);

    await pageScreenshotCapture(page, {
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      format: "jpeg",
      deviceScaleFactor: 1,
    });

    const params = send.mock.calls[0]?.[1] as { clip?: { scale: number } };
    expect(params.clip).toEqual({ x: 0, y: 0, width: 1920, height: 1080, scale: 1 });
  });

  it("passes `clip` with `scale = dpr` when deviceScaleFactor > 1 (the supersample contract)", async () => {
    const send = vi.fn().mockResolvedValue({ data: ONE_PIXEL_PNG_B64 });
    const page = makeFakePageWithCdp(send);

    await pageScreenshotCapture(page, {
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      format: "jpeg",
      deviceScaleFactor: 2,
    });

    expect(send).toHaveBeenCalledWith(
      "Page.captureScreenshot",
      expect.objectContaining({
        clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 2 },
      }),
    );
  });

  it("propagates a non-2 supersample factor (e.g. 720p → 4K = 3×)", async () => {
    const send = vi.fn().mockResolvedValue({ data: ONE_PIXEL_PNG_B64 });
    const page = makeFakePageWithCdp(send);

    await pageScreenshotCapture(page, {
      width: 1280,
      height: 720,
      fps: { num: 30, den: 1 },
      format: "jpeg",
      deviceScaleFactor: 3,
    });

    const params = send.mock.calls[0]?.[1] as { clip?: { scale: number } };
    expect(params.clip?.scale).toBe(3);
  });
});

describe("injectVideoFramesBatch replacement layout", () => {
  it("does not copy opposing inset constraints onto the injected frame image", async () => {
    const { window, document } = parseHTML(
      '<html><body><div id="root"><video id="clip" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video></div></body></html>',
    );

    Object.defineProperty(window.HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: () => Promise.resolve(),
    });

    const video = document.getElementById("clip") as HTMLVideoElement;
    Object.defineProperties(video, {
      offsetLeft: { configurable: true, get: () => 0 },
      offsetTop: { configurable: true, get: () => 0 },
      offsetWidth: { configurable: true, get: () => 1920 },
      offsetHeight: { configurable: true, get: () => 1080 },
    });
    video.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 1920,
        bottom: 1080,
        width: 1920,
        height: 1080,
        toJSON: () => ({}),
      }) as DOMRect;

    const computedStyle = document.createElement("div").style;
    computedStyle.position = "absolute";
    computedStyle.width = "1920px";
    computedStyle.height = "1080px";
    computedStyle.top = "0px";
    computedStyle.left = "0px";
    computedStyle.right = "0px";
    computedStyle.bottom = "0px";
    computedStyle.inset = "0px";
    computedStyle.objectFit = "cover";
    computedStyle.objectPosition = "center center";
    computedStyle.zIndex = "3";
    computedStyle.opacity = "1";
    Object.defineProperty(window, "getComputedStyle", {
      configurable: true,
      value: () => computedStyle,
    });

    const globals = globalThis as unknown as {
      window?: typeof window;
      document?: Document;
    };
    const previousWindow = globals.window;
    const previousDocument = globals.document;
    globals.window = window;
    globals.document = document;
    try {
      const page = {
        evaluate: async (
          fn: (
            updates: Array<{ videoId: string; dataUri: string }>,
            visualProperties: string[],
          ) => Promise<void>,
          updates: Array<{ videoId: string; dataUri: string }>,
          visualProperties: string[],
        ) => fn(updates, visualProperties),
      } as unknown as Page;

      await injectVideoFramesBatch(page, [
        {
          videoId: "clip",
          dataUri:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
        },
      ]);
    } finally {
      globals.window = previousWindow;
      globals.document = previousDocument;
    }

    const img = video.nextElementSibling as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.style.position).toBe("absolute");
    expect(img?.style.left).toBe("0px");
    expect(img?.style.top).toBe("0px");
    expect(img?.style.width).toBe("1920px");
    expect(img?.style.height).toBe("1080px");
    expect(img?.style.right).toBe("auto");
    expect(img?.style.bottom).toBe("auto");
    expect(img?.style.inset).toBe("auto");
  });
});
