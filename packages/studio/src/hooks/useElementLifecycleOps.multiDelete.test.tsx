// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useElementLifecycleOps } from "./useElementLifecycleOps";
import { makeLifecycleOpsParams } from "./elementLifecycleOpsTestUtils";
import { mountReactHarness, makeSelection } from "./domSelectionTestHarness";

function selectionFor(id: string) {
  const el = document.createElement("div");
  el.id = id;
  document.body.append(el);
  return { ...makeSelection(id, el), sourceFile: "index.html" };
}

describe("useElementLifecycleOps — deleting a canvas multi-selection", () => {
  const removed: string[] = [];

  beforeEach(() => {
    removed.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          target?: { id?: string; selector?: string };
        };
        const key = body.target?.id ?? body.target?.selector;
        if (key) removed.push(key);
        return {
          ok: true,
          json: async () => ({ changed: true, content: "<html></html>" }),
        } as unknown as Response;
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("removes every selected element, not just the first", async () => {
    // The reported bug: select several elements on the canvas, press Delete, and
    // one disappears while the rest stay — still drawn as selected.
    let ops: ReturnType<typeof useElementLifecycleOps> | null = null;
    function Probe() {
      ops = useElementLifecycleOps(
        makeLifecycleOpsParams({
          commitDomEditPatchBatches: vi.fn(async () => ({ ok: true }) as never),
          projectIdRef: { current: "p1" },
        }),
      );
      return null;
    }
    mountReactHarness(<Probe />);

    const selections = ["a", "b", "c"].map(selectionFor);
    await act(async () => {
      await ops!.handleDomEditElementsDelete(selections);
    });

    // The defect: only the first was ever removed.
    expect(removed).toEqual(["a", "b", "c"]);
  });
});
