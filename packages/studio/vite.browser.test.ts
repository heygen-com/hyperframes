import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const browserMocks = vi.hoisted(() => {
  const page = {
    setViewport: vi.fn(async () => {}),
    goto: vi.fn(async () => {}),
    evaluate: vi.fn(async () => undefined),
    waitForFunction: vi.fn(async () => undefined),
    addScriptTag: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => Buffer.from("thumbnail")),
    close: vi.fn(async () => {}),
  };
  const newPage = vi.fn(async () => page);
  const sharedBrowser = { connected: true, newPage };
  const launch = vi.fn(async () => sharedBrowser);
  return { launch, newPage, page, sharedBrowser };
});

vi.mock("puppeteer-core", () => ({ default: { launch: browserMocks.launch } }));

import { findSystemChrome, generateThumbnail, type GenerateThumbnailOptions } from "./vite.browser";

const originalBrowserPath = process.env["HYPERFRAMES_BROWSER_PATH"];

function options(signal = new AbortController().signal): GenerateThumbnailOptions {
  return {
    project: { dir: process.cwd() },
    compPath: "index.html",
    seekTime: 1,
    previewUrl: "http://localhost/preview",
    width: 1920,
    height: 1080,
    outputWidth: 240,
    outputHeight: 135,
    format: "jpeg",
    signal,
  };
}

describe("generateThumbnail", () => {
  beforeAll(() => {
    process.env["HYPERFRAMES_BROWSER_PATH"] = process.execPath;
  });

  beforeEach(() => {
    browserMocks.launch.mockReset().mockResolvedValue(browserMocks.sharedBrowser);
    browserMocks.newPage.mockClear();
    for (const mock of Object.values(browserMocks.page)) mock.mockClear();
  });

  afterAll(() => {
    if (originalBrowserPath === undefined) delete process.env["HYPERFRAMES_BROWSER_PATH"];
    else process.env["HYPERFRAMES_BROWSER_PATH"] = originalBrowserPath;
  });

  it("contains a transient browser launch failure and retries the next request", async () => {
    browserMocks.launch.mockRejectedValueOnce(new Error("launch failed"));

    await expect(generateThumbnail(options())).resolves.toBeNull();
    await expect(generateThumbnail(options())).resolves.toEqual(Buffer.from("thumbnail"));
    expect(browserMocks.launch).toHaveBeenCalledTimes(2);
  });

  it("captures at the route-provided physical output size", async () => {
    await expect(generateThumbnail(options())).resolves.toEqual(Buffer.from("thumbnail"));

    expect(browserMocks.page.setViewport).toHaveBeenCalledWith({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 0.125,
    });
    expect(browserMocks.page.close).toHaveBeenCalledTimes(1);
  });

  it("lets the route own dedupe and closes browser work on cancellation", async () => {
    const controller = new AbortController();
    const cancelled = generateThumbnail(options(controller.signal));
    await vi.waitFor(() => expect(browserMocks.newPage).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(cancelled).resolves.toBeNull();
    expect(browserMocks.page.close).toHaveBeenCalled();

    browserMocks.newPage.mockClear();
    await Promise.all([generateThumbnail(options()), generateThumbnail(options())]);
    expect(browserMocks.newPage).toHaveBeenCalledTimes(2);
  });

  it("contains a canceled screenshot without crashing the dev server", async () => {
    const controller = new AbortController();
    let rejectScreenshot: ((reason: Error) => void) | undefined;
    browserMocks.page.screenshot.mockImplementationOnce(
      () =>
        new Promise<Buffer>((_resolve, reject) => {
          rejectScreenshot = reject;
        }),
    );
    browserMocks.page.close.mockImplementationOnce(async () => {
      rejectScreenshot?.(new Error("Target closed"));
    });

    const thumbnail = generateThumbnail(options(controller.signal));
    const result = expect(thumbnail).resolves.toBeNull();
    await vi.waitFor(() => expect(browserMocks.page.screenshot).toHaveBeenCalledTimes(1));
    controller.abort();

    await result;
  });
});

describe("findSystemChrome", () => {
  it("uses the CLI browser override before legacy producer and system paths", () => {
    const pathExists = vi.fn(() => true);

    expect(
      findSystemChrome(
        {
          HYPERFRAMES_BROWSER_PATH: "/custom/browser",
          PRODUCER_HEADLESS_SHELL_PATH: "/legacy/browser",
        },
        pathExists,
      ),
    ).toBe("/custom/browser");
    expect(pathExists).toHaveBeenCalledTimes(1);
  });

  it("finds a standard Windows Chrome installation", () => {
    const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    const pathExists = vi.fn((path: string) => path === chromePath);

    expect(findSystemChrome({}, pathExists, "win32")).toBe(chromePath);
  });
});
