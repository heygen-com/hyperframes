import { afterEach, describe, expect, it, vi } from "vitest";
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
      subTimelineWaitMemo: {},
      scriptLoadFailures: [],
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
  describe("timeline wait", () => {
    afterEach(() => vi.useRealTimers());

    // Hosts "main" (registered) and "badge" (never registers); every other page call is ready.
    function makeVerificationSession(memo: { unregisteredIds?: string[] }, failures: string[]) {
      const host = (id: string) => ({
        hasAttribute: () => false,
        getAttribute: (name: string) => (name === "data-composition-id" ? id : null),
      });
      const document = { querySelectorAll: () => [host("main"), host("badge")] };
      const window = { __timelines: { main: {} } };
      const verificationPage = {
        evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
        setViewport: vi.fn().mockResolvedValue(undefined),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(async (expr: unknown) =>
          typeof expr === "string" && expr.includes("data-composition-id")
            ? new Function("document", "window", `return ${expr}`)(document, window)
            : true,
        ),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const session = {
        browser: { newPage: vi.fn().mockResolvedValue(verificationPage) },
        serverUrl: "http://127.0.0.1:3000",
        subTimelineWaitMemo: memo,
        scriptLoadFailures: failures,
        options: { width: 1920, height: 1080, format: "mp4", skipReadinessVideoIds: [] },
      } as unknown as CaptureSession;
      let settled = false;
      const created = createStaticVerificationPage(session).finally(() => (settled = true));
      return { created, settled: () => settled };
    }

    it("does not wait again for a host the render already timed out on", async () => {
      vi.useFakeTimers();
      const run = makeVerificationSession({ unregisteredIds: ["badge"] }, []);
      await vi.advanceTimersByTimeAsync(0);
      expect(run.settled()).toBe(true);
      await run.created;
    });

    it("stops after the script-failure grace instead of the full timeout", async () => {
      vi.useFakeTimers();
      const run = makeVerificationSession({}, ["http://127.0.0.1:3000/scene.js"]);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(run.settled()).toBe(false);
      await vi.advanceTimersByTimeAsync(500);
      expect(run.settled()).toBe(true);
      await run.created;
    });
  });
});
