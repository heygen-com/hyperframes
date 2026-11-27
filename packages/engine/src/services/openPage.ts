import type { Browser, Page } from "puppeteer-core";

const EXIT_STATUS_WAIT_MS = 500;

interface ExitStatus {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
}

function exitReason(browser: Browser, exit?: ExitStatus): string {
  const status = exit ?? browser.process();
  return `Chrome exited while opening a render page (exit code ${status?.exitCode ?? "unknown"}, signal ${status?.signalCode ?? "none"})`;
}

/** Chrome lost a render page's tab while opening it, so the page has no main frame to use. */
export class PageTabLostError extends Error {
  readonly browserRunning: boolean;

  constructor(browser: Browser, exit?: ExitStatus) {
    super(
      browser.connected
        ? "Chrome closed the render page's tab while opening it, twice; the browser is still running"
        : exitReason(browser, exit),
    );
    this.name = "PageTabLostError";
    this.browserRunning = browser.connected;
  }
}

// Chrome's CDP pipe often closes before Node's child_process emits "exit", leaving child.exitCode null if read at once.
function waitForExitStatus(browser: Browser): Promise<ExitStatus | undefined> {
  if (browser.connected) return Promise.resolve(undefined);
  const child = browser.process();
  if (!child) return Promise.resolve(undefined);
  const canListen = typeof child.once === "function" && typeof child.removeListener === "function";
  if (child.exitCode !== null || child.signalCode !== null || !canListen) {
    return Promise.resolve({ exitCode: child.exitCode, signalCode: child.signalCode });
  }
  return new Promise((resolve) => {
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolve({ exitCode: code ?? child.exitCode, signalCode: signal ?? child.signalCode });
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => finish(code, signal);
    const timer = setTimeout(() => finish(null, null), EXIT_STATUS_WAIT_MS);
    timer.unref?.();
    child.once("exit", onExit);
  });
}

async function newLivePage(browser: Browser): Promise<Page | undefined> {
  const page = await browser.newPage();
  try {
    page.mainFrame();
    return page;
  } catch {
    await page.close().catch(() => {});
    return undefined;
  }
}

// `browser.newPage()`, minus the page puppeteer resolves when its tab closed during setup (no main frame).
// One more page only while the browser runs; a browser that is gone is reported, never retried.
export async function openPage(browser: Browser): Promise<Page> {
  const page =
    (await newLivePage(browser)) ?? (browser.connected ? await newLivePage(browser) : undefined);
  if (page) return page;
  throw new PageTabLostError(browser, await waitForExitStatus(browser));
}
