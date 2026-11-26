// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditing";
import type { GestureState } from "./domEditOverlayGestures";
import { applyManualOffsetDragDraft, type ManualOffsetDragMember } from "./manualOffsetDrag";
import { previewFrameOpaque } from "../../player/lib/previewChannel";
import { createDomEditOverlayGestureHandlers } from "./useDomEditOverlayGestures";

vi.mock("../../player/lib/previewChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../player/lib/previewChannel")>()),
  previewFrameOpaque: vi.fn(() => true),
}));
vi.mock("./manualOffsetDrag", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./manualOffsetDrag")>()),
  applyManualOffsetDragDraft: vi.fn(() => ({ x: 0, y: 0 })),
}));

(window as unknown as { onpointerrawupdate: null }).onpointerrawupdate = null;
const member = {} as ManualOffsetDragMember;
const harnesses: Array<{ gestureRef: { current: unknown } }> = [];

function sealedDrag() {
  const opts = {
    gestureRef: {
      current: {
        kind: "drag",
        mode: "path-offset",
        pointerId: 1,
        selection: { element: document.createElement("div") } as unknown as DomEditSelection,
        ...{
          startX: 100,
          startY: 100,
          originLeft: 10,
          originTop: 20,
          originWidth: 50,
          originHeight: 40,
        },
        ...{ editScaleX: 1, editScaleY: 1, actualRotation: 0 },
        pathOffsetMember: member,
      } as Partial<GestureState> | null,
    },
    groupGestureRef: { current: null },
    iframeRef: { current: document.createElement("iframe") },
    selectionRef: { current: null },
    boxRef: { current: null },
    handlesRef: { current: null },
    blockedMoveRef: { current: null },
    waitingPressRef: { current: null },
    rafPausedRef: { current: true },
    snapGuidesRef: { current: null },
    setOverlayRect: vi.fn(),
    onCanvasPointerMoveRef: { current: vi.fn() },
  };
  harnesses.push(opts);
  return { opts, handlers: createDomEditOverlayGestureHandlers(opts as never) };
}

const pointer = (clientX: number, clientY: number) =>
  ({ clientX, clientY, shiftKey: false, altKey: false, pointerId: 1, buttons: 1 }) as never;
const rawUpdate = (clientX: number, clientY: number) =>
  window.dispatchEvent(
    new PointerEvent("pointerrawupdate", { clientX, clientY, pointerId: 1, buttons: 1 }),
  );

afterEach(() => {
  for (const opts of harnesses.splice(0)) opts.gestureRef.current = null;
  rawUpdate(0, 0);
  vi.mocked(applyManualOffsetDragDraft).mockClear();
  vi.mocked(previewFrameOpaque).mockReturnValue(true);
});

describe("a sealed drag's step reaches the frame before the paint of its pointer's frame", () => {
  // fails without the fix: the step was drawn only from pointermove, which runs in the task that paints the frame.
  it("draws each step after the first from the raw pointer update", () => {
    const { handlers } = sealedDrag();
    handlers.onPointerMove(pointer(110, 100));
    vi.mocked(applyManualOffsetDragDraft).mockClear();
    rawUpdate(130, 104);
    expect(applyManualOffsetDragDraft).toHaveBeenCalledWith(member, 30, 4);
  });

  it("draws from pointermove when no raw update came first", () => {
    const { handlers } = sealedDrag();
    handlers.onPointerMove(pointer(110, 100));
    expect(applyManualOffsetDragDraft).toHaveBeenCalledWith(member, 10, 0);
  });

  it("leaves an unsealed drag to pointermove", () => {
    vi.mocked(previewFrameOpaque).mockReturnValue(false);
    const { handlers } = sealedDrag();
    handlers.onPointerMove(pointer(110, 100));
    rawUpdate(130, 104);
    expect(applyManualOffsetDragDraft).toHaveBeenCalledTimes(1);
  });

  it("stops listening once the drag is let go", () => {
    const { opts, handlers } = sealedDrag();
    handlers.onPointerMove(pointer(110, 100));
    const held = opts.gestureRef.current;
    opts.gestureRef.current = null;
    rawUpdate(120, 100);
    opts.gestureRef.current = held;
    vi.mocked(applyManualOffsetDragDraft).mockClear();
    rawUpdate(130, 100);
    expect(applyManualOffsetDragDraft).not.toHaveBeenCalled();
  });
});
