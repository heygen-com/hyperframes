// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { installReactActEnvironment, makeSelection } from "../../hooks/domSelectionTestHarness";
import { watchPreviewFrame } from "../../player/lib/bridgePlayback";
import { previewRequest } from "../../player/lib/previewChannel";
import { describePreviewElements, queryPreviewElements } from "../../player/lib/previewElements";
import { sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";
import { usePlayerStore } from "../../player/store/playerStore";
import { __resetForTests } from "../../utils/canvasNudgeGate";
import { isStudioEditSaving } from "../../utils/studioPendingEdits";
import type { DomEditSelection } from "./domEditing";
import type { OverlayRect } from "./domEditOverlayGeometry";
import type { UseDomEditOverlayGesturesOptions } from "./domEditOverlayGestures";
import { CANVAS_NUDGE_COMMIT_DEBOUNCE_MS } from "./domEditNudge";
import { gestureStartReadAhead, keepGestureStartReadAhead } from "./gestureStartReadAhead";
import { standInFor } from "./previewSelection";
import { useDomEditNudge, type UseDomEditNudgeParams } from "./useDomEditNudge";

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

function mountSealedScene(html: string, id: string) {
  document.body.innerHTML = html;
  const el = document.getElementById(id)!;
  el.getBoundingClientRect = () => {
    const x = 300 + (Number.parseFloat(el.style.translate) || 0);
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
  Object.defineProperty(el, "offsetWidth", { value: 100, configurable: true });
  Object.defineProperty(el, "offsetHeight", { value: 50, configurable: true });
  usePlayerStore.setState({ currentTime: 0.5, isPlaying: false });
  return el;
}

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
const asked = (kind: string) =>
  vi.mocked(previewRequest).mock.calls.filter(([, k]) => k === kind).length;

type GsapStub = {
  set: (target: Element | string, vars: Record<string, number>) => void;
  getProperty: (target: Element | string, prop: string) => number;
  globalTimeline: { getChildren: () => unknown[] };
};

function installGsap(el: HTMLElement, initial: { x: number; y: number }) {
  const state = { ...initial };
  const timeline = {
    getChildren: () => [
      { targets: () => [el], vars: { x: state.x, y: state.y }, duration: () => 0 },
    ],
  };
  const gsap: GsapStub = {
    set: (_target, vars) => {
      if (typeof vars.x === "number") state.x = vars.x;
      if (typeof vars.y === "number") state.y = vars.y;
    },
    getProperty: (_target, prop) => (prop === "x" ? state.x : prop === "y" ? state.y : 0),
    globalTimeline: timeline,
  };
  (window as unknown as { gsap?: GsapStub }).gsap = gsap;
  (window as unknown as { __timelines?: Record<string, unknown> }).__timelines = { main: timeline };
  return state;
}

type PathCommit = UseDomEditNudgeParams["onPathOffsetCommitRef"]["current"];

async function setupSealedNudge({
  html = `<div data-composition-id="main" data-width="1920" data-height="1080"><div id="box"></div></div>`,
  id = "box",
  warm = true,
  overlayRect = {
    left: 100,
    top: 75,
    width: 50,
    height: 25,
    editScaleX: 0.5,
    editScaleY: 0.5,
  } as OverlayRect | null,
  commit = vi.fn<PathCommit>(async () => {}),
  withGsap = null as { x: number; y: number } | null,
} = {}) {
  const el = mountSealedScene(html, id);
  const gsapState = withGsap ? installGsap(el, withGsap) : null;
  const iframe = opaqueFrame();
  const handle = (await queryPreviewElements(iframe, `#${id}`))!.matches[0]!.handle;
  const standIn = standInFor(iframe, (await describePreviewElements(iframe, [handle]))![0]!);
  const selection: DomEditSelection = { ...makeSelection(id, standIn), id, handle };
  const opts = {
    selectionRef: ref(selection),
    overlayRectRef: ref(overlayRect),
    boxRef: ref(document.createElement("div")),
    overlayRef: ref(sized(document.createElement("div"), [20, 10, 1200, 800])),
    iframeRef: ref(iframe),
    activeCompositionPathRef: ref(null),
    gestureRef: ref(null),
    groupGestureRef: ref(null),
    groupOverlayItemsRef: ref([]),
    waitingPressRef: ref(null),
    rafPausedRef: ref(false),
    blockedMoveRef: ref(null),
    onManualDragStartRef: ref(vi.fn()),
    onBlockedMoveRef: ref(vi.fn()),
    onPathOffsetCommitRef: ref(commit),
    onGroupPathOffsetCommitRef: ref(async () => {}),
  };

  function Harness() {
    useDomEditNudge({
      selection,
      groupSelections: [],
      allowCanvasMovement: true,
      ...opts,
    });
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(React.createElement(Harness)));
  onTestFinished(() => act(() => root.unmount()));

  if (warm) {
    onTestFinished(keepGestureStartReadAhead(opts as unknown as UseDomEditOverlayGesturesOptions));
    await vi.waitFor(() =>
      expect(
        gestureStartReadAhead(
          opts as unknown as UseDomEditOverlayGesturesOptions,
          iframe,
          [selection],
          false,
        ),
      ).not.toBeNull(),
    );
  }
  return { el, gsapState, iframe, selection, opts, commit };
}

const arrowRight = (shiftKey = false) =>
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey, cancelable: true }),
  );

beforeEach(() => {
  __resetForTests();
  vi.mocked(previewRequest).mockClear();
});

afterEach(() => {
  delete (window as unknown as { gsap?: GsapStub; __timelines?: unknown }).gsap;
  delete (window as unknown as { __timelines?: unknown }).__timelines;
  document.body.innerHTML = "";
  usePlayerStore.setState({ currentTime: 0, isPlaying: false });
  vi.useRealTimers();
});

// fails without the fix: sealed nudge ignored gestureStartReadAhead and asked query, describe and gesture-start.
it("starts a sealed nudge at once from read-ahead without asking the frame, and keeps one read across a multi-key burst", async () => {
  const { commit } = await setupSealedNudge();
  vi.mocked(previewRequest).mockClear();
  vi.useFakeTimers();

  act(() => {
    arrowRight();
    arrowRight();
    arrowRight();
  });

  expect(["query", "describe", "gesture-start"].map(asked)).toEqual([0, 0, 0]);
  act(() => vi.advanceTimersByTime(CANVAS_NUDGE_COMMIT_DEBOUNCE_MS + 10));
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit.mock.calls[0]?.[1]).toEqual({ x: 3, y: 0 });
  expect(commit.mock.calls[0]?.[2]).toEqual({ plainTranslate: true });
});

it("nudges a nested GSAP-animated layer from read-ahead with zero port reads on keydown", async () => {
  const { commit, gsapState } = await setupSealedNudge({
    html: `<div data-composition-id="main" data-width="1920" data-height="1080"><div id="parent" style="transform: translate(50px, 20px)"><div id="child"></div></div></div>`,
    id: "child",
    withGsap: { x: 60, y: 12 },
  });
  vi.mocked(previewRequest).mockClear();
  vi.useFakeTimers();

  act(() => arrowRight(true));

  expect(["query", "describe", "gesture-start"].map(asked)).toEqual([0, 0, 0]);
  act(() => vi.advanceTimersByTime(CANVAS_NUDGE_COMMIT_DEBOUNCE_MS + 10));
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit.mock.calls[0]?.[1]).toEqual({ x: 10, y: 0 });
  expect(commit.mock.calls[0]?.[2]).toEqual({ plainTranslate: false });
  expect(gsapState).toEqual({ x: 60, y: 12 });
});

it("falls back to asking the frame on a cache miss and still nudges when overlayRect is null", async () => {
  const { commit } = await setupSealedNudge({ warm: false, overlayRect: null });
  vi.mocked(previewRequest).mockClear();

  act(() => arrowRight());
  await vi.waitFor(() => expect(asked("gesture-start")).toBe(1));
  await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(1), { timeout: 2000 });
  expect(commit.mock.calls[0]?.[1]).toEqual({ x: 1, y: 0 });
});

it("invalidates read-ahead after a nudge save so back-to-back bursts start from the saved position", async () => {
  let saved!: (nextX: number) => void;
  let gsapPos: { x: number; y: number } | null = null;
  const commit = vi.fn<PathCommit>(
    () =>
      new Promise<void>((resolve) => {
        saved = (nextX) => {
          if (gsapPos) gsapPos.x = nextX;
          resolve();
        };
      }),
  );
  const { gsapState, iframe, selection, opts } = await setupSealedNudge({
    withGsap: { x: 60, y: 0 },
    commit,
  });
  gsapPos = gsapState;
  vi.mocked(previewRequest).mockClear();

  // Burst 1 hits read-ahead (0 port reads) and commits +10 from x=60.
  act(() => arrowRight(true));
  expect(["query", "describe", "gesture-start"].map(asked)).toEqual([0, 0, 0]);
  await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(1), { timeout: 2000 });
  saved(100);
  for (let i = 0; i < 10 && isStudioEditSaving(); i++) await Promise.resolve();
  expect(isStudioEditSaving()).toBe(false);

  // Right after save (before rAF refreshes), read-ahead is invalid and burst 2 reads fresh x=100 -> 110.
  expect(
    gestureStartReadAhead(
      opts as unknown as UseDomEditOverlayGesturesOptions,
      iframe,
      [selection],
      false,
    ),
  ).toBeNull();
  vi.mocked(previewRequest).mockClear();
  act(() => arrowRight(true));
  await vi.waitFor(() => expect(asked("gesture-start")).toBeGreaterThanOrEqual(1));
  await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(2), { timeout: 2000 });
  expect(gsapPos).toEqual({ x: 110, y: 0 });
  saved(200);
  await vi.waitFor(() => expect(isStudioEditSaving()).toBe(false));

  // Once read-ahead refreshes at rest, burst 3 hits it (x=200 -> 210) with 0 port reads.
  await vi.waitFor(() =>
    expect(
      gestureStartReadAhead(
        opts as unknown as UseDomEditOverlayGesturesOptions,
        iframe,
        [selection],
        false,
      )?.reply.elements[0]?.gsap?.x,
    ).toBe(200),
  );
  vi.mocked(previewRequest).mockClear();
  act(() => arrowRight(true));
  expect(["query", "describe", "gesture-start"].map(asked)).toEqual([0, 0, 0]);
  await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(3), { timeout: 2000 });
  expect(gsapPos).toEqual({ x: 210, y: 0 });
  saved(210);
  await vi.waitFor(() => expect(isStudioEditSaving()).toBe(false));
});
