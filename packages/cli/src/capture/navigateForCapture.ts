import { TimeoutError, type CDPSession, type HTTPResponse, type Page } from "puppeteer-core";
import { isNavigationTimeoutError, withRemainingBudget } from "./captureTimeout.js";

export { isNavigationTimeoutError };

export const NETWORK_IDLE_ATTEMPT_MS = 30_000;

export type CaptureGotoWaitUntil = "networkidle2" | "domcontentloaded";

export interface CaptureGotoOptions {
  waitUntil: CaptureGotoWaitUntil;
  timeout: number;
}

export interface CaptureGotoPage<TResponse = unknown> {
  goto(url: string, options: CaptureGotoOptions): Promise<TResponse>;
}

export interface NavigateForCaptureResult<TResponse = unknown> {
  response: TResponse;
  waitUntil: CaptureGotoWaitUntil;
  networkIdleTimeoutMs: number;
  fellBackFromNetworkIdle: boolean;
}

export function networkIdleAttemptTimeoutMs(totalTimeoutMs: number): number {
  return Math.min(NETWORK_IDLE_ATTEMPT_MS, Math.max(0, totalTimeoutMs));
}

export async function navigateForCapture<TResponse>(
  page: CaptureGotoPage<TResponse>,
  url: string,
  totalTimeoutMs: number,
): Promise<NavigateForCaptureResult<TResponse>> {
  const networkIdleTimeoutMs = networkIdleAttemptTimeoutMs(totalTimeoutMs);
  try {
    const response = await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: networkIdleTimeoutMs,
    });
    return {
      response,
      waitUntil: "networkidle2",
      networkIdleTimeoutMs,
      fellBackFromNetworkIdle: false,
    };
  } catch (err) {
    if (!isNavigationTimeoutError(err) || networkIdleTimeoutMs >= totalTimeoutMs) {
      throw err;
    }
  }

  const fallbackTimeoutMs = totalTimeoutMs - networkIdleTimeoutMs;
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: fallbackTimeoutMs,
  });
  return {
    response,
    waitUntil: "domcontentloaded",
    networkIdleTimeoutMs,
    fellBackFromNetworkIdle: true,
  };
}

const PUPPETEER_LAUNCH_DEFAULT_TIMEOUT_MS = 30_000;
const SENT_OR_ANSWERED_WITHOUT_NETWORK = [
  "Network.requestWillBeSentExtraInfo",
  "Network.responseReceived",
] as const;

export async function gotoWhenSent(
  page: Page,
  url: string,
  timeoutMs: number,
  coldChromeFirstRequestTimeoutMs = PUPPETEER_LAUNCH_DEFAULT_TIMEOUT_MS,
): Promise<HTTPResponse | null> {
  const cdp = await page.createCDPSession();
  try {
    await cdp.send("Network.enable");
    const sent = documentRequestSent(cdp);
    const navigation = page.goto(url, { waitUntil: "domcontentloaded", timeout: 0 });
    const navigationAwaitedBelow = navigation.catch(() => undefined);
    await withRemainingBudget(
      Promise.race([sent, navigationAwaitedBelow]),
      coldChromeFirstRequestTimeoutMs,
      "sending the page request",
      () =>
        new TimeoutError(
          `Navigation timeout: Chrome did not send the page request within ${coldChromeFirstRequestTimeoutMs} ms`,
        ),
    );
    return await withRemainingBudget(
      navigation,
      timeoutMs,
      "loading the page",
      () => new TimeoutError(`Navigation timeout of ${timeoutMs} ms exceeded`),
    );
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

export function documentRequestSent(cdp: CDPSession): Promise<void> {
  const documents = new Set<string>();
  const sent = new Set<string>();
  return new Promise((resolve) => {
    const settle = (requestId: string) => {
      if (documents.has(requestId) && sent.has(requestId)) resolve();
    };
    cdp.on("Network.requestWillBeSent", ({ requestId, type }) => {
      if (type === "Document") documents.add(requestId);
      settle(requestId);
    });
    for (const event of SENT_OR_ANSWERED_WITHOUT_NETWORK) {
      cdp.on(event, ({ requestId }) => {
        sent.add(requestId);
        settle(requestId);
      });
    }
  });
}
