import type { Browser, LaunchOptions, PuppeteerNode } from "puppeteer-core";
import {
  resolveCaptureBrowserGpuMode,
  type BrowserGpuMode,
  type ResolvedBrowserGpuMode,
} from "./gpuPolicy.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { requestCliExit } from "../utils/commandResult.js";
import { processIsAlive } from "../utils/processTree.js";
import { watchChromeTree, type ChromeWatchdog } from "./windowsChromeWatchdog.js";
import {
  inAgentSandbox,
  isOneProcessOverPipe,
  pipeLaunchClosedOnMac,
  machServiceDenied,
  oneProcessOverPipe,
  sandboxDeniedRemediation,
} from "./sandboxDenied.js";

export class BrowserCleanupError extends AggregateError {}

const browsers = new Set<Browser>();
const closing = new WeakMap<Browser, Promise<void>>();
const watchdogs = new WeakMap<Browser, ChromeWatchdog>();
const pending = new Map<Promise<Browser>, AbortController>();
const sessionCleanups = new Set<() => Promise<void>>();
const CLOSE_GRACE_MS = 1_000;
const LAUNCH_TIMEOUT_MS = 30_000;
const EXIT_POLL_MS = 50;
let listening = false;
let shutdown: Promise<void> | undefined;

/** CLI signals close browser admission and native processes before the root exits. */
function stopForSignal(signal: "SIGINT" | "SIGTERM"): void {
  if (shutdown) return;
  shutdown = closeManagedBrowsers();
  void shutdown.then(
    () => requestCliExit(signal === "SIGINT" ? 130 : 143),
    (error: unknown) => {
      console.error("Browser shutdown failed:", error);
      requestCliExit(1);
    },
  );
}

function ownSignals(): void {
  if (listening) return;
  listening = true;
  process.on("SIGINT", () => stopForSignal("SIGINT"));
  process.on("SIGTERM", () => stopForSignal("SIGTERM"));
}

/** The GPU probe launches its own Chrome, so the signal owner must exist before it runs. */
export async function resolveManagedGpuMode(
  requestedMode: BrowserGpuMode,
  chromePath?: string,
  context: {
    signal?: AbortSignal;
    onBrowser?: (browser: Browser) => void;
    noListen?: boolean;
  } = {},
): Promise<ResolvedBrowserGpuMode> {
  ownSignals();
  if (requestedMode === "auto" && inAgentSandbox()) return "software";
  return resolveCaptureBrowserGpuMode(requestedMode, chromePath, {
    launch: async (puppeteer, options) => {
      context.signal?.throwIfAborted();
      const browser = await launchManagedBrowser(puppeteer, {
        ...options,
        ...(context.noListen ? oneProcessOverPipe(options) : {}),
        signal: context.signal,
      });
      try {
        context.onBrowser?.(browser);
      } catch (error) {
        return rethrowAfterBrowserCleanup(browser, error);
      }
      return browser;
    },
    close: closeManagedBrowser,
  });
}

/** One owner for every CLI browser, including a launch cancelled before its connection is ready. */
export async function launchManagedBrowser(
  puppeteer: PuppeteerNode,
  options: LaunchOptions,
): Promise<Browser> {
  const sandboxed = isOneProcessOverPipe(options) || inAgentSandbox();
  try {
    return await launchOwnedBrowser(puppeteer, sandboxed ? oneProcessOverPipe(options) : options);
  } catch (error) {
    const unnamedSeatbelt =
      !sandboxed &&
      (machServiceDenied(normalizeErrorMessage(error)) || pipeLaunchClosedOnMac(error));
    if (!unnamedSeatbelt) throw withRemediation(error);
    return launchOwnedBrowser(puppeteer, oneProcessOverPipe(options)).catch(
      (retryError: unknown) => {
        throw withRemediation(retryError);
      },
    );
  }
}

function withRemediation(error: unknown): unknown {
  const remediation = sandboxDeniedRemediation(normalizeErrorMessage(error));
  return remediation ? new Error(remediation, { cause: error }) : error;
}

async function launchOwnedBrowser(
  puppeteer: PuppeteerNode,
  options: LaunchOptions,
): Promise<Browser> {
  if (shutdown) throw new Error("The CLI is stopping; no browser can start.");
  ownSignals();
  const abort = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal;
  const launchedAt = Date.now();
  const launch = untilLaunchOrAbort(
    puppeteer.launch({ ...options, pipe: true, signal, handleSIGINT: false, handleSIGTERM: false }),
    signal,
  );
  const limit = options.timeout ?? LAUNCH_TIMEOUT_MS;
  const timer =
    limit > 0
      ? setTimeout(
          () => abort.abort(new Error(`The browser did not finish starting within ${limit} ms.`)),
          limit,
        )
      : undefined;
  pending.set(launch, abort);
  try {
    const browser = await launch;
    const child = browser.process();
    if (!child) throw new Error("A launched browser has no owned process.");
    browsers.add(browser);
    const watchdog = watchChromeTree(child, launchedAt);
    if (watchdog) watchdogs.set(browser, watchdog);
    child.once("exit", () => browsers.delete(browser));
    return browser;
  } finally {
    clearTimeout(timer);
    pending.delete(launch);
  }
}

function untilLaunchOrAbort(launch: Promise<Browser>, signal: AbortSignal): Promise<Browser> {
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  void launch
    .then((late) => (signal.aborted ? closeManagedBrowser(late) : undefined))
    .catch(() => undefined);
  return Promise.race([launch, aborted]);
}

/** Resolved launches keep their signal live; only pending launches are aborted during shutdown. */
async function closeManagedBrowsers(): Promise<void> {
  for (const abort of pending.values()) abort.abort();
  await Promise.allSettled(pending.keys());
  const results = await Promise.allSettled([...browsers].map(closeManagedBrowser));
  results.push(...(await Promise.allSettled([...sessionCleanups].map((cleanup) => cleanup()))));
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length) throw new AggregateError(errors, "Browser session shutdown failed.");
}

export function registerBrowserSessionCleanup(cleanup: () => Promise<void>): () => void {
  if (shutdown) throw new Error("The CLI is stopping; no browser session can start.");
  ownSignals();
  sessionCleanups.add(cleanup);
  return () => sessionCleanups.delete(cleanup);
}

/** Manual teardown and signal teardown share the same bounded close, exactly once. */
export function closeManagedBrowser(browser: Browser): Promise<void> {
  const existing = closing.get(browser);
  if (existing) return existing;
  const close = closeBrowser(browser);
  closing.set(browser, close);
  return close;
}

export async function rethrowAfterBrowserCleanup(
  browser: Browser | undefined,
  error: unknown,
): Promise<never> {
  if (browser) {
    try {
      await closeManagedBrowser(browser);
    } catch (cleanupError) {
      throw new BrowserCleanupError(
        [error, cleanupError],
        `${normalizeErrorMessage(error)}; browser cleanup failed: ${normalizeErrorMessage(cleanupError)}`,
      );
    }
  }
  throw error;
}

async function closeBrowser(browser: Browser): Promise<void> {
  let clean = false;
  try {
    clean = await closedWithoutKill(browser);
  } finally {
    watchdogs.get(browser)?.release(clean);
  }
}

async function closedWithoutKill(browser: Browser): Promise<boolean> {
  const child = browser.process();
  if (!child) throw new Error("A managed browser lost its owned process.");
  if (child.exitCode !== null || child.signalCode !== null) return false;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  let timer: NodeJS.Timeout | undefined;
  let poll: NodeJS.Timeout | undefined;
  const grace = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, CLOSE_GRACE_MS);
  });
  try {
    await Promise.race([
      browser.close().catch((error: unknown) => console.warn("Browser close failed:", error)),
      grace,
    ]);
    const clean = child.exitCode !== null || child.signalCode !== null;
    if (!clean) child.kill("SIGKILL");
    clearTimeout(timer);
    const exitLimit = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Browser process did not exit after forced shutdown.")),
        CLOSE_GRACE_MS,
      );
    });
    const goneBeforeExitEvent = new Promise<void>((resolve) => {
      poll = setInterval(() => {
        if (child.pid === undefined || !processIsAlive(child.pid)) resolve();
      }, EXIT_POLL_MS);
    });
    await Promise.race([exited, goneBeforeExitEvent, exitLimit]);
    return clean;
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
  }
}
