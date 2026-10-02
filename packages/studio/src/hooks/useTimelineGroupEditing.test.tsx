// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
import type { TimelineElement } from "../player";
import { persistTimelineMoveEditsAtomically } from "./timelineMoveAdapter";
import { useTimelineGroupEditing } from "./useTimelineGroupEditing";
import { installReactActEnvironment, mountReactHarness } from "./domSelectionTestHarness";

installReactActEnvironment();

function el(id: string, start: number, duration: number, track = 0): TimelineElement {
  return { id, tag: "video", start, duration, track, domId: id };
}

describe("useTimelineGroupEditing: handleTimelineGroupMove suppressFailureToast", () => {
  let root: Root | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  type GroupEditingOptions = Parameters<typeof useTimelineGroupEditing>[0];

  // No project id makes enqueueGroupOperation reject before any persist runs,
  // exercising the move's real catch block without faking the SDK/server path.
  function mountFailingHarness(showToast: GroupEditingOptions["showToast"]) {
    let hook: ReturnType<typeof useTimelineGroupEditing> | null = null;
    function Harness() {
      hook = useTimelineGroupEditing({
        activeCompPath: "index.html",
        editQueueRef: { current: Promise.resolve() },
        pendingTimelineEditPathRef: { current: new Set() },
        previewIframeRef: { current: null },
        projectIdRef: { current: null },
        recordEdit: vi.fn().mockResolvedValue(undefined),
        reloadPreview: vi.fn(),
        showToast,
        writeProjectFile: vi.fn().mockResolvedValue(undefined),
      });
      return null;
    }
    root = mountReactHarness(<Harness />);
    return () => hook!;
  }

  const change = { element: el("a", 0, 2), start: 2 };

  it("shows no toast when suppressFailureToast is set on a failed move", async () => {
    const showToast = vi.fn();
    const getHook = mountFailingHarness(showToast);

    await act(async () => {
      await expect(
        getHook().handleTimelineGroupMove([change], { suppressFailureToast: true }),
      ).rejects.toThrow();
    });

    expect(showToast).not.toHaveBeenCalled();
  });

  it("shows one toast when suppressFailureToast is not set on a failed move", async () => {
    const showToast = vi.fn();
    const getHook = mountFailingHarness(showToast);

    await act(async () => {
      await expect(getHook().handleTimelineGroupMove([change])).rejects.toThrow();
    });

    expect(showToast).toHaveBeenCalledTimes(1);
  });
});

it.each([false, true])(
  "keeps detachment and the lane atomic, including a refused history write ($0)",
  async (refused) => {
    const before =
      '<main data-composition-id="root" data-duration="4"><audio id="voice" data-start="0" data-duration="2" data-track-index="1" data-audio-group="group"></audio></main>';
    let disk = before;
    const failure = new Error("history refused");
    const recordEdit = refused ? vi.fn().mockRejectedValue(failure) : vi.fn();
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    iframe.contentDocument!.body.innerHTML = before;
    const writeProjectFile = vi.fn(async (_path: string, content: string) => {
      disk = content;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ content: disk }), {
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    let hook: ReturnType<typeof useTimelineGroupEditing>;
    function Harness() {
      hook = useTimelineGroupEditing({
        activeCompPath: "index.html",
        editQueueRef: { current: Promise.resolve() },
        pendingTimelineEditPathRef: { current: new Set() },
        previewIframeRef: { current: iframe },
        projectIdRef: { current: "fixture" },
        recordEdit,
        writeProjectFile,
        reloadPreview: vi.fn(),
        showToast: vi.fn(),
      });
      return null;
    }
    const root = mountReactHarness(<Harness />);
    try {
      await act(async () => {
        const moved = persistTimelineMoveEditsAtomically(
          [
            {
              element: { ...el("voice", 0, 2, 1), tag: "audio", audioGroup: "group" },
              updates: { start: 0, track: 0, audioGroup: null },
            },
          ],
          "insert",
          "track-insert",
          { handleTimelineGroupMove: hook!.handleTimelineGroupMove },
        );
        if (refused) await expect(moved).rejects.toBe(failure);
        else await moved;
      });
      expect(
        iframe.contentDocument!.getElementById("voice")?.getAttribute("data-audio-group"),
      ).toBe("group");
      if (refused) {
        expect(disk).toBe(before);
        expect(writeProjectFile).toHaveBeenCalledTimes(2);
        return;
      }
      expect(writeProjectFile).toHaveBeenCalledOnce();
      expect(recordEdit).toHaveBeenCalledOnce();
      expect(disk).not.toContain("data-audio-group");
      expect(disk).toContain('data-track-index="0"');
      expect(recordEdit.mock.calls[0][0].files["index.html"]).toEqual({ before, after: disk });
    } finally {
      act(() => root.unmount());
      iframe.remove();
      vi.unstubAllGlobals();
    }
  },
);
