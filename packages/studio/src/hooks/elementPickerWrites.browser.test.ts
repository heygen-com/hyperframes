import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { closeTestChrome, launchTestChrome } from "../../tests/chromeTestUtils";
import { buildStudioBundle, openPreview } from "../../tests/sealedPreviewHarness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const require = createRequire(import.meta.url);
const MODES = process.env.HF_PARITY_MODE ? [process.env.HF_PARITY_MODE] : ["unsealed", "sealed"];
let browser: Browser;
let studioBundle: string;

beforeAll(async () => {
  browser = await launchTestChrome();
  studioBundle = await buildStudioBundle([
    `export { writePicked } from "./hooks/elementPickerWrites";`,
  ]);
});

afterAll(() => closeTestChrome(browser));

function previewHtml(): string {
  const runtime = readFileSync(require.resolve("@hyperframes/core/runtime"), "utf8");
  return `<!doctype html><html><head><meta charset="UTF-8" />
    <meta name="hyperframes-studio-preview" content="1" />
    </head><body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1920" data-height="1080">
      <h1 class="title" data-hf-id="t1" data-start="0" data-duration="4" data-track-index="1">Hello</h1>
    </div>
    <script>${runtime}</script></body></html>`;
}

async function pickerWrites(mode: string) {
  const preview = await openPreview(browser, studioBundle, previewHtml(), mode);
  try {
    const sources = await preview.page.evaluate(async () => {
      type Studio = {
        writePicked(iframe: HTMLIFrameElement, selector: string, write: unknown): unknown;
      };
      const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
      const iframe = document.querySelector("iframe")!;
      return [
        await studio.writePicked(iframe, ".title", {
          live: (el: HTMLElement) => el.style.setProperty("color", "rgb(0, 128, 0)"),
          sealed: { styles: [["color", "rgb(0, 128, 0)"]] },
        }),
        await studio.writePicked(iframe, ".title", {
          live: (el: HTMLElement) => el.setAttribute("data-mood", "calm"),
          sealed: { attributes: [["data-mood", "calm"]] },
        }),
        await studio.writePicked(iframe, ".title", {
          live: (el: HTMLElement) => {
            el.textContent = "Hi <there> & you";
          },
          sealed: { html: "Hi &lt;there&gt; &amp; you" },
        }),
        await studio.writePicked(iframe, ".missing", {
          live: () => {},
          sealed: { styles: [["color", "red"]] },
        }),
      ];
    });
    const drawn = await preview.frame.evaluate(() => {
      const title = document.querySelector<HTMLElement>(".title")!;
      return {
        color: getComputedStyle(title).color,
        mood: title.getAttribute("data-mood"),
        text: title.textContent,
      };
    });
    return { sources, drawn };
  } finally {
    await preview.page.close();
  }
}

it.each(MODES)(
  "the element picker's style, data and text edits draw in a %s preview",
  async (mode) => {
    const writes = await pickerWrites(mode);
    const source = { hfId: "t1", ownFile: "index.html" };
    expect(writes).toEqual({
      sources: [source, source, source, null],
      drawn: { color: "rgb(0, 128, 0)", mood: "calm", text: "Hi <there> & you" },
    });
  },
);
