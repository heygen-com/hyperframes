// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installReactActEnvironment, makeSelection } from "../../hooks/domSelectionTestHarness";
import { __resetForTests } from "../../utils/canvasNudgeGate";
import { CANVAS_NUDGE_COMMIT_DEBOUNCE_MS } from "./domEditNudge";
import type { OverChannel } from "./previewGestureStartRead";
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

function Harness({ commit }: { commit: () => Promise<unknown> }) {
  // A sealed selection's element is a stand-in, never in the page.
  const [selection] = React.useState(() => ({
    ...makeSelection("Dot", document.createElement("div")),
    handle: "e1",
  }));
  useDomEditNudge({
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
    onManualDragStartRef: ref(() => {}),
    onBlockedMoveRef: ref(() => {}),
    onPathOffsetCommitRef: ref(commit),
    onGroupPathOffsetCommitRef: ref(async () => {}),
  });
  return null;
}

const arrowRight = () =>
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }));

let root: ReturnType<typeof createRoot> | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  __resetForTests();
});
afterEach(() => {
  act(() => root?.unmount());
  vi.useRealTimers();
});

it("moves a sealed element GSAP animates by its tween, counting the keys pressed while the frame answered", async () => {
  let answer!: (read: OverChannel) => void;
  readShownGestureStarts.mockReturnValue(new Promise((resolve) => (answer = resolve)));
  const commit = vi.fn(async () => {});
  root = createRoot(document.createElement("div"));
  act(() => root!.render(React.createElement(Harness, { commit })));

  act(() => {
    arrowRight();
    arrowRight();
    arrowRight();
  });
  const [, , , [selection]] = readShownGestureStarts.mock.calls[0]!;
  await act(async () =>
    answer({
      shown: [
        {
          selection,
          rect: RECT,
          start: {
            layout: { width: 100, height: 50 },
            screenToOffset: null,
            gsap: { x: 60, y: 0, moving: false },
          },
        },
      ],
      snap: { targets: [], compositionTarget: null, gridEdges: null, snapEnabled: false },
    }),
  );
  act(() => vi.advanceTimersByTime(CANVAS_NUDGE_COMMIT_DEBOUNCE_MS));

  expect(readShownGestureStarts).toHaveBeenCalledOnce();
  expect(commit).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ handle: "e1" }),
    { x: 3, y: 0 },
    { plainTranslate: false },
  );
});
