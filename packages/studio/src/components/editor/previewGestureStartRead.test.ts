// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { makeSelection } from "../../hooks/domSelectionTestHarness";
import { computeDraggedGsapPosition } from "../../hooks/draggedGsapPosition";
import { tryGsapResizeIntercept } from "../../hooks/gsapResizeIntercept";
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
import {
  askShownGestureStarts,
  gestureStartLayout,
  measureLiveGrow,
  measurePreviewGestureStart,
  UNANSWERED,
  unansweredMoveReason,
  type PreviewGestureStart,
} from "./previewGestureStartRead";
import { computeOverlayRootScale } from "./domEditOverlayBasis";
import { standInFor } from "./previewSelection";
import { collectSnapContext } from "./snapTargetCollection";
import { sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";

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

/** In a mirrored parent: a px of translate x moves it left, y moves it down; it grows leftward. */
function mirroredCard(card: HTMLElement) {
  sized(card, [0, 0, 200, 100]);
  card.getBoundingClientRect = () => {
    const [x = 0, y = 0] = card.style.translate
      .split(/ (?![^(]*\))/)
      .map((axis) =>
        [...axis.matchAll(/-?[\d.]+px/g)].reduce((sum, [px]) => sum + Number.parseFloat(px), 0),
      );
    const [width, height] = [
      parseFloat(card.style.width) || 200,
      parseFloat(card.style.height) || 100,
    ];
    const left = 600 - x - (width - 200);
    const top = 300 + y;
    return { x: left, y: top, width, height, left, top } as DOMRect;
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
    gsap: {
      getProperty: (_: Element, axis: string) => (axis === "x" ? 200 : axis === "y" ? 5 : 0),
    },
    __timelines: { main: { getChildren: () => tweens } },
  });
}

/** An opaque frame whose runtime hasn't posted a size yet; `post` sends one. */
function unsizedOpaqueFrame() {
  const { iframe: sealed, frame } = sealedPreviewFrame();
  const iframe = sized(sealed, [100, 50, 960, 540]) as HTMLIFrameElement;
  watchPreviewFrame(iframe);
  const post = (data: Record<string, unknown>) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame as unknown as Window,
        origin: window.location.origin,
        data: { source: "hf-preview", type: "stage-size", ...data },
      }),
    );
  return { iframe, post };
}

// fails without the fix: a sealed frame whose root declares no size never had a stage size, so the overlay had no
// scale, and a press or nudge read gave up at once and was dropped.
describe("an opaque frame whose root declares no size", () => {
  it("scales the overlay by the root's measured box, as the unsealed overlay measures the root", () => {
    const { iframe, post } = unsizedOpaqueFrame();
    post({ measuredSize: { width: 1280, height: 720 } });
    const doc = document.implementation.createHTMLDocument("");
    doc.body.innerHTML = `<div data-composition-id="main"></div>`;
    sized(doc.querySelector("[data-composition-id]")!, [0, 0, 1280, 720]);
    const scale = (frame: HTMLIFrameElement, read: Document | null) => {
      const basis = computeOverlayRootScale(overlayEl(), frame, read);
      return basis && [basis.rootScaleX, basis.rootScaleY];
    };
    expect(scale(iframe, null)).toEqual([0.75, 0.75]);
    expect(scale(iframe, null)).toEqual(scale(liveFrame(), doc));
  });

  it("tells a frame that answered without a size from one that never answered", () => {
    const silent = unsizedOpaqueFrame();
    expect(unansweredMoveReason(silent.iframe)).toBe(
      "The preview didn't answer, so Studio can't move this layer. Try again.",
    );
    const sizeless = unsizedOpaqueFrame();
    sizeless.post({ type: "timeline", durationSeconds: 4 });
    expect(unansweredMoveReason(sizeless.iframe)).toBe(
      "This composition has no size, so Studio can't move its layers. Give its root a width and height.",
    );
  });

  it("waits for the frame's size before reading a press, instead of giving up", async () => {
    const { iframe, post } = unsizedOpaqueFrame();
    const card = makeSelection("Card", document.getElementById("card")!);
    const read = askShownGestureStarts(iframe, overlayEl(), "index.html", [card]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    post({ measuredSize: { width: 1920, height: 1080 } });
    const answer = await read;
    expect(answer !== UNANSWERED && answer?.shown.length).toBe(1);
  });
});

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
      gsap: { x: 200, y: 5, moving: false, drawsTranslate: true },
      gsapAt: { x: 200, y: 5 },
      gsapRotation: 0,
      grow: { a: -0.25, b: 0, c: 0, d: 0.25 },
      cssRotation: null,
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
  gsapRotation: null,
};
const SNAP = { targets: [], compositionTarget: null, gridEdges: null, snapEnabled: true };

// fails without the fix: the live read asked for the overlay scale without the frame's document, got none, and an
// unsealed corner resize pinned by half the size change, so an xPercent-centred box jumped off its centre.
describe("a resize on a frame Studio scripts", () => {
  it("measures the grow the sealed frame reports for the same element", async () => {
    const live = measureLiveGrow(overlayEl(), liveFrame(), document.getElementById("card")!);
    const { iframe, handle } = await opaqueCard();
    const read = await measurePreviewGestureStart(iframe, overlayEl(), [handle]);
    expect(live).toEqual({ a: -0.25, b: 0, c: 0, d: 0.25 });
    expect(live).toEqual(read!.elements[0]!.start.grow);
  });
});

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

describe("a resize in a preview Studio cannot script", () => {
  it.each([-5, 1e-9, 1e9])("keeps no start box for a frame-reported width of %s", async (width) => {
    const iframe = opaqueFrame();
    Object.defineProperty(document.querySelector("#last"), "offsetWidth", {
      value: width,
      configurable: true,
    });
    const handle = (await queryPreviewElements(iframe, "#last"))!.matches[0]!.handle;
    await measurePreviewGestureStart(iframe, overlayEl(), [handle]);
    expect(gestureStartLayout(handle)).toBeNull();
  });

  it("scales from the box its gesture started from, not a 200 px fallback", async () => {
    const iframe = opaqueFrame();
    const handle = (await queryPreviewElements(iframe, "#last"))!.matches[0]!.handle;
    const standIn = standInFor(iframe, (await describePreviewElements(iframe, [handle]))![0]!);
    await measurePreviewGestureStart(iframe, overlayEl(), [handle]);
    const scaleKeys = {
      id: "#last-scale",
      targetSelector: "#last",
      propertyGroup: "scale",
      method: "to",
      properties: { scale: 1 },
      position: 0,
      resolvedStart: 0,
      duration: 1,
      keyframes: {
        keyframes: [
          { percentage: 0, properties: { scale: 1 } },
          { percentage: 100, properties: { scale: 1 } },
        ],
      },
    } as unknown as GsapAnimation;
    const commitMutation = vi.fn();

    await tryGsapResizeIntercept(
      { ...makeSelection("last", standIn), handle },
      { width: 240, height: 120 },
      [scaleKeys],
      iframe,
      commitMutation,
    );

    const scales = JSON.stringify(commitMutation.mock.calls.map((call) => call[1]));
    // It measured 120 x 60 at the press, so 240 x 120 is a scale of 2; the 200 px fallback gave 1.2.
    expect(scales).toMatch(/"scale":2\b/);
  });
});
