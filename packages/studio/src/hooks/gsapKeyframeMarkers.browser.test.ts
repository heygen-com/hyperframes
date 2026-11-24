// Real Chrome: after a tween write, a class or descendant tween's keyframe markers land on the elements it
// animates, in a preview Studio cannot script (a sandboxed frame) exactly as in a same-origin one.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { closeTestChrome, launchTestChrome } from "../../tests/chromeTestUtils";
import { buildStudioBundle, openPreview, type Studio } from "../../tests/sealedPreviewHarness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const require = createRequire(import.meta.url);
const MODES = process.env.HF_PARITY_MODE ? [process.env.HF_PARITY_MODE] : ["unsealed", "sealed"];
let browser: Browser;
let studioBundle: string;

beforeAll(async () => {
  browser = await launchTestChrome();
  studioBundle = await buildStudioBundle([
    `export { cacheCommittedKeyframes } from "./hooks/gsapKeyframeCacheHelpers";`,
  ]);
});

afterAll(() => closeTestChrome(browser));

function previewHtml(): string {
  const gsap = readFileSync(require.resolve("gsap/dist/gsap.min.js"), "utf8");
  const runtime = readFileSync(require.resolve("@hyperframes/core/runtime"), "utf8");
  const clip = (id: string, cls: string) =>
    `<div id="${id}" class="${cls}" data-start="0" data-duration="4"></div>`;
  return `<!doctype html><html><head><meta charset="UTF-8" />
    <meta name="hyperframes-studio-preview" content="1" /></head><body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1920" data-height="1080">
      <div id="stat3">${clip("blk1", "block")}${clip("blk2", "block")}</div>
      ${clip("outside", "block")}${clip("d1", "dot")}${clip("d2", "dot")}
    </div>
    <script>${gsap}</script>
    <script>(function () {
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      tl.to(".dot", { x: 100, duration: 4 }, 0);
      tl.to("#stat3 .block", { y: 50, duration: 4 }, 0);
      window.__timelines.main = tl;
    })();</script>
    <script>${runtime}</script></body></html>`;
}

const tween = (id: string, targetSelector: string): GsapAnimation => ({
  id,
  targetSelector,
  method: "to",
  position: 0,
  properties: {},
  duration: 4,
  resolvedStart: 0,
  propertyGroup: "position",
  keyframes: { format: "percentage", keyframes: [{ percentage: 50, properties: { x: 100 } }] },
});

describe.each(MODES)("keyframe markers after a tween write, %s preview", (mode) => {
  it("files class and descendant tweens under every element they animate", async () => {
    const { page } = await openPreview(browser, studioBundle, previewHtml(), mode);
    const marked = await page.evaluate(
      async (animations) => {
        const studio = (window as unknown as { hfStudio: Studio & Record<string, Function> })
          .hfStudio;
        studio.usePlayerStore.setState({ keyframeCache: new Map(), gsapAnimations: new Map() });
        // The edit was to the `.dot` tween with d1 selected.
        await studio.cacheCommittedKeyframes(
          document.querySelector("iframe"),
          animations,
          "index.html",
          "d1",
          { targetSelector: ".dot" },
        );
        const keys = [...studio.usePlayerStore.getState().keyframeCache.keys()] as string[];
        return keys.filter((k) => k.startsWith("index.html#")).sort();
      },
      [tween("dots", ".dot"), tween("blocks", "#stat3 .block")],
    );
    expect(marked).toEqual([
      "index.html#blk1",
      "index.html#blk2",
      "index.html#d1",
      "index.html#d2",
    ]);
    await page.close();
  });
});
