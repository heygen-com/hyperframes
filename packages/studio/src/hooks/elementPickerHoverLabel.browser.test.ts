// @vitest-environment happy-dom
import { build } from "esbuild";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { closeTestChrome, launchTestChrome } from "../../tests/chromeTestUtils";

vi.setConfig({ testTimeout: 60_000 });

let browser: Awaited<ReturnType<typeof launchTestChrome>> | undefined;

afterEach(async () => {
  await closeTestChrome(browser);
  browser = undefined;
});

it("keeps the hover label readable inside a transformed preview without taking pointer input", async () => {
  const bundle = await build({
    entryPoints: [join(import.meta.dirname, "elementPickerHoverLabel.ts")],
    bundle: true,
    format: "iife",
    globalName: "PickerHoverLabel",
    platform: "browser",
    write: false,
  });
  browser = await launchTestChrome();
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 600 });
  await page.setContent(`<!doctype html><style>
    :root {
      --color-studio-accent: #6ee7b7;
      --color-studio-bg: #18181b;
      --color-studio-text: #fafafa;
      --shadow-popover: 0 2px 8px #0008;
    }
    body { margin: 40px; }
    iframe { width: 320px; height: 180px; transform: scale(1.5); transform-origin: top left; }
  </style><iframe id="preview"></iframe>`);
  await page.addScriptTag({ content: bundle.outputFiles[0]?.text });

  const result = await page.evaluate(() => {
    const preview = document.querySelector<HTMLIFrameElement>("#preview");
    if (!preview) throw new Error("preview iframe missing");
    const api = (
      window as typeof window & {
        PickerHoverLabel: {
          createElementPickerHoverLabel(): {
            show(
              info: {
                id: string;
                tagName: string;
                boundingBox: { x: number; y: number; width: number; height: number };
              },
              iframe: HTMLIFrameElement,
            ): void;
          };
        };
      }
    ).PickerHoverLabel.createElementPickerHoverLabel();
    api.show(
      {
        id: "hero-title",
        tagName: "h1",
        boundingBox: { x: 270, y: 24, width: 40, height: 30 },
      },
      preview,
    );
    const label = document.querySelector<HTMLElement>("[data-hf-picker-hover-label]");
    if (!label) throw new Error("hover label missing");
    const labelRect = label.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    return {
      text: label.textContent,
      pointerEvents: getComputedStyle(label).pointerEvents,
      insidePreview: labelRect.left >= previewRect.left && labelRect.right <= previewRect.right,
      insideViewport: labelRect.left >= 0 && labelRect.right <= innerWidth,
    };
  });

  expect(result).toEqual({
    text: "h1#hero-title",
    pointerEvents: "none",
    insidePreview: true,
    insideViewport: true,
  });
});
