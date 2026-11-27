// Real Chrome: the shown display of every element a selector matches, read the same in a sealed preview and a
// same-origin one, so a reader of the page's markup can tell words laid out as blocks from words in one line.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { closeTestChrome, launchTestChrome } from "../../../tests/chromeTestUtils";
import { buildStudioBundle, openPreview, type Studio } from "../../../tests/sealedPreviewHarness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const require = createRequire(import.meta.url);
const MODES = process.env.HF_PARITY_MODE ? [process.env.HF_PARITY_MODE] : ["unsealed", "sealed"];
type Reads = Studio & {
  previewComputedStylesOfEvery: typeof import("./previewChannel").previewComputedStylesOfEvery;
};
let browser: Browser;
let studioBundle: string;

beforeAll(async () => {
  browser = await launchTestChrome();
  studioBundle = await buildStudioBundle([
    `export { previewComputedStylesOfEvery } from "./player/lib/previewChannel";`,
  ]);
});

afterAll(() => closeTestChrome(browser));

function previewHtml(): string {
  const runtime = readFileSync(require.resolve("@hyperframes/core/runtime"), "utf8");
  return `<!doctype html><html><head><meta charset="UTF-8" />
    <meta name="hyperframes-studio-preview" content="1" />
    <style>.line { display: block }</style>
    </head><body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1920" data-height="1080">
      <div id="headline" class="clip" data-start="0" data-duration="4" data-track-index="0"><span style="display: block">Launch</span><span class="line">day</span></div>
      <p id="inline" class="clip" data-start="0" data-duration="4" data-track-index="1"><span>Big</span> <b>news</b></p>
    </div>
    <script>${runtime}</script></body></html>`;
}

// fails without the fix: the frame answered one element per request, so a sealed reader had no shown display for
// a clip's words and guessed from tags.
it.each(MODES)("reads the shown display of every match, in page order (%s)", async (mode) => {
  const preview = await openPreview(browser, studioBundle, previewHtml(), mode);
  const read = await preview.page.evaluate(async () => {
    const studio = (window as unknown as { hfStudio: Reads }).hfStudio;
    const iframe = document.querySelector("iframe")!;
    const display = (selector: string) =>
      studio.previewComputedStylesOfEvery(iframe, selector, ["display"]);
    return [await display("#headline, #headline *"), await display("#inline *")];
  });
  expect(read).toEqual([
    {
      matches: [{ display: "block" }, { display: "block" }, { display: "block" }],
      truncated: false,
    },
    { matches: [{ display: "inline" }, { display: "inline" }], truncated: false },
  ]);
  await preview.page.close();
});
