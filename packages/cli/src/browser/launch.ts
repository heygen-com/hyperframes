import { resolveChromeProxyArgs } from "@hyperframes/engine";
import type { Browser, LaunchOptions, PuppeteerNode } from "puppeteer-core";
import {
  resolveCaptureBrowserGpuMode,
  type BrowserGpuMode,
  type ResolvedBrowserGpuMode,
} from "./gpuPolicy.js";
import { requestCliExit } from "../utils/commandResult.js";

const browsers = new Set<Browser>();
const pending = new Map<Promise<Browser>, AbortController>();
const CLOSE_GRACE_MS = 1_000;
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
): Promise<ResolvedBrowserGpuMode> {
  ownSignals();
  return resolveCaptureBrowserGpuMode(requestedMode, chromePath);
}

/** One owner for every CLI browser, including a launch cancelled before its connection is ready. */
export async function launchManagedBrowser(
  puppeteer: PuppeteerNode,
  options: LaunchOptions,
): Promise<Browser> {
  if (shutdown) throw new Error("The CLI is stopping; no browser can start.");
  const args = [...(options.args ?? []), ...resolveChromeProxyArgs(options.env ?? process.env)];
  ownSignals();
  const abort = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal;
  const launch = puppeteer.launch({
    ...options,
    args,
    signal,
    handleSIGINT: false,
    handleSIGTERM: false,
  });
  pending.set(launch, abort);
  try {
    const browser = await launch;
    const child = browser.process();
    if (!child) throw new Error("A launched browser has no owned process.");
    browsers.add(browser);
    child.once("exit", () => browsers.delete(browser));
    return browser;
  } finally {
    pending.delete(launch);
  }
}

/** Resolved launches keep their signal live; only pending launches are aborted during shutdown. */
async function closeManagedBrowsers(): Promise<void> {
  for (const abort of pending.values()) abort.abort();
  await Promise.allSettled(pending.keys());
  await Promise.all([...browsers].map(closeBrowser));
}

async function closeBrowser(browser: Browser): Promise<void> {
  const child = browser.process();
  if (!child) throw new Error("A managed browser lost its owned process.");
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  let timer: NodeJS.Timeout | undefined;
  const grace = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, CLOSE_GRACE_MS);
  });
  try {
    await Promise.race([
      browser.close().catch((error: unknown) => console.warn("Browser close failed:", error)),
      grace,
    ]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  } finally {
    clearTimeout(timer);
  }
}
