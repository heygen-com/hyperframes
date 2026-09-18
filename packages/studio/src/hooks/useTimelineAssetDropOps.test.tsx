// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTimelineAssetDropOps } from "./useTimelineAssetDropOps";
import { mountReactHarness } from "./domSelectionTestHarness";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

type DropFn = ReturnType<typeof useTimelineAssetDropOps>["handleTimelineAssetDrop"];

function renderDropHook(
  sourceContent: string,
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>,
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
      timelineElements: [],
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
});
