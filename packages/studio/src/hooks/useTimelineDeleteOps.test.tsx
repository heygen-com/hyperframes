// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../player";
import { applyRippleShifts, useTimelineDeleteOps } from "./useTimelineDeleteOps";
import { installReactActEnvironment, mountReactHarness } from "./domSelectionTestHarness";

installReactActEnvironment();

function el(id: string, start: number, duration: number, track = 0): TimelineElement {
  return { id, tag: "video", start, duration, track, domId: id };
}

describe("applyRippleShifts", () => {
  it("returns survivors unchanged when there are no changes", () => {
    const survivors = [el("a", 0, 2), el("c", 8, 1)];
    expect(applyRippleShifts(survivors, null)).toBe(survivors);
  });

  it("rewrites only the starts named by the changes", () => {
    const survivors = [el("a", 0, 2), el("c", 8, 1)];
    const result = applyRippleShifts(survivors, [{ element: survivors[1], start: 2 }]);
    expect(result).toEqual([el("a", 0, 2), el("c", 2, 1)]);
    expect(result[0]).toBe(survivors[0]);
  });
});

describe("useTimelineDeleteOps: ripple undo label", () => {
  const html = `<!DOCTYPE html><html data-composition-variables='[]'><body>
<div data-hf-id="hf-stage" data-hf-root data-duration="6">
<div data-hf-id="hf-a" data-start="0" data-duration="2"></div>
<div data-hf-id="hf-b" data-start="2" data-duration="2"></div>
<div data-hf-id="hf-c" data-start="4" data-duration="2"></div>
</div>
</body></html>`;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/file-mutations/remove-element/")) {
          return new Response(JSON.stringify({ changed: true, content: html }), { status: 200 });
        }
        return new Response(JSON.stringify({ content: html }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  type DeleteOpsOptions = Parameters<typeof useTimelineDeleteOps>[0];

  function mountDeleteHarness(overrides: {
    handleTimelineGroupMove: DeleteOpsOptions["handleTimelineGroupMove"];
    showToast?: DeleteOpsOptions["showToast"];
    recordEdit?: DeleteOpsOptions["recordEdit"];
    reloadPreview?: DeleteOpsOptions["reloadPreview"];
    forceReloadSdkSession?: DeleteOpsOptions["forceReloadSdkSession"];
  }) {
    const elements = [el("hf-a", 0, 2), el("hf-b", 2, 2), el("hf-c", 4, 2)];
    let hook: ReturnType<typeof useTimelineDeleteOps> | null = null;
    function Harness() {
      hook = useTimelineDeleteOps({
        projectIdRef: { current: "test-project" },
        activeCompPath: "index.html",
        timelineElements: elements,
        showToast: overrides.showToast ?? vi.fn(),
        writeProjectFile: vi.fn().mockResolvedValue(undefined),
        recordEdit: overrides.recordEdit ?? vi.fn().mockResolvedValue(undefined),
        reloadPreview: overrides.reloadPreview ?? vi.fn(),
        forceReloadSdkSession: overrides.forceReloadSdkSession,
        previewIframeRef: { current: null },
        handleTimelineGroupMove: overrides.handleTimelineGroupMove,
      });
      return null;
    }
    mountReactHarness(<Harness />);
    return { b: elements[1], getHook: () => hook! };
  }

  // editHistory.ts's coalescing keeps the LAST recordEdit call's label, so the
  // folded ripple move must carry the delete's label, not its own.
  it("passes the delete's own label to the folded ripple move, not 'Move timeline clips'", async () => {
    const handleTimelineGroupMove = vi.fn().mockResolvedValue(undefined);
    const { b, getHook } = mountDeleteHarness({ handleTimelineGroupMove });

    await act(async () => {
      await getHook().handleTimelineElementDelete(b);
    });

    expect(handleTimelineGroupMove).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ label: "Delete timeline clip" }),
    );
  });

  it("shows exactly one toast when a ripple fails to persist after a committed delete", async () => {
    const handleTimelineGroupMove = vi.fn().mockRejectedValue(new Error("persist failed"));
    const showToast = vi.fn();
    const { b, getHook } = mountDeleteHarness({ handleTimelineGroupMove, showToast });

    await act(async () => {
      await getHook().handleTimelineElementDelete(b);
    });

    // The user did one thing (delete); the generic move-failure toast is
    // suppressed on this call so only the specific message reaches them.
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      "Clip deleted, but the gap could not be closed.",
      "error",
    );
    expect(handleTimelineGroupMove).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ suppressFailureToast: true }),
    );
  });

  it("an overwrite delete records under the drop's fold key and never ripples the main track", async () => {
    const handleTimelineGroupMove = vi.fn().mockResolvedValue(undefined);
    const recordEdit = vi.fn().mockResolvedValue(undefined);
    const { b, getHook } = mountDeleteHarness({ handleTimelineGroupMove, recordEdit });
    const withoutB = html.replace(/<div data-hf-id="hf-b"[^>]*><\/div>\n/, "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const content = String(input).includes("/remove-element/") ? withoutB : html;
        return new Response(JSON.stringify({ changed: true, content }), { status: 200 });
      }),
    );
    let deleted: boolean | undefined;

    await act(async () => {
      deleted = await getHook().deleteTimelineElements([b], {
        coalesceKey: "clip-overwrite:3",
        coalesceMs: Number.POSITIVE_INFINITY,
      });
    });

    expect(deleted).toBe(true);
    expect(handleTimelineGroupMove).not.toHaveBeenCalled();
    expect(recordEdit).toHaveBeenCalledWith(
      expect.objectContaining({ coalesceKey: "clip-overwrite:3", coalesceMs: Infinity }),
    );
  });

  // A drop reloads the preview once, at its end; an interior remove must not reload on its own.
  it("skips reloading the preview for an overwrite delete, but still refreshes the sdk session", async () => {
    const handleTimelineGroupMove = vi.fn().mockResolvedValue(undefined);
    const reloadPreview = vi.fn();
    const forceReloadSdkSession = vi.fn();
    const { b, getHook } = mountDeleteHarness({
      handleTimelineGroupMove,
      reloadPreview,
      forceReloadSdkSession,
    });

    await act(async () => {
      await getHook().deleteTimelineElements([b], {
        coalesceKey: "clip-overwrite:4",
        coalesceMs: Number.POSITIVE_INFINITY,
      });
    });

    expect(reloadPreview).not.toHaveBeenCalled();
    expect(forceReloadSdkSession).toHaveBeenCalledTimes(1);
  });

  it("still reloads the preview for a plain (non-drop) delete", async () => {
    const handleTimelineGroupMove = vi.fn().mockResolvedValue(undefined);
    const reloadPreview = vi.fn();
    const { b, getHook } = mountDeleteHarness({ handleTimelineGroupMove, reloadPreview });

    await act(async () => {
      await getHook().handleTimelineElementDelete(b);
    });

    expect(reloadPreview).toHaveBeenCalledTimes(1);
  });

  it("an overwrite delete leaves the store to the drop, a plain delete rewrites it", async () => {
    const handleTimelineGroupMove = vi.fn().mockResolvedValue(undefined);
    const dropEndState = [el("hf-a", 1, 1), el("hf-c", 6, 2)];
    const { b, getHook } = mountDeleteHarness({ handleTimelineGroupMove });

    usePlayerStore.getState().setElements(dropEndState);
    await act(async () => {
      await getHook().deleteTimelineElements([b], {
        coalesceKey: "clip-overwrite:5",
        coalesceMs: Number.POSITIVE_INFINITY,
      });
    });
    expect(usePlayerStore.getState().elements).toEqual(dropEndState);

    await act(async () => {
      await getHook().handleTimelineElementDelete(b);
    });
    expect(usePlayerStore.getState().elements.map((e) => e.id)).toEqual(["hf-a", "hf-c"]);
    expect(usePlayerStore.getState().elements).not.toEqual(dropEndState);
  });
});
