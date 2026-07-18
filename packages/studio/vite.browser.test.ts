import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const browserMocks = vi.hoisted(() => {
  const newPage = vi.fn(async () => ({
    setViewport: vi.fn(async () => {}),
    goto: vi.fn(async () => {}),
    evaluate: vi.fn(async () => undefined),
    waitForFunction: vi.fn(async () => undefined),
    addScriptTag: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => Buffer.from("thumbnail")),
    close: vi.fn(async () => {}),
  }));
  const launch = vi.fn(async () => ({ connected: true, newPage }));
  return { launch, newPage };
});

vi.mock("puppeteer-core", () => ({ default: { launch: browserMocks.launch } }));

import { generateThumbnail, type GenerateThumbnailOptions } from "./vite.browser";

const originalExecutable = process.env.PUPPETEER_EXECUTABLE_PATH;

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
    process.env.PUPPETEER_EXECUTABLE_PATH = process.execPath;
  });

  beforeEach(() => {
    browserMocks.newPage.mockClear();
  });

  afterAll(() => {
    if (originalExecutable == null) delete process.env.PUPPETEER_EXECUTABLE_PATH;
    else process.env.PUPPETEER_EXECUTABLE_PATH = originalExecutable;
  });

  it("retries browser launch after a transient failure", async () => {
    browserMocks.launch.mockClear();
    browserMocks.launch.mockRejectedValueOnce(new Error("launch failed"));

    await expect(generateThumbnail(options())).rejects.toThrow("launch failed");
    await expect(generateThumbnail(options())).resolves.toEqual(Buffer.from("thumbnail"));
    expect(browserMocks.launch).toHaveBeenCalledTimes(2);
  });

  it("captures at the route-provided physical output size", async () => {
    await expect(generateThumbnail(options())).resolves.toEqual(Buffer.from("thumbnail"));
    const result = browserMocks.newPage.mock.results[0];
    if (!result) throw new Error("page was not created");
    const page = await result.value;

    expect(page.setViewport).toHaveBeenCalledWith({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 0.125,
    });
    expect(page.close).toHaveBeenCalledTimes(1);
  });

  it("lets the route own dedupe and closes browser work on cancellation", async () => {
    const controller = new AbortController();
    const cancelled = generateThumbnail(options(controller.signal));
    await vi.waitFor(() => expect(browserMocks.newPage).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(cancelled).resolves.toBeNull();
    const cancelledResult = browserMocks.newPage.mock.results[0];
    if (!cancelledResult) throw new Error("cancelled page was not created");
    expect((await cancelledResult.value).close).toHaveBeenCalled();

    browserMocks.newPage.mockClear();
    await Promise.all([generateThumbnail(options()), generateThumbnail(options())]);
    expect(browserMocks.newPage).toHaveBeenCalledTimes(2);
  });
});
