// @vitest-environment happy-dom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { mountReactHarness } from "../../hooks/domSelectionTestHarness";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  actions: null as null | {
    previewIframeRef: { current: HTMLIFrameElement | null };
    handleDomZIndexReorderCommit: ReturnType<typeof vi.fn>;
  },
}));

vi.mock("../../contexts/DomEditContext", () => ({
  useDomEditActionsContextOptional: () => mocks.actions,
}));
vi.mock("../../contexts/StudioContext", () => ({
  useStudioShellContextOptional: () => ({ activeCompPath: "nested.html" }),
}));

import { useTimelineStackingSync } from "./useTimelineStackingSync";

describe("useTimelineStackingSync", () => {
  it("forwards resolved entries and the lane gesture coalesce key", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const node = iframe.contentDocument!.createElement("div");
    node.setAttribute("data-hf-id", "hf-a");
    iframe.contentDocument!.body.appendChild(node);
    const commit = vi.fn().mockResolvedValue(undefined);
    mocks.actions = { previewIframeRef: { current: iframe }, handleDomZIndexReorderCommit: commit };
    const element: TimelineElement = {
      id: "a",
      key: "a",
      hfId: "hf-a",
      tag: "div",
      start: 0,
      duration: 2,
      track: 0,
      sourceFile: "nested.html",
    };
    let apply: ((patches: Array<{ key: string; zIndex: number }>, key?: string) => unknown) | null =
      null;
    function Harness() {
      apply = useTimelineStackingSync({
        expandedElementsRef: { current: [element] },
      }).applyStackingPatches;
      return null;
    }
    const root = mountReactHarness(<Harness />);

    await act(async () => {
      await apply!([{ key: "a", zIndex: 8 }], "clip-lane-move:7");
    });

    expect(commit).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          element: node,
          zIndex: 8,
          sourceFile: "nested.html",
          // The patch's store key rides along so the commit updates the store
          // zIndex synchronously on the lane-sync path (and rolls it back on
          // failure) instead of waiting for a preview reload.
          key: "a",
        }),
      ],
      "clip-lane-move:7",
    );
    act(() => root.unmount());
    mocks.actions = null;
    iframe.remove();
  });
});
