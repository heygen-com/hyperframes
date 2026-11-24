import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { closeTestChrome, launchTestChrome } from "../../../tests/chromeTestUtils";
import { buildStudioBundle, openPreview } from "../../../tests/sealedPreviewHarness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const require = createRequire(import.meta.url);
const MODES = process.env.HF_PARITY_MODE ? [process.env.HF_PARITY_MODE] : ["unsealed", "sealed"];
let browser: Browser;
let studioBundle: string;

beforeAll(async () => {
  browser = await launchTestChrome();
  studioBundle = await buildStudioBundle([
    `export { previewAuthoredStyles, previewFontFaces } from "./player/lib/previewChannel";`,
    `export { queryPreviewElements } from "./player/lib/previewElements";`,
  ]);
});

afterAll(() => closeTestChrome(browser));

function previewHtml(): string {
  const runtime = readFileSync(require.resolve("@hyperframes/core/runtime"), "utf8");
  return `<!doctype html><html><head><meta charset="UTF-8" />
    <meta name="hyperframes-studio-preview" content="1" />
    <style>
      @font-face { font-family: "Brand Sans"; src: url("fonts/brand.woff2"); }
      h1 { font-size: 3rem; }
      .title { font-size: 48px; color: rgb(200, 0, 0); }
    </style>
    </head><body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1920" data-height="1080">
      <h1 class="title" data-hf-id="t1" style="color: blue" data-start="0" data-duration="4">Hello</h1>
      <h1 class="plain" data-hf-id="t2" data-start="0" data-duration="4">Plain</h1>
    </div>
    <script>document.fonts.add(new FontFace("Scripted", "url(fonts/scripted.woff2)"));</script>
    <script>${runtime}</script></body></html>`;
}

async function textStyleReads(mode: string) {
  const preview = await openPreview(browser, studioBundle, previewHtml(), mode);
  try {
    return await preview.page.evaluate(async () => {
      type Studio = {
        queryPreviewElements(
          iframe: HTMLIFrameElement,
          selector: string,
        ): Promise<{ matches: Array<{ handle: string }> } | null>;
        previewAuthoredStyles(
          iframe: HTMLIFrameElement,
          handle: string,
          properties: string[],
        ): Promise<Record<string, string> | null>;
        previewFontFaces(iframe: HTMLIFrameElement): Promise<unknown>;
      };
      const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
      const iframe = document.querySelector("iframe")!;
      const handleOf = async (selector: string) =>
        (await studio.queryPreviewElements(iframe, selector))!.matches[0]!.handle;
      const properties = ["font-size", "color", "letter-spacing"];
      return {
        title: await studio.previewAuthoredStyles(iframe, await handleOf(".title"), properties),
        plain: await studio.previewAuthoredStyles(iframe, await handleOf(".plain"), properties),
        fonts: await studio.previewFontFaces(iframe),
      };
    });
  } finally {
    await preview.page.close();
  }
}

it.each(MODES)(
  "the frame answers a text toolbar's authored styles and fonts the same in a %s preview",
  async (mode) => {
    const reads = await textStyleReads(mode);
    expect(reads.title).toEqual({ "font-size": "48px", color: "blue" });
    expect(reads.plain).toEqual({ "font-size": "3rem" });
    expect(reads.fonts).toEqual({
      families: ["Brand Sans", "Scripted"],
      ownFaces: [{ family: '"Brand Sans"', src: 'url("fonts/brand.woff2")' }],
    });
  },
);
