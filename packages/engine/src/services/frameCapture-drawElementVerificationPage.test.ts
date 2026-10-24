import { runInNewContext } from "node:vm";
import { MEDIA_RENDER_ID_ATTR } from "@hyperframes/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureDeVerificationFrames, type CaptureSession } from "./frameCapture.js";
import { pageScreenshotCapture } from "./screenshotService.js";

vi.mock("./screenshotService.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./screenshotService.js")>()),
  pageScreenshotCapture: vi.fn().mockResolvedValue(Buffer.from("frame")),
}));

function makePage() {
  const seek = vi.fn();
  const context = {
    window: { __hf: { duration: 100, seek } },
    document: { querySelectorAll: () => [], querySelector: () => null, images: [] },
    __name: <T>(fn: T) => fn,
  };
  return {
    seek,
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    setViewport: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(
      async (callback: string | ((...args: unknown[]) => unknown), ...args: unknown[]) =>
        typeof callback === "string"
          ? true
          : runInNewContext(`(${callback.toString()})(...args)`, { ...context, args }),
    ),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSession() {
  const capturePage = makePage();
  const verificationPage = makePage();
  const onBeforeCapture = vi.fn().mockResolvedValue(undefined);
  const browser = { newPage: vi.fn().mockResolvedValue(verificationPage) };
  // The page boundary is mocked; evaluate executes the actual browser callbacks in separate contexts.
  const session = {
    browser,
    page: capturePage,
    serverUrl: "http://127.0.0.1:3000",
    subTimelineWaitMemo: {},
    scriptLoadFailures: [],
    onBeforeCapture,
    options: {
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      format: "jpeg",
      compositionDurationSeconds: 100,
      deVerifySamples: 2,
    },
  } as unknown as CaptureSession;
  return { session, capturePage, verificationPage, browser, onBeforeCapture };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(pageScreenshotCapture).mockReset().mockResolvedValue(Buffer.from("frame"));
});

describe("drawElement verification page", () => {
  it("captures ground truth without seeking or injecting into the live animation", async () => {
    const { session, capturePage, verificationPage, browser, onBeforeCapture } = makeSession();
    await expect(captureDeVerificationFrames(session, session.page, vi.fn())).resolves.toBe(true);

    expect(capturePage.seek).not.toHaveBeenCalled();
    expect(browser.newPage).toHaveBeenCalledOnce();
    expect(verificationPage.seek.mock.calls.map(([time]) => time)).toEqual([0, 50, 95]);
    expect(onBeforeCapture.mock.calls).toEqual([
      [verificationPage, 50],
      [verificationPage, 95],
    ]);
    expect(
      vi.mocked(pageScreenshotCapture).mock.calls.every(([page]) => page === verificationPage),
    ).toBe(true);
    expect([...(session.deVerifyFrames?.keys() ?? [])]).toEqual([1500, 2850]);
    expect(verificationPage.close).toHaveBeenCalledOnce();
    expect(capturePage.close).not.toHaveBeenCalled();
  });

  it("closes the verification page and propagates a capture failure", async () => {
    const { session, capturePage, verificationPage } = makeSession();
    vi.mocked(pageScreenshotCapture).mockRejectedValueOnce(new Error("screenshot failed"));

    await expect(captureDeVerificationFrames(session, session.page, vi.fn())).rejects.toThrow(
      "screenshot failed",
    );
    expect(verificationPage.close).toHaveBeenCalledOnce();
    expect(capturePage.seek).not.toHaveBeenCalled();
    expect(session.deVerifyFrames).toBeUndefined();
  });

  it("closes the verification page if video injection fails", async () => {
    const { session, capturePage, verificationPage, onBeforeCapture } = makeSession();
    onBeforeCapture.mockRejectedValueOnce(new Error("injection failed"));

    await expect(captureDeVerificationFrames(session, session.page, vi.fn())).rejects.toThrow(
      "injection failed",
    );
    expect(verificationPage.close).toHaveBeenCalledOnce();
    expect(capturePage.seek).not.toHaveBeenCalled();
    expect(session.deVerifyFrames).toBeUndefined();
  });

  it("installs the media render-id resolvers on the verification page", async () => {
    const { session, verificationPage } = makeSession();
    await captureDeVerificationFrames(session, session.page, vi.fn());
    expect(verificationPage.evaluateOnNewDocument).toHaveBeenCalledWith(
      expect.any(Function),
      MEDIA_RENDER_ID_ATTR,
    );
  });

  it("reports a verification page that fails to load instead of throwing", async () => {
    const { session, capturePage, verificationPage } = makeSession();
    verificationPage.goto.mockRejectedValueOnce(new Error("Navigation timeout"));

    await expect(captureDeVerificationFrames(session, session.page, vi.fn())).resolves.toBe(false);
    expect(verificationPage.close).toHaveBeenCalledOnce();
    expect(capturePage.seek).not.toHaveBeenCalled();
    expect(session.deVerifyFrames).toBeUndefined();
  });

  it("does not allocate a page when verification is disabled", async () => {
    vi.stubEnv("HF_DE_VERIFY", "0");
    const { session, browser } = makeSession();
    await captureDeVerificationFrames(session, session.page, vi.fn());
    expect(browser.newPage).not.toHaveBeenCalled();
    expect(pageScreenshotCapture).not.toHaveBeenCalled();
  });
});
