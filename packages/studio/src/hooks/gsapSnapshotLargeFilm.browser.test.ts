// Real Chrome: a film with thousands of tweens on hundreds of layers reads into Studio sealed as unsealed.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { closeTestChrome, launchTestChrome } from "../../tests/chromeTestUtils";
import { buildStudioBundle, openPreview } from "../../tests/sealedPreviewHarness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const require = createRequire(import.meta.url);
const MODES = process.env.HF_PARITY_MODE ? [process.env.HF_PARITY_MODE] : ["unsealed", "sealed"];
const CELLS = 700;
const FLIPS = 4;
let browser: Browser;
let studioBundle: string;

beforeAll(async () => {
  browser = await launchTestChrome();
  studioBundle = await buildStudioBundle([
    `export { readGsapSnapshot } from "./hooks/gsapSnapshotReply";`,
    `export { frameTimelines, settleGsapSnapshot } from "./hooks/gsapFrameSnapshot";`,
  ]);
});

afterAll(() => closeTestChrome(browser));

// A flickering grid of binary digits, each cell flipped by its own sets, beside one button.
function previewHtml(): string {
  const gsap = readFileSync(require.resolve("gsap/dist/gsap.min.js"), "utf8");
  const runtime = readFileSync(require.resolve("@hyperframes/core/runtime"), "utf8");
  return `<!doctype html><html><head><meta charset="UTF-8" />
    <meta name="hyperframes-studio-preview" content="1" />
    </head><body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1920" data-height="1080">
      <div id="grid"></div>
      <button id="button" data-start="0" data-duration="4">Button</button>
    </div>
    <script>${gsap}</script>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      var grid = document.getElementById("grid");
      for (var i = 0; i < ${CELLS}; i++) {
        var cell = grid.appendChild(document.createElement("span"));
        for (var f = 0; f < ${FLIPS}; f++) tl.set(cell, { attr: { "data-b": (i + f) % 2 } }, f * 0.5);
      }
      tl.to("#button", { scale: 1.1, duration: 1 }, 1);
      window.__timelines.main = tl;
    </script>
    <script>${runtime}</script></body></html>`;
}

// fails without the fix: past the snapshot's 2,048-tween and 512-target caps a sealed frame answered no snapshot,
// so every resize there said "The preview didn't answer".
it.each(MODES)(
  "a film past 2,048 tweens on 512 layers is read whole, in a %s preview",
  async (mode) => {
    const preview = await openPreview(browser, studioBundle, previewHtml(), mode);
    try {
      const read = await preview.page.evaluate(async () => {
        type Snapshot = {
          timelines: Array<{ tweens: unknown[] }>;
          targets: Array<{ id: string }>;
        };
        type Studio = {
          previewRequest(
            iframe: HTMLIFrameElement,
            kind: string,
            params: unknown,
          ): Promise<unknown>;
          readGsapSnapshot(value: unknown): Snapshot | null;
          settleGsapSnapshot(iframe: HTMLIFrameElement): Promise<boolean>;
          frameTimelines(
            iframe: HTMLIFrameElement,
          ): Record<string, { getChildren(): unknown[] }> | null;
        };
        const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
        const iframe = document.querySelector("iframe")!;
        // The gate a resize press and a moving layer's move both wait on.
        const gestureCanStart = await studio.settleGsapSnapshot(iframe);
        const timeline = studio.frameTimelines(iframe)?.main?.getChildren().length ?? null;
        const snapshot = studio.readGsapSnapshot(
          await studio.previewRequest(iframe, "gsap-snapshot", {}).catch(() => null),
        );
        return {
          gestureCanStart,
          timeline,
          tweens: snapshot?.timelines.flatMap((line) => line.tweens).length ?? 0,
          targets: snapshot?.targets.length ?? 0,
          button: snapshot?.targets.some((target) => target.id === "button") ?? false,
        };
      });
      expect(read).toMatchObject({ gestureCanStart: true, button: true });
      expect(read.tweens).toBeGreaterThan(CELLS * FLIPS);
      expect(read.targets).toBeGreaterThan(CELLS);
      expect(read.timeline).toBe(mode === "sealed" ? read.tweens : null);
    } finally {
      await preview.page.close();
    }
  },
);
