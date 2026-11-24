import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { closeTestChrome, launchTestChrome } from "../../tests/chromeTestUtils";
import { buildStudioBundle, openPreview, type Preview } from "../../tests/sealedPreviewHarness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const require = createRequire(import.meta.url);
const MODES = process.env.HF_PARITY_MODE ? [process.env.HF_PARITY_MODE] : ["unsealed", "sealed"];
let browser: Browser;
let studioBundle: string;

beforeAll(async () => {
  browser = await launchTestChrome();
  studioBundle = await buildStudioBundle([
    `export { captureDurationRollback, patchIframeDomTiming, syncPreviewContentDuration } from "./hooks/previewTimingPatch";`,
  ]);
});

afterAll(() => closeTestChrome(browser));

function previewHtml(): string {
  const runtime = readFileSync(require.resolve("@hyperframes/core/runtime"), "utf8");
  return `<!doctype html><html><head><meta charset="UTF-8" />
    <meta name="hyperframes-studio-preview" content="1" />
    </head><body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1920" data-height="1080">
      <div id="a" class="clip" data-start="0" data-duration="4" data-track-index="1"></div>
      <div id="b" class="clip" data-start="0" data-duration="2" data-track-index="2"></div>
    </div>
    <script>${runtime}</script></body></html>`;
}

type Studio = {
  usePlayerStore: { getState(): { duration: number }; setState(state: object): void };
  patchIframeDomTiming(...args: unknown[]): void;
  syncPreviewContentDuration(iframe: HTMLIFrameElement): void;
  captureDurationRollback(iframe: HTMLIFrameElement): () => void;
};

const shown = async ({ page, frame }: Preview) => ({
  duration: await page.evaluate(
    () => (window as unknown as { hfStudio: Studio }).hfStudio.usePlayerStore.getState().duration,
  ),
  frame: await frame.evaluate(() => {
    const a = document.getElementById("a")!;
    return {
      start: a.getAttribute("data-start"),
      length: a.getAttribute("data-duration"),
      root: document.getElementById("root")!.getAttribute("data-duration"),
    };
  }),
});

async function timingEdit(mode: string) {
  const preview = await openPreview(browser, studioBundle, previewHtml(), mode);
  try {
    await preview.page.evaluate(() => {
      const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
      const iframe = document.querySelector("iframe")!;
      studio.usePlayerStore.setState({ duration: 4 });
      const clip = {
        id: "a",
        domId: "a",
        selector: "#a",
        sourceFile: "index.html",
        kind: "element",
      };
      studio.patchIframeDomTiming(iframe, clip, [
        ["data-start", "2"],
        ["data-duration", "3"],
      ]);
      (window as unknown as { rollback: () => void }).rollback =
        studio.captureDurationRollback(iframe);
      studio.syncPreviewContentDuration(iframe);
    });
    const patched = { duration: 5, frame: { start: "2", length: "3", root: "5" } };
    await expect.poll(() => shown(preview)).toEqual(patched);
    await preview.page.evaluate(() => (window as unknown as { rollback: () => void }).rollback());
    await expect
      .poll(() => shown(preview))
      .toEqual({ ...patched, duration: 4, frame: { ...patched.frame, root: "4" } });
  } finally {
    await preview.page.close();
  }
}

it.each(MODES)("a timing edit patches the clip and the duration in a %s preview", async (mode) => {
  await timingEdit(mode);
});
