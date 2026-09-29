import { describe, expect, it, vi } from "vitest";
import { createStaticVerificationPage, type CaptureSession } from "./frameCapture.js";

describe("createStaticVerificationPage", () => {
  it("uses a fresh, ready page so verification seeks cannot affect capture", async () => {
    const verificationPage = {
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
      setViewport: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(true),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const session = {
      browser: { newPage: vi.fn().mockResolvedValue(verificationPage) },
      page: {},
      serverUrl: "http://127.0.0.1:3000",
      options: {
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
        format: "mp4",
        skipReadinessVideoIds: [],
      },
    } as unknown as CaptureSession;

    await expect(createStaticVerificationPage(session)).resolves.toBe(verificationPage);

    expect(session.browser.newPage).toHaveBeenCalledOnce();
    expect(verificationPage.goto).toHaveBeenCalledWith("http://127.0.0.1:3000/index.html", {
      waitUntil: "domcontentloaded",
      timeout: expect.any(Number),
    });
    expect(verificationPage.close).not.toHaveBeenCalled();
  });

  it("closes a failed verification page before static dedup fails closed", async () => {
    const verificationPage = {
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
      setViewport: vi.fn().mockRejectedValue(new Error("viewport failed")),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const session = {
      browser: { newPage: vi.fn().mockResolvedValue(verificationPage) },
      serverUrl: "http://127.0.0.1:3000",
      options: { width: 1920, height: 1080, format: "mp4" },
    } as unknown as CaptureSession;

    await expect(createStaticVerificationPage(session)).rejects.toThrow("viewport failed");
    expect(verificationPage.close).toHaveBeenCalledOnce();
  });
});
