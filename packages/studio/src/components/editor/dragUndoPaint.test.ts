// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditing";
import type { GestureState } from "./domEditOverlayGestures";
import { createDomEditOverlayGestureHandlers } from "./useDomEditOverlayGestures";
import {
  hasStudioPendingEdits,
  paintBackNewestStudioPendingEdit,
} from "../../utils/studioPendingEdits";

afterEach(() => {
  document.body.innerHTML = "";
});

const ref = <T>(current: T) => ({ current });
const pointer = (x: number, y: number) => ({
  clientX: x,
  clientY: y,
  pointerId: 1,
  button: 0,
  preventDefault() {},
  stopPropagation() {},
  currentTarget: { setPointerCapture() {}, releasePointerCapture() {} },
});

/** Drags a box without GSAP 100 px right and 60 px down; its save waits for `save`. */
function dragWithSaveRunning(save: Promise<void>) {
  const element = document.createElement("div");
  element.style.setProperty("translate", "40px 30px");
  document.body.append(element);
  const selection = { element, capabilities: { canApplyManualOffset: true } };
  const handlers = createDomEditOverlayGestureHandlers({
    selectionRef: ref(selection as unknown as DomEditSelection),
    overlayRectRef: ref({ left: 0, top: 0, width: 240, height: 160, editScaleX: 1, editScaleY: 1 }),
    boxRef: ref(document.createElement("div")),
    overlayRef: ref(null),
    iframeRef: ref(null),
    gestureRef: ref<GestureState | null>(null),
    rafPausedRef: ref(false),
    onManualDragStartRef: ref(vi.fn()),
    onBlockedMoveRef: ref(vi.fn()),
    onPathOffsetCommitRef: ref(vi.fn(() => save)),
    snapGuidesRef: ref(null),
    groupGestureRef: ref(null),
    blockedMoveRef: ref(null),
    setOverlayRect: vi.fn(),
    suppressNextBoxClickRef: ref(false),
    hoverSelectionRef: ref(null),
    onCanvasMouseDown: vi.fn(),
  } as never);
  expect(handlers.startGesture("drag", pointer(10, 10) as never)).toBe(true);
  handlers.onPointerUp(pointer(110, 70) as never);
  return element;
}

it("a drag whose save is still running can be painted back at once, and shown again", async () => {
  let saved!: () => void;
  const element = dragWithSaveRunning(new Promise<void>((resolve) => (saved = resolve)));
  const moved = element.style.getPropertyValue("translate");
  expect(moved).not.toBe("40px 30px");

  const shown = paintBackNewestStudioPendingEdit();
  expect(element.style.getPropertyValue("translate")).toBe("40px 30px");
  expect(paintBackNewestStudioPendingEdit()).toBeNull();
  shown!.showAgain();
  expect(element.style.getPropertyValue("translate")).toBe(moved);

  saved();
  await vi.waitFor(() => expect(hasStudioPendingEdits()).toBe(false));
  expect(paintBackNewestStudioPendingEdit()).toBeNull();
});
