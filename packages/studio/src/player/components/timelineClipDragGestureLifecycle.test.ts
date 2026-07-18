// @vitest-environment happy-dom

import type { SetStateAction } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { mountTimelineClipDragGestureLifecycle } from "./timelineClipDragGestureLifecycle";
import type { DraggedClipState, ResizingClipState } from "./timelineClipDragTypes";

afterEach(() => {
  document.body.replaceChildren();
  usePlayerStore.getState().reset();
});

describe("timeline clip drag gesture lifecycle", () => {
  it("finishes a drag after virtualization unmounts its source row", () => {
    const element: TimelineElement = {
      id: "clip-1",
      tag: "div",
      start: 0,
      duration: 2,
      track: 0,
    };
    const drag: DraggedClipState = {
      pointerId: 0,
      element,
      originClientX: 0,
      originClientY: 0,
      originScrollLeft: 0,
      originScrollTop: 0,
      pointerClientX: 0,
      pointerClientY: 0,
      pointerOffsetX: 0,
      pointerOffsetY: 0,
      previewStart: 1,
      previewTrack: 0,
      desiredTrack: 0,
      insertRow: null,
      snapTime: null,
      snapType: null,
      started: true,
    };
    const draggedClipRef = { current: drag as DraggedClipState | null };
    const resizingClipRef = { current: null as ResizingClipState | null };
    const setDraggedClip = (next: SetStateAction<DraggedClipState | null>) => {
      draggedClipRef.current = typeof next === "function" ? next(draggedClipRef.current) : next;
    };
    const updateDraggedClipPreview = vi.fn((previous: DraggedClipState) => ({
      ...previous,
      previewStart: 3,
    }));
    const onMoveElement = vi.fn();
    const stopAutoScroll = vi.fn();
    const cancelGestureRef = { current: () => false };
    const dispose = mountTimelineClipDragGestureLifecycle({
      lifecycleRef: {
        current: {
          kind: "drag",
          phase: "active",
          pointerId: null,
          sessionEpoch: 0,
        },
      },
      sessionEpochRef: { current: 0 },
      cancelGestureRef,
      scrollRef: { current: null },
      draggedClipRef,
      resizingClipRef,
      blockedClipRef: { current: null },
      groupResizeRef: { current: null },
      suppressClickRef: { current: false },
      gestureSelectedKeysRef: { current: new Set() },
      elementsRef: { current: [element] },
      trackOrderRef: { current: [0] },
      setDraggedClipState: setDraggedClip,
      setResizingClipState: () => {},
      setShowPopover: () => {},
      setRangeSelectionRef: { current: null },
      applyResizePointerRef: { current: () => {} },
      syncClipDragAutoScrollRef: { current: () => {} },
      stopClipDragAutoScrollRef: { current: stopAutoScroll },
      updateDraggedClipPreviewRef: { current: updateDraggedClipPreview },
      publishDraggedClip: setDraggedClip,
      updateElement: vi.fn(),
      onMoveElementRef: { current: onMoveElement },
      onMoveElementsRef: { current: undefined },
      onResizeElementRef: { current: undefined },
      onResizeElementsRef: { current: undefined },
      onBlockedEditAttemptRef: { current: undefined },
      readZIndexRef: { current: undefined },
      onStackingPatchesRef: { current: undefined },
      refreshAfterLaneMoveRef: { current: undefined },
    });

    const sourceRow = document.createElement("div");
    sourceRow.dataset.timelineRow = "";
    sourceRow.append(document.createElement("div"));
    document.body.append(sourceRow);
    sourceRow.remove();

    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 20, clientY: 10 }));
    expect(updateDraggedClipPreview).toHaveBeenCalledTimes(1);
    expect(draggedClipRef.current?.previewStart).toBe(3);

    window.dispatchEvent(new MouseEvent("pointerup"));
    expect(onMoveElement).toHaveBeenCalledWith(element, { start: 3, track: 0 });
    expect(draggedClipRef.current).toBeNull();
    expect(stopAutoScroll).toHaveBeenCalledTimes(1);

    dispose();
    expect(cancelGestureRef.current()).toBe(false);
  });
});
