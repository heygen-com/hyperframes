// Real Chrome: the off-canvas indicators a preview Studio cannot script (a sandboxed frame) gets are the ones a
// same-origin preview gets, for an element past an edge, a turned one, a crop that keeps it inside, and one inside.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeTestChrome, launchTestChrome } from "../../../tests/chromeTestUtils";
import { buildStudioBundle, openPreview, type Studio } from "../../../tests/sealedPreviewHarness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const require = createRequire(import.meta.url);
const MODES = process.env.HF_PARITY_MODE ? [process.env.HF_PARITY_MODE] : ["unsealed", "sealed"];
let browser: Browser;
let studioBundle: string;

beforeAll(async () => {
  browser = await launchTestChrome();
  studioBundle = await buildStudioBundle([
    `export { startOffCanvasIndicatorRefresh } from "./components/editor/offCanvasIndicatorRefresh";`,
  ]);
});

afterAll(() => closeTestChrome(browser));

function previewHtml(): string {
  const runtime = readFileSync(require.resolve("@hyperframes/core/runtime"), "utf8");
  const clip = (id: string, track: number, style: string) =>
    `<div id="${id}" class="clip" data-start="0" data-duration="4" data-track-index="${track}" style="${style}"></div>`;
  return `<!doctype html><html><head><meta charset="UTF-8" />
    <meta name="hyperframes-studio-preview" content="1" />
    <style>html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden }
      .clip { position: absolute; width: 300px; height: 200px; background: #888 }</style></head><body>
    <main id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1920" data-height="1080">
      ${clip("inside", 1, "left: 800px; top: 400px")}
      ${clip("hangs-left", 2, "left: -150px; top: 100px")}
      ${clip("turned", 3, "left: 1750px; top: 800px; transform: rotate(30deg)")}
      ${clip("cropped", 4, "left: -200px; top: 600px; clip-path: inset(0 0 0 220px)")}
    </main>
    <script>${runtime}</script></body></html>`;
}

type Shown = {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
  angle?: number;
};

describe.each(MODES)("off-canvas indicators, %s preview", (mode) => {
  it("flags the elements that cross the composition edge, where they render", async () => {
    const { page } = await openPreview(browser, studioBundle, previewHtml(), mode);
    await page.evaluate(() => {
      const iframe = document.querySelector("iframe")!;
      const box = iframe.getBoundingClientRect();
      const overlay = document.createElement("div");
      overlay.style.cssText = `position: absolute; left: ${box.left}px; top: ${box.top}px; width: ${box.width}px; height: ${box.height}px; pointer-events: none`;
      document.body.append(overlay);
      const w = window as unknown as {
        hfStudio: Studio & { startOffCanvasIndicatorRefresh: (options: unknown) => () => void };
        __shown: unknown[];
      };
      w.__shown = [];
      const ref = <T>(current: T) => ({ current });
      // The overlay loop runs once Studio has seen the preview boot.
      w.hfStudio.usePlayerStore.setState({ previewBooted: true });
      w.hfStudio.startOffCanvasIndicatorRefresh({
        iframeRef: ref(iframe),
        overlayRef: ref(overlay),
        compRectRef: ref({ left: 0, top: 0, width: box.width, height: box.height }),
        activeCompositionPathRef: ref("index.html"),
        dirtyRef: ref(true),
        sigRef: ref(""),
        observerRef: ref(null),
        observedDocRef: ref(null),
        elementsRef: ref(new Map()),
        setRects: (rects: unknown[]) => {
          w.__shown = rects;
        },
      });
    });
    const shown = () => page.evaluate(() => (window as unknown as { __shown: Shown[] }).__shown);
    await expect.poll(async () => (await shown()).length, { timeout: 10_000 }).toBe(2);
    const rects = (await shown()).sort((a, b) => a.key.localeCompare(b.key));
    expect(rects.map((r) => r.key)).toEqual(["index.html:hangs-left:0", "index.html:turned:0"]);
    const [left, turned] = rects;
    expect(left).toMatchObject({ left: -150, top: 100, width: 300, height: 200 });
    expect(left!.angle ?? 0).toBeCloseTo(0, 3);
    expect(turned!.left).toBeCloseTo(1750, 1);
    expect(turned!.top).toBeCloseTo(800, 1);
    expect(turned!.width).toBeCloseTo(300, 1);
    expect(turned!.height).toBeCloseTo(200, 1);
    expect(turned!.angle).toBeCloseTo(30, 1);
    await page.close();
  });
});
