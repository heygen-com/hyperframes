// @vitest-environment happy-dom

import { gsap } from "gsap";
import { parseGsapScriptAcorn } from "@hyperframes/parsers/gsap-parser-acorn";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeSelection } from "../../hooks/domSelectionTestHarness";
import { freezeDragStamp } from "../../hooks/draggedGsapPosition";
import { settleGsapSnapshot } from "../../hooks/gsapFrameSnapshot";
import { tryGsapDragIntercept, tryGsapRotationIntercept } from "../../hooks/gsapRuntimeBridge";
import { watchPreviewFrame } from "../../player/lib/bridgePlayback";
import { describePreviewElements, queryPreviewElements } from "../../player/lib/previewElements";
import { usePlayerStore } from "../../player/store/playerStore";
import type { UseDomEditOverlayGesturesOptions } from "./domEditOverlayGestures";
import { startGesture } from "./domEditOverlayStartGesture";
import {
  applyManualOffsetDragCommit,
  applyManualOffsetDragDraft,
  createManualOffsetDragMember,
  endManualOffsetDragMembers,
  restoreManualOffsetDragMembers,
  type ManualOffsetDragMember,
} from "./manualOffsetDrag";
import { armPreviewDraftEnd, drawPreviewDraft, endPreviewDraft } from "./previewDrafts";
import { manualOffsetMoveRevert } from "./gestureUndoRevert";
import { patchSealedPreview } from "../../hooks/sealedTweenPatch";
import { takePreviewTicket } from "../../utils/sealedPreviewLedger";
import { previewAnswer, previewRequest } from "../../player/lib/previewChannel";

vi.mock("../../player/lib/previewChannel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../player/lib/previewChannel")>();
  return {
    ...actual,
    previewAnswer: vi.fn(actual.previewAnswer),
    previewRequest: vi.fn(actual.previewRequest),
  };
});
import { measurePreviewGestureStart } from "./previewGestureStartRead";
import { captureStudioRotation } from "./manualEditsSnapshot";
import {
  applyRotationDraft,
  endRotationDraft,
  endRotationGestureIfCurrent,
  readCssRotationTarget,
  restoreRotationDraft,
} from "./rotationDraft";
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

/** Presses the box on a sealed frame, as the overlay does. */
async function pressBoxOnSealedFrame(beforePress?: (iframe: HTMLIFrameElement) => void) {
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
  return { iframe, standIn, selection, start, started, member };
}

/** Presses the box on a sealed frame, drags it 10 page px right and lets go, as the overlay does. */
async function dragBoxOnSealedFrame(
  script: string,
  beforePress?: (iframe: HTMLIFrameElement) => void,
  beforeEnd?: (standIn: Element, member: ManualOffsetDragMember) => void,
  save?: (iframe: HTMLIFrameElement, standIn: Element) => Promise<unknown>,
) {
  const box = document.getElementById("box")!;
  const { iframe, standIn, selection, start, started, member } =
    await pressBoxOnSealedFrame(beforePress);

  // A page px is two frame px: the frame shows 1920 px in 960.
  applyManualOffsetDragDraft(member, 10, 0);
  await vi.waitFor(() => expect(drawnAt(box)).toEqual({ x: start.gsap!.x + 20, y: start.gsap!.y }));

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
  beforeEnd?.(standIn, member);
  await save?.(iframe, standIn);
  endManualOffsetDragMembers([member]);
  return { started, start, anim: anim!, outcome, commit, iframe, standIn, member };
}

// fails without the fix: the frame kept the drag's drawn translate on top of the x the save gave GSAP.
it("ends a sealed drag on GSAP's route without its drawn translate, so the saved x alone places the layer", async () => {
  mount(SCRIPT);
  await dragBoxOnSealedFrame(SCRIPT);

  await vi.waitFor(() => expect(document.getElementById("box")!.style.translate).toBe(""));
});

// fails without the fix: a sealed drag on GSAP's route left its offset on Studio's stand-in, the next gesture counted
// from it, and a second scale resize of the layer saved its position that far off.
it("leaves no Studio offset on the stand-in once a sealed drag ends on GSAP's route", async () => {
  mount(SCRIPT);
  const { standIn } = await dragBoxOnSealedFrame(SCRIPT);

  expect((standIn as HTMLElement).style.getPropertyValue("--hf-studio-offset-x")).toBe("");
});

const writes = (box: HTMLElement) => [box.style.transform, box.style.translate];

// fails without the fix: the sealed draft drew a CSS translate on top of GSAP's, at another precision than the x/y an
// open preview's drag gives GSAP, so a sealed drop point and the x it saved came out 0.001 px off.
it("draws a sealed drag of a GSAP-held layer with the writes an open preview's drag makes", async () => {
  mount(SCRIPT);
  let sealed: string[] = [];
  await dragBoxOnSealedFrame(SCRIPT, undefined, () => (sealed = writes(box())));
  mount(SCRIPT);
  const rect = { left: 300, top: 200, width: 100, height: 50, editScaleX: 1, editScaleY: 1 };
  const element = box();
  const open = createManualOffsetDragMember({
    key: "box",
    selection: makeSelection("box", element),
    element,
    rect,
    gesture: "drag",
  });
  if (!open.ok) throw new Error("no open member");
  applyManualOffsetDragDraft(open.member, 20, 0);
  expect(writes(element)).toEqual(sealed);
});

/** The frame's writes for a drag of `frameDx` frame px, sealed then open: a page px is two frame px sealed. */
async function sealedAndOpenWrites(script: string, frameDx: number) {
  mount(script);
  const { member } = await pressBoxOnSealedFrame();
  const from = drawnAt(box()).x;
  applyManualOffsetDragDraft(member, frameDx / 2, 0);
  await vi.waitFor(() => expect(drawnAt(box()).x).toBeGreaterThan(from + frameDx - 1));
  const sealed = [writes(box()), drawnAt(box())];
  mount(script);
  const element = box();
  const rect = { left: 300, top: 200, width: 100, height: 50, editScaleX: 1, editScaleY: 1 };
  const selection = makeSelection("box", element);
  const open = createManualOffsetDragMember({
    key: "box",
    selection,
    element,
    rect,
    gesture: "drag",
  });
  if (!open.ok) throw new Error("no open member");
  applyManualOffsetDragDraft(open.member, frameDx, 0);
  return { sealed, open: [writes(element), drawnAt(element)] };
}

// fails without the fix: a sealed drag gave the frame the unrounded offset, where an open preview's drag rounds the
// position it writes to 3 decimals, so the drawn box and the drop point measured from it came out up to 0.0005 px off.
it.each([
  ["a GSAP-held layer, on GSAP's route", SCRIPT],
  ["a layer GSAP leaves alone, on its own translate", timeline("")],
])("draws a sealed drag of %s at the position an open drag rounds to", async (_name, script) => {
  const { sealed, open } = await sealedAndOpenWrites(script, 20.00074);
  expect(sealed[1]).toEqual(open[1]);
});

it("puts a cancelled sealed drag of a GSAP-held layer back where GSAP had it", async () => {
  mount(SCRIPT);
  await dragBoxOnSealedFrame(SCRIPT, undefined, (_standIn, member) =>
    restoreManualOffsetDragMembers([member]),
  );
  await vi.waitFor(() =>
    expect([box().style.translate, drawnAt(box())]).toEqual(["", { x: 100, y: 40 }]),
  );
});

// fails without the fix: ending the draft on GSAP's route took back the size a resize had drawn too.
it("keeps the size a sealed resize drew when its anchor ends on GSAP's route", async () => {
  mount(SCRIPT);
  await dragBoxOnSealedFrame(SCRIPT, undefined, (standIn) =>
    drawPreviewDraft(standIn, { size: { width: 300, height: 200 } }),
  );

  const box = document.getElementById("box")!;
  await vi.waitFor(() => expect([box.style.width, box.style.translate]).toEqual(["300px", ""]));
});

// fails without the fix: a resize saved as GSAP scale kept its drawn CSS size, and the scale grew it again.
it("drops the size a sealed resize drew when its save writes the size as GSAP scale", async () => {
  mount(SCRIPT);
  await dragBoxOnSealedFrame(SCRIPT, undefined, (standIn, member) => {
    drawPreviewDraft(standIn, { size: { width: 300, height: 200 } });
    member.sizeSavedAsScale = true;
  });

  const box = document.getElementById("box")!;
  await vi.waitFor(() => expect([box.style.width, box.style.translate]).toEqual(["", ""]));
});

// fails without the fix: a sealed preview refused to drag a layer its animation moves.
it("drags a layer its tween moves in a sealed preview: it moves live and saves a keyframe there", async () => {
  mount(SCRIPT);
  const { started, start, anim, outcome, commit } = await dragBoxOnSealedFrame(SCRIPT);

  expect(start.gsap).toEqual({ x: 100, y: 40, moving: true, drawsTranslate: true });
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

  expect(start.gsap).toEqual({ x: 100, y: 40, moving: true, drawsTranslate: true });
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

  expect(start.gsap).toEqual({ x: 100, y: 40, moving: false, drawsTranslate: true });
  expect(outcome).toEqual({ status: "persisted" });
  expect(commit).toHaveBeenCalledTimes(1);
  // The hold's own `set` takes the new place, as when the frame's tweens are read.
  expect(commit.mock.calls[0]![1]).toEqual({
    type: "update-properties",
    animationId: "#box-set-0-position",
    properties: { x: 120, y: 40 },
  });
});

// fails without the fix: the resize read the stand-in's own (empty) timelines, called the layer plain CSS and
// saved its rotated corner's anchor as a raw `translate` that a reload added on top of GSAP's x.
it("a resize in a sealed preview keeps the anchor of a layer its tween moves on GSAP's route", async () => {
  mount(SCRIPT);
  const iframe = opaqueFrame();
  const handle = (await queryPreviewElements(iframe, "#box"))!.matches[0]!.handle;
  const standIn = standInFor(iframe, (await describePreviewElements(iframe, [handle]))![0]!);
  const overlay = sized(document.createElement("div"), [20, 10, 1200, 800]);
  const { rect, start } = (await measurePreviewGestureStart(iframe, overlay, [handle]))!
    .elements[0]!;
  const result = createManualOffsetDragMember({
    key: "box",
    selection: { ...makeSelection("box", standIn), id: "box", handle },
    element: standIn,
    rect,
    gesture: "resize",
    start,
  });

  expect(start.gsap).toEqual({ x: 100, y: 40, moving: true, drawsTranslate: true });
  expect(result.ok && result.member.plainTranslate).toBe(false);
});

async function sealedBox() {
  const iframe = opaqueFrame();
  const handle = (await queryPreviewElements(iframe, "#box"))!.matches[0]!.handle;
  const described = (await describePreviewElements(iframe, [handle]))![0]!;
  return {
    box: document.getElementById("box")!,
    standIn: standInFor(iframe, described) as HTMLElement,
  };
}

// fails without the fix: a sealed frame never turned the element a rotate gesture drew.
it("turns a sealed frame's element by its rotate property as the gesture draws, and back on a cancel", async () => {
  mount(SCRIPT);
  const { box, standIn } = await sealedBox();
  const start = captureStudioRotation(standIn);

  applyRotationDraft(standIn, 30, readCssRotationTarget(standIn));
  await vi.waitFor(() => expect(box.style.getPropertyValue("rotate")).toBe("30deg"));
  restoreRotationDraft(standIn, 30, start, true);
  await vi.waitFor(() => expect(box.style.getPropertyValue("rotate")).toBe(""));
});

// fails without the fix: a GSAP rotation drew only on Studio's stand-in.
it("turns a sealed frame's element by its own GSAP, and keeps the turn when the gesture ends", async () => {
  mount(SCRIPT);
  const { box, standIn } = await sealedBox();

  applyRotationDraft(standIn, 40, null);
  endRotationDraft(standIn);
  await vi.waitFor(() => expect(gsap.getProperty(box, "rotation")).toBe(40));
  expect(box.style.getPropertyValue("rotate")).toBe("none");
});

const SPINS_BOX = timeline(`tl.to("#box", { rotation: 40, duration: 1, ease: "none" }, 0);`);

/** The box on a sealed frame, and a press of its rotate handle as the overlay does it. */
async function sealedRotate(script: string, extra = "") {
  mount(script, extra);
  const iframe = opaqueFrame();
  const handle = (await queryPreviewElements(iframe, "#box"))!.matches[0]!.handle;
  const standIn = standInFor(iframe, (await describePreviewElements(iframe, [handle]))![0]!);
  const made = makeSelection("box", standIn);
  const capabilities = { ...made.capabilities, canApplyManualRotation: true };
  const selection = { ...made, capabilities, id: "box", handle };
  const pressRotate = async () => {
    const opts = gestureOpts(iframe);
    const read = await measurePreviewGestureStart(iframe, opts.overlayRef.current!, [handle]);
    const { rect, start } = read!.elements[0]!;
    startGesture("rotate", press(), opts, { selection, rect, start, snap: read!.snap });
    return { gesture: opts.gestureRef.current!, start };
  };
  return { selection, iframe, standIn, pressRotate };
}

async function pressRotateOnSealedFrame(script: string, extra = "") {
  const sealed = await sealedRotate(script, extra);
  return { ...sealed, ...(await sealed.pressRotate()) };
}

// fails without the fix: the rotate asked the stand-in, which has no GSAP, so a sealed spin saved a CSS rotate.
it("turns a layer its tween spins on GSAP's route in a sealed preview, from the angle GSAP shows, and saves the tween", async () => {
  const { gesture, selection, iframe, standIn } = await pressRotateOnSealedFrame(SPINS_BOX);
  expect(gesture.plainRotation).toBeNull();
  expect(gesture.actualRotation).toBe(20);

  const commit = vi.fn(async () => undefined);
  const [anim] = parseGsapScriptAcorn(SPINS_BOX).animations;
  const outcome = await tryGsapRotationIntercept(
    selection,
    35,
    [anim!],
    iframe,
    commit,
    undefined,
    freezeDragStamp(standIn),
  );
  expect(outcome).toEqual({ status: "persisted" });
  expect(commit.mock.calls[0]![1]).toMatchObject({
    keyframes: expect.arrayContaining([{ percentage: 50, properties: { rotation: 35 } }]),
  });
});

it("turns a layer GSAP leaves alone by its own CSS rotate in a sealed preview", async () => {
  const { gesture } = await pressRotateOnSealedFrame(timeline(""));
  expect(gesture.plainRotation).toMatchObject({ property: "rotate" });
});

// fails without the fix: the stand-in has no stylesheet, so the turn began at 0 and drew 30deg short.
it("turns a sealed layer its stylesheet rotates from the angle it shows", async () => {
  const { gesture } = await pressRotateOnSealedFrame(
    timeline(""),
    "<style>#box { rotate: 30deg; }</style>",
  );
  expect(gesture.actualRotation).toBeCloseTo(30, 6);
});

// fails without the fix: the first rotate's save, landing after a regrab, ended the regrab's frame draft, so a
// cancelled regrab left the frame at its mid-drag angle.
it("cancels a rotate regrabbed while the first one saves back to where the regrab started, on the frame too", async () => {
  const { standIn, pressRotate } = await sealedRotate(timeline(""));
  const box = document.getElementById("box")!;
  const turned = () => [box, standIn].map((el) => el.style.getPropertyValue("rotate"));
  const first = (await pressRotate()).gesture;
  applyRotationDraft(standIn, 30, first.plainRotation);
  await vi.waitFor(() => expect(turned()).toEqual(["30deg", "30deg"]));

  const regrab = (await pressRotate()).gesture;
  applyRotationDraft(standIn, 50, regrab.plainRotation);
  await vi.waitFor(() => expect(turned()).toEqual(["50deg", "50deg"]));
  endRotationGestureIfCurrent(standIn, first.manualEditDragToken);
  restoreRotationDraft(standIn, 50, regrab.initialRotation, true);

  await vi.waitFor(() => expect(turned()).toEqual(["30deg", "30deg"]));
});

// fails without the fix: an out-of-range GSAP rotation made Studio refuse the whole start, so a drag lost GSAP's x/y.
it("keeps a sealed element's move start when GSAP's rotation is out of range, and drops only the turn", async () => {
  mount(SCRIPT);
  gsap.set("#box", { rotation: 100_000 });
  const iframe = opaqueFrame();
  const handle = (await queryPreviewElements(iframe, "#box"))!.matches[0]!.handle;
  const overlay = sized(document.createElement("div"), [20, 10, 1200, 800]);
  const { start } = (await measurePreviewGestureStart(iframe, overlay, [handle]))!.elements[0]!;

  expect(start.gsap).toEqual({ x: 100, y: 40, moving: true, drawsTranslate: true });
  expect(start.gsapRotation).toBeUndefined();
});

const draftEnds = () =>
  vi
    .mocked(previewRequest)
    .mock.calls.filter(([, kind]) => kind === "draft")
    .flatMap(([, , params]) => (params as { drafts: object[] }).drafts)
    .filter((op) => "end" in op || ("translate" in op && op.translate === null));
const patchRequests = () =>
  vi.mocked(previewAnswer).mock.calls.filter(([, kind]) => kind === "patch-tweens");
const drawsSettled = () => new Promise((resolve) => setTimeout(resolve, 30));

/** The save a sealed move on GSAP's route sends: the new x and y as a base set, as patch-tweens. */
function savePosition(change: { kind: "global-set" | "set"; props: { x: number; y: number } }) {
  return async (iframe: HTMLIFrameElement) => {
    await drawsSettled();
    vi.mocked(previewRequest).mockClear();
    vi.mocked(previewAnswer).mockClear();
    const ticket = takePreviewTicket(iframe, {
      scriptText: SCRIPT,
      snapshot: null,
      attributes: false,
      timing: false,
    });
    patchSealedPreview(ticket, [{ selector: "#box", change }], true, () => undefined);
    await vi.waitFor(() => expect(patchRequests()).toHaveLength(1));
    await vi.mocked(previewAnswer).mock.results.at(-1)!.value;
  };
}

// fails without the fix: the save set GSAP's x/y and the draft end followed as its own message, so the frame
// painted the drawn translate on top of the saved position (the layer moved twice) for a frame.
it("a sealed move's save ends its draft in the same frame message, and the teardown sends no other end", async () => {
  mount(SCRIPT);
  const { iframe } = await dragBoxOnSealedFrame(SCRIPT, undefined, undefined, async (frame) => {
    await savePosition({ kind: "global-set", props: { x: 110, y: 40 } })(frame);
    const box = document.getElementById("box")!;
    expect([box.style.translate, drawnAt(box)]).toEqual(["", { x: 110, y: 40 }]);
  });
  const [[, , params]] = patchRequests() as unknown as [
    [unknown, unknown, { endsDrafts?: unknown[] }],
  ];
  expect(params.endsDrafts).toEqual([expect.objectContaining({ end: "keep-size" })]);
  await drawsSettled();
  expect(draftEnds()).toEqual([]);
  expect(iframe).toBeDefined();
});

// fails without the fix: the undo's redraw on GSAP's route sent the press position (the stand-in keeps no path offset
// there), and skipped a draft of (0, 0) as a relative move of nothing; the layer stayed where the undo had put it.
it.each([
  [
    "(0, 0)",
    timeline(`tl.to("#box", { x: -40, y: 0, duration: 1, ease: "none" }, 0);`),
    { x: -20, y: 0 },
  ],
  ["(120, 40)", SCRIPT, { x: 100, y: 40 }],
])(
  "puts a sealed GSAP move that ended at %s back there when its undo does not go through",
  async (_name, script, start) => {
    mount(script);
    const { member } = await dragBoxOnSealedFrame(script);
    const box = document.getElementById("box")!;
    const end = { x: start.x + 20, y: start.y };
    await vi.waitFor(() => expect(drawnAt(box)).toEqual(end));
    const putBack = manualOffsetMoveRevert([member])();
    // The undo's write reaching the frame, which the redraw must paint over.
    gsap.set(box, start);
    putBack();
    await vi.waitFor(() => expect(drawnAt(box)).toEqual(end));
  },
);

// fails without the fix: a gesture with no save ended its draft as {translate:null} then {end:keep}, two messages.
it("a sealed move with no save ends its draft once, as one end", async () => {
  mount(SCRIPT);
  vi.mocked(previewRequest).mockClear();
  await dragBoxOnSealedFrame(SCRIPT, undefined, undefined, drawsSettled);

  await vi.waitFor(() => expect(document.getElementById("box")!.style.translate).toBe(""));
  expect(draftEnds()).toEqual([
    expect.objectContaining({ end: "keep-size", draft: expect.any(Number) }),
  ]);
});

it("a save the frame cannot apply leaves the end to go alone, so the draft still ends", async () => {
  mount(SCRIPT);
  await dragBoxOnSealedFrame(
    SCRIPT,
    undefined,
    undefined,
    savePosition({ kind: "set", props: { x: 110, y: 40 } }),
  );

  await vi.waitFor(() => expect(document.getElementById("box")!.style.translate).toBe(""));
  expect(draftEnds()).toEqual([expect.objectContaining({ end: "keep-size" })]);
});

const savedEnds = () =>
  (patchRequests() as unknown as Array<[unknown, unknown, { endsDrafts?: unknown[] }]>).at(-1)?.[2]
    .endsDrafts;
const regrab = (x: number) => (standIn: Element) =>
  drawPreviewDraft(standIn, { translate: { x, y: 0 } });
const box = () => document.getElementById("box")!;

describe("a newer gesture that takes the element before the older save lands", () => {
  // fails without the fix: the older save took the end of the draft the regrab now drew on, and its patch
  // cleared the regrab's translate for a frame (the mid-drag flash of seqheldtwice-tlhold-px on the edit bench).
  it("leaves the regrab's draft alone when the older save lands", async () => {
    mount(SCRIPT);
    await dragBoxOnSealedFrame(SCRIPT, undefined, regrab(7), async (iframe) => {
      await savePosition({ kind: "global-set", props: { x: 110, y: 40 } })(iframe);
      expect(savedEnds()).toBeUndefined();
      expect(drawnTranslate(box())[0]).not.toBe(0);
    });
  });

  // The box's tween starts after the playhead, so the older save's base set is what the frame shows there.
  it("puts a cancelled regrab back where the older save left it, not where the older drag began", async () => {
    const later = timeline(`tl.to("#box", { x: 200, y: 80, duration: 1, ease: "none" }, 5);`);
    mount(later);
    await dragBoxOnSealedFrame(later, undefined, regrab(7), async (iframe, standIn) => {
      await savePosition({ kind: "global-set", props: { x: 110, y: 40 } })(iframe);
      endPreviewDraft(standIn, "restore");
      await vi.waitFor(() => expect(box().style.translate).toBe(""));
      expect(drawnAt(box())).toEqual({ x: 110, y: 40 });
    });
  });

  it("leaves the regrab's draft alone when the older save fails", async () => {
    mount(SCRIPT);
    await dragBoxOnSealedFrame(SCRIPT, undefined, regrab(7), async (iframe) => {
      await drawsSettled();
      vi.mocked(previewRequest).mockClear();
      vi.mocked(previewAnswer).mockClear();
      const ticket = takePreviewTicket(iframe, {
        scriptText: SCRIPT,
        snapshot: null,
        attributes: false,
        timing: false,
      });
      const patch = {
        selector: "#gone",
        change: { kind: "global-set" as const, props: { x: 1, y: 1 } },
      };
      patchSealedPreview(ticket, [patch], true, () => undefined);
      await vi.waitFor(() => expect(patchRequests()).toHaveLength(1));
      await vi.mocked(previewAnswer).mock.results.at(-1)!.value;
      await drawsSettled();
      expect(draftEnds()).toEqual([]);
      expect(drawnTranslate(box())[0]).not.toBe(0);
    });
  });

  it("ends only the newest gesture's draft when three saves land out of order", async () => {
    mount(SCRIPT);
    await dragBoxOnSealedFrame(SCRIPT, undefined, regrab(7), async (iframe, standIn) => {
      armPreviewDraftEnd(standIn, "#box");
      regrab(9)(standIn);
      await savePosition({ kind: "global-set", props: { x: 105, y: 40 } })(iframe);
      expect(savedEnds()).toBeUndefined();
      await savePosition({ kind: "global-set", props: { x: 103, y: 40 } })(iframe);
      expect(savedEnds()).toBeUndefined();
      expect(drawnTranslate(box())[0]).not.toBe(0);
      armPreviewDraftEnd(standIn, "#box");
      await savePosition({ kind: "global-set", props: { x: 110, y: 40 } })(iframe);
      expect(savedEnds()).toEqual([expect.objectContaining({ end: "keep-size" })]);
      expect([box().style.translate, drawnAt(box())]).toEqual(["", { x: 110, y: 40 }]);
    });
  });
});

it("a failed save's restore still takes the draft back", async () => {
  mount(SCRIPT);
  await dragBoxOnSealedFrame(SCRIPT, undefined, (standIn) => endPreviewDraft(standIn, "restore"));

  await vi.waitFor(() =>
    expect(drawnAt(document.getElementById("box")!)).toEqual({ x: 100, y: 40 }),
  );
});

it("an older gesture's save leaves a regrab's draft alone", async () => {
  mount(SCRIPT);
  await dragBoxOnSealedFrame(SCRIPT, undefined, undefined, async (iframe, standIn) => {
    endPreviewDraft(standIn, "keep");
    drawPreviewDraft(standIn, { translate: { x: 7, y: 0 } });
    await savePosition({ kind: "global-set", props: { x: 110, y: 40 } })(iframe);
    const [[, , params]] = patchRequests() as unknown as [
      [unknown, unknown, { endsDrafts?: unknown }],
    ];
    expect(params.endsDrafts).toBeUndefined();
    expect(drawnTranslate(document.getElementById("box")!)[0]).not.toBe(0);
  });
});
