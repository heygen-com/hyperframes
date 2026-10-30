import type { ChildProcess } from "node:child_process";
import {
  inAgentSandbox,
  isOneProcessOverPipe,
  machServiceDenied,
  oneProcessOverPipe,
  pipeLaunchClosedOnMac,
  sandboxDeniedRemediation,
} from "@hyperframes/engine";
import { explainChromeLaunchFailure } from "@hyperframes/engine/chrome-startup";
import type { Browser, LaunchOptions, Page, PuppeteerNode } from "puppeteer-core";
import { withHyperframesBrowserMarker } from "@hyperframes/core/browser-marker";
import {
  resolveCaptureBrowserGpuMode,
  type BrowserGpuMode,
  type ResolvedBrowserGpuMode,
} from "./gpuPolicy.js";
import { normalizeErrorMessage, notePageCrash } from "../utils/errorMessage.js";
import { requestCliExit } from "../utils/commandResult.js";
import { processIsAlive } from "../utils/processTree.js";
import { chromeDescendants, reapChromeTree } from "./chromeTree.js";
import { watchChromeTree, type ChromeWatchdog } from "./windowsChromeWatchdog.js";

export class BrowserCleanupError extends AggregateError {}

const browsers = new Set<Browser>();
const closing = new WeakMap<Browser, Promise<void>>();
const watchdogs = new WeakMap<Browser, ChromeWatchdog>();
const gracefulClose = new WeakMap<Browser, () => Promise<void>>();
const pending = new Map<Promise<Browser>, AbortController>();
const diagnosing = new Set<AbortController>();
const sessionCleanups = new Set<() => Promise<void>>();
const CLOSE_GRACE_MS = 1_000;
const LAUNCH_TIMEOUT_MS = 30_000;
const SLOW_START_NOTICE_MS = 5_000;
const EXIT_POLL_MS = 50;
let listening = false;
let shutdown: Promise<void> | undefined;

const stopListeners = new Set<(signal: "SIGINT" | "SIGTERM") => void>();

export function onStopSignal(listener: (signal: "SIGINT" | "SIGTERM") => void): () => void {
  ownSignals();
  stopListeners.add(listener);
  return () => stopListeners.delete(listener);
}

/** CLI signals close browser admission and native processes before the root exits. */
function stopForSignal(signal: "SIGINT" | "SIGTERM"): void {
  if (shutdown) return;
  for (const listener of stopListeners) listener(signal);
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
      const browser = await launchManagedBrowser(
        puppeteer,
        {
          ...options,
          ...(context.noListen ? oneProcessOverPipe(options) : {}),
          signal: context.signal,
        },
        { diagnose: false },
      );
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
  { diagnose = true }: { diagnose?: boolean } = {},
): Promise<Browser> {
  const sandboxed = isOneProcessOverPipe(options) || inAgentSandbox();
  try {
    return await launchOwnedBrowser(puppeteer, sandboxed ? oneProcessOverPipe(options) : options);
  } catch (error) {
    const unnamedSeatbelt =
      !sandboxed &&
      (machServiceDenied(normalizeErrorMessage(error)) || pipeLaunchClosedOnMac(error));
    if (!unnamedSeatbelt)
      throw await withStartupDiagnosis(withRemediation(error), puppeteer, options, diagnose);
    return launchOwnedBrowser(puppeteer, oneProcessOverPipe(options)).catch(
      async (retryError: unknown) => {
        throw await withStartupDiagnosis(withRemediation(retryError), puppeteer, options, diagnose);
      },
    );
  }
}

async function withStartupDiagnosis(
  error: unknown,
  puppeteer: PuppeteerNode,
  options: LaunchOptions,
  diagnose: boolean,
): Promise<unknown> {
  if (!diagnose || !options.executablePath || options.signal?.aborted || shutdown) return error;
  if (!(error instanceof Error)) return error;
  if (sandboxDeniedRemediation(normalizeErrorMessage(error))) return error;
  const args = await (async () =>
    puppeteer.defaultArgs({
      headless: options.headless ?? true,
      args: withHyperframesBrowserMarker(options.args),
    }))().catch(() => undefined);
  if (!args) return error;
  const abort = new AbortController();
  diagnosing.add(abort);
  try {
    return await explainChromeLaunchFailure(error, options.executablePath, args, abort.signal);
  } finally {
    diagnosing.delete(abort);
  }
}

function withRemediation(error: unknown): unknown {
  const remediation = sandboxDeniedRemediation(normalizeErrorMessage(error));
  return remediation ? new Error(remediation, { cause: error }) : error;
}

function destroyBrowserPipes(child: ChildProcess): void {
  for (const pipe of child.stdio ?? []) pipe?.destroy();
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
    puppeteer.launch({
      ...options,
      args: withHyperframesBrowserMarker(options.args),
      pipe: true,
      signal,
      handleSIGINT: false,
      handleSIGTERM: false,
    }),
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
  const slow = setTimeout(() => console.error("Chrome is still starting..."), SLOW_START_NOTICE_MS);
  pending.set(launch, abort);
  try {
    const browser = await launch;
    const child = browser.process();
    if (!child) throw new Error("A launched browser has no owned process.");
    browsers.add(browser);
    const watchdog = watchChromeTree(child, launchedAt);
    if (watchdog) watchdogs.set(browser, watchdog);
    gracefulClose.set(browser, browser.close.bind(browser));
    browser.close = () => closeManagedBrowser(browser);
    const newPage = browser.newPage;
    browser.newPage = async (...args) => closeOnRendererCrash(await newPage.apply(browser, args));
    child.once("exit", () => {
      browsers.delete(browser);
      destroyBrowserPipes(child);
    });
    return browser;
  } finally {
    clearTimeout(timer);
    clearTimeout(slow);
    pending.delete(launch);
  }
}

function closeOnRendererCrash(page: Page): Page {
  page.once("error", () => {
    notePageCrash();
    page.close().catch(() => undefined);
  });
  return page;
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
  for (const abort of [...pending.values(), ...diagnosing]) abort.abort();
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

async function descendantsToReap(pid: number | undefined) {
  if (pid === undefined || process.platform === "win32") return [];
  return chromeDescendants(pid).catch(() => []);
}

function closeGracefully(browser: Browser): Promise<void> {
  return (gracefulClose.get(browser) ?? (() => browser.close()))();
}

async function closedWithoutKill(browser: Browser): Promise<boolean> {
  const child = browser.process();
  if (!child) throw new Error("A managed browser lost its owned process.");
  if (child.exitCode !== null || child.signalCode !== null) return false;
  const tree = await descendantsToReap(child.pid);
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  let timer: NodeJS.Timeout | undefined;
  let poll: NodeJS.Timeout | undefined;
  const grace = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, CLOSE_GRACE_MS);
  });
  try {
    await Promise.race([
      closeGracefully(browser).catch((error: unknown) =>
        console.warn("Browser close failed:", error),
      ),
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
    await reapChromeTree(tree).catch(() => undefined);
    return clean;
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
  }
}
