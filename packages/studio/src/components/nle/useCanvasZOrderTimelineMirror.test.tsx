// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { usePlayerStore, type TimelineElement } from "../../player";
import { TimelineEditProvider } from "../../contexts/TimelineEditContext";
import type { TimelineEditCallbacks } from "../../player/components/timelineCallbacks";
import { useElementLifecycleOps, zReorderCoalesceKey } from "../../hooks/useElementLifecycleOps";
import {
  useCanvasZOrderTimelineMirror,
  type MirrorZOrderInput,
} from "./useCanvasZOrderTimelineMirror";
import { makeLifecycleOpsParams } from "../../hooks/elementLifecycleOpsTestUtils";
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
  commitZ: (entries: ReorderEntries, coalesceKey: string, action: string) => Promise<unknown>;
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
    coalesceMs: number | undefined,
    after: string,
  ) => {
    const entry = buildEditHistoryEntry({
      id: `e-${history.now()}`,
      projectId: "p",
      label,
      kind,
      coalesceKey,
      coalesceMs,
      now: history.now(),
      files: { "index.html": { before: history.fileContent.current, after } },
    });
    history.fileContent.current = after;
    history.state = pushEditHistoryEntry(history.state, entry);
  };

  const onMoveElements: TimelineEditCallbacks["onMoveElements"] = (
    _edits,
    coalesceKey,
    _operation,
    coalesceMs,
  ) => {
    history.moveCoalesceKeys.push(coalesceKey ?? "<none>");
    record("Move timeline clips", "timeline", coalesceKey ?? "<none>", coalesceMs, "C-move");
  };

  const api: Partial<HarnessApi> = {};
  function Harness() {
    const { handleDomZIndexReorderCommit } = useElementLifecycleOps(
      makeLifecycleOpsParams({
        commitDomEditPatchBatches: async (_batches, options) => {
          record(options.label, "manual", options.coalesceKey, options.coalesceMs, "B-z");
          return { durable: true, allMatched: true, changed: true };
        },
      }),
    );
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
    // Deterministic clock: consecutive records land 400ms apart — PAST the
    // reducer's default 300ms coalesce window, as in the live flow where the
    // mirror is dispatched only after the z persist's server round-trip
    // resolves (real network latency exceeds 300ms). The fold must therefore
    // ride the gesture's explicit coalesceMs window, not the default.
    now: () => (tick += 400),
    fileContent: { current: "A-original" },
    moveCoalesceKeys: [] as string[],
  };
}

function mountMirrorOnlyHarness(
  onMoveElements: TimelineEditCallbacks["onMoveElements"],
): Pick<HarnessApi, "mirror"> {
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
  const mirror = api.mirror;
  if (!mirror) throw new Error("mirror harness failed to mount");
  return { mirror };
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
    // Gesture-unique key: action + ids + a per-call gesture sequence, so two
    // SEPARATE actions on the same selection never share a key (see the
    // two-gestures test below) while this gesture's two records do.
    expect(coalesceKey).toMatch(/^z-reorder:bring-forward:t:g\d+$/);

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

  it("two SEPARATE gestures on the same selection produce TWO undo entries (distinct keys)", async () => {
    // Two consecutive gestures on the same element: each mints its own coalesce
    // key (gesture sequence), so even an unbounded per-gesture window must never
    // merge distinct user actions into one undo step.
    setStoreElements([storeEl("t", 0, 0, 10), storeEl("b", 1, 0, 10)]);
    const history = makeHistory();
    const api = mountMirrorHarness(history);

    const target = domTarget("t");
    const entries: ReorderEntries = [
      { element: target, zIndex: 7, id: "t", sourceFile: "index.html", key: "index.html#t" },
    ];

    // Identical action + identical selection still mints a fresh key per call.
    expect(zReorderCoalesceKey(entries, "send-backward")).not.toBe(
      zReorderCoalesceKey(entries, "send-backward"),
    );

    const keys: string[] = [];
    // Gesture 1: t (top) sent backward past b → back-to-back, no free lane in
    // the bounded interval → insert immediately below b (t and b swap lanes).
    // Gesture 2: t brought forward past b → insert immediately above b (swap
    // back). Both gestures mirror (lane move persists), so each records a
    // z+move pair.
    const gestures = [
      { action: "send-backward" as const, crossedId: "b" },
      { action: "bring-forward" as const, crossedId: "b" },
    ];
    for (const { action, crossedId } of gestures) {
      const coalesceKey = zReorderCoalesceKey(entries, action);
      keys.push(coalesceKey);
      await act(async () => {
        await api.commitZ(entries, coalesceKey, action);
        const mirrored = await api.mirror({
          selectionKey: "index.html#t",
          action,
          crossed: domTarget(crossedId),
          sourceFile: "index.html",
          coalesceKey,
        });
        expect(mirrored).toBe(true);
      });
    }

    expect(keys[0]).not.toBe(keys[1]); // fresh key per gesture
    // Each gesture folded its own z+move pair, but the two gestures stayed apart.
    expect(history.state.undo).toHaveLength(2);
    expect(history.moveCoalesceKeys).toEqual(keys);
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
    const { mirror } = mountMirrorOnlyHarness(onMoveElements);

    const mirrored = await act(async () =>
      mirror({
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

  it("maps a cross-file duplicate selector to the source-scoped crossed occurrence", async () => {
    setStoreElements([
      {
        id: "scene.html:.sub:0",
        key: "scene.html:.sub:0",
        tag: "div",
        start: 20,
        duration: 5,
        track: 0,
        selector: ".sub",
        selectorIndex: 0,
        sourceFile: "scene.html",
      },
      {
        id: "scene.html:.sub:1",
        key: "scene.html:.sub:1",
        tag: "div",
        start: 0,
        duration: 10,
        track: 1,
        selector: ".sub",
        selectorIndex: 1,
        sourceFile: "scene.html",
      },
      {
        ...storeEl("t", 2, 0, 10),
        key: "scene.html#t",
        sourceFile: "scene.html",
      },
    ]);
    const edits: Array<{ element: TimelineElement; updates: { start: number; track: number } }> =
      [];
    const onMoveElements: TimelineEditCallbacks["onMoveElements"] = (batch) => {
      edits.push(...batch);
    };
    const { mirror } = mountMirrorOnlyHarness(onMoveElements);

    // This root-file duplicate precedes the scene nodes in the flattened preview
    // DOM. It must not offset scene.html's selector indices.
    const rootDuplicate = document.createElement("div");
    rootDuplicate.className = "sub";
    document.body.appendChild(rootDuplicate);
    const scene = document.createElement("div");
    scene.setAttribute("data-composition-id", "scene");
    scene.setAttribute("data-composition-file", "scene.html");
    document.body.appendChild(scene);
    const first = document.createElement("div");
    first.className = "sub";
    scene.appendChild(first);
    const crossed = document.createElement("div");
    crossed.className = "sub";
    scene.appendChild(crossed);

    const mirrored = await act(async () =>
      mirror({
        selectionKey: "scene.html#t",
        action: "bring-forward",
        crossed,
        sourceFile: "scene.html",
        coalesceKey: "z-reorder:bring-forward:t",
      }),
    );

    expect(mirrored).toBe(true);
    expect(edits).toHaveLength(1);
    expect(edits[0].updates.track).toBe(0);
  });
});
