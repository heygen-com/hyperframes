import { describe, expect, it, vi } from "vitest";
import { createStaticVerificationPage, type CaptureSession } from "./frameCapture.js";

describe("createStaticVerificationPage background", () => {
  function makeSession(options: Record<string, unknown>) {
    const send = vi.fn().mockResolvedValue(undefined);
    const verificationPage = {
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
      setViewport: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(true),
      createCDPSession: vi.fn().mockResolvedValue({ send }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const session = {
      browser: { newPage: vi.fn().mockResolvedValue(verificationPage) },
      page: {},
      serverUrl: "http://127.0.0.1:3000",
      subTimelineWaitMemo: {},
      scriptLoadFailures: [],
      options: {
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
        skipReadinessVideoIds: [],
        ...options,
      },
    } as unknown as CaptureSession;
    return { session, send };
  }

  const clearsBackground = (send: ReturnType<typeof vi.fn>) =>
    send.mock.calls.some(([method]) => method === "Emulation.setDefaultBackgroundColorOverride");

  it("clears the background for transparent PNG capture so verification matches capture", async () => {
    const { session, send } = makeSession({ format: "png" });
    await createStaticVerificationPage(session);
    expect(clearsBackground(send)).toBe(true);
  });

  it("keeps the page background for lossless opaque PNG capture", async () => {
    const { session, send } = makeSession({ format: "png", transparent: false });
    await createStaticVerificationPage(session);
    expect(clearsBackground(send)).toBe(false);
  });
});
