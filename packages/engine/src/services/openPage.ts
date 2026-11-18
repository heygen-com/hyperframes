import type { Browser, Page } from "puppeteer-core";

/** Chrome lost a render page's tab while opening it, so the page has no main frame to use. */
export class PageTabLostError extends Error {
  readonly browserRunning: boolean;

  constructor(browser: Browser) {
    const child = browser.process();
    super(
      browser.connected
        ? "Chrome closed the render page's tab while opening it, twice; the browser is still running"
        : `Chrome exited while opening a render page (exit code ${child?.exitCode ?? "unknown"}, signal ${child?.signalCode ?? "none"})`,
    );
    this.name = "PageTabLostError";
    this.browserRunning = browser.connected;
  }
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

/**
 * `browser.newPage()` that never returns a page whose tab closed during setup: puppeteer swallows that
 * close and resolves a page whose every call throws "Requesting main frame too early!". One more page
 * is opened only while the browser still runs; a browser that is gone is reported, never retried.
 */
export async function openPage(browser: Browser): Promise<Page> {
  const page =
    (await newLivePage(browser)) ?? (browser.connected ? await newLivePage(browser) : undefined);
  if (page) return page;
  throw new PageTabLostError(browser);
}
