// @vitest-environment happy-dom
import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditing";
import type { GestureState, GroupGestureState } from "./domEditOverlayGestures";
import { DomEditGroupChrome, DomEditSelectionChrome } from "./DomEditSelectionChrome";
import { resolveSnapAdjustment } from "./snapEngine";
import { createDomEditOverlayGestureHandlers } from "./useDomEditOverlayGestures";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function gestureHarness(gesture: Partial<GestureState> | null, group: GroupGestureState | null) {
  const opts = {
    gestureRef: { current: gesture },
    groupGestureRef: { current: group },
    selectionRef: { current: null },
    hoverSelectionRef: { current: null },
    boxRef: { current: null },
    blockedMoveRef: { current: null },
    rafPausedRef: { current: false },
    suppressNextBoxClickRef: { current: false },
    snapGuidesRef: { current: null },
    setOverlayRect: vi.fn(),
    setGroupOverlayItems: vi.fn(),
    onCanvasMouseDown: vi.fn(),
    onCanvasPointerMoveRef: { current: vi.fn() },
  };
  const handlers = createDomEditOverlayGestureHandlers(opts as never);
  const pointer = (clientX: number, clientY: number, shiftKey: boolean) =>
    ({ clientX, clientY, shiftKey, altKey: false }) as never;
  return { opts, handlers, pointer };
}

function singleDrag() {
  const element = document.createElement("div");
  return gestureHarness(
    {
      kind: "drag",
      mode: "path-offset",
      selection: { element } as unknown as DomEditSelection,
      startX: 100,
      startY: 100,
      originLeft: 10,
      originTop: 20,
      originWidth: 50,
      originHeight: 40,
      editScaleX: 1,
      editScaleY: 1,
      actualRotation: 0,
    },
    null,
  );
}

const groupGesture = () =>
  ({ startX: 100, startY: 100, originItems: [], members: [] }) as unknown as GroupGestureState;

describe("shift+drag locks a move to the axis the pointer travels further on", () => {
  it("keeps a mostly horizontal single drag on its row", () => {
    const { opts, handlers, pointer } = singleDrag();
    handlers.onPointerMove(pointer(130, 108, true));
    expect(opts.setOverlayRect).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: 40, top: 20 }),
    );
  });

  it("keeps a mostly vertical single drag on its column", () => {
    const { opts, handlers, pointer } = singleDrag();
    handlers.onPointerMove(pointer(95, 160, true));
    expect(opts.setOverlayRect).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: 10, top: 80 }),
    );
  });

  it("frees the drag on the next move once shift is released, and locks again when pressed", () => {
    const { opts, handlers, pointer } = singleDrag();
    handlers.onPointerMove(pointer(130, 108, false));
    expect(opts.setOverlayRect).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: 40, top: 28 }),
    );
    handlers.onPointerMove(pointer(140, 110, true));
    expect(opts.setOverlayRect).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: 50, top: 20 }),
    );
  });

  it("locks a group drag the same way", () => {
    const group = groupGesture();
    const { handlers, pointer } = gestureHarness(null, group);
    handlers.onPointerMove(pointer(130, 108, true));
    expect([group.lastSnappedDx, group.lastSnappedDy]).toEqual([30, 0]);
  });

  it("snaps a locked drag only along its free axis", () => {
    const target = {
      id: "t",
      left: 0,
      top: 203,
      right: 400,
      bottom: 303,
      centerX: 200,
      centerY: 253,
    };
    const snap = (lockedAxis?: "x" | "y") =>
      resolveSnapAdjustment({
        movingRect: { left: 0, top: 0, width: 50, height: 200 },
        proposedDx: 97,
        proposedDy: 0,
        targets: [target],
        threshold: 6,
        disabled: false,
        lockedAxis,
      } as never);
    expect(snap().dy).toBe(3);
    const locked = snap("y");
    expect(locked.dy).toBe(0);
    expect(locked.guides.every((guide) => guide.axis === "x")).toBe(true);
  });
});

describe("shift+click on a selected group still toggles the member under the pointer", () => {
  it("hands a shift press that never travelled to the canvas as an additive click", () => {
    const { opts, handlers, pointer } = gestureHarness(null, groupGesture());
    handlers.onPointerUp(pointer(101, 100, true));
    expect(opts.onCanvasMouseDown).toHaveBeenCalledWith(
      expect.objectContaining({ shiftKey: true }),
      expect.objectContaining({ preferClipAncestor: false }),
    );
    expect(opts.suppressNextBoxClickRef.current).toBe(true);
  });

  it("leaves a plain press on the group box alone", () => {
    const { opts, handlers, pointer } = gestureHarness(null, groupGesture());
    handlers.onPointerUp(pointer(101, 100, false));
    expect(opts.onCanvasMouseDown).not.toHaveBeenCalled();
  });
});

describe("a shift press on a selected box starts the drag", () => {
  const rect = { left: 10, top: 10, width: 200, height: 100, editScaleX: 1, editScaleY: 1 };
  const gestures = () => ({
    startGesture: vi.fn(),
    startGroupDrag: vi.fn(),
    startBlockedMove: vi.fn(),
  });
  const shiftPress = (el: Element) =>
    act(() => {
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          shiftKey: true,
          pointerId: 1,
        }),
      );
    });

  function mount(node: (spies: ReturnType<typeof gestures>) => React.ReactNode) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const spies = gestures();
    act(() => root.render(node(spies)));
    const box = host.querySelector<HTMLElement>('[data-dom-edit-selection-box="true"]')!;
    return { spies, box, unmount: () => act(() => root.unmount()) };
  }

  const single = (canMove: boolean) =>
    mount((spies) => (
      <DomEditSelectionChrome
        selection={
          {
            element: document.createElement("div"),
            capabilities: { canApplyManualOffset: canMove },
          } as unknown as DomEditSelection
        }
        overlayRect={rect}
        allowCanvasMovement
        allowBodyDrag
        boxRef={createRef()}
        boxChromeClass=""
        boxClipPath={undefined}
        selectionKey="box"
        groupSelectionCount={0}
        gestures={spies as never}
        onBoxMouseDown={vi.fn()}
        onBoxClick={vi.fn()}
      />
    ));

  const group = (groupCanMove: boolean) =>
    mount((spies) => (
      <DomEditGroupChrome
        groupOverlayItems={[]}
        groupBounds={rect}
        allowCanvasMovement
        allowBodyDrag
        groupCanMove={groupCanMove}
        gestures={spies as never}
        onBoxMouseDown={vi.fn()}
        onBoxClick={vi.fn()}
      />
    ));

  it("drags a single selection", () => {
    const { spies, box, unmount } = single(true);
    shiftPress(box);
    expect(spies.startGesture).toHaveBeenCalledWith("drag", expect.anything());
    unmount();
  });

  it("drags a group selection", () => {
    const { spies, box, unmount } = group(true);
    shiftPress(box);
    expect(spies.startGroupDrag).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("leaves a shift press on a box that cannot move to the multi-select toggle", () => {
    const one = single(false);
    shiftPress(one.box);
    expect(one.spies.startBlockedMove).not.toHaveBeenCalled();
    one.unmount();
    const many = group(false);
    shiftPress(many.box);
    expect(many.spies.startGroupDrag).not.toHaveBeenCalled();
    many.unmount();
  });
});
