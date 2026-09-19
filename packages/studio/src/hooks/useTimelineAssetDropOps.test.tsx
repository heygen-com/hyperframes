// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTimelineAssetDropOps } from "./useTimelineAssetDropOps";
import { mountReactHarness } from "./domSelectionTestHarness";
import { usePlayerStore } from "../player/store/playerStore";
import type { TimelineElement } from "../player";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  usePlayerStore.getState().reset();
});

type DropFn = ReturnType<typeof useTimelineAssetDropOps>["handleTimelineAssetDrop"];

function renderDropHook(
  sourceContent: string,
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>,
  timelineElements: TimelineElement[] = [],
) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: sourceContent }) }),
  );
  let drop: DropFn | null = null;
  function Harness() {
    const { handleTimelineAssetDrop } = useTimelineAssetDropOps({
      projectIdRef: { current: "project" },
      activeCompPath: "index.html",
      timelineElements,
      showToast: vi.fn(),
      writeProjectFile,
      recordEdit: vi.fn().mockResolvedValue(undefined),
      reloadPreview: vi.fn(),
      uploadProjectFiles: vi.fn().mockResolvedValue([]),
    });
    drop = handleTimelineAssetDrop;
    return null;
  }
  mountReactHarness(<Harness />);
  return () => drop!;
}

describe("useTimelineAssetDropOps handleTimelineAssetDrop", () => {
  it("grows the root duration when the drop lands past the current end", async () => {
    const source =
      '<main data-composition-id="scene" data-duration="10" data-width="1920" data-height="1080"></main>';
    const writeProjectFile = vi.fn().mockResolvedValue(undefined);
    const getDrop = renderDropHook(source, writeProjectFile);

    await act(async () => {
      await getDrop()("clip.mp4", { start: 8, track: 0 }, 5);
    });

    const [, written] = writeProjectFile.mock.calls[0] as [string, string];
    expect(written).toContain('data-duration="13"');
  });

  it("leaves the root duration alone when the drop lands inside the current end", async () => {
    const source =
      '<main data-composition-id="scene" data-duration="10" data-width="1920" data-height="1080"></main>';
    const writeProjectFile = vi.fn().mockResolvedValue(undefined);
    const getDrop = renderDropHook(source, writeProjectFile);

    await act(async () => {
      await getDrop()("clip.mp4", { start: 1, track: 0 }, 2);
    });

    const [, written] = writeProjectFile.mock.calls[0] as [string, string];
    expect(written).toContain('data-duration="10"');
  });

  it("selects and reveals the newly dropped clip", async () => {
    const source =
      '<main data-composition-id="scene" data-duration="10" data-width="1920" data-height="1080"></main>';
    const writeProjectFile = vi.fn().mockResolvedValue(undefined);
    const getDrop = renderDropHook(source, writeProjectFile);

    await act(async () => {
      await getDrop()("clip.mp4", { start: 1, track: 0 }, 2);
    });

    expect(usePlayerStore.getState().selectedElementId).toBe("index.html#clip");
  });

  it("measures the insert row against the visible rows, not clips the timeline hides", async () => {
    const clip = (id: string, track: number): TimelineElement => ({
      id,
      key: id,
      tag: "div",
      start: 0,
      duration: 2,
      track,
      authoredTrack: track,
      hfId: `hf-${id}`,
      domId: id,
    });
    const source = [
      '<main data-composition-id="scene" data-duration="10" data-width="1920" data-height="1080">',
      ...["a:0", "hidden:1", "b:2"].map((t) => {
        const [id, track] = t.split(":");
        return `<div data-hf-id="hf-${id}" id="${id}" data-start="0" data-track-index="${track}"></div>`;
      }),
      "</main>",
    ].join("\n");
    usePlayerStore.getState().setTopLevelIds(new Set(["a", "b"]));
    const writeProjectFile = vi.fn().mockResolvedValue(undefined);
    const getDrop = renderDropHook(source, writeProjectFile, [
      clip("a", 0),
      clip("hidden", 1),
      clip("b", 2),
    ]);

    await act(async () => {
      await getDrop()("clip.mp4", { start: 1, track: 1, insertRow: 1 }, 2);
    });

    const [, written] = writeProjectFile.mock.calls[0] as [string, string];
    expect(written).toContain('id="b" data-start="0" data-track-index="2"');
    expect(written).toContain('id="hidden" data-start="0" data-track-index="1"');
  });
});
