// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../player";
import { useRazorSplit } from "./useRazorSplit";
import { createPersistentEditHistoryStore } from "./usePersistentEditHistory";
import { createMemoryEditHistoryStorage } from "../utils/editHistoryStorage";
import { createEmptyEditHistory } from "../utils/editHistory";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORIGINAL = `<div class="clip" id="clip1" data-start="0" data-duration="4">hi</div>`;
const SPLIT =
  `<div class="clip" id="clip1" data-start="0" data-duration="2">hi</div>` +
  `<div class="clip" id="clip1-split" data-start="2" data-duration="2">hi</div>`;

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

interface Harness {
  disk: Record<string, string>;
  store: ReturnType<typeof createPersistentEditHistoryStore>;
  splitRef: { current: Split | undefined };
  root: ReturnType<typeof createRoot>;
  expected: string;
}

const SPLIT_GSAP = SPLIT.replace(
  "</div>",
  "</div><script>window.__timelines={};const tl=gsap.timeline({paused:true});" +
    'tl.set("#clip1-split",{x:0},2);window.__timelines["c"]=tl;</script>',
);

function mountRazorSplit(opts: { gsap?: boolean } = {}): Harness {
  const disk: Record<string, string> = { "index.html": ORIGINAL };
  const finalContent = opts.gsap ? SPLIT_GSAP : SPLIT;

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
        return new Response(JSON.stringify({ ok: true, after: SPLIT_GSAP }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
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
      return new Response(
        JSON.stringify({ ok: true, changed: true, content: SPLIT, newId: "clip1-split" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
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
      reloadPreview: () => {},
    });
    splitRef.current = handleRazorSplit;
    return null;
  }

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(<Component />);
  });

  return { disk, store, splitRef, root, expected: finalContent };
}

async function undoViaDisk(harness: Harness) {
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
