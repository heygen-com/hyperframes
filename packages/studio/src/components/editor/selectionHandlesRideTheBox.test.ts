// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditing";
import type { GestureState } from "./domEditOverlayGestures";
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
