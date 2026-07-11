// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import type { PatchOperation } from "../utils/sourcePatcher";
import { useElementLifecycleOps } from "./useElementLifecycleOps";
import { mountReactHarness } from "./domSelectionTestHarness";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

type CommitPositionPatch = (
  selection: DomEditSelection,
  patches: PatchOperation[],
  options: { label: string; coalesceKey: string; skipRefresh?: boolean },
) => Promise<void>;

type ReorderCommit = (
  entries: Array<{
    element: HTMLElement;
    zIndex: number;
    id?: string;
    selector?: string;
    selectorIndex?: number;
    sourceFile: string;
  }>,
  coalesceKeyOverride?: string,
) => void;

/** Render the hook, capturing every selection handed to commitPositionPatchToHtml. */
function renderReorderHook(
  capturedSelections: DomEditSelection[],
  onReady: (commit: ReorderCommit) => void,
) {
  function Harness() {
    const { handleDomZIndexReorderCommit } = useElementLifecycleOps({
      activeCompPath: "index.html",
      showToast: vi.fn(),
      writeProjectFile: vi.fn(async () => {}),
      domEditSaveTimestampRef: { current: 0 },
      editHistory: { recordEdit: vi.fn(async () => {}) },
      projectIdRef: { current: "demo" },
      reloadPreview: vi.fn(),
      clearDomSelection: vi.fn(),
      commitPositionPatchToHtml: (async (selection: DomEditSelection) => {
        capturedSelections.push(selection);
      }) as CommitPositionPatch,
    });
    onReady(handleDomZIndexReorderCommit);
    return null;
  }
  return mountReactHarness(<Harness />);
}

/** Append the element, mount the reorder hook, and run one commit through act. */
async function runReorderCommit(el: HTMLElement, entries: Parameters<ReorderCommit>[0]) {
  document.body.appendChild(el);

  const captured: DomEditSelection[] = [];
  let commit: ReorderCommit | undefined;
  const root = renderReorderHook(captured, (fn) => (commit = fn));

  await act(async () => {
    commit!(entries);
  });

  return { captured, root };
}

describe("useElementLifecycleOps — z-index reorder payload", () => {
  // Regression: an id-less canvas element (e.g. a caption `.sub` div, which
  // carries only data-hf-id + class) once had its absent id coerced to `null`
  // (`entry.id ?? null`). The DOM-patch guard rejects a null `body.target.id`,
  // so "move to back" toasted "unsafe values" and nothing persisted. The target
  // id must be `undefined` (dropped on the wire), letting hfId / selector match.
  it("never sends a null target id for an id-less element", async () => {
    const el = document.createElement("div");
    el.className = "sub clip";
    el.setAttribute("data-hf-id", "hf-card");

    const { captured, root } = await runReorderCommit(el, [
      {
        element: el,
        zIndex: 0,
        // id intentionally absent — the id-less element case.
        selector: ".sub.clip",
        selectorIndex: 3,
        sourceFile: "index.html",
      },
    ]);

    expect(captured).toHaveLength(1);
    expect(captured[0]!.id).toBeUndefined();
    expect(captured[0]!.id).not.toBeNull();
    // The element stays addressable via hfId (and selector) instead.
    expect(captured[0]!.hfId).toBe("hf-card");

    act(() => root.unmount());
  });

  it("preserves a real id when the element has one", async () => {
    const el = document.createElement("video");
    el.id = "v-hero";
    el.setAttribute("data-hf-id", "hf-ezl2");

    const { captured, root } = await runReorderCommit(el, [
      { element: el, zIndex: 2, id: "v-hero", selector: "#v-hero", sourceFile: "index.html" },
    ]);

    expect(captured).toHaveLength(1);
    expect(captured[0]!.id).toBe("v-hero");

    act(() => root.unmount());
  });
});
