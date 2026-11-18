// @vitest-environment happy-dom

import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { findPreviewElementForSelection, standInFor } from "../components/editor/previewSelection";
import { useTimelineStackingSync } from "../player/components/useTimelineStackingSync";
import { sealedPreviewFrame } from "../player/lib/sealedPreviewFrame.test-helpers";
import { usePlayerStore, type TimelineElement } from "../player/store/playerStore";
import type { DomEditPatchBatch } from "./domEditCommitTypes";
import { mountReactHarness } from "./domSelectionTestHarness";
import { makeLifecycleOpsParams } from "./elementLifecycleOpsTestUtils";
import type { TimelineZIndexReorderCommit } from "./useTimelineEditingTypes";
import { useElementLifecycleOps } from "./useElementLifecycleOps";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const unmounts: Array<() => void> = [];
afterEach(() => {
  unmounts.splice(0).forEach((unmount) => act(unmount));
  document.body.innerHTML = "";
  usePlayerStore.getState().setElements([]);
});

const PAGE = `<div data-composition-id="main">
  <div id="back" style="position: static; z-index: 1"></div><div id="front" style="position: absolute; z-index: 2"></div>
</div>`;

const clip = (id: string, track: number, zIndex: number): TimelineElement => ({
  id,
  key: id,
  domId: id,
  label: id,
  tag: "div",
  start: 0,
  duration: 5,
  track,
  zIndex,
  sourceFile: "index.html",
});

function stackingSync(iframe: HTMLIFrameElement, commit: TimelineZIndexReorderCommit) {
  let sync!: ReturnType<typeof useTimelineStackingSync>;
  function Harness() {
    sync = useTimelineStackingSync({
      expandedElementsRef: { current: [clip("back", 1, 1), clip("front", 0, 2)] },
      previewIframeRef: { current: iframe },
      onZIndexReorder: commit,
    });
    return null;
  }
  const root = mountReactHarness(createElement(Harness));
  unmounts.push(() => root.unmount());
  return () => sync;
}

it("reads a sealed preview's clip z-index for a lane drag", () => {
  const sync = stackingSync(sealedPreviewFrame().iframe, vi.fn());
  expect(sync().readClipZIndex(clip("back", 1, 1))).toBe(1);
  expect(sync().readClipZIndex({ ...clip("back", 1, 1), zIndex: undefined })).toBeNaN();
});

it("saves the restack of a lane drag in a sealed preview", async () => {
  document.body.innerHTML = PAGE;
  const commit = vi.fn<TimelineZIndexReorderCommit>(async () => undefined);
  const sync = stackingSync(sealedPreviewFrame().iframe, commit);
  await act(() => sync().applyStackingPatches([{ key: "back", zIndex: 3 }], "clip-lane-move:1"));
  expect(commit).toHaveBeenCalledOnce();
  expect(commit.mock.calls[0]).toMatchObject([
    [{ zIndex: 3, id: "back", sourceFile: "index.html", key: "back" }],
    "clip-lane-move:1",
  ]);
});

function reorderCommit(save: (batches: DomEditPatchBatch[]) => boolean) {
  let commit!: TimelineZIndexReorderCommit;
  function Harness() {
    commit = useElementLifecycleOps(
      makeLifecycleOpsParams({
        commitDomEditPatchBatches: async (batches) => {
          const durable = save(batches);
          return { durable, allMatched: durable, changed: durable };
        },
      }),
    ).handleDomZIndexReorderCommit;
    return null;
  }
  const root = mountReactHarness(createElement(Harness));
  unmounts.push(() => root.unmount());
  return (...args: Parameters<TimelineZIndexReorderCommit>) => commit(...args);
}

async function restackBack(save: (batches: DomEditPatchBatch[]) => boolean) {
  const iframe = sealedPreviewFrame().iframe;
  const found = await findPreviewElementForSelection(
    iframe,
    { id: "back", sourceFile: "index.html" },
    "index.html",
  );
  const element = standInFor(iframe, found!);
  const commit = reorderCommit(save);
  await act(() => commit([{ element, zIndex: 3, id: "back", sourceFile: "index.html" }]));
}

it("draws a sealed restack in the frame and saves the position it needs", async () => {
  document.body.innerHTML = PAGE;
  const saved: DomEditPatchBatch[][] = [];
  await restackBack((batches) => (saved.push(batches), true));
  const back = document.getElementById("back")!;
  await vi.waitFor(() => expect(back.style.zIndex).toBe("3"));
  expect(back.style.position).toBe("relative");
  expect(saved).toHaveLength(1);
  expect(saved[0]![0]!.patches[0]!.operations).toEqual([
    { type: "inline-style", property: "z-index", value: "3" },
    { type: "inline-style", property: "position", value: "relative" },
  ]);
});

it("puts a sealed restack back when its save fails", async () => {
  document.body.innerHTML = PAGE;
  const back = document.getElementById("back")!;
  const drawn: string[] = [];
  const watch = new MutationObserver(() => drawn.push(back.style.zIndex));
  watch.observe(back, { attributeFilter: ["style"] });
  await restackBack(() => false);
  await vi.waitFor(() => expect([...new Set(drawn)]).toEqual(["3", "1"]));
  expect(back.getAttribute("style")).toBe("position: static; z-index: 1;");
  watch.disconnect();
});
