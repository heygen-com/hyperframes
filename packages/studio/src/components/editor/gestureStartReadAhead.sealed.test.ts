// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { installReactActEnvironment, makeSelection } from "../../hooks/domSelectionTestHarness";
import { watchPreviewFrame } from "../../player/lib/bridgePlayback";
import { describePreviewElements, queryPreviewElements } from "../../player/lib/previewElements";
import { previewRequest } from "../../player/lib/previewChannel";
import { sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";
import { usePlayerStore } from "../../player/store/playerStore";
import { isStudioEditSaving, trackStudioPendingEdit } from "../../utils/studioPendingEdits";
import type { UseDomEditOverlayGesturesOptions } from "./domEditOverlayGestures";
import { gestureStartReadAhead, keepGestureStartReadAhead } from "./gestureStartReadAhead";
import { createPreviewGestureStarts } from "./previewGestureStarts";
import { standInFor } from "./previewSelection";
import { useDomEditOverlayRects } from "./useDomEditOverlayRects";

const frames = vi.hoisted(() => new Set<() => void>());
vi.mock("./overlayFrameLoop", () => ({
  subscribeOverlayFrame: (update: () => void) => {
    frames.add(update);
    return () => frames.delete(update);
  },
}));
installReactActEnvironment();

vi.mock("../../player/lib/previewChannel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../player/lib/previewChannel")>();
  return { ...actual, previewRequest: vi.fn(actual.previewRequest) };
});

function sized<T extends Element>(element: T, [x, y, width, height]: number[]): T {
  element.getBoundingClientRect = () =>
    ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }) as DOMRect;
  return element;
}

/** The frame's document is this one: #box is drawn at 300 + its translate x, 200. */
function mountBox() {
  document.body.innerHTML = `<div data-composition-id="main" data-width="1920" data-height="1080"><div id="box"></div></div>`;
  const box = document.getElementById("box")!;
  box.getBoundingClientRect = () => {
    const x = 300 + (Number.parseFloat(box.style.translate) || 0);
    return {
      x,
      y: 200,
      width: 100,
      height: 50,
      left: x,
      top: 200,
      right: x + 100,
      bottom: 250,
    } as DOMRect;
  };
  Object.defineProperty(box, "offsetWidth", { value: 100 });
  Object.defineProperty(box, "offsetHeight", { value: 50 });
  usePlayerStore.setState({ currentTime: 0.5, isPlaying: false });
  return box;
}
afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.setState({ currentTime: 0, isPlaying: false });
});

function opaqueFrame() {
  const { iframe: sealed, frame } = sealedPreviewFrame();
  const iframe = sized(sealed, [100, 50, 960, 540]) as HTMLIFrameElement;
  watchPreviewFrame(iframe);
  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame as unknown as Window,
      origin: window.location.origin,
      data: { source: "hf-preview", type: "stage-size", width: 1920, height: 1080 },
    }),
  );
  return iframe;
}

const ref = <T>(current: T) => ({ current });

/** The box selected on a sealed frame, with the refs an overlay mount holds. */
async function selectBoxOnSealedFrame() {
  const box = mountBox();
  const iframe = opaqueFrame();
  const handle = (await queryPreviewElements(iframe, "#box"))!.matches[0]!.handle;
  const standIn = standInFor(iframe, (await describePreviewElements(iframe, [handle]))![0]!);
  const selection = { ...makeSelection("box", standIn), id: "box", handle };
  const opts = {
    selectionRef: ref(selection),
    overlayRectRef: ref({
      left: 100,
      top: 75,
      width: 50,
      height: 25,
      editScaleX: 0.5,
      editScaleY: 0.5,
    }),
    boxRef: ref(document.createElement("div")),
    overlayRef: ref(sized(document.createElement("div"), [20, 10, 1200, 800])),
    iframeRef: ref(iframe),
    activeCompositionPathRef: ref(null),
    gestureRef: ref(null),
    groupGestureRef: ref(null),
    groupOverlayItemsRef: ref([]),
    waitingPressRef: ref(null),
    rafPausedRef: ref(false),
    setOverlayRect: vi.fn(),
    setGroupOverlayItems: vi.fn(),
    onManualDragStartRef: ref(vi.fn()),
    onBlockedMoveRef: ref(vi.fn()),
  } as unknown as UseDomEditOverlayGesturesOptions;
  onTestFinished(keepGestureStartReadAhead(opts));
  await vi.waitFor(() =>
    expect(gestureStartReadAhead(opts, iframe, [selection], false)).not.toBeNull(),
  );
  return { box, iframe, selection, opts };
}

const press = () =>
  ({
    clientX: 400,
    clientY: 300,
    pointerId: 1,
    button: 0,
    preventDefault() {},
    stopPropagation() {},
    currentTarget: { setPointerCapture() {} },
  }) as unknown as React.PointerEvent<HTMLElement>;

const asked = (kind: string) =>
  vi.mocked(previewRequest).mock.calls.filter(([, k]) => k === kind).length;

// fails without the fix: the press waited on query, describe and gesture-start answers before its gesture started.
it("starts a press on a sealed preview at once from the read made before it, asking the frame nothing", async () => {
  const { selection, opts } = await selectBoxOnSealedFrame();
  vi.mocked(previewRequest).mockClear();

  const starts = createPreviewGestureStarts(opts, vi.fn(), vi.fn());
  expect(starts.startGesture("drag", press(), { selection })).toBe(true);

  expect(opts.gestureRef.current?.selection.handle).toBe(selection.handle);
  expect(opts.waitingPressRef.current).toBeNull();
  expect(opts.boxRef.current!.hasAttribute("data-dom-edit-press-waiting")).toBe(false);
  expect(["query", "describe", "gesture-start"].map(asked)).toEqual([0, 0, 0]);
});

it("starts a press made after an edit from where the edit left the layer, not from the read before it", async () => {
  const { box, selection, opts } = await selectBoxOnSealedFrame();
  let saved!: () => void;
  const save = trackStudioPendingEdit(new Promise<void>((resolve) => (saved = resolve)));
  // The edit moves the layer 40 frame px right, 20 page px at this preview's scale.
  box.style.translate = "40px 0px";
  saved();
  await save;
  // Pressed as soon as the edit is saved, before anything reads the frame again.
  expect(isStudioEditSaving()).toBe(false);

  const starts = createPreviewGestureStarts(opts, vi.fn(), vi.fn());
  expect(starts.startGesture("drag", press(), { selection })).toBe(true);
  expect(opts.gestureRef.current).toBeNull();

  await vi.waitFor(() => expect(opts.gestureRef.current).not.toBeNull());
  // Frame x 340 is page x 100 + 340 / 2 = 270, overlay x 250; the read before the edit had 230.
  expect(opts.gestureRef.current!.originLeft).toBe(250);
});

/** The overlay's own rect loop over the sealed frame, as an overlay mount runs it; `frame` runs one of its frames. */
function overlayLoopOn(opts: UseDomEditOverlayGesturesOptions) {
  let shown: ReturnType<typeof useDomEditOverlayRects> | null = null;
  function Harness() {
    shown = useDomEditOverlayRects({
      iframeRef: opts.iframeRef,
      overlayRef: opts.overlayRef,
      selectionRef: opts.selectionRef,
      activeCompositionPathRef: opts.activeCompositionPathRef,
      groupSelectionsRef: { current: [] },
      hoverSelectionRef: { current: null },
      rafPausedRef: opts.rafPausedRef,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(React.createElement(Harness)));
  onTestFinished(() => act(() => root.unmount()));
  return {
    shownLeft: () => shown!.overlayRectRef.current?.left,
    frame: () => act(() => frames.forEach((update) => update())),
  };
}

// fails without the fix: the press started at once from the read made before the frame moved the layer, at 230.
it("starts a press made after the frame moved the layer on its own from where it moved it", async () => {
  const { box, selection, opts } = await selectBoxOnSealedFrame();
  const overlay = overlayLoopOn(opts);
  await vi.waitFor(() => {
    overlay.frame();
    expect(overlay.shownLeft()).toBe(230);
  });
  // A timer in the composition moves the layer 40 frame px right; Studio sends the frame nothing.
  box.style.translate = "40px 0px";
  await vi.waitFor(() => {
    overlay.frame();
    expect(overlay.shownLeft()).toBe(250);
  });

  const starts = createPreviewGestureStarts(opts, vi.fn(), vi.fn());
  expect(starts.startGesture("drag", press(), { selection })).toBe(true);

  await vi.waitFor(() => expect(opts.gestureRef.current).not.toBeNull());
  expect(opts.gestureRef.current!.originLeft).toBe(250);
});
