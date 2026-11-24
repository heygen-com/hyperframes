// Real Chrome: a CSS-placed element whose only tween is its opacity still moves by CSS once Studio has read GSAP.
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
  settleGsapSnapshot: typeof import("./gsapFrameSnapshot").settleGsapSnapshot;
  previewGestureStart: typeof import("../player/lib/previewElements").previewGestureStart;
};
let browser: Browser;
let studioBundle: string;

beforeAll(async () => {
  browser = await launchTestChrome();
  studioBundle = await buildStudioBundle([
    `export { settleGsapSnapshot } from "./hooks/gsapFrameSnapshot";`,
    `export { previewGestureStart } from "./player/lib/previewElements";`,
  ]);
});

afterAll(() => closeTestChrome(browser));

function previewHtml(): string {
  const gsap = readFileSync(require.resolve("gsap/dist/gsap.min.js"), "utf8");
  const runtime = readFileSync(require.resolve("@hyperframes/core/runtime"), "utf8");
  return `<!doctype html><html><head><meta charset="UTF-8" />
    <meta name="hyperframes-studio-preview" content="1" />
    <style>html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden }
      #title { position: absolute; left: 600px; top: 500px; translate: 0 -200px }</style>
    </head><body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1920" data-height="1080">
      <h1 id="title" class="clip" data-start="0" data-duration="4" data-track-index="1">Title</h1>
    </div>
    <script>${gsap}</script>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      tl.to("#title", { opacity: 0.5, duration: 4 }, 0);
      window.__timelines.main = tl;
    </script>
    <script>${runtime}</script></body></html>`;
}

// fails without the fix: the sealed read asked GSAP for x, GSAP took over the translate and the move saved as gsap.set.
it.each(MODES)("a move after a GSAP read still saves as a CSS translate (%s)", async (mode) => {
  const preview = await openPreview(browser, studioBundle, previewHtml(), mode);
  await preview.seek(1);
  const start = await preview.page.evaluate(async () => {
    const studio = (window as unknown as { hfStudio: Reads }).hfStudio;
    const iframe = document.querySelector("iframe")!;
    studio.usePlayerStore.setState({ currentTime: 1, isPlaying: false });
    await studio.settleGsapSnapshot(iframe);
    const query = await studio.previewRequest(iframe, "query", { selector: "#title" });
    const handle = (query as { matches: Array<{ handle: string }> } | null)?.matches[0]?.handle;
    return (await studio.previewGestureStart(iframe, [handle!]))?.elements[0];
  });
  expect(start).toMatchObject({ gsap: null });
  const drawn = await preview.frame.evaluate(
    () => getComputedStyle(document.getElementById("title")!).translate,
  );
  expect(drawn).toBe("0px -200px");
  await preview.page.close();
});
