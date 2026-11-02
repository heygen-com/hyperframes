import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "puppeteer-core";
import { BACKGROUND_DECODE_TIMEOUT_MS, decodeDynamicCssBackgroundImages } from "./frameCapture.js";

function makeMockPage(
  getBackgroundImage: () => string,
  decoded: string[],
  decodeImage?: (src: string) => Promise<void>,
): Page {
  return {
    evaluate: async (fn: (arg?: unknown) => unknown, arg?: unknown) => {
      const previousDocument = globalThis.document;
      const previousImage = globalThis.Image;
      const previousWindow = globalThis.window;

      const element = {
        style: {
          get backgroundImage() {
            return getBackgroundImage();
          },
        },
      };

      class MockImage {
        src = "";

        async decode(): Promise<void> {
          decoded.push(this.src);
          await decodeImage?.(this.src);
        }
      }

      Object.assign(globalThis, {
        document: {
          querySelectorAll: () => [element],
        },
        Image: MockImage,
        window: previousWindow ?? {},
      });

      try {
        return await fn(arg);
      } finally {
        Object.assign(globalThis, {
          document: previousDocument,
          Image: previousImage,
          window: previousWindow,
        });
      }
    },
  } as unknown as Page;
}

afterEach(() => {
  const root = globalThis as {
    __hf_css_background_decoded?: Set<string>;
    __hf_css_background_timed_out?: Set<string>;
    __hfDecodeDynamicCssBackgroundImages?: () => Promise<void>;
  };
  delete root.__hf_css_background_decoded;
  delete root.__hf_css_background_timed_out;
  vi.useRealTimers();
  delete root.__hfDecodeDynamicCssBackgroundImages;
});

describe("decodeDynamicCssBackgroundImages", () => {
  it("decodes each newly assigned inline background URL before capture", async () => {
    let backgroundImage = 'url("/assets/row-0.jpg")';
    const decoded: string[] = [];
    const page = makeMockPage(() => backgroundImage, decoded);

    await decodeDynamicCssBackgroundImages(page);
    await decodeDynamicCssBackgroundImages(page);

    backgroundImage = 'url("/assets/row-1.jpg")';
    await decodeDynamicCssBackgroundImages(page);

    expect(decoded).toEqual(["/assets/row-0.jpg", "/assets/row-1.jpg"]);
  });

  it("decodes every URL in a layered inline background", async () => {
    const decoded: string[] = [];
    const page = makeMockPage(
      () => "linear-gradient(#000, #fff), url(\"/assets/plate.png\"), url('/assets/grain.webp')",
      decoded,
    );

    await decodeDynamicCssBackgroundImages(page);

    expect(decoded).toEqual(["/assets/plate.png", "/assets/grain.webp"]);
  });

  it("rejects malformed quoted URLs without exponential backtracking", async () => {
    const decoded: string[] = [];
    const malformed = `url("${"\\!".repeat(27)}`;
    const page = makeMockPage(() => malformed, decoded);
    const startedAt = performance.now();

    await decodeDynamicCssBackgroundImages(page);

    expect(performance.now() - startedAt).toBeLessThan(250);
    expect(decoded).toEqual([]);
  });

  it("retries a URL after a transient decode failure", async () => {
    const decoded: string[] = [];
    let attempts = 0;
    const page = makeMockPage(
      () => 'url("/assets/late.jpg")',
      decoded,
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("not ready");
      },
    );

    await decodeDynamicCssBackgroundImages(page);
    await decodeDynamicCssBackgroundImages(page);

    expect(decoded).toEqual(["/assets/late.jpg", "/assets/late.jpg"]);
  });

  it("stops waiting for a url whose decode never settles and names it", async () => {
    vi.useFakeTimers();
    const decoded: string[] = [];
    const page = makeMockPage(
      () => 'url("/assets/stuck.jpg")',
      decoded,
      () => new Promise<void>(() => {}),
    );

    const first = decodeDynamicCssBackgroundImages(page);
    await vi.advanceTimersByTimeAsync(BACKGROUND_DECODE_TIMEOUT_MS);
    expect(await first).toEqual(["/assets/stuck.jpg"]);

    expect(await decodeDynamicCssBackgroundImages(page)).toEqual([]);
    expect(decoded).toEqual(["/assets/stuck.jpg"]);
  });

  it("installs a page-local decoder that can run after an in-page seek", async () => {
    let backgroundImage = 'url("/assets/row-0.jpg")';
    const decoded: string[] = [];
    const page = makeMockPage(() => backgroundImage, decoded);

    await decodeDynamicCssBackgroundImages(page);
    backgroundImage = 'url("/assets/row-1.jpg")';

    await page.evaluate(async () => {
      const decodeAfterSeek = (
        globalThis as { __hfDecodeDynamicCssBackgroundImages?: () => Promise<void> }
      ).__hfDecodeDynamicCssBackgroundImages;
      expect(decodeAfterSeek).toBeTypeOf("function");
      await decodeAfterSeek?.();
    });

    expect(decoded).toEqual(["/assets/row-0.jpg", "/assets/row-1.jpg"]);
  });

  it("awaits seek completion and the page-local decoder before batch paint", () => {
    const drawElementSource = readFileSync(
      fileURLToPath(new URL("./drawElementService.ts", import.meta.url)),
      "utf8",
    );
    const batchSource = drawElementSource.slice(
      drawElementSource.indexOf("export async function produceDrawElementFrameBatch"),
    );

    expect(batchSource).toMatch(
      /aw\.__hf\.seek\(t\);\s*await aw\.__hfWaitForSeekCompletion\?\.\(\);\s*await aw\.__hfDecodeDynamicCssBackgroundImages\?\.\(\);/,
    );
  });
});
