// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditing";
import type { GestureState, GroupGestureState } from "./domEditOverlayGestures";
import { createDomEditOverlayGestureHandlers } from "./useDomEditOverlayGestures";

const ref = <T>(current: T) => ({ current });
const pointer = (x: number, y: number) => ({
  clientX: x,
  clientY: y,
  pointerId: 1,
  button: 0,
  buttons: 1,
  preventDefault() {},
  stopPropagation() {},
  currentTarget: { setPointerCapture() {}, releasePointerCapture() {} },
});

/** Starts a gesture on a 240x160 box at (20, 30); React's state setter is a stub, so nothing renders. */
function pressBox(kind: "drag" | "resize") {
  const element = document.createElement("div");
  element.setAttribute("style", "position: absolute; width: 240px; height: 160px");
  document.body.append(element);
  const selection = {
    element,
    capabilities: { canApplyManualOffset: true, canApplyManualSize: true },
  };
  const box = document.createElement("div");
  const handles = document.createElement("div");
  const handlers = createDomEditOverlayGestureHandlers({
    selectionRef: ref(selection as unknown as DomEditSelection),
    overlayRectRef: ref({
      left: 20,
      top: 30,
      width: 240,
      height: 160,
      editScaleX: 1,
      editScaleY: 1,
    }),
    boxRef: ref(box),
    handlesRef: ref(handles),
    overlayRef: ref(null),
    iframeRef: ref(null),
    gestureRef: ref<GestureState | null>(null),
    rafPausedRef: ref(false),
    onManualDragStartRef: ref(vi.fn()),
    onCanvasPointerMoveRef: ref(vi.fn()),
    snapGuidesRef: ref(null),
    groupGestureRef: ref(null),
    blockedMoveRef: ref(null),
    waitingPressRef: ref(null),
    setOverlayRect: vi.fn(),
    suppressNextBoxClickRef: ref(false),
    hoverSelectionRef: ref(null),
    onCanvasMouseDown: vi.fn(),
  } as never);
  const start = kind === "drag" ? pointer(100, 100) : pointer(260, 190);
  expect(handlers.startGesture(kind, start as never, { resizeHandle: "se" })).toBe(true);
  return { handlers, box, handles };
}

const rectOf = (el: HTMLElement) => [el.style.left, el.style.top, el.style.width, el.style.height];

// fails without the fix: the handles were placed only by React's later commit, a frame after the box and the layer.
it("a drag move places the resize handles in the same write as the box", () => {
  const { handlers, box, handles } = pressBox("drag");
  handlers.onPointerMove(pointer(130, 112) as never);
  expect(box.style.left).toBe("50px");
  expect(rectOf(handles)).toEqual(rectOf(box));
});

it("a resize move sizes the resize handles in the same write as the box", () => {
  const { handlers, box, handles } = pressBox("resize");
  handlers.onPointerMove(pointer(300, 220) as never);
  expect(box.style.width).not.toBe("");
  expect(rectOf(handles)).toEqual(rectOf(box));
});

// fails without the fix: the group's boxes were placed only by React's later commit, a frame after the layers.
it("a group drag move places every member box and the group box in the same write", () => {
  const chrome = document.createElement("div");
  chrome.innerHTML =
    '<div data-dom-edit-group-member="a"></div><div data-dom-edit-group-member="b"></div>' +
    '<div data-dom-edit-group-box="true"></div>';
  const rect = (left: number, top: number) => ({
    left,
    top,
    width: 40,
    height: 30,
    editScaleX: 1,
    editScaleY: 1,
  });
  const group = {
    pointerId: 1,
    startX: 100,
    startY: 100,
    originItems: [
      { key: "a", rect: rect(10, 20) },
      { key: "b", rect: rect(70, 50) },
    ],
    members: [],
  } as unknown as GroupGestureState;
  const handlers = createDomEditOverlayGestureHandlers({
    gestureRef: ref(null),
    groupGestureRef: ref(group),
    overlayRef: ref(chrome),
    boxRef: ref(null),
    handlesRef: ref(null),
    selectionRef: ref(null),
    waitingPressRef: ref(null),
    blockedMoveRef: ref(null),
    snapGuidesRef: ref(null),
    setGroupOverlayItems: vi.fn(),
    onCanvasPointerMoveRef: ref(vi.fn()),
  } as never);
  handlers.onPointerMove(pointer(130, 112) as never);
  const at = (selector: string) => {
    const el = chrome.querySelector<HTMLElement>(selector)!;
    return [el.style.left, el.style.top, el.style.width, el.style.height];
  };
  expect(at('[data-dom-edit-group-member="a"]')).toEqual(["40px", "32px", "40px", "30px"]);
  expect(at('[data-dom-edit-group-member="b"]')).toEqual(["100px", "62px", "40px", "30px"]);
  expect(at("[data-dom-edit-group-box]")).toEqual(["40px", "32px", "100px", "60px"]);
});
