// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The frame's real runtime agent, serving the opaque frame from this document.
import { installEditingAgent } from "../../../../core/src/runtime/editingAgent";
import { makeSelection } from "../../hooks/domSelectionTestHarness";
import { computeDraggedGsapPosition } from "../../hooks/draggedGsapPosition";
import { watchPreviewFrame } from "../../player/lib/bridgePlayback";
import { describePreviewElements, queryPreviewElements } from "../../player/lib/previewElements";
import { detachedFakeIframe } from "../../player/hooks/timelinePlayerTestHarness";
import type { UseDomEditOverlayGesturesOptions } from "./domEditOverlayGestures";
import { startGesture, startGroupDrag } from "./domEditOverlayStartGesture";
import {
  applyManualOffsetDragCommit,
  createManualOffsetDragMember,
  restoreManualOffsetDragMembers,
} from "./manualOffsetDrag";
import { MOVING_LAYER_UNREADABLE } from "./plainTranslate";
import { measurePreviewGestureStart, type PreviewGestureStart } from "./previewGestureStartRead";
import { standInFor } from "./previewSelection";
import { collectSnapContext } from "./snapTargetCollection";

const FIXTURE = `
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <div id="card" style="translate: 10px 0px"></div>
    <div id="host" data-composition-src="a.html" data-width="960" data-height="540">
      <p id="inner"></p>
    </div>
    <div id="clipped" style="clip-path: inset(10px 20px 30px 40px)"></div>
    <div style="display: none"><span id="gone"></span></div>
    <div id="sub" data-composition-id="sub"><b id="nested"></b></div>
    <div id="last"></div>
  </div>`;
const RECTS: Record<string, number[]> = {
  host: [200, 100, 960, 540],
  inner: [220, 140, 300, 80],
  clipped: [900, 700, 400, 300],
  gone: [1, 1, 50, 50],
  sub: [5, 5, 50, 50],
  nested: [6, 6, 10, 10],
  last: [1500, 900, 120, 60],
};

function sized(element: Element, [x, y, width, height]: number[]) {
  element.getBoundingClientRect = () =>
    ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }) as DOMRect;
  Object.defineProperty(element, "offsetWidth", { value: width, configurable: true });
  Object.defineProperty(element, "offsetHeight", { value: height, configurable: true });
  return element;
}

/** The card sits in a mirrored parent: a px of translate x moves it a px left, y moves it down. */
function mirroredCard(card: HTMLElement) {
  sized(card, [0, 0, 200, 100]);
  card.getBoundingClientRect = () => {
    const [x = 0, y = 0] = card.style.translate
      .split(/ (?![^(]*\))/)
      .map((axis) =>
        [...axis.matchAll(/-?[\d.]+px/g)].reduce((sum, [px]) => sum + Number.parseFloat(px), 0),
      );
    const left = 600 - x;
    const top = 300 + y;
    return { x: left, y: top, width: 200, height: 100, left, top } as DOMRect;
  };
}

const closers: Array<() => void> = [];
beforeEach(() => {
  document.body.innerHTML = FIXTURE;
  for (const [id, rect] of Object.entries(RECTS)) sized(document.getElementById(id)!, rect);
  mirroredCard(document.getElementById("card")!);
});
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "gsap");
  Reflect.deleteProperty(window, "__timelines");
});

/** A frame Studio scripts directly; its document and window are this one's. */
function liveFrame() {
  const iframe = detachedFakeIframe(window as unknown as Record<string, unknown>);
  Object.defineProperty(iframe, "contentDocument", { value: document });
  return sized(iframe, [100, 50, 960, 540]) as HTMLIFrameElement;
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
  const agent = installEditingAgent(parent);
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

const overlayEl = () => sized(document.createElement("div"), [20, 10, 1200, 800]) as HTMLDivElement;
const round = (value: unknown) =>
  JSON.parse(JSON.stringify(value, (_, v: unknown) => (typeof v === "number" ? +v.toFixed(9) : v)));

async function opaqueCard() {
  const iframe = opaqueFrame();
  const handle = (await queryPreviewElements(iframe, "#card"))!.matches[0]!.handle;
  const description = (await describePreviewElements(iframe, [handle]))![0]!;
  return { iframe, handle, standIn: standInFor(iframe, description) };
}

/** GSAP holds the card at x 200, y 5, as `gsap.set` leaves it. */
function gsapHoldsCard(tweens: unknown[] = []) {
  const card = document.getElementById("card")!;
  Object.assign(card, { _gsap: { renderTransform: () => {} } });
  Object.assign(window, {
    gsap: { getProperty: (_: Element, axis: string) => (axis === "x" ? 200 : 5) },
    __timelines: { main: { getChildren: () => tweens } },
  });
}

describe("a gesture's start on an opaque frame", () => {
  it("reads the snap targets a scriptable frame collects, without the pressed element", async () => {
    const overlay = overlayEl();
    const card = document.getElementById("card")!;
    const live = collectSnapContext({
      overlayEl: overlay,
      iframe: liveFrame(),
      excludeElements: new Set([card]),
    });
    const { iframe, handle } = await opaqueCard();
    const read = await measurePreviewGestureStart(iframe, overlay, [handle]);
    expect(round(read!.snap)).toEqual(round(live));
    // host, inner, clipped, last: the hidden span, the nested composition and the card are left out.
    expect(live.targets).toHaveLength(4);
    expect(live.compositionTarget).not.toBeNull();
  });

  it("reads GSAP's x/y, the layout size and the frame's move, so a drag saves from where it is", async () => {
    gsapHoldsCard();
    const { iframe, handle, standIn } = await opaqueCard();
    const read = await measurePreviewGestureStart(iframe, overlayEl(), [handle]);
    const { rect, start } = read!.elements[0]!;
    // Mirrored x at a 0.5 page scale: a pointer px left is 2 translate px right.
    expect(start).toEqual({
      layout: { width: 200, height: 100 },
      screenToOffset: { a: -2, b: 0, c: 0, d: 2 },
      gsap: { x: 200, y: 5, moving: false },
    });
    const selection = { ...makeSelection("card", standIn), handle };
    const made = createManualOffsetDragMember({
      key: "card",
      selection,
      element: standIn,
      rect,
      gesture: "drag",
      start,
    });
    if (!made.ok) throw new Error(made.reason);
    closers.push(() => restoreManualOffsetDragMembers([made.member]));
    expect(made.member.plainTranslate).toBe(false);
    // The release stamps the gesture's base and offset, as the GSAP commit reads them.
    const offset = applyManualOffsetDragCommit(made.member, 10, 0);
    expect(offset).toEqual({ x: -20, y: 0 });
    // GSAP's own x plus the drag, not the drag alone.
    expect(computeDraggedGsapPosition(standIn, offset, { x: 0, y: 0 }).newX).toBe(180);
  });

  it("moves an element GSAP does not own by its translate, as before", async () => {
    const { iframe, handle } = await opaqueCard();
    const read = await measurePreviewGestureStart(iframe, overlayEl(), [handle]);
    expect(read!.elements[0]!.start.gsap).toBeNull();
  });
});

function gestureOpts(selection: ReturnType<typeof makeSelection>) {
  const ref = <T>(current: T) => ({ current });
  return {
    selectionRef: ref(selection),
    overlayRectRef: ref({
      left: 0,
      top: 0,
      width: 50,
      height: 25,
      editScaleX: 0.5,
      editScaleY: 0.5,
    }),
    boxRef: ref(document.createElement("div")),
    overlayRef: ref(overlayEl()),
    iframeRef: ref(liveFrame()),
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
const START: PreviewGestureStart = {
  layout: { width: 200, height: 100 },
  screenToOffset: { a: 2, b: 0, c: 0, d: 2 },
  gsap: null,
};
const SNAP = { targets: [], compositionTarget: null, gridEdges: null, snapEnabled: true };

describe("starting a gesture from what an opaque frame read", () => {
  it("grows a resize from the frame's layout size, and snaps with the targets it read", () => {
    const element = document.createElement("div");
    const opts = gestureOpts(makeSelection("card", element));
    expect(startGesture("resize", press(), opts, { start: START, snap: SNAP })).toBe(true);
    // The element has no box here; its rect over the edit scale would give 100 x 50.
    const g = opts.gestureRef.current!;
    expect([g.actualWidth, g.actualHeight]).toEqual([200, 100]);
    expect(g.snapContext).toBe(SNAP);
    restoreManualOffsetDragMembers(g.pathOffsetMember ? [g.pathOffsetMember] : []);
  });

  it("refuses a drag of a layer a tween moves, which this preview cannot save yet", () => {
    const element = document.createElement("div");
    const selection = makeSelection("card", element);
    const opts = gestureOpts(selection);
    const moving = { ...START, gsap: { x: 0, y: 0, moving: true } };
    expect(startGesture("drag", press(), opts, { start: moving })).toBe(false);
    expect(opts.onBlockedMoveRef.current).toHaveBeenCalledWith(selection, MOVING_LAYER_UNREADABLE);
    expect(opts.gestureRef.current).toBeNull();
  });

  it("drags a group from each member's GSAP position, snapping with the targets it read", () => {
    const items = ["a", "b"].map((key, i) => {
      const element = document.createElement("div");
      const gsap = { x: 100 * (i + 1), y: 0, moving: false };
      const rect = { left: 0, top: 0, width: 10, height: 10, editScaleX: 1, editScaleY: 1 };
      return {
        key,
        selection: makeSelection(key, element),
        element,
        rect,
        start: { ...START, gsap },
      };
    });
    const opts = gestureOpts(items[0]!.selection);
    opts.groupOverlayItemsRef.current = items;
    expect(startGroupDrag(press(), opts, undefined, SNAP)).toBe(true);
    const g = opts.groupGestureRef.current!;
    expect(g.snapContext).toBe(SNAP);
    expect(g.members.map((member) => [member.plainTranslate, member.baseGsap.x])).toEqual([
      [false, 100],
      [false, 200],
    ]);
    restoreManualOffsetDragMembers(g.members);
  });
});
