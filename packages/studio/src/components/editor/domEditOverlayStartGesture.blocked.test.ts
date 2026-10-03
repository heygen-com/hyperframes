// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditing";
import { createDomEditOverlayGestureHandlers } from "./useDomEditOverlayGestures";

vi.mock("./plainTranslate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./plainTranslate")>()),
  readTranslatePx: () => ({ x: Number.NaN, y: 0 }),
}));

it("a drag press the layer cannot take gets the notice alone, and counts as handled", () => {
  const element = document.body.appendChild(document.createElement("div"));
  const ref = <T>(current: T) => ({ current });
  const onBlockedMove = vi.fn();
  const opts = {
    selectionRef: ref({
      element,
      capabilities: { canApplyManualOffset: true },
    } as unknown as DomEditSelection),
    overlayRectRef: ref({ left: 0, top: 0, width: 240, height: 160, editScaleX: 1, editScaleY: 1 }),
    boxRef: ref(document.createElement("div")),
    overlayRef: ref(null),
    iframeRef: ref(null),
    gestureRef: ref(null),
    rafPausedRef: ref(false),
    onManualDragStartRef: ref(vi.fn()),
    onBlockedMoveRef: ref(onBlockedMove),
    onPathOffsetCommitRef: ref(vi.fn()),
    snapGuidesRef: ref(null),
    groupGestureRef: ref(null),
    blockedMoveRef: ref(null),
    setOverlayRect: vi.fn(),
    suppressNextBoxClickRef: ref(false),
    hoverSelectionRef: ref(null),
    onCanvasMouseDown: vi.fn(),
  };
  const press = new PointerEvent("pointerdown", { cancelable: true });
  const e = {
    clientX: 10,
    clientY: 10,
    pointerId: 1,
    button: 0,
    preventDefault: () => press.preventDefault(),
    stopPropagation() {},
    currentTarget: { setPointerCapture() {} },
  };
  const handlers = createDomEditOverlayGestureHandlers(opts as never);
  expect(handlers.startGesture("drag", e as never)).toBe(false);
  expect(onBlockedMove).toHaveBeenCalledTimes(1);
  expect(press.defaultPrevented).toBe(true);
});
