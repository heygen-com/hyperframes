import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";

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
  const sharedBrowser = { connected: true as boolean, newPage };
  const launch = vi.fn(async () => sharedBrowser);
  const versionProbe = vi.fn(() => "150.0.0.0");
  return { launch, newPage, page, sharedBrowser, versionProbe };
});

vi.mock("puppeteer-core", () => ({ default: { launch: browserMocks.launch } }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFileSync: browserMocks.versionProbe,
}));

import { findSystemChrome, generateThumbnail, type GenerateThumbnailOptions } from "./vite.browser";

const originalBrowserPath = process.env["HYPERFRAMES_BROWSER_PATH"];

const controllers: AbortController[] = [];

function options(signal = trackedSignal()): GenerateThumbnailOptions {
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

function trackedSignal(): AbortSignal {
  const controller = new AbortController();
  controllers.push(controller);
  return controller.signal;
}

describe("generateThumbnail", () => {
  beforeAll(async () => {
    process.env["HYPERFRAMES_BROWSER_PATH"] = process.execPath;
    // generateThumbnail loads puppeteer lazily; the first load is slow on a cold Windows runner.
    await import("puppeteer-core");
  }, 60_000);

  beforeEach(() => {
    browserMocks.launch.mockReset().mockResolvedValue(browserMocks.sharedBrowser);
    browserMocks.newPage.mockClear();
    browserMocks.versionProbe.mockClear();
    for (const mock of Object.values(browserMocks.page)) mock.mockClear();
  });

  afterEach(() => {
    // Cancel any request a timed-out test left running, so it cannot close pages in the next test.
    for (const controller of controllers.splice(0)) controller.abort();
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

  it("blocks on the browser's version only to word a failure, and only once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // An earlier test's browser would skip the launch.
    browserMocks.sharedBrowser.connected = false;
    browserMocks.launch.mockImplementationOnce(async () => {
      browserMocks.sharedBrowser.connected = true;
      return browserMocks.sharedBrowser;
    });

    await expect(generateThumbnail(options())).resolves.toEqual(Buffer.from("thumbnail"));
    expect(browserMocks.launch).toHaveBeenCalledTimes(1);
    expect(browserMocks.versionProbe).not.toHaveBeenCalled();

    browserMocks.page.goto.mockRejectedValueOnce(new Error("page failed"));
    browserMocks.page.goto.mockRejectedValueOnce(new Error("page failed again"));
    await generateThumbnail(options());
    await generateThumbnail(options());
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("150.0.0.0"), "page failed again");
    expect(browserMocks.versionProbe).toHaveBeenCalledTimes(1);
    warn.mockRestore();
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

    expect(findSystemChrome({}, pathExists, "win32", () => "Chrome/140.0.1")).toBe(chromePath);
  });

  it("prefers the newest Puppeteer cache entry over a compatible system Chrome", () => {
    const cachePath = join(
      "/tmp/puppeteer",
      "chrome",
      "chrome-152.0.1",
      "chrome-linux64",
      "chrome",
    );
    const systemPath = "/usr/bin/google-chrome";
    const pathExists = vi.fn((path: string) => path === cachePath || path === systemPath);

    expect(
      findSystemChrome(
        { PUPPETEER_CACHE_DIR: "/tmp/puppeteer" },
        pathExists,
        "linux",
        () => "Chrome/113.0.1",
        () => ["chrome-152.0.1"],
      ),
    ).toBe(cachePath);
  });

  it("uses Puppeteer's Windows cache executable layout", () => {
    const cachePath = join(
      "C:\\puppeteer",
      "chrome",
      "chrome-152.0.1",
      "chrome-win64",
      "chrome.exe",
    );
    const pathExists = vi.fn((path: string) => path === cachePath);

    expect(
      findSystemChrome(
        { PUPPETEER_CACHE_DIR: "C:\\puppeteer" },
        pathExists,
        "win32",
        () => "Chrome/113.0.1",
        () => ["chrome-152.0.1"],
      ),
    ).toBe(cachePath);
  });

  it("rejects a system Chrome older than the Puppeteer-supported major", () => {
    const systemPath = "/usr/bin/google-chrome";
    const pathExists = vi.fn((path: string) => path === systemPath);

    expect(
      findSystemChrome(
        {},
        pathExists,
        "linux",
        () => "Google Chrome 113.0.1",
        () => [],
      ),
    ).toBe(undefined);
  });
});
