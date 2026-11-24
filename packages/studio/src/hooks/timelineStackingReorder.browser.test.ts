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
    `export { applyTimelineStackingReorder } from "./hooks/timelineStackingReorder";`,
    `export { standInHandle } from "./components/editor/previewSelection";`,
  ]);
});

afterAll(() => closeTestChrome(browser));

function previewHtml(): string {
  const runtime = readFileSync(require.resolve("@hyperframes/core/runtime"), "utf8");
  const clip = (id: string, track: number, z: string) =>
    `<div id="${id}" class="clip" data-start="0" data-duration="4" data-track-index="${track}"
      style="position: absolute; width: 100px; height: 100px; ${z}"></div>`;
  return `<!doctype html><html><head><meta charset="UTF-8" />
    <meta name="hyperframes-studio-preview" content="1" />
    <style>#b { z-index: 2 }</style>
    </head><body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1920" data-height="1080">
      ${clip("a", 1, "z-index: 1")}${clip("b", 2, "")}${clip("c", 3, "z-index: 3")}
    </div>
    <script>${runtime}</script></body></html>`;
}

async function restack(mode: string, keys: string[]) {
  const preview = await openPreview(browser, studioBundle, previewHtml(), mode);
  try {
    return await preview.page.evaluate(async (ids) => {
      type Entry = { element: HTMLElement; zIndex: number; id?: string; key?: string };
      type Studio = {
        applyTimelineStackingReorder(input: unknown): Promise<void>;
        standInHandle(element: Element): string | undefined;
        previewRequest(
          iframe: HTMLIFrameElement,
          kind: "query",
          params: { selector: string },
        ): Promise<{ matches: Array<{ handle: string }> } | null>;
      };
      const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
      const targets: Record<string, number> = { a: 2, b: 1, c: 3, gone: 5 };
      const committed: Array<Record<string, unknown>> = [];
      const iframe = document.querySelector("iframe")!;
      await studio.applyTimelineStackingReorder({
        element: { tag: "div" },
        stackingReorder: {
          contextKey: "main",
          placement: "above",
          zIndexChanges: ids.map((id) => ({ key: id, domId: id, zIndex: targets[id] })),
        },
        timelineElements: [],
        iframe,
        activeCompPath: null,
        commit: async (entries: Entry[]) => {
          for (const { element, zIndex, id, key } of entries)
            committed.push({ element, zIndex, id, key });
        },
      });
      // The clip each entry writes to: a live element's id, or the frame element its stand-in names.
      const named = async (element: HTMLElement) => {
        const handle = studio.standInHandle(element);
        if (!handle) return element.id;
        for (const id of ["a", "b", "c"]) {
          const query = await studio.previewRequest(iframe, "query", { selector: `#${id}` });
          if (query?.matches[0]?.handle === handle) return id;
        }
        return "";
      };
      for (const entry of committed) entry.element = await named(entry.element as HTMLElement);
      return committed;
    }, keys);
  } finally {
    await preview.page.close();
  }
}

it.each(MODES)("a lane move restacks the clips' z-index in a %s preview", async (mode) => {
  const moved = [
    { element: "a", zIndex: 2, id: "a", key: "a" },
    { element: "b", zIndex: 1, id: "b", key: "b" },
  ];
  expect(await restack(mode, ["a", "b", "c"])).toEqual(moved);
  expect(await restack(mode, ["a", "gone"])).toEqual([]);
});
