import { describe, expect, it, vi } from "vitest";
import type { Browser, Page } from "puppeteer-core";
import { createThumbnailPages } from "./thumbnailPages.js";

function fakeBrowser() {
  const pages: Array<{ close: ReturnType<typeof vi.fn> }> = [];
  const browser = {
    newPage: vi.fn(async () => {
      const page = { close: vi.fn(async () => {}) };
      pages.push(page);
      return page as unknown as Page;
    }),
  } as unknown as Browser;
  return { browser, pages };
}

describe("createThumbnailPages", () => {
  it("loads a document once and serves every frame from that page, one at a time", async () => {
    const { browser } = fakeBrowser();
    const thumbnails = createThumbnailPages();
    const load = vi.fn(async () => {});
    const order: string[] = [];
    const shot = (name: string) => async () => {
      order.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`${name}:end`);
      return name;
    };

    const frames = await Promise.all([
      thumbnails.withPage(browser, "/preview", "v1", load, shot("t0")),
      thumbnails.withPage(browser, "/preview", "v1", load, shot("t3")),
    ]);

    expect(frames).toEqual(["t0", "t3"]);
    expect(browser.newPage).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["t0:start", "t0:end", "t3:start", "t3:end"]);
  });

  it("reloads when the project content changes and after a failed frame", async () => {
    const { browser, pages } = fakeBrowser();
    const thumbnails = createThumbnailPages();
    const load = vi.fn(async () => {});

    await thumbnails.withPage(browser, "/preview", "v1", load, async () => null);
    await thumbnails.withPage(browser, "/preview", "v2", load, async () => null);
    expect(load).toHaveBeenCalledTimes(2);
    expect(pages[0]?.close).toHaveBeenCalled();

    await expect(
      thumbnails.withPage(browser, "/preview", "v2", load, async () => {
        throw new Error("page crashed");
      }),
    ).rejects.toThrow("page crashed");
    await thumbnails.withPage(browser, "/preview", "v2", load, async () => null);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("closes a page nobody has used for a while, so an idle Studio runs no composition", async () => {
    vi.useFakeTimers();
    try {
      const { browser, pages } = fakeBrowser();
      const thumbnails = createThumbnailPages(2, 10_000);
      const load = vi.fn(async () => {});

      await thumbnails.withPage(browser, "/preview", "v1", load, async () => null);
      await vi.advanceTimersByTimeAsync(9_999);
      expect(pages[0]?.close).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(pages[0]?.close).toHaveBeenCalled();

      await thumbnails.withPage(browser, "/preview", "v1", load, async () => null);
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes a page whose load fails, so failed loads leave no page open", async () => {
    const { browser, pages } = fakeBrowser();
    const thumbnails = createThumbnailPages();
    const load = vi.fn(async () => {
      throw new Error("navigation timeout");
    });

    for (let i = 0; i < 3; i++) {
      await expect(
        thumbnails.withPage(browser, "/preview", "v1", load, async () => null),
      ).rejects.toThrow("navigation timeout");
    }
    thumbnails.closeAll();

    expect(pages).toHaveLength(3);
    await vi.waitFor(() =>
      expect(pages.every((page) => page.close.mock.calls.length > 0)).toBe(true),
    );
  });

  it("never closes a page under a frame that is still being taken", async () => {
    const { browser, pages } = fakeBrowser();
    const thumbnails = createThumbnailPages(1);
    const load = vi.fn(async () => {});
    let finish: () => void = () => {};
    const slow = thumbnails.withPage(
      browser,
      "/a",
      "v1",
      load,
      () => new Promise<void>((r) => (finish = r)),
    );
    await vi.waitFor(() => expect(pages).toHaveLength(1));

    await thumbnails.withPage(browser, "/b", "v1", load, async () => null);
    expect(pages[0]?.close).not.toHaveBeenCalled();
    finish();
    await slow;
    await vi.waitFor(() => expect(pages[0]?.close).toHaveBeenCalled());
  });
});
