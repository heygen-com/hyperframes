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
    `export { finishTimelineTimingFallback } from "./hooks/timelineTimingSync";`,
    `export { announcePreviewPromoted } from "./player/sceneSwap";`,
    `export { retirePreviewEditingClient } from "./player/lib/previewChannel";`,
    `export { findPreviewElementForSelection, standInFor, standInHandle } from "./components/editor/previewSelection";`,
    `export { editPreviewElement } from "./player/lib/previewElements";`,
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
  removeIframeTimelineElements(
    iframe: HTMLIFrameElement,
    elements: unknown[],
    activeCompositionPath?: string | null,
    selected?: Map<unknown, Element>,
  ): void;
  findPreviewElementForSelection(
    iframe: HTMLIFrameElement,
    selection: object,
    path: string | null,
  ): Promise<unknown>;
  standInFor(iframe: HTMLIFrameElement, element: unknown): HTMLElement;
  standInHandle(element: Element): string | undefined;
  editPreviewElement(
    iframe: HTMLIFrameElement,
    handle: string,
    edit: object,
  ): { drawn: Promise<boolean> };
  finishTimelineTimingFallback(input: object): Promise<void>;
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

// A move whose save rewrites no script rebinds the clip windows in place; a full reload here is what let a delete
// made right after it land on a frame that was still loading.
async function moveThenDelete(mode: string) {
  const preview = await openPreview(browser, studioBundle, previewHtml(), mode);
  try {
    await preview.frame.evaluate(() => ((window as unknown as { loadMark: number }).loadMark = 1));
    await preview.page.evaluate(async () => {
      const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
      const iframe = document.querySelector("iframe")!;
      const reloads = { count: 0 };
      (window as unknown as { reloads: { count: number } }).reloads = reloads;
      const clip = {
        id: "b",
        domId: "b",
        selector: "#b",
        sourceFile: "index.html",
        kind: "element",
      };
      studio.patchIframeDomTiming(iframe, clip, [["data-start", "3"]]);
      await studio.finishTimelineTimingFallback({
        iframe,
        projectId: null,
        reloadPreview: () => (reloads.count += 1),
        onGsapError: () => {},
        rebindWhenUnmutated: true,
      });
    });
    const hidden = () =>
      preview.frame.evaluate(() =>
        document.getElementById("b")!.hasAttribute("data-hf-clip-hidden"),
      );
    await expect
      .poll(hidden, { message: "the rebind hides #b, which now starts at 3 s" })
      .toBe(true);
    const reloads = () =>
      preview.page.evaluate(
        () => (window as unknown as { reloads: { count: number } }).reloads.count,
      );
    expect(await reloads(), "the frame keeps its load").toBe(0);

    await preview.page.evaluate(() => {
      const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
      const clip = {
        id: "a",
        domId: "a",
        selector: "#a",
        sourceFile: "index.html",
        kind: "element",
      };
      studio.removeIframeTimelineElements(document.querySelector("iframe")!, [clip]);
    });
    const inFrame = () =>
      preview.frame.evaluate(() => ({
        load: (window as unknown as { loadMark?: number }).loadMark,
        clips: ["root", "a", "b"].filter((id) => document.getElementById(id)),
      }));
    await expect.poll(inFrame).toEqual({ load: 1, clips: ["root", "b"] });
    expect(await reloads()).toBe(0);
  } finally {
    await preview.page.close();
  }
}

it.each(MODES)(
  "a move that rewrites no script rebinds in place, and a delete right after it leaves the same load, in a %s preview",
  async (mode) => {
    await moveThenDelete(mode);
  },
);

// A rebind rebuilds from the frame's attributes, so a move whose live patch did not land must reload the saved file.
async function moveWithoutAPatch(mode: string) {
  const preview = await openPreview(browser, studioBundle, previewHtml(), mode);
  try {
    await preview.page.evaluate(async () => {
      const studio = (window as unknown as { hfStudio: Studio }).hfStudio;
      const iframe = document.querySelector("iframe")!;
      const reloads = { count: 0 };
      (window as unknown as { reloads: { count: number } }).reloads = reloads;
      const gone = {
        id: "gone",
        domId: "gone",
        selector: "#gone",
        sourceFile: "index.html",
        kind: "element",
      };
      studio.patchIframeDomTiming(iframe, gone, [["data-start", "3"]]);
      await studio.finishTimelineTimingFallback({
        iframe,
        projectId: null,
        reloadPreview: () => (reloads.count += 1),
        onGsapError: () => {},
        rebindWhenUnmutated: true,
      });
    });
    const reloads = () =>
      preview.page.evaluate(
        () => (window as unknown as { reloads: { count: number } }).reloads.count,
      );
    await expect
      .poll(reloads, { message: "the frame never showed the move, so the saved file reloads" })
      .toBe(1);
  } finally {
    await preview.page.close();
  }
}

it.each(MODES)(
  "a move whose live patch found no clip reloads the saved file, in a %s preview",
  async (mode) => {
    await moveWithoutAPatch(mode);
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

type Selected = Held & { __kinds: string[]; __standIn: HTMLElement; __loads: number };

/** Holds clip b's canvas stand-in, as a click on it leaves it, and records each request kind Studio sends. */
async function selectB(preview: Preview) {
  await preview.page.evaluate(async () => {
    const w = window as unknown as Selected;
    const iframe = document.querySelector("iframe")!;
    w.__loads = 0;
    iframe.addEventListener("load", () => w.__loads++);
    const found = await w.hfStudio.findPreviewElementForSelection(
      iframe,
      { id: "b", sourceFile: "index.html" },
      null,
    );
    w.__standIn = w.hfStudio.standInFor(iframe, found);
    w.__kinds = [];
    const post = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (
      this: MessagePort,
      data: unknown,
      ...rest: never[]
    ) {
      const kind = (data as { id?: unknown; kind?: string } | null)?.kind;
      if (typeof (data as { id?: unknown } | null)?.id === "number" && kind) w.__kinds.push(kind);
      return post.call(this, data, ...rest);
    };
  });
}

// fails without the fix: a sealed delete of the selected clip asked the frame to look it up first (query, describe),
// each hop waiting behind Studio's re-render, so the clip left a sealed frame ~50 ms after an unsealed one.
it("a sealed delete of the selected clip sends only its removal, before the caller's task ends", async () => {
  const preview = await openPreview(browser, studioBundle, previewHtml(), "sealed");
  try {
    await selectB(preview);
    const sent = await preview.page.evaluate(async (clip) => {
      const w = window as unknown as Selected;
      w.hfStudio.removeIframeTimelineElements(
        document.querySelector("iframe")!,
        [clip],
        null,
        new Map([[clip, w.__standIn]]),
      );
      // Microtasks only: no task (a re-render's, a reply's) runs before these checks.
      for (let i = 0; i < 20; i++) await Promise.resolve();
      return [...w.__kinds];
    }, clipB);
    expect(sent).toEqual(["remove-elements"]);
    await expect.poll(() => hasB(preview.frame)).toBe(false);
  } finally {
    await preview.page.close();
  }
});

it("a sealed delete right after a pending edit of the clip reaches the frame after that edit", async () => {
  const preview = await openPreview(browser, studioBundle, previewHtml(), "sealed");
  try {
    await selectB(preview);
    await preview.frame.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { seen: string[] }).seen = seen;
      const b = document.getElementById("b")!;
      new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === "attributes" && r.target === b) seen.push(`edit ${r.attributeName}`);
          if (r.type === "childList" && [...r.removedNodes].includes(b)) seen.push("removed");
        }
      }).observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-edited"],
      });
    });
    await preview.page.evaluate((clip) => {
      const w = window as unknown as Selected;
      const iframe = document.querySelector("iframe")!;
      void w.hfStudio.editPreviewElement(iframe, w.hfStudio.standInHandle(w.__standIn)!, {
        attributes: [["data-edited", "1"]],
      });
      w.hfStudio.removeIframeTimelineElements(iframe, [clip], null, new Map([[clip, w.__standIn]]));
    }, clipB);
    const seen = () => preview.frame.evaluate(() => (window as unknown as { seen: string[] }).seen);
    await expect.poll(seen).toEqual(["edit data-edited", "removed"]);
    expect(await preview.page.evaluate(() => (window as unknown as Selected).__kinds)).toEqual(
      expect.arrayContaining(["edit-element", "remove-elements"]),
    );
  } finally {
    await preview.page.close();
  }
});

type Swallowing = Selected & {
  __swallow: Set<string>;
  __rejecting: boolean;
  __swallowed: Array<{ kind: string; answer: (result: unknown) => void }>;
};

it.each([
  ["the frame refuses", true, null],
  ["comes back with nothing removed", false, { removed: 0 }],
])(
  "a sealed delete whose fast removal %s looks the clip up and removes it",
  async (_case, rejecting, answer) => {
    const preview = await openPreview(browser, studioBundle, previewHtml(), "sealed");
    try {
      await selectB(preview);
      await preview.page.evaluate(
        (clip, rejecting) => {
          const w = window as unknown as Swallowing;
          w.__swallow.add("remove-elements");
          w.__rejecting = rejecting;
          w.hfStudio.removeIframeTimelineElements(
            document.querySelector("iframe")!,
            [clip],
            null,
            new Map([[clip, w.__standIn]]),
          );
        },
        clipB,
        rejecting,
      );
      await expect
        .poll(() =>
          preview.page.evaluate(() => (window as unknown as Swallowing).__swallowed.length),
        )
        .toBe(1);
      await preview.page.evaluate((answer) => {
        const w = window as unknown as Swallowing;
        w.__swallow.delete("remove-elements");
        w.__rejecting = false;
        w.__swallowed[0]!.answer(answer);
      }, answer);
      await expect
        .poll(() => hasB(preview.frame), { message: "the lookup path removes the clip" })
        .toBe(false);
    } finally {
      await preview.page.close();
    }
  },
);

it("a sealed delete holding a stand-in from the frame's previous load looks the clip up in the new one", async () => {
  const preview = await openPreview(browser, studioBundle, previewHtml(), "sealed");
  try {
    await selectB(preview);
    await preview.page.evaluate(() => {
      const iframe = document.querySelector("iframe")!;
      iframe.setAttribute("srcdoc", iframe.getAttribute("srcdoc")!);
    });
    await expect
      .poll(() => preview.page.evaluate(() => (window as unknown as Selected).__loads))
      .toBe(1);
    await preview.frame.waitForFunction(
      () => "__player" in window && !!document.getElementById("b"),
    );
    await preview.page.evaluate((clip) => {
      const w = window as unknown as Selected;
      w.__kinds = [];
      w.hfStudio.removeIframeTimelineElements(
        document.querySelector("iframe")!,
        [clip],
        null,
        new Map([[clip, w.__standIn]]),
      );
    }, clipB);
    await expect
      .poll(() => hasB(preview.frame), { message: "the new load drops the clip" })
      .toBe(false);
    const kinds = await preview.page.evaluate(() => (window as unknown as Selected).__kinds);
    expect(kinds[0], "the old load's handle is never sent to the new load").not.toBe(
      "remove-elements",
    );
  } finally {
    await preview.page.close();
  }
});
