// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installReactActEnvironment, makeSelection } from "../../hooks/domSelectionTestHarness";
import { useDomEditNudge, type UseDomEditNudgeParams } from "./useDomEditNudge";
import { CANVAS_NUDGE_COMMIT_DEBOUNCE_MS, CANVAS_NUDGE_STEP_PX } from "./domEditNudge";
import { __resetForTests } from "../../utils/canvasNudgeGate";
import type { DomEditSelection } from "./domEditing";
import type { OverlayRect } from "./domEditOverlayGeometry";

installReactActEnvironment();

function makeRef<T>(current: T): { current: T } {
  return { current };
}

const REST_RECT: OverlayRect = {
  left: 0,
  top: 0,
  width: 100,
  height: 50,
  editScaleX: 1,
  editScaleY: 1,
};

// Stable across renders on purpose: the test targets the `selection` identity
// key specifically, so `groupSelections` must not itself be a source of churn.
const EMPTY_GROUP_SELECTIONS: DomEditSelection[] = [];

function Harness({
  selection,
  onPathOffsetCommit,
}: {
  selection: DomEditSelection | null;
  onPathOffsetCommit: UseDomEditNudgeParams["onPathOffsetCommitRef"]["current"];
}) {
  useDomEditNudge({
    selection,
    groupSelections: EMPTY_GROUP_SELECTIONS,
    allowCanvasMovement: true,
    selectionRef: makeRef(selection),
    overlayRectRef: makeRef(REST_RECT),
    groupOverlayItemsRef: makeRef([]),
    gestureRef: makeRef(null),
    groupGestureRef: makeRef(null),
    blockedMoveRef: makeRef(null),
    onManualDragStartRef: makeRef(() => {}),
    onPathOffsetCommitRef: makeRef(onPathOffsetCommit),
    onGroupPathOffsetCommitRef: makeRef(async () => {}),
  });
  return null;
}

function dispatchArrowRight(): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
  );
}

describe("useDomEditNudge — selection cleanup keyed on stable identity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a nudge burst alive when the parent hands down a new selection object for the same element", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    const element = document.createElement("div");
    element.id = "dot-a";
    document.body.append(element);

    const commit = vi.fn();
    const firstSelection = makeSelection("Dot", element);

    act(() => {
      root.render(
        React.createElement(Harness, { selection: firstSelection, onPathOffsetCommit: commit }),
      );
    });

    act(() => {
      dispatchArrowRight();
    });
    expect(commit).not.toHaveBeenCalled();

    // Re-render with a BRAND NEW selection object describing the SAME element
    // (same id) — exactly what an un-memoized parent does on every render.
    // Before the fix, the cleanup effect was keyed on this object's identity
    // and would flush the burst right here, one arrow-press early.
    const secondSelection = makeSelection("Dot", element);
    act(() => {
      root.render(
        React.createElement(Harness, { selection: secondSelection, onPathOffsetCommit: commit }),
      );
    });
    expect(commit).not.toHaveBeenCalled();

    act(() => {
      dispatchArrowRight();
    });
    expect(commit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(CANVAS_NUDGE_COMMIT_DEBOUNCE_MS + 10);
    });

    // One combined commit for both presses, not two separate (premature) ones.
    expect(commit).toHaveBeenCalledTimes(1);
    const [, next] = commit.mock.calls[0] as [DomEditSelection, { x: number; y: number }];
    expect(next.x).toBeCloseTo(2 * CANVAS_NUDGE_STEP_PX);
    expect(next.y).toBeCloseTo(0);

    act(() => root.unmount());
    host.remove();
    element.remove();
  });

  it("still flushes the burst when the selection actually changes to a different element", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    const elementA = document.createElement("div");
    elementA.id = "dot-a";
    document.body.append(elementA);
    const elementB = document.createElement("div");
    elementB.id = "dot-b";
    document.body.append(elementB);

    const commit = vi.fn();
    const selectionA = makeSelection("Dot A", elementA);
    const selectionB = makeSelection("Dot B", elementB);

    act(() => {
      root.render(
        React.createElement(Harness, { selection: selectionA, onPathOffsetCommit: commit }),
      );
    });

    act(() => {
      dispatchArrowRight();
    });
    expect(commit).not.toHaveBeenCalled();

    // A genuine selection change (different id) must still flush immediately —
    // only same-identity re-renders should be ignored.
    act(() => {
      root.render(
        React.createElement(Harness, { selection: selectionB, onPathOffsetCommit: commit }),
      );
    });
    expect(commit).toHaveBeenCalledTimes(1);
    const [committedSelection, next] = commit.mock.calls[0] as [
      DomEditSelection,
      { x: number; y: number },
    ];
    expect(committedSelection.element).toBe(elementA);
    expect(next.x).toBeCloseTo(CANVAS_NUDGE_STEP_PX);

    act(() => root.unmount());
    host.remove();
    elementA.remove();
    elementB.remove();
  });

  it("flushes the burst when switching between two id-less siblings that share a selector", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    // Two id-less siblings with the SAME selector — distinguished only by
    // selectorIndex. Under the old `id ?? selector ?? label` key they shared
    // one identity, so selecting B mid-burst didn't flush A and the next arrow
    // kept moving A. The key now folds in selectorIndex, so they're distinct.
    const elementA = document.createElement("div");
    document.body.append(elementA);
    const elementB = document.createElement("div");
    document.body.append(elementB);

    const commit = vi.fn();
    const base = (label: string, element: HTMLElement) => ({
      ...makeSelection(label, element),
      id: undefined,
      selector: "div.row",
    });
    const selectionA: DomEditSelection = { ...base("Row", elementA), selectorIndex: 0 };
    const selectionB: DomEditSelection = { ...base("Row", elementB), selectorIndex: 1 };

    act(() => {
      root.render(
        React.createElement(Harness, { selection: selectionA, onPathOffsetCommit: commit }),
      );
    });

    act(() => {
      dispatchArrowRight();
    });
    expect(commit).not.toHaveBeenCalled();

    act(() => {
      root.render(
        React.createElement(Harness, { selection: selectionB, onPathOffsetCommit: commit }),
      );
    });

    // The sibling switch must flush A's pending burst exactly once, for A.
    expect(commit).toHaveBeenCalledTimes(1);
    const [committedSelection, next] = commit.mock.calls[0] as [
      DomEditSelection,
      { x: number; y: number },
    ];
    expect(committedSelection.element).toBe(elementA);
    expect(next.x).toBeCloseTo(CANVAS_NUDGE_STEP_PX);

    act(() => root.unmount());
    host.remove();
    elementA.remove();
    elementB.remove();
  });
});
