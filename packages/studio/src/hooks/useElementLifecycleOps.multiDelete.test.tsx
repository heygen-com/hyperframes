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
  const requests: string[] = [];
  let changes = true;

  beforeEach(() => {
    removed.length = 0;
    requests.length = 0;
    changes = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push(String(url));
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          targets?: { id?: string; selector?: string }[];
        };
        for (const target of body.targets ?? []) {
          const key = target.id ?? target.selector;
          if (key) removed.push(key);
        }
        return {
          ok: true,
          json: async () => ({ changed: changes, content: "<html></html>" }),
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
    // And one request for the selection, not one per member: a canvas selection
    // runs to hundreds, and a round trip each made Delete look like a no-op.
    expect(requests.filter((url) => url.includes("remove-elements"))).toHaveLength(1);
  });

  it("says so when the preview is stale instead of claiming a delete", async () => {
    // Every target missing means the preview is describing a document the file
    // does not have. Reporting success there is what read as Delete doing
    // nothing at all, with nothing on screen to explain it.
    changes = false;
    const showToast = vi.fn();
    let ops: ReturnType<typeof useElementLifecycleOps> | null = null;
    function Probe() {
      ops = useElementLifecycleOps(
        makeLifecycleOpsParams({
          commitDomEditPatchBatches: vi.fn(async () => ({ ok: true }) as never),
          projectIdRef: { current: "p1" },
          showToast,
        }),
      );
      return null;
    }
    mountReactHarness(<Probe />);

    await act(async () => {
      await ops!.handleDomEditElementsDelete([selectionFor("a")]);
    });

    expect(showToast.mock.calls.flat().join(" ")).toContain("out of date");
  });
});
