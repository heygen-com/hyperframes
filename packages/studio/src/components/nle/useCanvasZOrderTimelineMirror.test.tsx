// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../../player";
import { TimelineEditProvider } from "../../contexts/TimelineEditContext";
import type { TimelineEditCallbacks } from "../../player/components/timelineCallbacks";
import { useElementLifecycleOps, zReorderCoalesceKey } from "../../hooks/useElementLifecycleOps";
import {
  useCanvasZOrderTimelineMirror,
  type MirrorZOrderInput,
} from "./useCanvasZOrderTimelineMirror";
import { mountReactHarness } from "../../hooks/domSelectionTestHarness";
import {
  buildEditHistoryEntry,
  createEmptyEditHistory,
  pushEditHistoryEntry,
  type EditHistoryState,
} from "../../utils/editHistory";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  // Wrapped in act: mounted harnesses subscribe to the store via
  // useExpandedTimelineElements, so the reset re-renders them.
  act(() => usePlayerStore.getState().setElements([]));
});

/** Set the store elements inside act (mounted harnesses re-render on it). */
function setStoreElements(elements: TimelineElement[]): void {
  act(() => usePlayerStore.getState().setElements(elements));
}

// Store keys follow buildTimelineElementKey's `<sourceFile>#<domId>` branch —
// the same shape deriveTimelineStoreKey produces for reorder entries.
function storeEl(domId: string, track: number, start: number, duration: number): TimelineElement {
  return {
    id: domId,
    key: `index.html#${domId}`,
    tag: "video",
    start,
    duration,
    track,
    domId,
  };
}

type ReorderEntries = Array<{
  element: HTMLElement;
  zIndex: number;
  id?: string;
  selector?: string;
  sourceFile: string;
  key?: string;
}>;

interface HarnessApi {
  commitZ: (entries: ReorderEntries, coalesceKey: string, action: string) => Promise<void>;
  mirror: (input: MirrorZOrderInput) => Promise<boolean>;
}

/**
 * Mount the REAL wiring pair PreviewOverlays composes — handleDomZIndexReorderCommit
 * (z persist) + useCanvasZOrderTimelineMirror (lane mirror) — over a shared,
 * real editHistory reducer so the undo-fold assertion exercises the actual
 * pushEditHistoryEntry coalescing:
 *
 * - the z sink mimics commitDomEditPatchBatches' recordEdit call verbatim
 *   (kind "manual", options.coalesceKey — see useDomEditCommits.ts), and
 * - the move sink mimics persistTimelineBatchEdit → saveProjectFilesWithHistory
 *   (kind "timeline", the coalesceKey forwarded through onMoveElements — see
 *   timelineEditingHelpers.ts / studioFileHistory.ts),
 *
 * with a deterministic clock inside the reducer's 300ms coalesce window.
 */
function mountMirrorHarness(history: {
  state: EditHistoryState;
  now: () => number;
  fileContent: { current: string };
  moveCoalesceKeys: string[];
}) {
  const record = (
    label: string,
    kind: "manual" | "timeline",
    coalesceKey: string,
    after: string,
  ) => {
    const entry = buildEditHistoryEntry({
      id: `e-${history.now()}`,
      projectId: "p",
      label,
      kind,
      coalesceKey,
      now: history.now(),
      files: { "index.html": { before: history.fileContent.current, after } },
    });
    history.fileContent.current = after;
    history.state = pushEditHistoryEntry(history.state, entry);
  };

  const onMoveElements: TimelineEditCallbacks["onMoveElements"] = (_edits, coalesceKey) => {
    history.moveCoalesceKeys.push(coalesceKey ?? "<none>");
    record("Move timeline clips", "timeline", coalesceKey ?? "<none>", "C-move");
  };

  const api: Partial<HarnessApi> = {};
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
      commitDomEditPatchBatches: async (_batches, options) => {
        record(options.label, "manual", options.coalesceKey, "B-z");
      },
    });
    api.commitZ = handleDomZIndexReorderCommit;
    api.mirror = useCanvasZOrderTimelineMirror();
    return null;
  }
  mountReactHarness(
    <TimelineEditProvider value={{ onMoveElements }}>
      <Harness />
    </TimelineEditProvider>,
  );
  return api as HarnessApi;
}

function makeHistory() {
  let tick = 1000;
  return {
    state: createEmptyEditHistory(),
    // Deterministic clock: consecutive records land 50ms apart — inside the
    // reducer's default 300ms coalesce window, as in the live flow where the
    // mirror is dispatched right after the z persist resolves.
    now: () => (tick += 50),
    fileContent: { current: "A-original" },
    moveCoalesceKeys: [] as string[],
  };
}

function domTarget(id: string): HTMLElement {
  const el = document.createElement("div");
  el.id = id;
  document.body.appendChild(el);
  return el;
}

describe("useCanvasZOrderTimelineMirror", () => {
  it("folds the z write and the mirrored lane write into ONE undo entry (shared coalesce key)", async () => {
    // Timeline: t on lane 2, b on lane 1 (the crossed neighbor), a on lane 0
    // free over t's span → bring-forward mirrors to a kind:"move" onto lane 0.
    setStoreElements([storeEl("a", 0, 20, 5), storeEl("b", 1, 0, 10), storeEl("t", 2, 0, 10)]);
    const history = makeHistory();
    const api = mountMirrorHarness(history);

    const target = domTarget("t");
    const entries: ReorderEntries = [
      { element: target, zIndex: 7, id: "t", sourceFile: "index.html", key: "index.html#t" },
    ];
    const coalesceKey = zReorderCoalesceKey(entries, "bring-forward");
    expect(coalesceKey).toBe("z-reorder:bring-forward:t");

    await act(async () => {
      // The PreviewOverlays wiring: z commit first, mirror after it resolves,
      // BOTH with the same key.
      await api.commitZ(entries, coalesceKey, "bring-forward");
      const mirrored = await api.mirror({
        selectionKey: "index.html#t",
        action: "bring-forward",
        crossed: domTarget("b"),
        sourceFile: "index.html",
        coalesceKey,
      });
      expect(mirrored).toBe(true);
    });

    // The move persist received the EXACT z coalesce key…
    expect(history.moveCoalesceKeys).toEqual([coalesceKey]);
    // …and the real reducer folded the two records into one undo entry spanning
    // pre-z "before" → post-move "after". One Cmd+Z reverts both writes.
    expect(history.state.undo).toHaveLength(1);
    expect(history.state.undo[0].files["index.html"]).toMatchObject({
      before: "A-original",
      after: "C-move",
    });
    // Timeline UI reflects the lane change without a reload: optimistic store update.
    const t = usePlayerStore.getState().elements.find((e) => e.key === "index.html#t");
    expect(t?.track).toBe(0);
  });

  it("z-only actions leave the timeline untouched (resolver null → single z undo entry)", async () => {
    // t has NO overlapping neighbor above → bring-forward has no lane mirror.
    setStoreElements([storeEl("a", 0, 20, 5), storeEl("t", 1, 0, 10)]);
    const history = makeHistory();
    const api = mountMirrorHarness(history);

    const entries: ReorderEntries = [
      {
        element: domTarget("t"),
        zIndex: 3,
        id: "t",
        sourceFile: "index.html",
        key: "index.html#t",
      },
    ];
    const coalesceKey = zReorderCoalesceKey(entries, "bring-forward");
    await act(async () => {
      await api.commitZ(entries, coalesceKey, "bring-forward");
      const mirrored = await api.mirror({
        selectionKey: "index.html#t",
        action: "bring-forward",
        crossed: null,
        sourceFile: "index.html",
        coalesceKey,
      });
      expect(mirrored).toBe(false);
    });

    expect(history.moveCoalesceKeys).toEqual([]); // no lane persist dispatched
    expect(history.state.undo).toHaveLength(1); // just the z entry
    const t = usePlayerStore.getState().elements.find((e) => e.key === "index.html#t");
    expect(t?.track).toBe(1); // lane unchanged
  });

  it("elements that are not timeline clips resolve false without touching the persist path", async () => {
    setStoreElements([storeEl("a", 0, 0, 10)]);
    const history = makeHistory();
    const api = mountMirrorHarness(history);
    const mirrored = await act(async () =>
      api.mirror({
        selectionKey: undefined, // canvas-only decoration: no timeline key
        action: "send-to-back",
        crossed: null,
        sourceFile: "index.html",
        coalesceKey: "z-reorder:send-to-back:x",
      }),
    );
    expect(mirrored).toBe(false);
    expect(history.moveCoalesceKeys).toEqual([]);
  });

  it("maps the crossed neighbor to its timeline key and rebases expanded sub-comp children", async () => {
    // t is an expanded sub-comp child (expandedParentStart 5, absolute start 5):
    // the mirror must forward its persist in LOCAL time (start 0), the same
    // rebase a timeline lane drag applies (forwardRebasedTimelineMoveElements).
    setStoreElements([
      {
        ...storeEl("a", 0, 25, 5),
        sourceFile: "sub.html",
        key: "sub.html#a",
        expandedParentStart: 5,
      },
      {
        ...storeEl("b", 1, 5, 10),
        sourceFile: "sub.html",
        key: "sub.html#b",
        expandedParentStart: 5,
      },
      {
        ...storeEl("t", 2, 5, 10),
        sourceFile: "sub.html",
        key: "sub.html#t",
        expandedParentStart: 5,
      },
    ]);
    const edits: Array<{ element: TimelineElement; updates: { start: number; track: number } }> =
      [];
    const onMoveElements: TimelineEditCallbacks["onMoveElements"] = (batch) => {
      edits.push(...batch);
    };
    const api: Partial<HarnessApi> = {};
    function Harness() {
      api.mirror = useCanvasZOrderTimelineMirror();
      return null;
    }
    mountReactHarness(
      <TimelineEditProvider value={{ onMoveElements }}>
        <Harness />
      </TimelineEditProvider>,
    );

    const mirrored = await act(async () =>
      api.mirror!({
        selectionKey: "sub.html#t",
        action: "bring-forward",
        // The crossed sibling maps to sub.html#b via its DOM id + sourceFile —
        // the same derivation reorder entries use (deriveTimelineStoreKey).
        crossed: domTarget("b"),
        sourceFile: "sub.html",
        coalesceKey: "z-reorder:bring-forward:t",
      }),
    );
    expect(mirrored).toBe(true);
    expect(edits).toHaveLength(1);
    // Rebased to sub-comp local coords: absolute 5 − parent start 5 = 0.
    expect(edits[0].element.start).toBe(0);
    expect(edits[0].updates).toMatchObject({ start: 0, track: 0 });
  });
});
