// @vitest-environment happy-dom

import { gsap } from "gsap";
import { parseGsapScriptAcorn } from "@hyperframes/parsers/gsap-parser-acorn";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
// The frame's real runtime agent, serving the opaque frame from this document.
import { installMarkedEditingAgent } from "../../../../core/src/runtime/editingAgent.test-helpers";
import { makeSelection } from "../../hooks/domSelectionTestHarness";
import { freezeDragStamp } from "../../hooks/draggedGsapPosition";
import { tryGsapDragIntercept } from "../../hooks/gsapRuntimeBridge";
import { watchPreviewFrame } from "../../player/lib/bridgePlayback";
import { describePreviewElements, queryPreviewElements } from "../../player/lib/previewElements";
import { detachedFakeIframe } from "../../player/hooks/timelinePlayerTestHarness";
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

const SCRIPT = `var tl = gsap.timeline({ paused: true });
tl.to("#box", { x: 200, y: 80, duration: 1, ease: "none" }, 0);
window.__timelines["main"] = tl;`;

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

const closers: Array<() => void> = [];
beforeEach(() => {
  document.body.innerHTML = `<div data-composition-id="main" data-width="1920" data-height="1080"><div id="box"></div></div>`;
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
  new Function("gsap", "window", SCRIPT)(gsap, window);
  // The preview paused half way through the tween: GSAP has the box at 100, 40.
  mainTimeline()?.seek(0.5);
  usePlayerStore.setState({ currentTime: 0.5, isPlaying: false, autoKeyframeEnabled: true });
});
afterEach(() => {
  closers.splice(0).forEach((close) => close());
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
  const frame: Record<string, unknown> = {};
  const iframe = sized(detachedFakeIframe(frame), [100, 50, 960, 540]) as HTMLIFrameElement;
  Object.defineProperty(iframe, "contentDocument", { value: null });
  Object.defineProperty(frame, "document", {
    get: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  const parent = {
    postMessage: (data: unknown, _origin: string, ports: MessagePort[]) =>
      window.dispatchEvent(
        new MessageEvent("message", { source: frame as unknown as Window, data, ports }),
      ),
  } as unknown as Window;
  const agent = installMarkedEditingAgent(parent);
  frame.postMessage = (data: unknown) =>
    window.dispatchEvent(new MessageEvent("message", { source: parent, data }));
  closers.push(() => agent.dispose());
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

// fails without the fix: a sealed preview refused to drag a layer its animation moves.
it("drags a layer its tween moves in a sealed preview: it moves live and saves a keyframe there", async () => {
  const box = document.getElementById("box")!;
  const iframe = opaqueFrame();
  const handle = (await queryPreviewElements(iframe, "#box"))!.matches[0]!.handle;
  const standIn = standInFor(iframe, (await describePreviewElements(iframe, [handle]))![0]!);
  const selection = { ...makeSelection("box", standIn), id: "box", handle };
  const opts = gestureOpts(iframe);
  const read = await measurePreviewGestureStart(iframe, opts.overlayRef.current!, [handle]);
  const { rect, start } = read!.elements[0]!;
  expect(start.gsap).toEqual({ x: 100, y: 40, moving: true });

  expect(startGesture("drag", press(), opts, { selection, rect, start, snap: read!.snap })).toBe(
    true,
  );
  expect(opts.onBlockedMoveRef.current).not.toHaveBeenCalled();
  const member = opts.gestureRef.current!.pathOffsetMember!;

  // A page px is two frame px: the frame shows 1920 px in 960.
  applyManualOffsetDragDraft(member, 10, 0);
  await vi.waitFor(() => expect(drawnAt(box)).toEqual({ x: 120, y: 40 }));

  const offset = applyManualOffsetDragCommit(member, 10, 0);
  const commit = vi.fn(async () => undefined);
  const [anim] = parseGsapScriptAcorn(SCRIPT).animations;
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

  expect(outcome).toEqual({ status: "persisted" });
  expect(commit).toHaveBeenCalledTimes(1);
  // The keyframe a same-origin preview writes for the same move: GSAP's 100, 40 plus the drag's 20.
  expect(commit.mock.calls[0]![1]).toEqual({
    type: "replace-with-keyframes",
    animationId: anim!.id,
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
