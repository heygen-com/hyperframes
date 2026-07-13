import { afterEach, describe, expect, it } from "vitest";
import type { Page } from "puppeteer-core";
import { decodeDynamicCssBackgroundImages } from "./frameCapture.js";

function makeMockPage(
  getBackgroundImage: () => string,
  decoded: string[],
  decodeImage?: (src: string) => Promise<void>,
): Page {
  return {
    evaluate: async (fn: () => unknown) => {
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
        return await fn();
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
  delete (globalThis as { __hf_css_background_decoded?: Set<string> }).__hf_css_background_decoded;
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
});
