import type { Browser, Page } from "puppeteer-core";

interface LoadedPage {
  browser: Browser;
  version: string;
  page: Promise<Page>;
  queue: Promise<unknown>;
}

/** One loaded preview page per document URL: a thumbnail is a seek and a screenshot on it, not a
 * fresh load of the whole composition. A new `version` (project content) reloads the page, and
 * calls on one page run one at a time so their seeks never interleave. */
export function createThumbnailPages(maxPages = 2) {
  const pages = new Map<string, LoadedPage>();
  const drop = (url: string) => {
    const entry = pages.get(url);
    pages.delete(url);
    void entry?.page.then((page) => page.close()).catch(() => {});
  };
  return {
    async withPage<T>(
      browser: Browser,
      url: string,
      version: string,
      load: (page: Page) => Promise<void>,
      use: (page: Page) => Promise<T>,
    ): Promise<T> {
      let entry = pages.get(url);
      if (entry && (entry.browser !== browser || entry.version !== version)) {
        drop(url);
        entry = undefined;
      }
      if (!entry) {
        const page = browser.newPage().then(async (created) => {
          await load(created);
          return created;
        });
        entry = { browser, version, page, queue: Promise.resolve() };
        pages.set(url, entry);
        while (pages.size > maxPages) drop(pages.keys().next().value!);
      }
      const current = entry;
      const run = current.queue.then(async () => use(await current.page));
      current.queue = run.catch(() => {});
      try {
        return await run;
      } catch (error) {
        if (pages.get(url) === current) drop(url);
        throw error;
      }
    },
    closeAll(): void {
      for (const url of [...pages.keys()]) drop(url);
    },
  };
}
