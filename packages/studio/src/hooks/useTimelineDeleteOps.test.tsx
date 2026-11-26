// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../player";
import { applyRippleShifts, useTimelineDeleteOps } from "./useTimelineDeleteOps";
import { installReactActEnvironment, mountReactHarness } from "./domSelectionTestHarness";
import { useTrackPendingTimelineEdit } from "./useTrackPendingTimelineEdit";
import { flushStudioPendingEdits } from "../utils/studioPendingEdits";
import { serializeStudioFileMutations } from "../utils/studioFileMutationCoordinator";
import { enqueueTimelineEdit, type TimelineEditQueue } from "./timelineEditQueue";
import type { TimelineGroupCommitOptions } from "./useTimelineGroupEditing";
import { useTimelineTrimRipple } from "./useTimelineTrimRipple";
import { persistTimelineMoveEditsAtomically } from "./timelineMoveAdapter";
import { persistMoveEdits, type DragCommitDeps } from "../player/components/timelineClipDragCommit";
import { LANE_OVERLAP_NOTICE } from "../player/components/timelineCollision";
import { keyHint } from "../player/components/studioShortcuts";
import type { DomEditSelection } from "../components/editor/domEditingTypes";

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

function stubRemoveElementsFetch(current: string, afterRemoval: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const isRemoval = String(input).includes("/file-mutations/remove-elements/");
      const content = isRemoval ? afterRemoval : current;
      return new Response(JSON.stringify({ changed: isRemoval, content }), { status: 200 });
    }),
  );
}

describe("useTimelineDeleteOps: ripple undo label", () => {
  const html = `<!DOCTYPE html><html data-composition-variables='[]'><body>
<div data-hf-id="hf-stage" data-hf-root data-duration="6">
<div data-hf-id="hf-a" data-start="0" data-duration="2"></div>
<div data-hf-id="hf-b" data-start="2" data-duration="2"></div>
<div data-hf-id="hf-c" data-start="4" data-duration="2"></div>
</div>
</body></html>`;

  beforeEach(() => {
    stubRemoveElementsFetch(html, html);
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
    editQueueRef?: DeleteOpsOptions["editQueueRef"];
    writeProjectFile?: DeleteOpsOptions["writeProjectFile"];
    alsoMount?: () => void;
  }) {
    const elements = [el("hf-a", 0, 2), el("hf-b", 2, 2), el("hf-c", 4, 2)];
    const editQueueRef = overrides.editQueueRef ?? {
      current: Promise.resolve(),
      projectId: "test-project",
    };
    usePlayerStore.getState().setElements(elements);
    let hook: ReturnType<typeof useTimelineDeleteOps> | null = null;
    function Harness() {
      hook = useTimelineDeleteOps({
        activeCompPath: "index.html",
        showToast: overrides.showToast ?? vi.fn(),
        writeProjectFile: overrides.writeProjectFile ?? vi.fn().mockResolvedValue(undefined),
        recordEdit: overrides.recordEdit ?? vi.fn().mockResolvedValue(undefined),
        reloadPreview: vi.fn(),
        previewIframeRef: { current: null },
        editQueueRef,
        handleTimelineGroupMove: overrides.handleTimelineGroupMove,
      });
      overrides.alsoMount?.();
      return null;
    }
    mountReactHarness(<Harness />);
    return { elements, b: elements[1], getHook: () => hook! };
  }

  it("drops the deleted clip from the timeline while the ripple is still saving", async () => {
    let finishRipple = () => {};
    const handleTimelineGroupMove = vi.fn(
      () => new Promise<void>((resolve) => (finishRipple = resolve)),
    );
    const { b, getHook } = mountDeleteHarness({ handleTimelineGroupMove });

    let deleting = Promise.resolve();
    await act(async () => {
      deleting = getHook().handleTimelineElementDelete(b);
      await vi.waitFor(() => expect(handleTimelineGroupMove).toHaveBeenCalled());
    });
    expect(usePlayerStore.getState().elements.map((e) => e.id)).toEqual(["hf-a", "hf-c"]);

    await act(async () => {
      finishRipple();
      await deleting;
    });
  });

  it("a delete that lands names the clip and the undo key, as the ripple toast does", async () => {
    const showToast = vi.fn();
    const { b, getHook } = mountDeleteHarness({
      handleTimelineGroupMove: vi.fn().mockResolvedValue(undefined),
      showToast,
    });

    await act(async () => {
      await getHook().handleTimelineElementDelete(b);
    });

    const undo = keyHint("undo");
    expect(showToast.mock.calls[0]).toEqual([`Deleted hf-b. Undo (${undo}) restores it.`, "info"]);
    expect(showToast.mock.calls[1]?.[0]).toContain(`Undo (${undo}) restores it`);
  });

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

  it("holds the delete's undo step open under the key its ripple joins, however late the ripple lands", async () => {
    stubRemoveElementsFetch(html, html.replace(/<div data-hf-id="hf-b"[^\n]*\n/, ""));
    const handleTimelineGroupMove = vi.fn().mockResolvedValue(undefined);
    const recordEdit = vi.fn().mockResolvedValue(undefined);
    const { b, getHook } = mountDeleteHarness({ handleTimelineGroupMove, recordEdit });

    await act(async () => {
      await getHook().handleTimelineElementDelete(b);
    });

    const [[deleted]] = recordEdit.mock.calls;
    expect(deleted).toMatchObject({ coalesceMs: Infinity });
    expect(handleTimelineGroupMove).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ coalesceKey: deleted.coalesceKey }),
    );
  });

  // Deletes, trims and moves sharing one edit queue; `writes` is the save order, with each move's starts.
  function mountQueuedEdits(refuseOnce?: string) {
    const writes: string[] = [];
    let refused = refuseOnce;
    const refuses = (write: string) => {
      writes.push(write);
      if (write !== refused) return false;
      refused = undefined;
      return true;
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/file-mutations/remove-elements/")) {
          const { targets } = JSON.parse(String(init?.body)) as { targets: Array<{ id: string }> };
          if (refuses(`delete ${targets.map((t) => t.id).join(",")}`)) {
            return new Response("{}", { status: 500 });
          }
        }
        return new Response(JSON.stringify({ content: html }), { status: 200 });
      }),
    );
    // Stands in for the editor's group commits: each joins the edit queue, then writes the file.
    const editQueueRef: TimelineEditQueue = {
      current: Promise.resolve(),
      projectId: "test-project",
    };
    const writeProjectFile = vi.fn().mockResolvedValue(undefined);
    const save = (write: string, options?: TimelineGroupCommitOptions) =>
      enqueueTimelineEdit(
        editQueueRef,
        async () => {
          await options?.beforeTiming;
          await serializeStudioFileMutations(writeProjectFile, ["index.html"], async () => {
            if (refuses(write)) throw new Error("refused");
          });
        },
        { ifEarlierRefused: options?.ifEarlierRefused, projectId: "test-project" },
      );
    const handleTimelineGroupMove: DeleteOpsOptions["handleTimelineGroupMove"] = (
      changes,
      options,
    ) => save(`move ${changes.map((c) => `${c.element.id}@${c.start}`).join(",")}`, options);
    let trimRipple: ReturnType<typeof useTimelineTrimRipple> | null = null;
    const { elements, getHook } = mountDeleteHarness({
      handleTimelineGroupMove,
      editQueueRef,
      writeProjectFile,
      alsoMount: () => {
        trimRipple = useTimelineTrimRipple({
          handleTimelineElementResize: vi.fn(),
          handleTimelineGroupResize: (changes, options) =>
            save(
              `resize ${changes.map((c) => `${c.element.id}+${c.duration}`).join(",")}`,
              options,
            ),
          handleTimelineGroupMove,
          showToast: vi.fn(),
          reloadPreview: vi.fn(),
          editQueueRef,
        });
      },
    });
    return { writes, elements, getHook, getTrim: () => trimRipple!, handleTimelineGroupMove };
  }

  // Deletes hf-a, then hf-b once hf-a's ripple slid it to 0.
  async function deleteTwoInARow(refuseOnce?: string) {
    const queued = mountQueuedEdits(refuseOnce);
    const { elements, getHook } = queued;
    await act(async () => {
      const first = getHook().handleTimelineElementDelete(elements[0]);
      const shiftedB = usePlayerStore.getState().elements.find((e) => e.id === "hf-b")!;
      await Promise.all([first, getHook().handleTimelineElementDelete(shiftedB)]);
    });
    return queued;
  }

  // fails without the fix: the second delete saved between the first delete and its ripple.
  it("saves a delete made right after another after the first one's ripple", async () => {
    const { writes } = await deleteTwoInARow();

    expect(writes).toEqual(["delete hf-a", "move hf-b@0,hf-c@2", "delete hf-b", "move hf-c@0"]);
    expect(usePlayerStore.getState().elements).toEqual([el("hf-c", 0, 2)]);
  });

  // fails without the fix: deleting hf-b saved hf-c at 0, on top of hf-a, though hf-a's delete or shift was refused.
  it.each([
    ["delete hf-a", ["delete hf-a", "delete hf-b"], [el("hf-c", 4, 2), el("hf-a", 0, 2)]],
    [
      "move hf-b@0,hf-c@2",
      ["delete hf-a", "move hf-b@0,hf-c@2", "delete hf-b"],
      [el("hf-c", 4, 2)],
    ],
  ])(
    "a refused %s refuses the next delete's shift too, so hf-c is never saved at 0 on hf-a",
    async (refused, saved, after) => {
      expect((await deleteTwoInARow(refused)).writes).toEqual(saved);
      expect(usePlayerStore.getState().elements).toEqual(after);
    },
  );

  it("a delete made once a refusal has settled still closes its gap", async () => {
    const { writes, getHook } = await deleteTwoInARow("delete hf-a");
    const a = usePlayerStore.getState().elements.find((e) => e.id === "hf-a")!;

    await act(() => getHook().handleTimelineElementDelete(a));

    expect(writes.slice(2)).toEqual(["delete hf-a", "move hf-c@2"]);
    expect(usePlayerStore.getState().elements).toEqual([el("hf-c", 2, 2)]);
  });

  // fails without the fix: the trim's shift saved hf-c at 1, placed as if hf-b's refused delete had happened.
  it("a trim ripple queued behind a refused delete is refused before it writes, and only its shift rolls back", async () => {
    const { writes, elements, getHook, getTrim } = mountQueuedEdits("delete hf-b");
    const [a, b] = elements;

    await act(async () => {
      const deleting = getHook().handleTimelineElementDelete(b);
      const trim = getTrim().handleTrimElement(a, {
        start: 0,
        duration: 1,
        playbackStart: undefined,
      });
      await Promise.all([deleting, trim]);
    });

    expect(writes).toEqual(["delete hf-b", "resize hf-a+1"]);
    expect(usePlayerStore.getState().elements).toEqual([
      el("hf-a", 0, 2),
      el("hf-c", 4, 2),
      el("hf-b", 2, 2),
    ]);
  });

  // Deletes hf-b with Ripple off, then drags hf-a to `to` while the delete is still saving.
  async function dragBehindRefusedDelete(to: number) {
    usePlayerStore.setState({ rippleEditEnabled: false });
    const queued = mountQueuedEdits("delete hf-b");
    const [a, b] = queued.elements;
    let refusal: Promise<unknown> = Promise.resolve();
    const onMoveElements: DragCommitDeps["onMoveElements"] = (edits, coalesceKey) => {
      const moved = persistTimelineMoveEditsAtomically(edits, coalesceKey, "timing", {
        handleTimelineGroupMove: queued.handleTimelineGroupMove,
      });
      refusal = moved.then(
        () => null,
        (error: Error) => error.message,
      );
      return moved;
    };
    try {
      await act(async () => {
        const deleting = queued.getHook().handleTimelineElementDelete(b);
        const { elements, updateElement } = usePlayerStore.getState();
        const drag = persistMoveEdits([{ element: a, updates: { start: to, track: 0 } }], {
          elements,
          trackOrder: [0],
          updateElement,
          onMoveElements,
        });
        await Promise.all([deleting, drag]);
      });
    } finally {
      usePlayerStore.setState({ rippleEditEnabled: true });
    }
    return { writes: queued.writes, refused: await refusal };
  }

  it("a drag queued behind a refused delete that stays clear of the restored clip still saves", async () => {
    const { writes, refused } = await dragBehindRefusedDelete(6.5);

    expect(refused).toBeNull();
    expect(writes).toEqual(["delete hf-b", "move hf-a@6.5"]);
    expect(usePlayerStore.getState().elements).toEqual([
      el("hf-a", 6.5, 2),
      el("hf-c", 4, 2),
      el("hf-b", 2, 2),
    ]);
  });

  // fails without the fix: the drag saved hf-a at 2.5, on top of hf-b, which the refused delete put back.
  it("a drag queued behind a refused delete that would land on the restored clip is refused and rolls back", async () => {
    const { writes, refused } = await dragBehindRefusedDelete(2.5);

    expect(refused).toBe(LANE_OVERLAP_NOTICE);
    expect(writes).toEqual(["delete hf-b"]);
    expect(usePlayerStore.getState().elements).toEqual([
      el("hf-a", 0, 2),
      el("hf-c", 4, 2),
      el("hf-b", 2, 2),
    ]);
  });

  it("removes a multi-clip selection with one request, however many clips it holds", async () => {
    const handleTimelineGroupMove = vi.fn().mockResolvedValue(undefined);
    const { elements, getHook } = mountDeleteHarness({ handleTimelineGroupMove });

    await act(async () => {
      await getHook().handleTimelineElementsDelete(elements);
    });

    const removals = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).includes("/file-mutations/remove-element"));
    expect(removals).toHaveLength(1);
    const [, init] = removals[0] as [unknown, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.targets).toHaveLength(elements.length);
  });

  // fails without the fix: the refused delete dropped the server's status, so telemetry could not say why it failed.
  it("a refused delete names its count and the server's status: 1 clip, 2 clips", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("/file-mutations/remove-elements/")
          ? new Response("{}", { status: 500 })
          : new Response(JSON.stringify({ content: html }), { status: 200 }),
      ),
    );
    const showToast = vi.fn();
    const { elements, b, getHook } = mountDeleteHarness({
      handleTimelineGroupMove: vi.fn(),
      showToast,
    });

    await act(async () => {
      await getHook().handleTimelineElementDelete(b);
    });
    await act(async () => {
      await getHook().handleTimelineElementsDelete(elements.slice(0, 2));
    });

    expect(showToast.mock.calls.map(([message]) => message)).toEqual([
      "Failed to delete 1 clip from index.html (500): {}",
      "Failed to delete 2 clips from index.html (500): {}",
    ]);
  });

  it.each([
    [
      403,
      "permission",
      "index.html can't be changed: it is read-only or protected. Check its permissions, then try again.",
    ],
    [423, "busy", "index.html is open in another program. Close it there, then try again."],
  ])("a delete the server refuses with %i names the file and why", async (status, why, words) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("/file-mutations/remove-elements/")
          ? new Response(JSON.stringify({ error: "refused", why }), { status })
          : new Response(JSON.stringify({ content: html }), { status: 200 }),
      ),
    );
    const showToast = vi.fn();
    const { b, getHook } = mountDeleteHarness({ handleTimelineGroupMove: vi.fn(), showToast });

    await act(async () => {
      await getHook().handleTimelineElementDelete(b);
    });

    expect(showToast.mock.calls.map(([message]) => message)).toEqual([words]);
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
    stubRemoveElementsFetch(html, htmlAfterDeletingC);
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
    usePlayerStore.getState().setElements(elements);
    const gate = deferred<void>();
    const recordEdit = vi.fn(() => gate.promise);
    let tracked: ((elements: TimelineElement[]) => Promise<void>) | null = null;
    function Harness() {
      const track = useTrackPendingTimelineEdit();
      const hook = useTimelineDeleteOps({
        activeCompPath: "index.html",
        showToast: vi.fn(),
        writeProjectFile: vi.fn().mockResolvedValue(undefined),
        recordEdit,
        reloadPreview: vi.fn(),
        previewIframeRef: { current: null },
        editQueueRef: { current: Promise.resolve(), projectId: "test-project" },
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

  it("shows the shortened length while the last clip's delete is still saving", async () => {
    const { gate, recordEdit, deleteSelection } = mountRaceHarness();
    usePlayerStore.getState().setDuration(6);
    const deletePromise = deleteSelection();
    await vi.waitFor(() => expect(recordEdit).toHaveBeenCalled());
    expect(usePlayerStore.getState().duration).toBe(4);
    gate.resolve();
    await deletePromise;
  });
});

// Regression: the live preview kept a deleted clip until its reload landed, and composition
// enrichment re-read it from there, so the clip stayed drawn after the file dropped it.
describe("useTimelineDeleteOps: live preview", () => {
  const html = `<!DOCTYPE html><html data-composition-variables='[]'><body>
<div data-hf-id="hf-stage" data-composition-id="main" data-duration="4">
<div data-hf-id="hf-a" data-start="0" data-duration="2"></div>
<div data-hf-id="hf-b" data-start="2" data-duration="2"></div>
</div>
</body></html>`;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ changed: true, content: html }))),
    );
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("takes the deleted clip out of the live preview before its reload", async () => {
    const preview = document.implementation.createHTMLDocument();
    preview.documentElement.innerHTML = html;
    const iframe = { contentDocument: preview } as unknown as HTMLIFrameElement;
    const clip = (id: string, start: number): TimelineElement => ({
      id,
      tag: "div",
      start,
      duration: 2,
      track: 0,
      hfId: id,
      sourceFile: "index.html",
    });
    const elements = [clip("hf-a", 0), clip("hf-b", 2)];
    usePlayerStore.getState().setElements(elements);
    let hook: ReturnType<typeof useTimelineDeleteOps> | null = null;
    function Harness() {
      hook = useTimelineDeleteOps({
        activeCompPath: "index.html",
        showToast: vi.fn(),
        writeProjectFile: vi.fn().mockResolvedValue(undefined),
        recordEdit: vi.fn().mockResolvedValue(undefined),
        reloadPreview: vi.fn(),
        previewIframeRef: { current: iframe },
        editQueueRef: { current: Promise.resolve(), projectId: "test-project" },
        handleTimelineGroupMove: vi.fn().mockResolvedValue(undefined),
      });
      return null;
    }
    mountReactHarness(<Harness />);

    await act(async () => {
      await hook!.handleTimelineElementDelete(elements[1]);
    });

    expect(preview.querySelector('[data-hf-id="hf-b"]')).toBeNull();
    expect(preview.querySelector('[data-hf-id="hf-a"]')).not.toBeNull();
  });

  // fails without the fix: the deleted clip's selection outline stayed until Studio re-read the preview, which a
  // sealed preview answers frames later (R77: outline gone at 128-228 ms after the clip, against 91-111 unsealed).
  it("drops the deleted clip's canvas selection in the same step that takes it out of the preview", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    const preview = document.implementation.createHTMLDocument();
    preview.documentElement.innerHTML = html;
    const iframe = { contentDocument: preview } as unknown as HTMLIFrameElement;
    const clip = (id: string, start: number): TimelineElement => ({
      id,
      tag: "div",
      start,
      duration: 2,
      track: 0,
      hfId: id,
      sourceFile: "index.html",
    });
    const elements = [clip("hf-a", 0), clip("hf-b", 2)];
    usePlayerStore.getState().setElements(elements);
    const selected = (hfId: string) =>
      ({
        element: preview.querySelector(`[data-hf-id="${hfId}"]`)!,
        hfId,
        sourceFile: "index.html",
      }) as unknown as DomEditSelection;
    const [kept, deleted] = [selected("hf-a"), selected("hf-b")];
    const applyMarqueeSelection = vi.fn();
    let hook: ReturnType<typeof useTimelineDeleteOps> | null = null;
    function Harness() {
      hook = useTimelineDeleteOps({
        activeCompPath: "index.html",
        showToast: vi.fn(),
        writeProjectFile: vi.fn().mockResolvedValue(undefined),
        recordEdit: vi.fn().mockResolvedValue(undefined),
        reloadPreview: vi.fn(),
        previewIframeRef: { current: iframe },
        canvasSelectionsRef: { current: [deleted, kept] },
        applyMarqueeSelectionRef: { current: applyMarqueeSelection },
        editQueueRef: { current: Promise.resolve(), projectId: "test-project" },
        handleTimelineGroupMove: vi.fn().mockResolvedValue(undefined),
      });
      return null;
    }
    mountReactHarness(<Harness />);

    void hook!.handleTimelineElementDelete(elements[1]);

    expect(preview.querySelector('[data-hf-id="hf-b"]')).toBeNull();
    expect(applyMarqueeSelection).toHaveBeenCalledExactlyOnceWith([deleted], "subtract");
  });
});
