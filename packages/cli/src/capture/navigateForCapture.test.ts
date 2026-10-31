import { gsapCdnDist } from "@hyperframes/core/gsap-cdn";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimeoutError, type Page } from "puppeteer-core";
import {
  gotoWhenSent,
  explainProxyRefusal,
  isNavigationTimeoutError,
  navigateForCapture,
  networkIdleAttemptTimeoutMs,
  settleAcrossNavigation,
  waitForPageReady,
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

describe("waitForPageReady", () => {
  it("pays one idle wait when the document is already parsed", async () => {
    const waitForNetworkIdle = vi.fn(async () => undefined);
    const evaluate = vi.fn(async () => false);

    await waitForPageReady({ waitForNetworkIdle, evaluate });

    // concurrency: 2 — the networkidle2 semantic navigation already uses, so
    // a single held-open request cannot block the wait until timeout.
    expect(waitForNetworkIdle).toHaveBeenCalledTimes(1);
    expect(waitForNetworkIdle).toHaveBeenCalledWith(expect.objectContaining({ concurrency: 2 }));
  });

  it("re-waits for idle once a still-parsing document finishes loading", async () => {
    const waitForNetworkIdle = vi.fn(async () => undefined);
    let loading = true;
    const evaluate = vi.fn(async () => {
      const was = loading;
      loading = false;
      return was;
    });

    await waitForPageReady({ waitForNetworkIdle, evaluate });

    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(waitForNetworkIdle).toHaveBeenCalledTimes(2);
  });

  it("treats a destroyed execution context as mid-navigation and keeps polling", async () => {
    const waitForNetworkIdle = vi.fn(async () => undefined);
    const evaluate = vi
      .fn()
      .mockRejectedValueOnce(new Error("Execution context was destroyed"))
      .mockResolvedValue(false);

    await waitForPageReady({ waitForNetworkIdle, evaluate });

    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(waitForNetworkIdle).toHaveBeenCalledTimes(2);
  });

  it("rethrows degradable evaluate timeouts instead of polling through them", async () => {
    const waitForNetworkIdle = vi.fn(async () => undefined);
    const evaluate = vi.fn(async () => {
      throw new TimeoutError(
        "Runtime.evaluate timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed.",
      );
    });

    await expect(waitForPageReady({ waitForNetworkIdle, evaluate })).rejects.toBeInstanceOf(
      TimeoutError,
    );
    // The stage degrades on the first timeout — it is not retried as
    // "still loading" for the full deadline.
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("stays bounded by wall clock when the document never reports a parsed state", async () => {
    vi.useFakeTimers();
    try {
      const waitForNetworkIdle = vi.fn(async () => undefined);
      const evaluate = vi.fn(async () => true);

      const start = Date.now();
      const done = waitForPageReady({ waitForNetworkIdle, evaluate }, { timeoutMs: 15_000 });
      await vi.runAllTimersAsync();
      await done;

      expect(Date.now() - start).toBeLessThanOrEqual(15_000);
      // ~500ms polls over the deadline — not unbounded.
      expect(evaluate.mock.calls.length).toBeLessThanOrEqual(31);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a hung evaluate to the shared deadline, not per-iteration latency", async () => {
    vi.useFakeTimers();
    try {
      // Each probe hangs for a protocol-timeout-scale 30s; the settle must
      // still finish at the deadline rather than paying 30s per poll.
      const evaluate = vi.fn(
        () =>
          new Promise<unknown>((resolve) => {
            setTimeout(() => resolve(true), 30_000);
          }),
      );
      const waitForNetworkIdle = vi.fn(async () => undefined);

      const start = Date.now();
      const done = waitForPageReady({ waitForNetworkIdle, evaluate }, { timeoutMs: 15_000 });
      await vi.advanceTimersByTimeAsync(15_000);
      await done;

      expect(Date.now() - start).toBeLessThanOrEqual(15_000);
      expect(evaluate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the leading idle wait in after-load mode on a parsed document", async () => {
    const waitForNetworkIdle = vi.fn(async () => undefined);
    const evaluate = vi.fn(async () => false);

    await waitForPageReady({ waitForNetworkIdle, evaluate }, { networkIdle: "after-load" });

    expect(waitForNetworkIdle).not.toHaveBeenCalled();
  });

  it("still idles in after-load mode once a loading document finishes", async () => {
    const waitForNetworkIdle = vi.fn(async () => undefined);
    let loading = true;
    const evaluate = vi.fn(async () => {
      const was = loading;
      loading = false;
      return was;
    });

    await waitForPageReady({ waitForNetworkIdle, evaluate }, { networkIdle: "after-load" });

    expect(waitForNetworkIdle).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the deadline has already passed", async () => {
    const waitForNetworkIdle = vi.fn(async () => undefined);
    const evaluate = vi.fn(async () => false);

    await waitForPageReady({ waitForNetworkIdle, evaluate }, { timeoutMs: 0 });

    expect(evaluate).not.toHaveBeenCalled();
    expect(waitForNetworkIdle).not.toHaveBeenCalled();
  });

  it("settles without waitForNetworkIdle on the page object", async () => {
    const evaluate = vi.fn(async () => false);

    await expect(waitForPageReady({ evaluate })).resolves.toBeUndefined();
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("stops polling when readyState does not evaluate to a boolean", async () => {
    vi.useFakeTimers();
    try {
      const waitForNetworkIdle = vi.fn(async () => undefined);
      const evaluate = vi.fn(async () => []);

      const start = Date.now();
      const done = waitForPageReady({ waitForNetworkIdle, evaluate }, { timeoutMs: 15_000 });
      await vi.runAllTimersAsync();
      await done;

      expect(evaluate).toHaveBeenCalledTimes(1);
      expect(Date.now() - start).toBeLessThan(15_000);
      expect(waitForNetworkIdle).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** A page whose goto keeps Puppeteer's contract: a non-zero timeout rejects the navigation. */
function fakeChromePage() {
  const session = Object.assign(new EventEmitter(), {
    send: async (_method: string, _params?: Record<string, unknown>) => undefined,
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

  it("answers the page's request for jsDelivr GSAP from the bundled copy, and lets any other request go", async () => {
    const chrome = fakeChromePage();
    const sent: Array<[string, Record<string, unknown> | undefined]> = [];
    chrome.session.send = async (method: string, params?: Record<string, unknown>) => {
      sent.push([method, params]);
    };
    const opened = gotoWhenSent(chrome.page, "http://127.0.0.1:1/", 10_000);
    await vi.waitFor(() => expect(sent.map(([method]) => method)).toContain("Fetch.enable"));
    chrome.session.emit("Fetch.requestPaused", {
      requestId: "gsap",
      request: { url: `${gsapCdnDist()}gsap.min.js` },
    });
    chrome.session.emit("Fetch.requestPaused", {
      requestId: "other",
      request: { url: "https://cdn.example/lib.js" },
    });
    await vi.waitFor(() =>
      expect(sent.map(([method]) => method)).toContain("Fetch.continueRequest"),
    );
    const fulfilled = sent.find(([method]) => method === "Fetch.fulfillRequest")?.[1];
    expect(fulfilled).toMatchObject({ requestId: "gsap", responseCode: 200 });
    expect(Buffer.from(String(fulfilled?.body), "base64").toString()).toContain("GreenSock");
    expect(sent.find(([method]) => method === "Fetch.continueRequest")?.[1]).toEqual({
      requestId: "other",
    });
    chrome.navigate();
    chrome.send();
    chrome.load({ status: () => 200 });
    await opened;
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

describe("settleAcrossNavigation", () => {
  const destroyed = () =>
    new Error("Execution context was destroyed, most likely because of a navigation.");

  function stubPage(failures: Error[]) {
    const waitForNetworkIdle = vi.fn(async () => undefined);
    const read = () => "html";
    const reads = vi.fn();
    const evaluate = vi.fn(async (fn: unknown) => {
      if (fn !== read) return false;
      reads();
      const failure = failures.shift();
      if (failure) throw failure;
      return "html";
    });
    const page = { evaluate, waitForNetworkIdle } as unknown as Page;
    settleAcrossNavigation(page);
    return { page, read, reads, waitForNetworkIdle };
  }

  it("settles the new document and reads again when a navigation lands mid-read", async () => {
    const { page, read, reads, waitForNetworkIdle } = stubPage([destroyed()]);
    await expect(page.evaluate(read)).resolves.toBe("html");
    expect(reads).toHaveBeenCalledTimes(2);
    expect(waitForNetworkIdle).toHaveBeenCalled();
  });

  it("reads once when nothing navigates", async () => {
    const { page, read, reads, waitForNetworkIdle } = stubPage([]);
    await expect(page.evaluate(read)).resolves.toBe("html");
    expect(reads).toHaveBeenCalledTimes(1);
    expect(waitForNetworkIdle).not.toHaveBeenCalled();
  });

  it("gives up after one more try, so a page that never stops navigating still fails", async () => {
    const { page, read, reads } = stubPage([destroyed(), destroyed()]);
    await expect(page.evaluate(read)).rejects.toThrow(/Execution context was destroyed/);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it("does not retry any other error", async () => {
    const { page, read, reads, waitForNetworkIdle } = stubPage([new Error("boom")]);
    await expect(page.evaluate(read)).rejects.toThrow("boom");
    expect(reads).toHaveBeenCalledTimes(1);
    expect(waitForNetworkIdle).not.toHaveBeenCalled();
  });
});

describe("a proxy that was in the way", () => {
  const failWith = async (message: string, url = "https://shop.example.com/") => {
    const goto = vi.fn().mockRejectedValue(new Error(message));
    return (await navigateForCapture({ goto }, url, 120_000).then(
      () => undefined,
      (err: unknown) => err,
    )) as Error;
  };

  it("that refused the tunnel to the site is named, with the code kept", async () => {
    const failure = await failWith(
      "net::ERR_TUNNEL_CONNECTION_FAILED at https://shop.example.com/x?q=1",
    );
    expect(failure.message).toBe(
      "Your network's proxy refused the connection to shop.example.com. Ask whoever runs it to allow shop.example.com. (net::ERR_TUNNEL_CONNECTION_FAILED)",
    );
    expect((failure.cause as Error).message).toContain("/x?q=1");
  });

  it("that could not be reached itself is not asked to allow the site", async () => {
    const failure = await failWith("net::ERR_PROXY_CONNECTION_FAILED at https://shop.example.com/");
    expect(failure.message).toBe(
      "Could not reach your network's proxy. Check the proxy address and that the proxy is running, or ask whoever runs it. (net::ERR_PROXY_CONNECTION_FAILED)",
    );
    expect(failure.message).not.toContain("allow");
  });

  it("names no raw address when the site's cannot be read", () => {
    const failure = explainProxyRefusal(
      new Error("net::ERR_TUNNEL_CONNECTION_FAILED"),
      "not a url at all",
    ) as Error;
    expect(failure.message).toContain("connection to the site");
    expect(failure.message).not.toContain("not a url");
  });

  it("is named after a networkidle2 timeout falls back too", async () => {
    const goto = vi
      .fn()
      .mockRejectedValueOnce(new TimeoutError("Navigation timeout of 30000 ms exceeded"))
      .mockRejectedValueOnce(new Error("net::ERR_TUNNEL_CONNECTION_FAILED at https://a.example/"));
    await expect(navigateForCapture({ goto }, "https://a.example/", 120_000)).rejects.toThrow(
      /proxy refused the connection to a\.example/,
    );
  });

  it("leaves every other failure as it was", async () => {
    const name = new Error("net::ERR_NAME_NOT_RESOLVED at https://nope.example/");
    expect(explainProxyRefusal(name, "https://nope.example/")).toBe(name);
    const goto = vi.fn().mockRejectedValue(name);
    await expect(navigateForCapture({ goto }, "https://nope.example/", 120_000)).rejects.toBe(name);
  });
});
