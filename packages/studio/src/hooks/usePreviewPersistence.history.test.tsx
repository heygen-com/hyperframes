// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../player/store/playerStore";
import type { TimelineElement } from "../player/store/timelineElement";
import { mountReactHarness } from "./domSelectionTestHarness";
import { usePreviewPersistence } from "./usePreviewPersistence";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.getState().reset();
});

describe("undo that reloads the preview", () => {
  it("keeps the timeline's clips until the reloaded preview reports its own", async () => {
    const clips = [{ id: "a" }, { id: "b" }] as unknown as TimelineElement[];
    usePlayerStore.getState().setElements(clips);
    usePlayerStore.getState().setTimelineReady(true);
    const reloadPreview = vi.fn();
    let sync: ReturnType<typeof usePreviewPersistence>["syncHistoryPreviewAfterApply"] | null =
      null;
    function Harness() {
      sync = usePreviewPersistence({
        showToast: () => {},
        readOptionalProjectFile: async () => "",
        writeProjectFile: async () => {},
        recordEdit: async () => {},
        previewIframeRef: { current: null },
        activeCompPathRef: { current: "index.html" },
        reloadPreview,
      }).syncHistoryPreviewAfterApply;
      return null;
    }
    mountReactHarness(<Harness />);

    // A nested composition's undo is not the active file's, so it reloads the preview.
    const files = { "compositions/sub.html": { previous: "<p>1</p>", restored: "<p>2</p>" } };
    await act(async () => sync!({ paths: Object.keys(files), files }));

    expect(reloadPreview).toHaveBeenCalledTimes(1);
    const player = usePlayerStore.getState();
    expect([player.elements, player.timelineReady]).toEqual([clips, true]);
  });
});
