import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimeoutError, type Page } from "puppeteer-core";
import {
  gotoWhenSent,
  isNavigationTimeoutError,
  navigateForCapture,
  networkIdleAttemptTimeoutMs,
  NETWORK_IDLE_ATTEMPT_MS,
} from "./navigateForCapture.js";

describe("networkIdleAttemptTimeoutMs", () => {
  it("caps at the network-idle attempt budget", () => {
    expect(networkIdleAttemptTimeoutMs(120_000)).toBe(NETWORK_IDLE_ATTEMPT_MS);
  });

  it("honors a caller timeout below the attempt budget", () => {
    expect(networkIdleAttemptTimeoutMs(10_000)).toBe(10_000);
  });
});

describe("isNavigationTimeoutError", () => {
  it("matches Puppeteer TimeoutError navigation timeouts", () => {
    expect(
      isNavigationTimeoutError(new TimeoutError("Navigation timeout of 30000 ms exceeded")),
    ).toBe(true);
  });

  it("ignores unrelated failures", () => {
    expect(isNavigationTimeoutError(new Error("net::ERR_NAME_NOT_RESOLVED"))).toBe(false);
  });
});

describe("navigateForCapture", () => {
  it("returns after networkidle2 when the page settles", async () => {
    const response = { status: () => 200 };
    const goto = vi.fn().mockResolvedValue(response);
    const result = await navigateForCapture({ goto }, "https://example.com", 120_000);

    expect(result).toEqual({
      response,
      waitUntil: "networkidle2",
      networkIdleTimeoutMs: NETWORK_IDLE_ATTEMPT_MS,
      fellBackFromNetworkIdle: false,
    });
    expect(goto).toHaveBeenCalledTimes(1);
    expect(goto).toHaveBeenCalledWith("https://example.com", {
      waitUntil: "networkidle2",
      timeout: NETWORK_IDLE_ATTEMPT_MS,
    });
  });

  it("falls back to domcontentloaded after a networkidle2 navigation timeout", async () => {
    const response = { status: () => 200 };
    const goto = vi
      .fn()
      .mockRejectedValueOnce(new TimeoutError("Navigation timeout of 30000 ms exceeded"))
      .mockResolvedValueOnce(response);

    const result = await navigateForCapture({ goto }, "https://www.yahoo.com/", 120_000);

    expect(result).toEqual({
      response,
      waitUntil: "domcontentloaded",
      networkIdleTimeoutMs: NETWORK_IDLE_ATTEMPT_MS,
      fellBackFromNetworkIdle: true,
    });
    expect(goto).toHaveBeenNthCalledWith(1, "https://www.yahoo.com/", {
      waitUntil: "networkidle2",
      timeout: NETWORK_IDLE_ATTEMPT_MS,
    });
    expect(goto).toHaveBeenNthCalledWith(2, "https://www.yahoo.com/", {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
  });

  it.each([
    { totalTimeoutMs: 31_000, fallbackTimeoutMs: 1_000 },
    { totalTimeoutMs: 45_000, fallbackTimeoutMs: 15_000 },
  ])(
    "uses only the remaining budget for fallback when totalTimeoutMs=$totalTimeoutMs",
    async ({ totalTimeoutMs, fallbackTimeoutMs }) => {
      const response = { status: () => 200 };
      const goto = vi
        .fn()
        .mockRejectedValueOnce(new TimeoutError("Navigation timeout of 30000 ms exceeded"))
        .mockResolvedValueOnce(response);

      await navigateForCapture({ goto }, "https://www.yahoo.com/", totalTimeoutMs);

      expect(goto).toHaveBeenNthCalledWith(1, "https://www.yahoo.com/", {
        waitUntil: "networkidle2",
        timeout: NETWORK_IDLE_ATTEMPT_MS,
      });
      expect(goto).toHaveBeenNthCalledWith(2, "https://www.yahoo.com/", {
        waitUntil: "domcontentloaded",
        timeout: fallbackTimeoutMs,
      });
    },
  );

  it("does not fall back for non-timeout navigation errors", async () => {
    const err = new Error("net::ERR_CONNECTION_REFUSED");
    const goto = vi.fn().mockRejectedValue(err);

    await expect(navigateForCapture({ goto }, "https://example.com", 120_000)).rejects.toBe(err);
    expect(goto).toHaveBeenCalledTimes(1);
  });

  it("does not fall back when the caller timeout already equals the idle attempt", async () => {
    const err = new TimeoutError("Navigation timeout of 10000 ms exceeded");
    const goto = vi.fn().mockRejectedValue(err);

    await expect(navigateForCapture({ goto }, "https://example.com", 10_000)).rejects.toBe(err);
    expect(goto).toHaveBeenCalledWith("https://example.com", {
      waitUntil: "networkidle2",
      timeout: 10_000,
    });
  });
});

/** A page whose goto keeps Puppeteer's contract: a non-zero timeout rejects the navigation. */
function fakeChromePage() {
  const session = Object.assign(new EventEmitter(), {
    send: async () => undefined,
    detach: vi.fn(async () => undefined),
  });
  let load: (response: unknown) => void = () => undefined;
  const page = {
    createCDPSession: async () => session,
    goto: (_url: string, { timeout }: { timeout: number }) =>
      new Promise((resolve, reject) => {
        load = resolve;
        if (timeout > 0) {
          setTimeout(
            () => reject(new TimeoutError(`Navigation timeout of ${timeout} ms exceeded`)),
            timeout,
          );
        }
      }),
  } as unknown as Page;
  return {
    page,
    session,
    navigate: () =>
      session.emit("Network.requestWillBeSent", {
        requestId: "doc",
        type: "Document",
        request: { url: "http://127.0.0.1:1/" },
      }),
    request: (requestId: string, type: string, url: string) =>
      session.emit("Network.requestWillBeSent", { requestId, type, request: { url } }),
    finish: (requestId: string) => session.emit("Network.loadingFinished", { requestId }),
    send: () => session.emit("Network.requestWillBeSentExtraInfo", { requestId: "doc" }),
    load: (response: unknown) => load(response),
  };
}

describe("gotoWhenSent", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives the page its whole budget after a cold Chrome is slow to send the request", async () => {
    vi.useFakeTimers();
    const chrome = fakeChromePage();
    const response = { status: () => 200 };
    const opened = gotoWhenSent(chrome.page, "http://127.0.0.1:1/", 10_000);
    await vi.advanceTimersByTimeAsync(0);
    chrome.navigate();
    await vi.advanceTimersByTimeAsync(25_000);
    chrome.send();
    await vi.advanceTimersByTimeAsync(9_000);
    chrome.load(response);
    await expect(opened).resolves.toBe(response);
    expect(chrome.session.detach).toHaveBeenCalledOnce();
  });

  it("fails as a navigation timeout when Chrome never sends the request", async () => {
    vi.useFakeTimers();
    const chrome = fakeChromePage();
    const opened = gotoWhenSent(chrome.page, "http://127.0.0.1:1/", 10_000);
    const failed = expect(opened).rejects.toSatisfy(
      (error: unknown) =>
        isNavigationTimeoutError(error) &&
        String(error).includes("did not send the page request within 30000 ms"),
    );
    await vi.advanceTimersByTimeAsync(0);
    chrome.navigate();
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
  });

  it("fails when the page does not load within its budget after the request is sent", async () => {
    vi.useFakeTimers();
    const chrome = fakeChromePage();
    const opened = gotoWhenSent(chrome.page, "http://127.0.0.1:1/", 10_000);
    const failed = expect(opened).rejects.toThrow("Navigation timeout of 10000 ms exceeded");
    await vi.advanceTimersByTimeAsync(0);
    chrome.send();
    chrome.navigate();
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
  });

  it.each([
    [
      "names the other server's script it is still waiting on",
      "https://cdn.example/gsap.min.js",
      "https://cdn.example/gsap.min.js",
      true,
    ],
    [
      "names a stalled script of its own without advising to move it",
      "http://127.0.0.1:1/app.js",
      "http://127.0.0.1:1/app.js",
      false,
    ],
    [
      "keeps a signed URL's secrets out of the message for another server's script",
      "https://user:SECRET@cdn.example/gsap.min.js?sig=SECRET#SECRET",
      "https://cdn.example/gsap.min.js?…",
      true,
    ],
    [
      "keeps a signed URL's secrets out of the message for a script of its own",
      "http://127.0.0.1:1/app.js?token=SECRET",
      "http://127.0.0.1:1/app.js?…",
      false,
    ],
  ])("%s", async (_name, script, shown, advises) => {
    vi.useFakeTimers();
    const chrome = fakeChromePage();
    const opened = gotoWhenSent(chrome.page, "http://127.0.0.1:1/", 10_000);
    const failed = expect(opened).rejects.toSatisfy((error: unknown) => {
      const message = String(error);
      return (
        isNavigationTimeoutError(error) &&
        message.includes(`while the page was still loading ${shown}.`) &&
        !message.includes("SECRET") &&
        !message.includes("styles.css") &&
        message.includes("from another server") === advises
      );
    });
    await vi.advanceTimersByTimeAsync(0);
    chrome.navigate();
    chrome.send();
    chrome.request("css", "Stylesheet", "http://127.0.0.1:1/styles.css");
    chrome.request("js", "Script", script);
    chrome.finish("doc");
    chrome.finish("css");
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
  });
});
