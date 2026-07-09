// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type React from "react";
import { createDomEditOverlayGestureHandlers } from "./useDomEditOverlayGestures";
import type { DomEditSelection } from "./domEditing";
import type { GestureState, UseDomEditOverlayGesturesOptions } from "./domEditOverlayGestures";
import type { SnapContext } from "./snapTargetCollection";

function ref<T>(current: T): { current: T } {
  return { current };
}

function makeSelection(element: HTMLElement): DomEditSelection {
  return {
    element,
    capabilities: {},
  } as DomEditSelection;
}

function makeGesture(selection: DomEditSelection, snapContext: SnapContext): GestureState {
  return {
    kind: "drag",
    mode: "path-offset",
    selection,
    startX: 0,
    startY: 0,
    centerX: 0,
    centerY: 0,
    initialPathOffset: { x: 0, y: 0 },
    initialRotation: { angle: 0 },
    initialBoxSize: { width: 20, height: 20 },
    originLeft: 10,
    originTop: 10,
    originWidth: 20,
    originHeight: 20,
    actualWidth: 20,
    actualHeight: 20,
    actualRotation: 0,
    editScaleX: 1,
    editScaleY: 1,
    snapContext,
  } as GestureState;
}

function makeOptions(gesture: GestureState): {
  opts: UseDomEditOverlayGesturesOptions;
  setOverlayRect: ReturnType<typeof vi.fn>;
} {
  const setOverlayRect = vi.fn();
  const element = gesture.selection.element;
  const opts = {
    overlayRef: ref(null),
    iframeRef: ref(null),
    boxRef: ref(null),
    selectionRef: ref(gesture.selection),
    hoverSelectionRef: ref(null),
    overlayRectRef: ref(null),
    groupOverlayItemsRef: ref([]),
    gestureRef: ref(gesture),
    groupGestureRef: ref(null),
    blockedMoveRef: ref(null),
    rafPausedRef: ref(false),
    suppressNextBoxClickRef: ref(false),
    setOverlayRect,
    setGroupOverlayItems: vi.fn(),
    onBlockedMoveRef: ref(vi.fn()),
    onManualDragStartRef: ref(undefined),
    onPathOffsetCommitRef: ref(vi.fn()),
    onGroupPathOffsetCommitRef: ref(vi.fn()),
    onBoxSizeCommitRef: ref(vi.fn()),
    onRotationCommitRef: ref(vi.fn()),
    onCanvasPointerMoveRef: ref(vi.fn()),
    onCanvasMouseDown: vi.fn(),
    snapGuidesRef: ref(null),
  } as unknown as UseDomEditOverlayGesturesOptions;

  element.getBoundingClientRect = () => new DOMRect(10, 10, 20, 20);
  return { opts, setOverlayRect };
}

describe("createDomEditOverlayGestureHandlers", () => {
  it("snaps to composition bounds even when there are no element targets", () => {
    const element = document.createElement("div");
    const selection = makeSelection(element);
    const gesture = makeGesture(selection, {
      targets: [],
      compositionTarget: {
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
        centerX: 50,
        centerY: 50,
        id: "composition",
      },
      gridEdges: null,
      snapEnabled: true,
    });
    const { opts, setOverlayRect } = makeOptions(gesture);
    const handlers = createDomEditOverlayGestureHandlers(opts);

    handlers.onPointerMove({
      clientX: 29,
      clientY: 0,
      altKey: false,
    } as React.PointerEvent<HTMLDivElement>);

    expect(gesture.lastSnappedDx).toBe(30);
    expect(setOverlayRect).toHaveBeenCalledWith(expect.objectContaining({ left: 40, top: 10 }));
    expect(opts.snapGuidesRef.current?.guides[0]).toMatchObject({
      axis: "x",
      position: 50,
    });
  });

  it("snaps to grid edges even when there are no element targets", () => {
    const element = document.createElement("div");
    const selection = makeSelection(element);
    const gesture = makeGesture(selection, {
      targets: [],
      compositionTarget: null,
      gridEdges: {
        x: [{ position: 50, source: "grid", id: "grid-x-0" }],
        y: [],
      },
      snapEnabled: true,
    });
    const { opts, setOverlayRect } = makeOptions(gesture);
    const handlers = createDomEditOverlayGestureHandlers(opts);

    handlers.onPointerMove({
      clientX: 17,
      clientY: 0,
      altKey: false,
    } as React.PointerEvent<HTMLDivElement>);

    expect(gesture.lastSnappedDx).toBe(20);
    expect(setOverlayRect).toHaveBeenCalledWith(expect.objectContaining({ left: 30, top: 10 }));
    expect(opts.snapGuidesRef.current?.guides[0]).toMatchObject({
      axis: "x",
      position: 50,
    });
  });
});
