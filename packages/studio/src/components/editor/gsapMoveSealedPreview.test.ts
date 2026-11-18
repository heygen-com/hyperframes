// @vitest-environment happy-dom

import { gsap } from "gsap";
import { parseGsapScriptAcorn } from "@hyperframes/parsers/gsap-parser-acorn";
import { afterEach, expect, it, vi } from "vitest";
import { makeSelection } from "../../hooks/domSelectionTestHarness";
import { freezeDragStamp } from "../../hooks/draggedGsapPosition";
import { settleGsapSnapshot } from "../../hooks/gsapFrameSnapshot";
import { tryGsapDragIntercept } from "../../hooks/gsapRuntimeBridge";
import { watchPreviewFrame } from "../../player/lib/bridgePlayback";
import { describePreviewElements, queryPreviewElements } from "../../player/lib/previewElements";
import { usePlayerStore } from "../../player/store/playerStore";
import type { UseDomEditOverlayGesturesOptions } from "./domEditOverlayGestures";
import { startGesture } from "./domEditOverlayStartGesture";
import {
  applyManualOffsetDragCommit,
  applyManualOffsetDragDraft,
  endManualOffsetDragMembers,
} from "./manualOffsetDrag";
import { measurePreviewGestureStart } from "./previewGestureStartRead";
import { standInFor } from "./previewSelection";
import { sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";

const timeline = (tweens: string) => `var tl = gsap.timeline({ paused: true });
${tweens}
window.__timelines["main"] = tl;`;
const MOVES_BOX = `tl.to("#box", { x: 200, y: 80, duration: 1, ease: "none" }, 0);`;
const SCRIPT = timeline(MOVES_BOX);
// Split-text output: more tween targets than the frame's GSAP snapshot carries, so Studio gets none.
const SPLIT_TEXT = `tl.to(".c", { opacity: 0, stagger: 0.001 }, 0);`;
const SPANS = '<span class="c"></span>'.repeat(600);

/** Frame px of a translate the draft drew, e.g. "calc(0px + 20px) calc(0px + 0px)". */
const drawnTranslate = (box: HTMLElement) =>
  box.style.translate
    .split(/ (?![^(]*\))/)
    .map((axis) =>
      [...axis.matchAll(/-?[\d.]+px/g)].reduce((sum, [px]) => sum + Number.parseFloat(px), 0),
    );

/** Where the box is drawn in the frame: the translate GSAP's transform starts with, plus any translate on top. */
function drawnAt(box: HTMLElement) {
  const [tx = 0, ty = 0] = drawnTranslate(box);
  const [gx = 0, gy = 0] = (/translate(?:3d)?\(([^)]*)\)/.exec(box.style.transform)?.[1] ?? "")
    .split(",")
    .map((part) => Number.parseFloat(part) || 0);
  return { x: gx + tx, y: gy + ty };
}

const mainTimeline = () =>
  (window as unknown as { __timelines?: Record<string, gsap.core.Timeline> }).__timelines?.main;

function mount(script: string, extra = "") {
  document.body.innerHTML = `<div data-composition-id="main" data-width="1920" data-height="1080"><div id="box"></div>${extra}</div>`;
  const box = document.getElementById("box")!;
  box.getBoundingClientRect = () => {
    const { x, y } = drawnAt(box);
    return {
      x: 300 + x,
      y: 200 + y,
      width: 100,
      height: 50,
      left: 300 + x,
      top: 200 + y,
    } as DOMRect;
  };
  Object.defineProperty(box, "offsetWidth", { value: 100 });
  Object.defineProperty(box, "offsetHeight", { value: 50 });
  Object.assign(window, { gsap, __timelines: {} });
  new Function("gsap", "window", script)(gsap, window);
  // The preview paused half way through the tween: GSAP has the box at 100, 40.
  mainTimeline()?.seek(0.5);
  usePlayerStore.setState({ currentTime: 0.5, isPlaying: false, autoKeyframeEnabled: true });
}
afterEach(() => {
  mainTimeline()?.kill();
  document.body.innerHTML = "";
  for (const name of ["gsap", "__timelines"]) Reflect.deleteProperty(window, name);
  usePlayerStore.setState({ currentTime: 0, isPlaying: false });
});

function sized<T extends Element>(element: T, [x, y, width, height]: number[]): T {
  element.getBoundingClientRect = () =>
    ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }) as DOMRect;
  return element;
}

/** A frame Studio cannot read, whose runtime is the real editing agent over this document. */
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

function gestureOpts(iframe: HTMLIFrameElement) {
  const ref = <T>(current: T) => ({ current });
  const overlayEl = sized(document.createElement("div"), [20, 10, 1200, 800]);
  return {
    selectionRef: ref(null),
    overlayRectRef: ref(null),
    boxRef: ref(document.createElement("div")),
    overlayRef: ref(overlayEl),
    iframeRef: ref(iframe),
    gestureRef: ref(null),
    groupGestureRef: ref(null),
    groupOverlayItemsRef: ref([]),
    rafPausedRef: ref(false),
    onManualDragStartRef: ref(vi.fn()),
    onBlockedMoveRef: ref(vi.fn()),
  } as unknown as UseDomEditOverlayGesturesOptions;
}

const press = () =>
  ({
    clientX: 10,
    clientY: 10,
    pointerId: 1,
    button: 0,
    preventDefault() {},
    stopPropagation() {},
    currentTarget: { setPointerCapture() {} },
  }) as unknown as React.PointerEvent<HTMLElement>;

/** Presses the box on a sealed frame, drags it 10 page px right and lets go, as the overlay does. */
async function dragBoxOnSealedFrame(
  script: string,
  beforePress?: (iframe: HTMLIFrameElement) => void,
) {
  const box = document.getElementById("box")!;
  const iframe = opaqueFrame();
  beforePress?.(iframe);
  const handle = (await queryPreviewElements(iframe, "#box"))!.matches[0]!.handle;
  const standIn = standInFor(iframe, (await describePreviewElements(iframe, [handle]))![0]!);
  const selection = { ...makeSelection("box", standIn), id: "box", handle };
  const opts = gestureOpts(iframe);
  const read = await measurePreviewGestureStart(iframe, opts.overlayRef.current!, [handle]);
  const { rect, start } = read!.elements[0]!;
  const started = startGesture("drag", press(), opts, { selection, rect, start, snap: read!.snap });
  expect(opts.onBlockedMoveRef.current).not.toHaveBeenCalled();
  const member = opts.gestureRef.current!.pathOffsetMember!;

  // A page px is two frame px: the frame shows 1920 px in 960.
  applyManualOffsetDragDraft(member, 10, 0);
  await vi.waitFor(() => expect(drawnAt(box)).toEqual({ x: 120, y: 40 }));

  const offset = applyManualOffsetDragCommit(member, 10, 0);
  const commit = vi.fn(async () => undefined);
  const [anim] = parseGsapScriptAcorn(script).animations;
  const outcome = await tryGsapDragIntercept(
    selection,
    offset,
    [anim!],
    iframe,
    commit,
    undefined,
    {
      stamp: freezeDragStamp(standIn),
    },
  );
  endManualOffsetDragMembers([member]);
  return { started, start, anim: anim!, outcome, commit };
}

// fails without the fix: a sealed preview refused to drag a layer its animation moves.
it("drags a layer its tween moves in a sealed preview: it moves live and saves a keyframe there", async () => {
  mount(SCRIPT);
  const { started, start, anim, outcome, commit } = await dragBoxOnSealedFrame(SCRIPT);

  expect(start.gsap).toEqual({ x: 100, y: 40, moving: true });
  expect(started).toBe(true);
  expect(outcome).toEqual({ status: "persisted" });
  expect(commit).toHaveBeenCalledTimes(1);
  // The keyframe a same-origin preview writes for the same move: GSAP's 100, 40 plus the drag's 20.
  expect(commit.mock.calls[0]![1]).toEqual({
    type: "replace-with-keyframes",
    animationId: anim.id,
    targetSelector: "#box",
    position: 0,
    duration: 1,
    keyframes: [
      { percentage: 50, properties: { x: 120, y: 40 } },
      { percentage: 100, properties: { x: 200, y: 80 } },
    ],
    easeEach: "none",
  });
});

it("saves the keyframe of a drag pressed right after two quick seeks", async () => {
  mount(SCRIPT);
  const seek = (time: number) => {
    mainTimeline()?.seek(time);
    usePlayerStore.setState({ currentTime: time });
  };
  const { outcome, commit } = await dragBoxOnSealedFrame(SCRIPT, (iframe) => {
    seek(0.3);
    void settleGsapSnapshot(iframe);
    seek(0.4);
    seek(0.5);
  });

  expect(outcome).toEqual({ status: "persisted" });
  expect(commit.mock.calls.map(([, mutation]) => mutation)).toMatchObject([
    {
      type: "replace-with-keyframes",
      keyframes: [{ percentage: 50, properties: { x: 120, y: 40 } }, {}],
    },
  ]);
});

it("saves nothing for a moving layer when the sealed preview's tweens can't be read", async () => {
  const script = timeline(`${MOVES_BOX}\n${SPLIT_TEXT}`);
  mount(script, SPANS);
  const { start, outcome, commit } = await dragBoxOnSealedFrame(script);

  expect(start.gsap).toEqual({ x: 100, y: 40, moving: true });
  // Routed without the frame's tweens, the move would save a `set` that pins the layer.
  expect(outcome).toEqual({
    status: "blocked",
    reason: "source-uneditable",
    detail: "frame-tweens-unreadable",
  });
  expect(commit).not.toHaveBeenCalled();
});

it("still saves a layer GSAP only holds when the sealed preview's tweens can't be read", async () => {
  const script = timeline(`tl.set("#box", { x: 100, y: 40 }, 0);\n${SPLIT_TEXT}`);
  mount(script, SPANS);
  const { start, outcome, commit } = await dragBoxOnSealedFrame(script);

  expect(start.gsap).toEqual({ x: 100, y: 40, moving: false });
  expect(outcome).toEqual({ status: "persisted" });
  expect(commit).toHaveBeenCalledTimes(1);
  // The hold's own `set` takes the new place, as when the frame's tweens are read.
  expect(commit.mock.calls[0]![1]).toEqual({
    type: "update-properties",
    animationId: "#box-set-0-position",
    properties: { x: 120, y: 40 },
  });
});
