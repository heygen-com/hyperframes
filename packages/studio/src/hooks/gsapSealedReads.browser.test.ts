// Real Chrome: what a commit reads of an element's GSAP values, in a sealed preview and a same-origin one.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { closeTestChrome, launchTestChrome } from "../../tests/chromeTestUtils";
import { buildStudioBundle, openPreview, type Studio } from "../../tests/sealedPreviewHarness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const require = createRequire(import.meta.url);
const MODES = process.env.HF_PARITY_MODE ? [process.env.HF_PARITY_MODE] : ["unsealed", "sealed"];
type Reads = Studio & {
  readAllAnimatedProperties: typeof import("./gsapRuntimeReaders").readAllAnimatedProperties;
  settleGsapSnapshot: typeof import("./gsapFrameSnapshot").settleGsapSnapshot;
};
let browser: Browser;
let studioBundle: string;

beforeAll(async () => {
  browser = await launchTestChrome();
  studioBundle = await buildStudioBundle([
    `export { readAllAnimatedProperties } from "./hooks/gsapRuntimeReaders";`,
    `export { settleGsapSnapshot } from "./hooks/gsapFrameSnapshot";`,
  ]);
});

afterAll(() => closeTestChrome(browser));

/** #box turns in one tween and rounds its corners in another, both over 0-2 s. */
function previewHtml(): string {
  const gsap = readFileSync(require.resolve("gsap/dist/gsap.min.js"), "utf8");
  const runtime = readFileSync(require.resolve("@hyperframes/core/runtime"), "utf8");
  return `<!doctype html><html><head><meta charset="UTF-8" />
    <meta name="hyperframes-studio-preview" content="1" />
    <style>html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden }
      #box { position: absolute; left: 100px; top: 100px; width: 200px; height: 200px; background: #f0c020 }</style>
    </head><body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1920" data-height="1080">
      <div id="box" class="clip" data-start="0" data-duration="4" data-track-index="1"></div>
    </div>
    <script>${gsap}</script>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      tl.to("#box", { rotation: 20, duration: 2, ease: "none" }, 0);
      tl.to("#box", { borderRadius: "24px", duration: 2, ease: "none" }, 0);
      window.__timelines.main = tl;
    </script>
    <script>${runtime}</script></body></html>`;
}

// fails without the fix: a sealed read saw no tween writing borderRadius and copied it into the rotation commit.
it.each(MODES)("a rotation commit reads only the rotation tween's channels (%s)", async (mode) => {
  const preview = await openPreview(browser, studioBundle, previewHtml(), mode);
  await preview.seek(1);
  const read = await preview.page.evaluate(async () => {
    const studio = (window as unknown as { hfStudio: Reads }).hfStudio;
    const iframe = document.querySelector("iframe")!;
    studio.usePlayerStore.setState({ currentTime: 1, isPlaying: false });
    await studio.settleGsapSnapshot(iframe);
    return studio.readAllAnimatedProperties(iframe, "#box", {
      properties: { rotation: 20 },
    } as never);
  });
  expect(read).toEqual({ rotation: 10 });
  await preview.page.close();
});

// fails without the fix: a read right after a seek found no sealed values yet and the commit got none of GSAP's.
it.each(MODES)(
  "a commit's read waits for the frame's values at the playhead (%s)",
  async (mode) => {
    const preview = await openPreview(browser, studioBundle, previewHtml(), mode);
    await preview.seek(1);
    const read = await preview.page.evaluate(() => {
      const studio = (window as unknown as { hfStudio: Reads }).hfStudio;
      const iframe = document.querySelector("iframe")!;
      studio.usePlayerStore.setState({ currentTime: 1, isPlaying: false });
      return studio.readAllAnimatedProperties(iframe, "#box", {
        properties: { rotation: 20 },
      } as never);
    });
    expect(read).toEqual({ rotation: 10 });
    await preview.page.close();
  },
);
