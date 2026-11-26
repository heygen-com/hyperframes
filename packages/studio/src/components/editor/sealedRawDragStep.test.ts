// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditing";
import type { GestureState, GroupGestureState } from "./domEditOverlayGestures";
import {
  applyManualOffsetDragDraft,
  createManualOffsetDragMember,
  type ManualOffsetDragMember,
} from "./manualOffsetDrag";
import { previewFrameOpaque, releaseEndedGestureHolds } from "../../player/lib/previewChannel";
import { createDomEditOverlayGestureHandlers } from "./useDomEditOverlayGestures";
import { applyRotationDraft } from "./rotationDraft";
import { applyStudioBoxSizeDraft } from "./manualEdits";
import { armSealedRawSteps } from "./gestureSteps";
import { startGesture, startGroupDrag } from "./domEditOverlayStartGesture";

vi.mock("../../player/lib/previewChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../player/lib/previewChannel")>()),
  previewFrameOpaque: vi.fn(() => true),
  releaseEndedGestureHolds: vi.fn(),
}));
vi.mock("./rotationDraft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./rotationDraft")>()),
  applyRotationDraft: vi.fn(),
}));
vi.mock("./manualEdits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./manualEdits")>()),
  applyStudioBoxSizeDraft: vi.fn((_element: unknown, size: unknown) => size),
}));
vi.mock("./resizeDraft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./resizeDraft")>()),
  resolveResizeDraftRect: vi.fn(() => ({ left: 0, top: 0, width: 1, height: 1 })),
}));
vi.mock("./manualOffsetDrag", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./manualOffsetDrag")>()),
  applyManualOffsetDragDraft: vi.fn(() => ({ x: 0, y: 0 })),
}));

(window as unknown as { onpointerrawupdate: null }).onpointerrawupdate = null;
const member = {} as ManualOffsetDragMember;
const harnesses: Array<{
  gestureRef: { current: unknown };
  groupGestureRef?: { current: unknown };
}> = [];

function realMember(key: string) {
  const element = document.createElement("div");
  document.body.append(element);
  const selection = {
    element,
    capabilities: { canApplyManualOffset: true },
  } as unknown as DomEditSelection;
  const rect = { left: 10, top: 20, width: 50, height: 40, editScaleX: 1, editScaleY: 1 };
  const built = createManualOffsetDragMember({ key, selection, element, rect, gesture: "drag" });
  if (!built.ok) throw new Error(built.reason);
  return { member: built.member, selection, element, rect };
}

const snapTargetAt42 = {
  snapEnabled: true,
  targets: [{ id: "t", left: 42, top: 200, right: 92, bottom: 300, centerX: 67, centerY: 250 }],
  compositionTarget: null,
  gridEdges: null,
};

function sealedDrag(kind: GestureState["kind"] = "drag") {
  const opts = {
    gestureRef: {
      current: {
        kind,
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
        ...{ centerX: 0, centerY: 100, actualWidth: 50, actualHeight: 40, plainRotation: null },
        ...{ editScaleX: 1, editScaleY: 1, actualRotation: 0 },
        pathOffsetMember: member,
      } as Partial<GestureState> | null,
    },
    groupGestureRef: { current: null as GroupGestureState | null },
    iframeRef: { current: document.createElement("iframe") },
    selectionRef: { current: null },
    hoverSelectionRef: { current: null },
    boxRef: { current: null },
    handlesRef: { current: null },
    blockedMoveRef: { current: null },
    waitingPressRef: { current: null },
    rafPausedRef: { current: true },
    suppressNextBoxClickRef: { current: false },
    snapGuidesRef: { current: null },
    setOverlayRect: vi.fn(),
    setGroupOverlayItems: vi.fn(),
    overlayRef: { current: null },
    onCanvasMouseDown: vi.fn(),
    onCanvasPointerMoveRef: { current: vi.fn() },
    onPathOffsetCommitRef: { current: vi.fn() },
    onGroupPathOffsetCommitRef: { current: vi.fn() },
  };
  harnesses.push(opts);
  const handlers = createDomEditOverlayGestureHandlers(opts as never);
  armSealedRawSteps(opts as never);
  return { opts, handlers };
}

const pointer = (clientX: number, clientY: number, buttons = 1) =>
  ({ clientX, clientY, shiftKey: false, altKey: false, pointerId: 1, buttons }) as never;
const rawUpdate = (clientX: number, clientY: number) =>
  window.dispatchEvent(
    new PointerEvent("pointerrawupdate", { clientX, clientY, pointerId: 1, buttons: 1 }),
  );

afterEach(() => {
  for (const opts of harnesses.splice(0)) {
    opts.gestureRef.current = null;
    if (opts.groupGestureRef) opts.groupGestureRef.current = null;
  }
  rawUpdate(0, 0);
  vi.mocked(applyManualOffsetDragDraft).mockClear();
  vi.mocked(applyRotationDraft).mockClear();
  vi.mocked(applyStudioBoxSizeDraft).mockClear();
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

  // fails without the fix: raw stepping was armed by the first pointermove, so that step went out late.
  it("draws the first step from the raw update, before any pointermove", () => {
    const element = document.createElement("div");
    const ref = <T>(current: T) => ({ current });
    const opts = {
      selectionRef: ref({ element, capabilities: { canApplyManualOffset: true } }),
      overlayRectRef: ref({
        left: 0,
        top: 0,
        width: 240,
        height: 160,
        editScaleX: 1,
        editScaleY: 1,
      }),
      ...{
        boxRef: ref(null),
        overlayRef: ref(null),
        iframeRef: ref(document.createElement("iframe")),
      },
      ...{ gestureRef: ref(null), groupGestureRef: ref(null), rafPausedRef: ref(false) },
      ...{ snapGuidesRef: ref(null), blockedMoveRef: ref(null), waitingPressRef: ref(null) },
      ...{ onManualDragStartRef: ref(vi.fn()), setOverlayRect: vi.fn() },
    };
    harnesses.push(opts as never);
    const press = { clientX: 10, clientY: 10, pointerId: 1, button: 0 };
    const started = startGesture(
      "drag",
      {
        ...press,
        preventDefault() {},
        stopPropagation() {},
        currentTarget: { setPointerCapture() {} },
      } as never,
      opts as never,
    );
    expect(started).toBe(true);
    vi.mocked(applyManualOffsetDragDraft).mockClear();
    rawUpdate(30, 14);
    expect(applyManualOffsetDragDraft).toHaveBeenCalledWith(
      (opts.gestureRef.current as GestureState | null)?.pathOffsetMember,
      20,
      4,
    );
  });

  // fails without the fix: a group press armed nothing, so its first step waited for pointermove.
  it("draws a group's first step from the raw update, before any pointermove", () => {
    const ref = <T>(current: T) => ({ current });
    const items = [0, 1].map((i) => {
      const element = document.createElement("div");
      document.body.append(element);
      const selection = { element, capabilities: { canApplyManualOffset: true } };
      const rect = { left: 0, top: 0, width: 240, height: 160, editScaleX: 1, editScaleY: 1 };
      return { key: `m${i}`, selection, element, rect };
    });
    const opts = {
      ...{ groupOverlayItemsRef: ref(items), overlayRef: ref(null), boxRef: ref(null) },
      ...{ iframeRef: ref(document.createElement("iframe")), selectionRef: ref(null) },
      ...{ gestureRef: ref(null), groupGestureRef: ref(null), rafPausedRef: ref(false) },
      ...{ snapGuidesRef: ref(null), blockedMoveRef: ref(null), waitingPressRef: ref(null) },
      ...{ onManualDragStartRef: ref(vi.fn()), onBlockedMoveRef: ref(vi.fn()) },
    };
    harnesses.push(opts as never);
    const press = { clientX: 10, clientY: 10, pointerId: 1, button: 0 };
    const started = startGroupDrag(
      {
        ...press,
        preventDefault() {},
        stopPropagation() {},
        currentTarget: { setPointerCapture() {} },
      } as never,
      opts as never,
    );
    expect(started).toBe(true);
    const members = (opts.groupGestureRef.current as { members: unknown[] } | null)?.members;
    vi.mocked(applyManualOffsetDragDraft).mockClear();
    rawUpdate(30, 14);
    expect(vi.mocked(applyManualOffsetDragDraft).mock.calls).toEqual(
      members?.map((member) => [member, 20, 4]),
    );
    opts.groupGestureRef.current = null;
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

describe("every sealed gesture draws its step from the raw pointer update", () => {
  // fails without the fix: only a single layer's move drew from the raw update.
  it("a group move draws every member", () => {
    const { opts, handlers } = sealedDrag();
    const members = ["a", "b"].map((key) => ({ key, element: document.createElement("div") }));
    opts.gestureRef.current = null;
    (opts.groupGestureRef as { current: unknown }).current = {
      ...{ pointerId: 1, startX: 100, startY: 100 },
      ...{ originItems: [], members },
    };
    handlers.onPointerMove(pointer(110, 100));
    vi.mocked(applyManualOffsetDragDraft).mockClear();
    rawUpdate(130, 104);
    expect(vi.mocked(applyManualOffsetDragDraft).mock.calls).toEqual([
      [members[0], 30, 4],
      [members[1], 30, 4],
    ]);
    (opts.groupGestureRef as { current: unknown }).current = null;
  });

  // fails without the fix
  it("a rotation draws its angle", () => {
    const { handlers } = sealedDrag("rotate");
    handlers.onPointerMove(pointer(110, 100));
    vi.mocked(applyRotationDraft).mockClear();
    rawUpdate(0, 200);
    expect(applyRotationDraft).toHaveBeenCalledWith(expect.anything(), 90, null);
  });

  // fails without the fix
  it("a resize draws its size", () => {
    const { handlers } = sealedDrag("resize");
    handlers.onPointerMove(pointer(110, 100));
    vi.mocked(applyStudioBoxSizeDraft).mockClear();
    rawUpdate(130, 104);
    expect(applyStudioBoxSizeDraft).toHaveBeenCalledTimes(1);
  });
});

describe("a sealed gesture's end", () => {
  /** The gesture each flush saw: it must already be gone, or the port still finds it held. */
  function flushesSeeing(opts: { gestureRef: { current: Partial<GestureState> | null } }) {
    opts.gestureRef.current = { ...opts.gestureRef.current, selection: undefined };
    const seen: unknown[] = [];
    vi.mocked(releaseEndedGestureHolds).mockReset();
    vi.mocked(releaseEndedGestureHolds).mockImplementation(() =>
      seen.push(opts.gestureRef.current),
    );
    return seen;
  }

  it("lets the display reads it held go when the drag is let go", () => {
    const { opts, handlers } = sealedDrag();
    const seen = flushesSeeing(opts);
    handlers.onPointerUp(pointer(110, 100));
    expect(seen).toEqual([null]);
  });

  it("lets them go when the drag is cancelled", () => {
    const { opts, handlers } = sealedDrag();
    const seen = flushesSeeing(opts);
    handlers.clearPointerState(opts.selectionRef as never);
    expect(seen).toEqual([null]);
  });
});

function singleSnappedDrag() {
  const item = realMember("single");
  const { opts, handlers } = sealedDrag();
  opts.gestureRef.current = {
    ...opts.gestureRef.current,
    selection: item.selection,
    pathOffsetMember: item.member,
    initialPathOffset: item.member.initialPathOffset,
    manualEditDragToken: item.member.gestureToken,
    snapContext: snapTargetAt42 as never,
  };
  return { opts, handlers, item };
}

function groupSnappedDrag() {
  const items = [realMember("a"), realMember("b")];
  const { opts, handlers } = sealedDrag();
  opts.gestureRef.current = null;
  opts.groupGestureRef.current = {
    pointerId: 1,
    startX: 100,
    startY: 100,
    originItems: items.map((i, idx) => ({
      key: i.member.key,
      selection: i.selection,
      element: i.element,
      rect: { ...i.rect, top: 20 + idx * 50 },
    })),
    members: items.map((i) => i.member),
    snapContext: snapTargetAt42 as never,
  };
  return { opts, handlers, items };
}

describe("releasing right after a raw update commits what the raw update drew", () => {
  it("single move commits the raw snapped delta instead of the earlier pointermove", () => {
    const { opts, handlers, item } = singleSnappedDrag();
    handlers.onPointerMove(pointer(110, 100));
    rawUpdate(130, 104);
    expect(applyManualOffsetDragDraft).toHaveBeenLastCalledWith(item.member, 32, 4);
    handlers.onPointerUp(pointer(130, 104, 0));
    expect(opts.onPathOffsetCommitRef.current).toHaveBeenCalledWith(
      item.selection,
      { x: 32, y: 4 },
      expect.anything(),
    );
    expect(opts.setOverlayRect).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: 42, top: 24 }),
    );
  });

  it("single move with no prior pointermove commits the raw snapped delta, not the unsnapped pointer", () => {
    const { opts, handlers, item } = singleSnappedDrag();
    rawUpdate(130, 104);
    expect(applyManualOffsetDragDraft).toHaveBeenLastCalledWith(item.member, 32, 4);
    handlers.onPointerUp(pointer(130, 104, 0));
    expect(opts.onPathOffsetCommitRef.current).toHaveBeenCalledWith(
      item.selection,
      { x: 32, y: 4 },
      expect.anything(),
    );
  });

  it("group move commits the raw snapped delta instead of the earlier pointermove", () => {
    const { opts, handlers, items } = groupSnappedDrag();
    handlers.onPointerMove(pointer(110, 100));
    rawUpdate(130, 104);
    handlers.onPointerUp(pointer(130, 104, 0));
    expect(opts.onGroupPathOffsetCommitRef.current).toHaveBeenCalledWith(
      items.map((i) => expect.objectContaining({ selection: i.selection, next: { x: 32, y: 4 } })),
    );
  });

  it("group move with no prior pointermove commits the raw snapped delta, not the unsnapped pointer", () => {
    const { opts, handlers, items } = groupSnappedDrag();
    rawUpdate(130, 104);
    handlers.onPointerUp(pointer(130, 104, 0));
    expect(opts.onGroupPathOffsetCommitRef.current).toHaveBeenCalledWith(
      items.map((i) => expect.objectContaining({ selection: i.selection, next: { x: 32, y: 4 } })),
    );
  });

  it("a drag that travelled on raw updates and returned near start still commits instead of tapping", () => {
    const { opts, handlers, item } = singleSnappedDrag();
    rawUpdate(130, 100);
    rawUpdate(101, 100);
    handlers.onPointerUp(pointer(101, 100, 0));
    expect(opts.onCanvasMouseDown).not.toHaveBeenCalled();
    expect(opts.onPathOffsetCommitRef.current).toHaveBeenCalledWith(
      item.selection,
      { x: 1, y: 0 },
      expect.anything(),
    );
  });
});
