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
    `export { readElementInfoText, readGsapBorderRadiusForPanel } from "./components/editor/propertyPanelSealedReads";`,
  ]);
});

afterAll(() => closeTestChrome(browser));

function previewHtml(): string {
  const gsap = readFileSync(require.resolve("gsap/dist/gsap.min.js"), "utf8");
  const runtime = readFileSync(require.resolve("@hyperframes/core/runtime"), "utf8");
  return `<!doctype html><html><head><meta charset="UTF-8" />
    <meta name="hyperframes-studio-preview" content="1" />
    <style>html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden }
      #root { position: relative; width: 100%; height: 100% }</style>
    </head><body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1920" data-height="1080">
      <div id="intro" class="clip" data-start="0" data-duration="4" data-track-index="2">Intro</div>
      <div id="card" class="clip card" data-start="0" data-duration="4" data-track-index="1"
        style="position: absolute; width: 400px; height: 300px; background: red; border-radius: 0px"></div>
    </div>
    <script>${gsap}</script>
    <script>(function () {
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      tl.to("#card", { borderRadius: "40px 80px 120px 20px", duration: 4, ease: "none" }, 0);
      window.__timelines.main = tl;
    })();</script>
    <script>${runtime}</script></body></html>`;
}

async function panelReads(mode: string) {
  const preview = await openPreview(browser, studioBundle, previewHtml(), mode);
  try {
    await preview.seek(2);
    return await preview.page.evaluate(async () => {
      type Studio = {
        previewRequest(
          iframe: HTMLIFrameElement,
          kind: "query",
          params: { selector: string },
        ): Promise<{ matches: Array<{ handle: string }> } | null>;
        readGsapBorderRadiusForPanel(...args: unknown[]): unknown;
        readElementInfoText(...args: unknown[]): Promise<string>;
      };
      const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
      const iframe = document.querySelector("iframe")!;
      const query = await studio.previewRequest(iframe, "query", { selector: "#card" });
      const element = {
        element: null,
        handle: query?.matches[0]?.handle,
        id: "card",
        selector: "#card",
        sourceFile: "index.html",
        tagName: "div",
        label: "card",
        boundingBox: { x: 0, y: 0, width: 400, height: 300 },
        computedStyles: {},
      };
      const animations = [{ properties: { borderRadius: "40px 80px 120px 20px" } }];
      const radius = await studio.readGsapBorderRadiusForPanel(null, animations, element, iframe);
      const info = await studio.readElementInfoText(element, "#card", [], iframe);
      return { radius, file: info.split("\n").find((line) => line.startsWith("File:")) };
    });
  } finally {
    await preview.page.close();
  }
}

it.each(MODES)(
  "the property panel reads corner radii and the source line in a %s preview",
  async (mode) => {
    const reads = await panelReads(mode);
    expect(reads.radius).toEqual({ tl: 20, tr: 40, br: 60, bl: 10 });
    expect(reads.file).toMatch(/^File: index\.html:\d+$/);
    expect(reads.file).not.toBe("File: index.html:1");
    expect(reads).toEqual(await panelReads("unsealed"));
  },
);
