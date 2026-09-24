import type { Browser, Page } from "puppeteer-core";

interface LoadedPage {
  browser: Browser;
  version: string;
  page: Promise<Page>;
  queue: Promise<unknown>;
  idleTimer?: ReturnType<typeof setTimeout>;
}

/** One loaded preview page per document URL: a thumbnail is a seek and a screenshot on it, not a
 * fresh load of the whole composition. A new `version` (project content) reloads the page, calls on
 * one page run one at a time so their seeks never interleave, and a page unused for `idleMs` closes
 * so an idle Studio keeps no composition running. */
export function createThumbnailPages(maxPages = 2, idleMs = 10_000) {
  const pages = new Map<string, LoadedPage>();
  const drop = (url: string) => {
    const entry = pages.get(url);
    if (!entry) return;
    pages.delete(url);
    clearTimeout(entry.idleTimer);
    // After any frame still running on it.
    void entry.queue
      .then(() => entry.page)
      .then((page) => page.close())
      .catch(() => {});
  };
  const entryFor = (
    browser: Browser,
    url: string,
    version: string,
    load: (page: Page) => Promise<void>,
  ): LoadedPage => {
    const existing = pages.get(url);
    if (existing && existing.browser === browser && existing.version === version) return existing;
    drop(url);
    const page = browser.newPage().then(async (created) => {
      await load(created);
      return created;
    });
    const entry: LoadedPage = { browser, version, page, queue: Promise.resolve() };
    pages.set(url, entry);
    while (pages.size > maxPages) drop(pages.keys().next().value!);
    return entry;
  };
  const armIdleClose = (url: string, entry: LoadedPage) => {
    if (pages.get(url) !== entry) return;
    clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      if (pages.get(url) === entry) drop(url);
    }, idleMs);
    entry.idleTimer.unref?.();
  };
  return {
    async withPage<T>(
      browser: Browser,
      url: string,
      version: string,
      load: (page: Page) => Promise<void>,
      use: (page: Page) => Promise<T>,
    ): Promise<T> {
      const current = entryFor(browser, url, version, load);
      clearTimeout(current.idleTimer);
      const run = current.queue.then(async () => use(await current.page));
      current.queue = run.catch(() => {});
      try {
        return await run;
      } catch (error) {
        if (pages.get(url) === current) drop(url);
        throw error;
      } finally {
        armIdleClose(url, current);
      }
    },
    closeAll(): void {
      for (const url of [...pages.keys()]) drop(url);
    },
  };
}
