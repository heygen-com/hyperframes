// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import type { PatchOperation } from "../utils/sourcePatcher";
import { usePlayerStore } from "../player";
import { useElementLifecycleOps } from "./useElementLifecycleOps";
import { mountReactHarness } from "./domSelectionTestHarness";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.getState().setElements([]);
  vi.unstubAllGlobals();
});

interface PositionPatchOptions {
  label: string;
  coalesceKey: string;
  coalesceMs?: number;
  skipRefresh?: boolean;
}

type CommitPositionPatch = (
  selection: DomEditSelection,
  patches: PatchOperation[],
  options: PositionPatchOptions,
) => Promise<void>;

type ReorderCommit = (
  entries: Array<{
    element: HTMLElement;
    zIndex: number;
    id?: string;
    selector?: string;
    selectorIndex?: number;
    sourceFile: string;
    key?: string;
  }>,
  coalesceKeyOverride?: string,
) => Promise<void>;

/** Render the hook, capturing every selection handed to commitPositionPatchToHtml. */
function renderReorderHook(
  capturedSelections: DomEditSelection[],
  onReady: (commit: ReorderCommit) => void,
  capturedOptions: PositionPatchOptions[] = [],
) {
  function Harness() {
    const { handleDomZIndexReorderCommit } = useElementLifecycleOps({
      activeCompPath: "index.html",
      showToast: vi.fn(),
      writeProjectFile: vi.fn(async () => {}),
      domEditSaveTimestampRef: { current: 0 },
      editHistory: { recordEdit: vi.fn(async () => {}) },
      projectIdRef: { current: null },
      reloadPreview: vi.fn(),
      clearDomSelection: vi.fn(),
      commitPositionPatchToHtml: (async (
        selection: DomEditSelection,
        _patches: PatchOperation[],
        options: PositionPatchOptions,
      ) => {
        capturedSelections.push(selection);
        capturedOptions.push(options);
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

  it("threads the lane gesture key into z-index persistence", async () => {
    const el = document.createElement("div");
    el.id = "clip-a";
    document.body.appendChild(el);
    const capturedOptions: Array<{
      label: string;
      coalesceKey: string;
      skipRefresh?: boolean;
    }> = [];
    let commit: ReorderCommit | undefined;
    const root = renderReorderHook([], (fn) => (commit = fn), capturedOptions);

    await act(async () => {
      await commit!(
        [{ element: el, zIndex: 4, id: "clip-a", sourceFile: "index.html" }],
        "clip-lane-move:7",
      );
    });

    expect(capturedOptions).toHaveLength(1);
    expect(capturedOptions[0]?.coalesceKey).toBe("clip-lane-move:7");
    act(() => root.unmount());
  });

  it("uses one infinite coalescing window for every element in a reorder", async () => {
    const elements = ["clip-a", "clip-b", "clip-c"].map((id) => {
      const element = document.createElement("div");
      element.id = id;
      document.body.appendChild(element);
      return element;
    });
    const capturedOptions: PositionPatchOptions[] = [];
    let commit: ReorderCommit | undefined;
    const root = renderReorderHook([], (fn) => (commit = fn), capturedOptions);

    await act(async () => {
      await commit!(
        elements.map((element, index) => ({
          element,
          zIndex: index + 1,
          id: element.id,
          sourceFile: "index.html",
        })),
        "clip-lane-move:atomic",
      );
    });

    expect(capturedOptions).toHaveLength(3);
    expect(
      capturedOptions.map(({ coalesceKey, coalesceMs }) => ({ coalesceKey, coalesceMs })),
    ).toEqual(
      Array.from({ length: 3 }, () => ({
        coalesceKey: "clip-lane-move:atomic",
        coalesceMs: Infinity,
      })),
    );
    act(() => root.unmount());
  });

  it("restores live, store, disk, and history state after a partial reorder failure", async () => {
    const originalContent = '<div id="clip-a"></div><div id="clip-b"></div><div id="clip-c"></div>';
    const partiallyReorderedContent =
      '<div id="clip-a" style="z-index: 3"></div><div id="clip-b"></div><div id="clip-c" style="z-index: 1"></div>';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: originalContent }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: partiallyReorderedContent }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const writeProjectFile = vi.fn(async () => {});
    const recordEdit = vi.fn(async () => {});
    const forceReloadSdkSession = vi.fn();
    const originalError = new Error("second patch failed");
    const elements = ["clip-a", "clip-b", "clip-c"].map((id, index) => {
      const element = document.createElement("div");
      element.id = id;
      element.style.zIndex = String(index + 10);
      document.body.appendChild(element);
      return element;
    });
    usePlayerStore.getState().setElements(
      elements.map((element, index) => ({
        id: element.id,
        tag: "div",
        start: 0,
        duration: 1,
        track: index,
        zIndex: index + 10,
        hasExplicitZIndex: false,
      })),
    );

    let commit: ReorderCommit | undefined;
    function Harness() {
      const { handleDomZIndexReorderCommit } = useElementLifecycleOps({
        activeCompPath: "index.html",
        showToast: vi.fn(),
        writeProjectFile,
        domEditSaveTimestampRef: { current: 0 },
        editHistory: { recordEdit },
        projectIdRef: { current: "demo" },
        reloadPreview: vi.fn(),
        clearDomSelection: vi.fn(),
        forceReloadSdkSession,
        commitPositionPatchToHtml: vi.fn(async (selection: DomEditSelection) => {
          if (selection.id === "clip-b") throw originalError;
        }),
      });
      commit = handleDomZIndexReorderCommit;
      return null;
    }
    const root = mountReactHarness(<Harness />);

    let rejection: unknown;
    await act(async () => {
      try {
        await commit!(
          elements.map((element, index) => ({
            element,
            zIndex: 3 - index,
            id: element.id,
            sourceFile: "index.html",
            key: element.id,
          })),
          "clip-lane-move:failure",
        );
      } catch (error) {
        rejection = error;
      }
    });

    expect(rejection).toBe(originalError);
    expect(elements.map((element) => element.style.zIndex)).toEqual(["10", "11", "12"]);
    expect(
      usePlayerStore
        .getState()
        .elements.map(({ zIndex, hasExplicitZIndex }) => ({ zIndex, hasExplicitZIndex })),
    ).toEqual([
      { zIndex: 10, hasExplicitZIndex: false },
      { zIndex: 11, hasExplicitZIndex: false },
      { zIndex: 12, hasExplicitZIndex: false },
    ]);
    expect(writeProjectFile).toHaveBeenCalledWith("index.html", originalContent);
    expect(recordEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Reorder layers",
        kind: "manual",
        coalesceKey: "clip-lane-move:failure",
        coalesceMs: Infinity,
      }),
    );
    expect(forceReloadSdkSession).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
