// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../player";
import { applyRippleShifts, useTimelineDeleteOps } from "./useTimelineDeleteOps";
import { installReactActEnvironment, mountReactHarness } from "./domSelectionTestHarness";
import { useTrackPendingTimelineEdit } from "./useTrackPendingTimelineEdit";
import { flushStudioPendingEdits } from "../utils/studioPendingEdits";

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
        recordEdit: vi.fn().mockResolvedValue(undefined),
        reloadPreview: vi.fn(),
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
});

// Regression: a delete's write can reach disk before its history entry is
// recorded, so an Undo fired in that window found nothing to restore.
// Fails without useTrackPendingTimelineEdit's wrap (see that file).
describe("useTimelineDeleteOps: undo race", () => {
  // data-composition-id (readRootCompositionDuration's key) plus a
  // remove-element mock that actually drops hf-c: needed for a real diff.
  const html = `<!DOCTYPE html><html data-composition-variables='[]'><body>
<div data-hf-id="hf-stage" data-composition-id="main" data-duration="6">
<div data-hf-id="hf-a" data-start="0" data-duration="2"></div>
<div data-hf-id="hf-b" data-start="2" data-duration="2"></div>
<div data-hf-id="hf-c" data-start="4" data-duration="2"></div>
</div>
</body></html>`;
  const htmlAfterDeletingC = `<!DOCTYPE html><html data-composition-variables='[]'><body>
<div data-hf-id="hf-stage" data-composition-id="main" data-duration="6">
<div data-hf-id="hf-a" data-start="0" data-duration="2"></div>
<div data-hf-id="hf-b" data-start="2" data-duration="2"></div>
</div>
</body></html>`;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/file-mutations/remove-element/")) {
          return new Response(JSON.stringify({ changed: true, content: htmlAfterDeletingC }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ content: html }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  // A manually-resolved gate stands in for the delete's write landing — a
  // real timer raced the fix's own microtasks unpredictably (verified: it
  // kept passing even with the fix's tracking call deleted).
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }

  function mountRaceHarness() {
    const elements = [el("hf-a", 0, 2), el("hf-b", 2, 2), el("hf-c", 4, 2)];
    const gate = deferred<void>();
    const recordEdit = vi.fn(() => gate.promise);
    let tracked: ((elements: TimelineElement[]) => Promise<void>) | null = null;
    function Harness() {
      const track = useTrackPendingTimelineEdit();
      const hook = useTimelineDeleteOps({
        projectIdRef: { current: "test-project" },
        activeCompPath: "index.html",
        timelineElements: elements,
        showToast: vi.fn(),
        writeProjectFile: vi.fn().mockResolvedValue(undefined),
        recordEdit,
        reloadPreview: vi.fn(),
        previewIframeRef: { current: null },
        handleTimelineGroupMove: vi.fn().mockResolvedValue(undefined),
      });
      tracked = track(hook.handleTimelineElementsDelete);
      return null;
    }
    mountReactHarness(<Harness />);
    // Deletes the LAST clip (not the middle one): only this shrinks the
    // composition's furthest-clip-end duration, so the write actually
    // differs from the original content and recordEdit is reached — the
    // middle clip's delete leaves duration unchanged and is a no-op write.
    return { gate, recordEdit, deleteSelection: () => tracked!([elements[2]]) };
  }

  it("the pending-edit flush waits while the delete's history write is still landing", async () => {
    const { gate, recordEdit, deleteSelection } = mountRaceHarness();
    const order: string[] = [];
    const deletePromise = deleteSelection().then(() => order.push("deleted"));
    // Let the delete run up to (and call) recordEdit, which is now gated —
    // this is the exact window a fast Undo used to race into.
    await vi.waitFor(() => expect(recordEdit).toHaveBeenCalled());
    // No React state changes happen inside the flush itself here (no
    // pending-edit-flush listeners are registered in this harness), so it
    // does not need act()'s wrapping — only awaiting the delete's own
    // resolution below does.
    const flushPromise = flushStudioPendingEdits().then(() => order.push("flushed"));
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([]);
    gate.resolve();
    await deletePromise;
    await flushPromise;
    expect(order).toEqual(["deleted", "flushed"]);
  });

  it("the pending-edit flush resolves immediately once the delete has already finished", async () => {
    const { gate, deleteSelection } = mountRaceHarness();
    gate.resolve();
    await deleteSelection();
    await act(async () => {
      await flushStudioPendingEdits();
    });
  });
});
