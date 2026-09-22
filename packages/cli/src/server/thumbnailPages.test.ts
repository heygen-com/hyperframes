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
});
