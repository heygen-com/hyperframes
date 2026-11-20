// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installReactActEnvironment, makeSelection } from "../../hooks/domSelectionTestHarness";
import { __resetForTests } from "../../utils/canvasNudgeGate";
import { flushStudioPendingEdits, trackedStudioEdit } from "../../utils/studioPendingEdits";
import { CANVAS_NUDGE_COMMIT_DEBOUNCE_MS } from "./domEditNudge";
import type { WaitingPressState } from "./domEditOverlayGestures";
import type { OverChannel, Shown } from "./previewGestureStartRead";
import { useDomEditNudge } from "./useDomEditNudge";

const { readShownGestureStarts } = vi.hoisted(() => ({ readShownGestureStarts: vi.fn() }));
vi.mock("../../player/lib/previewChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../player/lib/previewChannel")>()),
  previewFrameOpaque: () => true,
}));
vi.mock("./previewGestureStartRead", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./previewGestureStartRead")>()),
  readShownGestureStarts,
}));

installReactActEnvironment();
const ref = <T,>(current: T) => ({ current });
const RECT = { left: 0, top: 0, width: 100, height: 50, editScaleX: 1, editScaleY: 1 };
const NONE: never[] = [];
// A sealed selection's element is a stand-in, never in the page.
const sealed = (label: string, handle: string) => ({
  ...makeSelection(label, document.createElement("div")),
  handle,
});

function Harness({
  commit,
  selection,
  flush,
  pressing = ref(null),
}: {
  commit: () => Promise<unknown>;
  selection: ReturnType<typeof sealed>;
  flush?: { current: () => void };
  pressing?: { current: WaitingPressState | null };
}) {
  const { flushNudge } = useDomEditNudge({
    selection,
    groupSelections: NONE,
    allowCanvasMovement: true,
    iframeRef: ref(document.createElement("iframe")),
    overlayRef: ref(document.createElement("div")),
    activeCompositionPathRef: ref("index.html"),
    selectionRef: ref(selection),
    overlayRectRef: ref(RECT),
    groupOverlayItemsRef: ref([]),
    gestureRef: ref(null),
    groupGestureRef: ref(null),
    blockedMoveRef: ref(null),
    waitingPressRef: pressing,
    onManualDragStartRef: ref(() => {}),
    onBlockedMoveRef: ref(() => {}),
    onPathOffsetCommitRef: ref(commit),
    onGroupPathOffsetCommitRef: ref(async () => {}),
  });
  if (flush) flush.current = flushNudge;
  return null;
}

const arrowRight = () =>
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }));

/** Each frame read waits until the test answers it, in any order. */
function heldReads() {
  const answers: ((read: OverChannel) => void)[] = [];
  readShownGestureStarts.mockImplementation(
    () => new Promise<OverChannel>((resolve) => answers.push(resolve)),
  );
  return async (i: number) => {
    const [, , , [selection]] = readShownGestureStarts.mock.calls[i]!;
    const shown: Shown = {
      selection,
      rect: RECT,
      start: {
        layout: { width: 100, height: 50 },
        screenToOffset: null,
        gsap: { x: 60, y: 0, moving: false },
      },
    };
    const snap = { targets: [], compositionTarget: null, gridEdges: null, snapEnabled: false };
    await act(async () => answers[i]!({ shown: [shown], snap }));
  };
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });

let root: ReturnType<typeof createRoot> | null = null;
let dot = sealed("Dot", "e1");
function mount(props: React.ComponentProps<typeof Harness>) {
  root ??= createRoot(document.createElement("div"));
  act(() => root!.render(React.createElement(Harness, props)));
}
beforeEach(() => {
  vi.useFakeTimers();
  __resetForTests();
  readShownGestureStarts.mockReset();
  dot = sealed("Dot", "e1");
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
});

it("moves a sealed element GSAP animates by its tween, counting the keys pressed while the frame answered", async () => {
  const answer = heldReads();
  const commit = vi.fn(async () => {});
  mount({ commit, selection: dot });

  act(() => {
    arrowRight();
    arrowRight();
    arrowRight();
  });
  await answer(0);
  act(() => vi.advanceTimersByTime(CANVAS_NUDGE_COMMIT_DEBOUNCE_MS));

  expect(readShownGestureStarts).toHaveBeenCalledOnce();
  expect(commit).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ handle: "e1" }),
    { x: 3, y: 0 },
    { plainTranslate: false },
  );
});

// fails without the fix: the flush handed the edit queue the read's promise, and the late nudge then waited on it.
it("lets another edit save while a sealed nudge waits on its frame, and drops that nudge", async () => {
  const answer = heldReads();
  const commit = vi.fn(async () => {});
  mount({ commit, selection: dot });
  let otherSaved = false;
  const other = trackedStudioEdit(async () => void (otherSaved = true), { afterOlderSaves: true });

  act(() => arrowRight());
  act(() => void other());
  await answer(0);
  let drained = false;
  void flushStudioPendingEdits().then(() => (drained = true));
  await settle();
  act(() => vi.advanceTimersByTime(CANVAS_NUDGE_COMMIT_DEBOUNCE_MS));
  await settle();

  expect(otherSaved).toBe(true);
  expect(drained).toBe(true);
  expect(commit).not.toHaveBeenCalled();
});

// fails without the fix: the old element's read stayed open, so the new selection's arrow moved the old element.
it("moves the newly selected element, not the one still waiting on its frame", async () => {
  const answer = heldReads();
  const commit = vi.fn(async () => {});
  mount({ commit, selection: dot });

  act(() => arrowRight());
  mount({ commit, selection: sealed("Ring", "e2") });
  act(() => arrowRight());
  await answer(0);
  await answer(1);
  act(() => vi.advanceTimersByTime(CANVAS_NUDGE_COMMIT_DEBOUNCE_MS));

  expect(commit).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ handle: "e2" }),
    { x: 1, y: 0 },
    { plainTranslate: false },
  );
});

// fails without the fix: the frame's late answer started and saved the nudge under the drag that had begun.
it("drops a sealed nudge still waiting on its frame when a drag takes the element", async () => {
  const answer = heldReads();
  const commit = vi.fn(async () => {});
  const flush = { current: () => {} };
  mount({ commit, selection: dot, flush });

  act(() => arrowRight());
  act(() => flush.current());
  await answer(0);
  act(() => vi.advanceTimersByTime(CANVAS_NUDGE_COMMIT_DEBOUNCE_MS));
  act(() => arrowRight());
  await answer(1);
  act(() => vi.advanceTimersByTime(CANVAS_NUDGE_COMMIT_DEBOUNCE_MS));

  expect(commit).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ handle: "e1" }),
    { x: 1, y: 0 },
    { plainTranslate: false },
  );
});

// fails without the fix: an arrow during a press still waiting on its frame started a nudge the drag then ran under.
it("asks the frame nothing for an arrow pressed while a canvas press waits, and nudges once it ends", async () => {
  const answer = heldReads();
  const commit = vi.fn(async () => {});
  const pressing = { current: {} as WaitingPressState | null };
  mount({ commit, selection: dot, pressing });

  act(() => arrowRight());
  expect(readShownGestureStarts).not.toHaveBeenCalled();

  pressing.current = null;
  act(() => arrowRight());
  await answer(0);
  act(() => vi.advanceTimersByTime(CANVAS_NUDGE_COMMIT_DEBOUNCE_MS));
  expect(commit).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ handle: "e1" }),
    { x: 1, y: 0 },
    { plainTranslate: false },
  );
});
