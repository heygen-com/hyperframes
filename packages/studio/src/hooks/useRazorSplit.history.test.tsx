// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { splitElementInHtml } from "@hyperframes/studio-server/source-mutation";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import { useRazorSplit } from "./useRazorSplit";
import { createPersistentEditHistoryStore } from "./usePersistentEditHistory";
import { createMemoryEditHistoryStorage } from "../utils/editHistoryStorage";
import {
  createEmptyEditHistory,
  hashEditHistoryContent,
  undoEditHistory,
} from "../utils/editHistory";
import { createSplitFetchMock, mountProbe } from "./useRazorSplit.testHelpers";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORIGINAL = `<div class="clip" id="clip1" data-start="0" data-duration="4" data-hf-id="hf-clip">hi</div>`;
const SPLIT = splitElementInHtml(ORIGINAL, { id: "clip1" }, 2, "clip1-split").html;

const element: TimelineElement = {
  id: "clip1",
  tag: "div",
  start: 0,
  duration: 4,
  track: 0,
  domId: "clip1",
  sourceFile: "index.html",
  timingSource: "authored",
};

type Split = (element: TimelineElement, splitTime: number) => Promise<void>;
type SplitAll = (splitTime: number) => Promise<void>;

interface Harness {
  disk: Record<string, string>;
  store: ReturnType<typeof createPersistentEditHistoryStore>;
  splitRef: { current: Split | undefined };
  root: ReturnType<typeof mountProbe>;
  expected: string;
  previewWrites: string[];
}

const SPLIT_GSAP = SPLIT.replace(
  "</div>",
  "</div><script>window.__timelines={};const tl=gsap.timeline({paused:true});" +
    'tl.set("#clip1-split",{x:0},2);window.__timelines["c"]=tl;</script>',
);

function mountRazorSplit(opts: { gsap?: boolean; previewStamp?: boolean } = {}): Harness {
  const disk: Record<string, string> = { "index.html": ORIGINAL };
  const finalContent = opts.gsap ? SPLIT_GSAP : SPLIT;
  const previewWrites: string[] = [];

  const storage = createMemoryEditHistoryStorage();
  const store = createPersistentEditHistoryStore({
    projectId: "p1",
    storage,
    initialState: createEmptyEditHistory(),
    now: (() => {
      let t = 1000;
      return () => (t += 10);
    })(),
    onChange: () => {},
  });

  // Faithful stand-in for the studio-server file-mutation endpoints: the server
  // writes the split to disk itself, then returns the patched content.
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/gsap-mutations/")) {
      if (opts.gsap) {
        // Mirror the server: rewrites the GSAP script for the new id, writes to
        // disk, returns the final content.
        disk["index.html"] = SPLIT_GSAP;
        const version = `"test-gsap-${SPLIT_GSAP.length}"`;
        return new Response(JSON.stringify({ ok: true, after: SPLIT_GSAP, version }), {
          status: 200,
          headers: { "Content-Type": "application/json", ETag: version },
        });
      }
      // The fixture has no GSAP script — mirror the server's 400 response.
      return new Response(JSON.stringify({ error: "no GSAP script found in file" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/file-mutations/split-element/")) {
      disk["index.html"] = SPLIT;
      const version = `"test-split-${SPLIT.length}"`;
      return new Response(
        JSON.stringify({
          ok: true,
          changed: true,
          content: SPLIT,
          newId: "clip1-split",
          version,
        }),
        { status: 200, headers: { "Content-Type": "application/json", ETag: version } },
      );
    }
    if (u.includes("/files/")) {
      return new Response(JSON.stringify({ content: disk["index.html"] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    void init;
    throw new Error(`unexpected fetch: ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const splitRef: { current: Split | undefined } = { current: undefined };

  function Component() {
    const { handleRazorSplit } = useRazorSplit({
      projectId: "p1",
      activeCompPath: "index.html",
      showToast: () => {},
      writeProjectFile: async (path, content) => {
        disk[path] = content;
      },
      recordEdit: store.recordEdit,
      domEditSaveTimestampRef: { current: 0 },
      reloadPreview: () => {
        if (!opts.previewStamp) return;
        const stamped = ensureHfIds(disk["index.html"]);
        const idsBefore = (disk["index.html"].match(/\bdata-hf-id=/g) ?? []).length;
        const idsAfter = (stamped.match(/\bdata-hf-id=/g) ?? []).length;
        if (idsAfter > idsBefore) {
          disk["index.html"] = stamped;
          previewWrites.push(stamped);
        }
      },
      forceReloadSdkSession: () => {},
    });
    splitRef.current = handleRazorSplit;
    return null;
  }

  const root = mountProbe(Component);

  return { disk, store, splitRef, root, expected: finalContent, previewWrites };
}

async function undoViaDisk(harness: Pick<Harness, "disk" | "store">) {
  return harness.store.undo({
    readFile: async (path) => harness.disk[path],
    writeFile: async (path, content) => {
      harness.disk[path] = content;
    },
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("useRazorSplit — split is undoable via edit history", () => {
  it("keeps history aligned when preview reload checks hf-id persistence", async () => {
    const harness = mountRazorSplit({ previewStamp: true });

    await act(async () => {
      await harness.splitRef.current!(element, 2);
    });

    const snapshot = harness.store.snapshot().state;
    const entry = snapshot.undo.at(-1)!;
    const currentHash = hashEditHistoryContent(harness.disk["index.html"]);
    expect(entry.files["index.html"].afterHash).toBe(currentHash);

    const undo = undoEditHistory(snapshot, { "index.html": currentHash }, 2000);
    expect(undo.ok).toBe(true);
    expect(undo.filesToWrite).toEqual({ "index.html": ORIGINAL });
    expect(harness.previewWrites).toHaveLength(0);

    act(() => harness.root.unmount());
  });

  for (const gsap of [false, true]) {
    describe(gsap ? "with GSAP rewrite" : "plain HTML split", () => {
      let harness: Harness;
      beforeEach(() => {
        harness = mountRazorSplit({ gsap });
      });
      afterEach(() => {
        act(() => harness.root.unmount());
      });

      it("records a single 'Split timeline clip' history entry that undo restores", async () => {
        await act(async () => {
          await harness.splitRef.current!(element, 2);
        });

        // The split reached disk.
        expect(harness.disk["index.html"]).toBe(harness.expected);

        // The split must be the top of the undo stack — not a prior/other entry.
        expect(harness.store.snapshot().canUndo).toBe(true);
        expect(harness.store.snapshot().undoLabel).toBe("Split timeline clip");

        // Undo restores the exact pre-split file.
        const result = await undoViaDisk(harness);
        expect(result.ok).toBe(true);
        expect(result.label).toBe("Split timeline clip");
        expect(harness.disk["index.html"]).toBe(ORIGINAL);
      });
    });
  }
});

const BATCH_ORIGINALS = {
  "index.html": `<div class="clip" id="clip1" data-start="0" data-duration="4">one</div>`,
  "scenes/two.html": `<div class="clip" id="clip2" data-start="0" data-duration="4">two</div>`,
};

const batchElements: TimelineElement[] = [
  element,
  {
    ...element,
    id: "clip2",
    domId: "clip2",
    sourceFile: "scenes/two.html",
    track: 1,
  },
];

interface SplitAllHarness {
  disk: Record<string, string>;
  store: ReturnType<typeof createPersistentEditHistoryStore>;
  splitAllRef: { current: SplitAll | undefined };
  root: ReturnType<typeof mountProbe>;
}

function mountRazorSplitAll(failOnSplit?: number): SplitAllHarness {
  const disk: Record<string, string> = { ...BATCH_ORIGINALS };
  const store = createPersistentEditHistoryStore({
    projectId: "p1",
    storage: createMemoryEditHistoryStorage(),
    initialState: createEmptyEditHistory(),
    now: () => 1000,
    onChange: () => {},
  });
  let splitCount = 0;

  vi.stubGlobal(
    "fetch",
    createSplitFetchMock(disk, () => {
      splitCount++;
      if (splitCount === failOnSplit) throw new Error("simulated split failure");
    }),
  );

  const splitAllRef: { current: SplitAll | undefined } = { current: undefined };
  function Component() {
    const { handleRazorSplitAll } = useRazorSplit({
      projectId: "p1",
      activeCompPath: "index.html",
      showToast: () => {},
      writeProjectFile: async (path, content) => {
        disk[path] = content;
      },
      recordEdit: store.recordEdit,
      domEditSaveTimestampRef: { current: 0 },
      reloadPreview: () => {},
    });
    splitAllRef.current = handleRazorSplitAll;
    return null;
  }

  const root = mountProbe(Component);
  usePlayerStore.setState({ elements: batchElements });
  return { disk, store, splitAllRef, root };
}

describe("useRazorSplit — split-all batch history", () => {
  afterEach(() => {
    usePlayerStore.setState({ elements: [] });
  });

  async function runSplitAll(failOnSplit?: number) {
    const harness = mountRazorSplitAll(failOnSplit);
    await act(async () => {
      await harness.splitAllRef.current!(2);
    });
    return harness;
  }

  it("records one undo entry that restores every split file", async () => {
    const harness = await runSplitAll();

    expect(harness.store.snapshot().canUndo).toBe(true);
    const result = await undoViaDisk(harness);
    expect(result.ok).toBe(true);
    expect(harness.disk).toEqual(BATCH_ORIGINALS);
    expect(harness.store.snapshot().canUndo).toBe(false);
    act(() => harness.root.unmount());
  });

  it("restores completed writes and records no undo when a later split fails", async () => {
    const harness = await runSplitAll(2);

    expect(harness.disk).toEqual(BATCH_ORIGINALS);
    expect(harness.store.snapshot().canUndo).toBe(false);
    act(() => harness.root.unmount());
  });
});
