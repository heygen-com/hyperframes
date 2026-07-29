import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const launch = vi.fn();
const originalBrowserPath = process.env["HYPERFRAMES_BROWSER_PATH"];

vi.mock("puppeteer-core", () => ({
  default: { launch },
}));

describe("generateThumbnail", () => {
  beforeEach(() => {
    process.env["HYPERFRAMES_BROWSER_PATH"] = process.execPath;
    launch.mockReset();
    launch.mockRejectedValue(new Error("browser launch failed"));
  });

  afterEach(() => {
    if (originalBrowserPath === undefined) {
      delete process.env["HYPERFRAMES_BROWSER_PATH"];
    } else {
      process.env["HYPERFRAMES_BROWSER_PATH"] = originalBrowserPath;
    }
  });

  it("contains browser launch failures and retries them on the next request", async () => {
    const { generateThumbnail } = await import("./vite.browser");
    const options = {
      project: { dir: "/tmp/hyperframes-thumbnail-test" },
      compPath: "index.html",
      seekTime: 0.5,
      previewUrl: "http://localhost/preview",
      width: 1920,
      height: 1080,
      format: "jpeg" as const,
    };

    await expect(generateThumbnail(options)).resolves.toBeNull();
    await expect(generateThumbnail({ ...options, seekTime: 1 })).resolves.toBeNull();

    expect(launch).toHaveBeenCalledTimes(2);
  });
});

describe("findSystemChrome", () => {
  it("uses the CLI browser override before legacy producer and system paths", async () => {
    const { findSystemChrome } = await import("./vite.browser");
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

  it("finds a standard Windows Chrome installation", async () => {
    const { findSystemChrome } = await import("./vite.browser");
    const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    const pathExists = vi.fn((path: string) => path === chromePath);

    expect(findSystemChrome({}, pathExists, "win32")).toBe(chromePath);
  });
});
