// Real Chrome: a tween only GSAP's global timeline runs reaches a sealed snapshot as a same-origin one.
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
    `export { queryPreviewElements } from "./player/lib/previewElements";`,
    `export { readGsapSnapshot } from "./hooks/gsapSnapshotReply";`,
  ]);
});

afterAll(() => closeTestChrome(browser));

function previewHtml(): string {
  const gsap = readFileSync(require.resolve("gsap/dist/gsap.min.js"), "utf8");
  const runtime = readFileSync(require.resolve("@hyperframes/core/runtime"), "utf8");
  return `<!doctype html><html><head><meta charset="UTF-8" />
    <meta name="hyperframes-studio-preview" content="1" />
    </head><body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1920" data-height="1080">
      <h1 id="a" data-start="0" data-duration="4">A</h1>
      <h1 id="b" data-start="0" data-duration="4">B</h1>
    </div>
    <script>${gsap}</script>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      tl.to("#a", { x: 100, duration: 2 }, 0);
      window.__timelines.main = tl;
      gsap.to("#b", { color: "rgb(255, 0, 0)", duration: 2, paused: true });
    </script>
    <script>${runtime}</script></body></html>`;
}

it.each(MODES)(
  "a tween only GSAP's global timeline runs is in the snapshot once, in a %s preview",
  async (mode) => {
    const preview = await openPreview(browser, studioBundle, previewHtml(), mode);
    try {
      const read = await preview.page.evaluate(async () => {
        type Snapshot = {
          timelines: Array<{ tweens: Array<{ targets: string[] }> }>;
          globalTweens: Array<{ targets: string[]; vars: Record<string, unknown> }>;
        };
        type Studio = {
          previewRequest(
            iframe: HTMLIFrameElement,
            kind: string,
            params: unknown,
          ): Promise<unknown>;
          readGsapSnapshot(value: unknown): Snapshot | null;
          queryPreviewElements(
            iframe: HTMLIFrameElement,
            selector: string,
          ): Promise<{ matches: Array<{ handle: string }> } | null>;
        };
        const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
        const iframe = document.querySelector("iframe")!;
        const handle = async (selector: string) =>
          (await studio.queryPreviewElements(iframe, selector))!.matches[0]!.handle;
        const snapshot = studio.readGsapSnapshot(
          await studio.previewRequest(iframe, "gsap-snapshot", {}),
        )!;
        const [a, b] = [await handle("#a"), await handle("#b")];
        return {
          registered: snapshot.timelines.flatMap((line) => line.tweens.map((t) => t.targets)),
          global: snapshot.globalTweens.map((t) => t.targets),
          globalVars: snapshot.globalTweens.map((t) => t.vars),
          a,
          b,
        };
      });
      expect(read.registered.filter((targets) => targets.length)).toEqual([[read.a]]);
      expect(read.global).toEqual([[read.b]]);
      expect(read.globalVars).toHaveLength(1);
      expect(read.globalVars[0]).toMatchObject({ color: "rgb(255, 0, 0)" });
    } finally {
      await preview.page.close();
    }
  },
);
