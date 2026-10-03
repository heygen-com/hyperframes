import { isNavigationTimeoutError } from "./captureTimeout.js";

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

export interface PageReadyPage {
  waitForNetworkIdle(options: { idleTime: number; timeout: number }): Promise<unknown>;
  evaluate(fn: () => unknown): Promise<unknown>;
}

export async function waitForPageReady(page: PageReadyPage): Promise<void> {
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 15_000 }).catch(() => {});
  let waitedOutLoad = false;
  for (let i = 0; i < 30; i++) {
    const loading = await page.evaluate(() => document.readyState === "loading").catch(() => true);
    if (!loading) break;
    waitedOutLoad = true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!waitedOutLoad) return;
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 15_000 }).catch(() => {});
}
