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
    `export { captureDurationRollback, patchIframeDomTiming, removeIframeTimelineElements, syncPreviewContentDuration } from "./hooks/previewTimingPatch";`,
    `export { announcePreviewPromoted } from "./player/sceneSwap";`,
    `export { retirePreviewEditingClient } from "./player/lib/previewChannel";`,
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
  removeIframeTimelineElements(iframe: HTMLIFrameElement, elements: unknown[]): void;
  announcePreviewPromoted(promotion: { retired: HTMLIFrameElement; live: HTMLIFrameElement }): void;
  retirePreviewEditingClient(iframe: HTMLIFrameElement): void;
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

async function deleteClip(mode: string) {
  const preview = await openPreview(browser, studioBundle, previewHtml(), mode);
  try {
    await preview.page.evaluate(() => {
      const posted: string[][] = [];
      const frame = document.querySelector("iframe")!;
      window.addEventListener("message", ({ source, data }) => {
        if (source !== frame.contentWindow) return;
        if (data?.source === "hf-preview" && data.type === "timeline")
          posted.push(data.clips.map((clip: { id: string | null }) => clip.id));
      });
      const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
      const clip = {
        id: "b",
        domId: "b",
        selector: "#b",
        sourceFile: "index.html",
        kind: "element",
      };
      studio.removeIframeTimelineElements(frame, [clip]);
      (window as unknown as { posted: string[][] }).posted = posted;
    });
    const inFrame = () =>
      preview.frame.evaluate(() => ["root", "a", "b"].filter((id) => document.getElementById(id)));
    await expect.poll(inFrame).toEqual(["root", "a"]);
    const lastPosted = () =>
      preview.page.evaluate(() => (window as unknown as { posted: string[][] }).posted.at(-1));
    await expect.poll(lastPosted).toEqual(expect.arrayContaining(["a"]));
    expect(await lastPosted()).not.toContain("b");
  } finally {
    await preview.page.close();
  }
}

it.each(MODES)(
  "a deleted clip leaves the frame, and the frame's next clip list leaves it out, in a %s preview",
  async (mode) => {
    await deleteClip(mode);
  },
);

type Held = { __hold: boolean; __held: Array<() => void>; hfStudio: Studio };
const clipB = { id: "b", domId: "b", selector: "#b", sourceFile: "index.html", kind: "element" };

// A second frame loads the same film, as the shadow reload does, and replaces the first on screen.
async function loadShadow(preview: Preview, html: string, mode: string) {
  await preview.page.evaluate(
    (srcdoc, sealed) => {
      const shadow = document.createElement("iframe");
      if (sealed) shadow.setAttribute("sandbox", "allow-scripts");
      shadow.id = "shadow";
      shadow.srcdoc = srcdoc;
      document.body.append(shadow);
    },
    html,
    mode === "sealed",
  );
  const shadowFrame = await expect
    .poll(() => preview.page.frames().find((f) => f.parentFrame() && f !== preview.frame) ?? null)
    .not.toBeNull()
    .then(() => preview.page.frames().find((f) => f.parentFrame() && f !== preview.frame)!);
  await shadowFrame.waitForFunction(() => "__player" in window);
  return shadowFrame;
}

async function promoteShadow(preview: Preview, html: string, mode: string) {
  const shadowFrame = await loadShadow(preview, html, mode);
  await preview.page.evaluate(() => {
    const { hfStudio } = window as unknown as Held;
    const [retired, live] = [...document.querySelectorAll("iframe")];
    hfStudio.announcePreviewPromoted({ retired, live });
    hfStudio.retirePreviewEditingClient(retired);
  });
  return shadowFrame;
}

const hasB = (frame: Preview["frame"]) => frame.evaluate(() => !!document.getElementById("b"));

it.each(MODES)(
  "a delete given the frame a reload just replaced removes the clip from the frame now shown, in a %s preview",
  async (mode) => {
    const preview = await openPreview(browser, studioBundle, previewHtml(), mode);
    try {
      const shadow = await promoteShadow(preview, previewHtml(), mode);
      await preview.page.evaluate((clip) => {
        const retired = document.querySelector("iframe")!;
        (window as unknown as Held).hfStudio.removeIframeTimelineElements(retired, [clip]);
      }, clipB);
      await expect
        .poll(() => hasB(shadow), { message: "the shown frame drops the deleted clip" })
        .toBe(false);
    } finally {
      await preview.page.close();
    }
  },
);

// Only a sealed delete waits on the frame between finding the clip and removing it.
it("a sealed delete still waiting on its lookup when the reload is promoted removes the clip from the new frame", async () => {
  const preview = await openPreview(browser, studioBundle, previewHtml(), "sealed");
  try {
    await preview.page.evaluate((clip) => {
      const w = window as unknown as Held;
      w.__hold = true;
      w.hfStudio.removeIframeTimelineElements(document.querySelector("iframe")!, [clip]);
    }, clipB);
    const shadow = await promoteShadow(preview, previewHtml(), "sealed");
    await preview.page.evaluate(() => {
      const w = window as unknown as Held;
      w.__hold = false;
      for (const deliver of w.__held.splice(0)) deliver();
    });
    await expect
      .poll(() => hasB(shadow), { message: "the new frame drops the deleted clip" })
      .toBe(false);
  } finally {
    await preview.page.close();
  }
});

const clipA = { id: "a", domId: "a", selector: "#a", sourceFile: "index.html", kind: "element" };

it.each(MODES)(
  "deleting the clip that ended the film shortens the frame's film and the readout, in a %s preview",
  async (mode) => {
    const preview = await openPreview(browser, studioBundle, previewHtml(), mode);
    try {
      await preview.page.evaluate((clip) => {
        const frame = document.querySelector("iframe")!;
        const reported: number[] = [];
        window.addEventListener("message", ({ source, data }) => {
          if (
            source === frame.contentWindow &&
            data?.source === "hf-preview" &&
            data.type === "timeline"
          )
            reported.push(data.durationSeconds);
        });
        const w = window as unknown as Held & { reported: number[] };
        w.reported = reported;
        w.hfStudio.usePlayerStore.setState({ duration: 4 });
        w.hfStudio.removeIframeTimelineElements(frame, [clip]);
      }, clipA);
      const shown = () =>
        preview.page.evaluate(() => {
          const w = window as unknown as Held & { reported: number[] };
          return {
            reported: w.reported.at(-1),
            readout: w.hfStudio.usePlayerStore.getState().duration,
          };
        });
      await expect.poll(shown, { message: "the film ends with the clip left, #b at 2 s" }).toEqual({
        reported: 2,
        readout: 2,
      });
    } finally {
      await preview.page.close();
    }
  },
);

it("a sealed delete whose lookups answered just before the reload is promoted removes the clip from the new frame", async () => {
  const preview = await openPreview(browser, studioBundle, previewHtml(), "sealed");
  try {
    const shadow = await loadShadow(preview, previewHtml(), "sealed");
    await preview.page.evaluate((clip) => {
      const w = window as unknown as Held;
      w.__hold = true;
      w.hfStudio.removeIframeTimelineElements(document.querySelector("iframe")!, [clip]);
    }, clipB);
    await expect
      .poll(() => preview.page.evaluate(() => (window as unknown as Held).__held.length))
      .toBeGreaterThan(0);
    // The lookups' answers and the promotion land in one task, before the removal goes out.
    await preview.page.evaluate(() => {
      const w = window as unknown as Held;
      w.__hold = false;
      for (const deliver of w.__held.splice(0)) deliver();
      const [retired, live] = [...document.querySelectorAll("iframe")];
      w.hfStudio.announcePreviewPromoted({ retired, live });
      w.hfStudio.retirePreviewEditingClient(retired);
    });
    await expect
      .poll(() => hasB(shadow), { message: "the new frame drops the deleted clip" })
      .toBe(false);
  } finally {
    await preview.page.close();
  }
});
