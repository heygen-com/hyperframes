import type { CDPSession, HTTPResponse, Page } from "puppeteer-core";
import {
  isDegradableEvaluateTimeoutError,
  isNavigationTimeoutError,
  withRemainingBudget,
} from "./captureTimeout.js";

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
  waitForNetworkIdle?(options: {
    idleTime: number;
    timeout: number;
    concurrency?: number;
  }): Promise<unknown>;
  evaluate(fn: () => unknown): Promise<unknown>;
}

export interface WaitForPageReadyOptions {
  timeoutMs?: number;
  networkIdle?: "always" | "after-load";
}

export async function waitForPageReady(
  page: PageReadyPage,
  options: WaitForPageReadyOptions = {},
): Promise<void> {
  const { timeoutMs = 15_000, networkIdle = "always" } = options;
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(0, deadline - Date.now());
  const idle = async () => {
    try {
      await page.waitForNetworkIdle?.({
        idleTime: 500,
        timeout: remaining(),
        concurrency: 2,
      });
    } catch {}
  };

  if (networkIdle === "always" && remaining() > 0) await idle();

  let waitedOutLoad = false;
  while (remaining() > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loading = await Promise.race([
      page
        .evaluate(() => document.readyState === "loading")
        .catch((err: unknown) => {
          if (isDegradableEvaluateTimeoutError(err)) throw err;
          return true;
        }),
      new Promise<true>((resolve) => {
        timer = setTimeout(() => resolve(true), Math.max(1, remaining()));
      }),
    ]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
    if (loading !== true) break;
    waitedOutLoad = true;
    if (remaining() > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(500, remaining())));
    }
  }

  if (waitedOutLoad && remaining() > 0) await idle();
}

const PUPPETEER_LAUNCH_DEFAULT_TIMEOUT_MS = 30_000;
const PAGE_LOAD_BLOCKING_TYPES = new Set(["Document", "Script", "Stylesheet"]);
const NAMED_BLOCKING_REQUESTS = 3;
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
  const { TimeoutError } = await import("puppeteer-core");
  const cdp = await page.createCDPSession();
  try {
    await cdp.send("Network.enable");
    const sent = documentRequestSent(cdp);
    const unfinished = unfinishedPageLoadRequests(cdp);
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
      () => new TimeoutError(pageLoadTimeoutMessage(timeoutMs, url, unfinished())),
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

export function unfinishedPageLoadRequests(cdp: CDPSession): () => string[] {
  const unfinished = new Map<string, string>();
  cdp.on("Network.requestWillBeSent", ({ requestId, request, type }) => {
    if (type && PAGE_LOAD_BLOCKING_TYPES.has(type)) unfinished.set(requestId, request.url);
  });
  for (const event of ["Network.loadingFinished", "Network.loadingFailed"] as const) {
    cdp.on(event, ({ requestId }) => unfinished.delete(requestId));
  }
  return () => [...unfinished.values()];
}

function urlWithoutSecrets(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return `${url.protocol}…`;
    return `${url.origin}${url.pathname}${url.search ? "?…" : ""}`;
  } catch {
    return "(unreadable URL)";
  }
}

function originOf(raw: string): string | null {
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function pageLoadTimeoutMessage(timeoutMs: number, pageUrl: string, waitingOn: string[]): string {
  const exceeded = `Navigation timeout of ${timeoutMs} ms exceeded`;
  if (waitingOn.length === 0) return exceeded;
  const named = waitingOn.slice(0, NAMED_BLOCKING_REQUESTS).map(urlWithoutSecrets).join(", ");
  const unnamed = waitingOn.length - NAMED_BLOCKING_REQUESTS;
  const more = unnamed > 0 ? ` and ${unnamed} more` : "";
  const pageOrigin = new URL(pageUrl).origin;
  const fromAnotherServer = waitingOn.some((request) => originOf(request) !== pageOrigin);
  const advice = fromAnotherServer
    ? " A <script> or stylesheet from another server holds the page until it arrives; serve it from the project instead."
    : "";
  return `${exceeded} while the page was still loading ${named}${more}.${advice}`;
}
