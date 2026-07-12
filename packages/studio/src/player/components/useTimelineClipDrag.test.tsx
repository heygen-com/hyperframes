// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { usePlayerStore } from "../store/playerStore";
import { TRACK_H } from "./timelineLayout";
import { buildStackingTimelineLayers } from "./timelineTrackOrder";
import type { DraggedClipState, ResizingClipState } from "./useTimelineClipDrag";
import { useTimelineClipDrag } from "./useTimelineClipDrag";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function timelineElement(input: {
  id: string;
  tag?: string;
  track: number;
  zIndex: number;
  start?: number;
  duration?: number;
  sourceDuration?: number;
  playbackStart?: number;
  playbackRate?: number;
  timelineLocked?: boolean;
}): TimelineElement {
  return {
    id: input.id,
    domId: input.id,
    tag: input.tag ?? "div",
    start: input.start ?? 0,
    duration: input.duration ?? 2,
    sourceDuration: input.sourceDuration,
    playbackStart: input.playbackStart,
    playbackRate: input.playbackRate,
    track: input.track,
    zIndex: input.zIndex,
    stackingContextId: "root",
    parentCompositionId: null,
    compositionAncestors: ["root"],
    sourceFile: "index.html",
    timingSource: "authored",
    timelineLocked: input.timelineLocked,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.getState().reset();
});

function renderDragHarness(elements: TimelineElement[]) {
  usePlayerStore.getState().setElements(elements);
  const layers = buildStackingTimelineLayers(elements).rows;
  const scroll = document.createElement("div");
  document.body.append(scroll);
  const onMoveElement = vi.fn();
  const onResizeElement = vi.fn();
  const onMoveElements = vi.fn();
  const onResizeElements = vi.fn();
  const onPreviewMoveElements = vi.fn();
  const onPreviewResizeElements = vi.fn();
  let setDraggedClip: ((state: DraggedClipState | null) => void) | null = null;
  let setResizingClip: ((state: ResizingClipState | null) => void) | null = null;

  function Harness() {
    const hook = useTimelineClipDrag({
      scrollRef: { current: scroll },
      ppsRef: { current: 100 },
      trackOrderRef: { current: layers.map((layer) => layer.id) },
      timelineLayersRef: { current: layers },
      timelineElementsRef: { current: elements },
      onMoveElement,
      onResizeElement,
      onMoveElements,
      onResizeElements,
      onPreviewMoveElements,
      onPreviewResizeElements,
      onBlockedEditAttempt: vi.fn(),
      setShowPopover: vi.fn(),
      setRangeSelectionRef: { current: vi.fn() },
    });
    setDraggedClip = hook.setDraggedClip;
    setResizingClip = hook.setResizingClip;
    return null;
  }

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(<Harness />);
  });
  if (!setDraggedClip) throw new Error("Expected drag setter");
  if (!setResizingClip) throw new Error("Expected resize setter");
  const applyDraggedClip: (state: DraggedClipState | null) => void = setDraggedClip;
  const applyResizingClip: (state: ResizingClipState | null) => void = setResizingClip;

  return {
    layers,
    onMoveElement,
    onResizeElement,
    onMoveElements,
    onResizeElements,
    onPreviewMoveElements,
    onPreviewResizeElements,
    storeElements() {
      return usePlayerStore.getState().elements;
    },
    startDrag(element: TimelineElement, layerIndex: number) {
      const layer =
        layers[layerIndex] ??
        layers.find((candidate) =>
          candidate.elements.some((candidateElement) => candidateElement.id === element.id),
        ) ??
        layers[0]!;
      act(() => {
        applyDraggedClip({
          element,
          originClientX: 0,
          originClientY: 0,
          originScrollLeft: 0,
          originScrollTop: 0,
          pointerClientX: 0,
          pointerClientY: 0,
          pointerOffsetX: 0,
          pointerOffsetY: 0,
          previewStart: element.start,
          previewTrack: element.track,
          previewLayerId: layer.id,
          previewLayerIndex: layerIndex,
          previewStackingReorder: null,
          snapBeatTime: null,
          snapGuideTime: null,
          snapGuideKind: null,
          started: false,
        });
      });
    },
    startResize(element: TimelineElement, edge: "start" | "end") {
      act(() => {
        applyResizingClip({
          element,
          edge,
          originClientX: 0,
          previewStart: element.start,
          previewDuration: element.duration,
          previewPlaybackStart: element.playbackStart,
          snapGuideTime: null,
          snapGuideKind: null,
          started: false,
        });
      });
    },
    movePointer(clientX: number, clientY: number) {
      act(() => {
        window.dispatchEvent(
          new MouseEvent("pointermove", {
            bubbles: true,
            clientX,
            clientY,
          }),
        );
      });
    },
    async dropPointer() {
      await act(async () => {
        window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
      });
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

describe("useTimelineClipDrag", () => {
  it("allows moving a clip past the current composition duration", async () => {
    const clip = timelineElement({ id: "clip", track: 0, zIndex: 1 });
    const harness = renderDragHarness([clip]);

    harness.startDrag(clip, 0);
    harness.movePointer(1100, 0);
    await harness.dropPointer();

    expect(harness.onMoveElement).toHaveBeenCalledWith(
      clip,
      expect.objectContaining({ start: 11 }),
    );

    harness.unmount();
  });

  it("moves every selected clip body by the same delta", async () => {
    const first = timelineElement({ id: "first", track: 0, zIndex: 1, start: 1, duration: 2 });
    const second = timelineElement({ id: "second", track: 1, zIndex: 1, start: 4, duration: 2 });
    const harness = renderDragHarness([first, second]);
    act(() => {
      usePlayerStore.getState().setSelection(["first", "second"], "first");
    });

    harness.startDrag(first, 0);
    harness.movePointer(200, 0);

    expect(harness.storeElements().map((element) => [element.id, element.start])).toEqual([
      ["first", 3],
      ["second", 6],
    ]);
    expect(harness.onPreviewMoveElements).toHaveBeenLastCalledWith([
      { element: first, start: 3 },
      { element: second, start: 6 },
    ]);

    await harness.dropPointer();

    expect(harness.onMoveElement).not.toHaveBeenCalled();
    expect(harness.onMoveElements).toHaveBeenCalledTimes(1);
    expect(harness.onMoveElements).toHaveBeenCalledWith([
      { element: first, start: 3 },
      { element: second, start: 6 },
    ]);

    harness.unmount();
  });

  it("clamps a selected group move when the earliest member reaches zero", async () => {
    const early = timelineElement({ id: "early", track: 0, zIndex: 1, start: 1, duration: 2 });
    const grabbed = timelineElement({ id: "grabbed", track: 1, zIndex: 1, start: 4, duration: 2 });
    const harness = renderDragHarness([early, grabbed]);
    act(() => {
      usePlayerStore.getState().setSelection(["early", "grabbed"], "grabbed");
    });

    harness.startDrag(grabbed, 1);
    harness.movePointer(-300, 0);
    await harness.dropPointer();

    expect(harness.onMoveElements).toHaveBeenCalledWith([
      { element: early, start: 0 },
      { element: grabbed, start: 3 },
    ]);
    expect(harness.onMoveElement).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("keeps body drag single-clip when the grabbed clip is not in the multi-selection", async () => {
    const first = timelineElement({ id: "first", track: 0, zIndex: 1, start: 1, duration: 2 });
    const second = timelineElement({ id: "second", track: 1, zIndex: 1, start: 4, duration: 2 });
    const outside = timelineElement({ id: "outside", track: 2, zIndex: 1, start: 7, duration: 2 });
    const harness = renderDragHarness([first, second, outside]);
    act(() => {
      usePlayerStore.getState().setSelection(["first", "second"], "first");
    });

    harness.startDrag(outside, 2);
    harness.movePointer(200, 0);
    await harness.dropPointer();

    expect(harness.onMoveElements).not.toHaveBeenCalled();
    expect(harness.onMoveElement).toHaveBeenCalledTimes(1);
    expect(harness.onMoveElement).toHaveBeenCalledWith(
      outside,
      expect.objectContaining({ start: 9 }),
    );

    harness.unmount();
  });

  it("does not form a group when a selected member is locked (grabbed clip moves alone)", async () => {
    const first = timelineElement({ id: "first", track: 0, zIndex: 1, start: 1, duration: 2 });
    const locked = timelineElement({
      id: "locked",
      track: 1,
      zIndex: 1,
      start: 4,
      duration: 2,
      timelineLocked: true,
    });
    const harness = renderDragHarness([first, locked]);
    act(() => {
      usePlayerStore.getState().setSelection(["first", "locked"], "first");
    });

    harness.startDrag(first, 0);
    harness.movePointer(200, 0);
    await harness.dropPointer();

    // The locked member forbids the op, so no group forms: the grabbed clip moves
    // alone (single-clip path) and the locked clip is never touched.
    expect(harness.onMoveElements).not.toHaveBeenCalled();
    expect(harness.onMoveElement).toHaveBeenCalledTimes(1);
    expect(harness.onMoveElement).toHaveBeenCalledWith(
      first,
      expect.objectContaining({ start: 3 }),
    );
    expect(harness.storeElements().find((el) => el.id === "locked")?.start).toBe(4);

    harness.unmount();
  });

  it("allows right-edge resize past the current composition duration", async () => {
    const clip = timelineElement({ id: "clip", track: 0, zIndex: 1, start: 6, duration: 2 });
    const harness = renderDragHarness([clip]);

    harness.startResize(clip, "end");
    harness.movePointer(400, 0);
    await harness.dropPointer();

    expect(harness.onResizeElement).toHaveBeenCalledWith(
      clip,
      expect.objectContaining({ start: 6, duration: 6 }),
    );

    harness.unmount();
  });

  it("resizes every selected start edge by the same delta", async () => {
    const first = timelineElement({ id: "first", track: 0, zIndex: 1, start: 1, duration: 4 });
    const second = timelineElement({ id: "second", track: 1, zIndex: 1, start: 5, duration: 3 });
    const harness = renderDragHarness([first, second]);
    act(() => {
      usePlayerStore.getState().setSelection(["first", "second"], "first");
    });

    harness.startResize(first, "start");
    harness.movePointer(100, 0);

    expect(
      harness.storeElements().map((element) => [element.id, element.start, element.duration]),
    ).toEqual([
      ["first", 2, 3],
      ["second", 6, 2],
    ]);
    expect(harness.onPreviewResizeElements).toHaveBeenLastCalledWith([
      { element: first, start: 2, duration: 3, playbackStart: undefined },
      { element: second, start: 6, duration: 2, playbackStart: undefined },
    ]);

    await harness.dropPointer();

    expect(harness.onResizeElement).not.toHaveBeenCalled();
    expect(harness.onResizeElements).toHaveBeenCalledTimes(1);
    expect(harness.onResizeElements).toHaveBeenCalledWith([
      { element: first, start: 2, duration: 3, playbackStart: undefined },
      { element: second, start: 6, duration: 2, playbackStart: undefined },
    ]);

    harness.unmount();
  });

  it("resizes every selected end edge by the same delta", async () => {
    const first = timelineElement({ id: "first", track: 0, zIndex: 1, start: 1, duration: 4 });
    const second = timelineElement({ id: "second", track: 1, zIndex: 1, start: 5, duration: 3 });
    const harness = renderDragHarness([first, second]);
    act(() => {
      usePlayerStore.getState().setSelection(["first", "second"], "first");
    });

    harness.startResize(first, "end");
    harness.movePointer(100, 0);
    await harness.dropPointer();

    expect(harness.onResizeElement).not.toHaveBeenCalled();
    expect(harness.onResizeElements).toHaveBeenCalledWith([
      { element: first, start: 1, duration: 5, playbackStart: undefined },
      { element: second, start: 5, duration: 4, playbackStart: undefined },
    ]);

    harness.unmount();
  });

  it("clamps selected start-edge resize at the most constrained duration", async () => {
    const short = timelineElement({ id: "short", track: 0, zIndex: 1, start: 1, duration: 0.5 });
    const long = timelineElement({ id: "long", track: 1, zIndex: 1, start: 4, duration: 2 });
    const harness = renderDragHarness([short, long]);
    act(() => {
      usePlayerStore.getState().setSelection(["short", "long"], "short");
    });

    harness.startResize(short, "start");
    harness.movePointer(100, 0);
    await harness.dropPointer();

    expect(harness.onResizeElements).toHaveBeenCalledWith([
      { element: short, start: 1.4, duration: 0.1, playbackStart: undefined },
      { element: long, start: 4.4, duration: 1.6, playbackStart: undefined },
    ]);
    expect(harness.onResizeElement).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("adjusts every selected media playback start during start-edge resize", async () => {
    const audio = timelineElement({
      id: "audio",
      tag: "audio",
      track: 0,
      zIndex: 1,
      start: 2,
      duration: 3,
      playbackStart: 1,
      playbackRate: 1,
    });
    const video = timelineElement({
      id: "video",
      tag: "video",
      track: 1,
      zIndex: 1,
      start: 5,
      duration: 4,
      playbackStart: 2,
      playbackRate: 2,
    });
    const harness = renderDragHarness([audio, video]);
    act(() => {
      usePlayerStore.getState().setSelection(["audio", "video"], "audio");
    });

    harness.startResize(audio, "start");
    harness.movePointer(50, 0);
    await harness.dropPointer();

    expect(harness.onResizeElements).toHaveBeenCalledWith([
      { element: audio, start: 2.5, duration: 2.5, playbackStart: 1.5 },
      { element: video, start: 5.5, duration: 3.5, playbackStart: 3 },
    ]);

    harness.unmount();
  });

  it("keeps handle resize single-clip when the grabbed clip is not in the multi-selection", async () => {
    const first = timelineElement({ id: "first", track: 0, zIndex: 1, start: 1, duration: 2 });
    const second = timelineElement({ id: "second", track: 1, zIndex: 1, start: 4, duration: 2 });
    const outside = timelineElement({ id: "outside", track: 2, zIndex: 1, start: 7, duration: 2 });
    const harness = renderDragHarness([first, second, outside]);
    act(() => {
      usePlayerStore.getState().setSelection(["first", "second"], "first");
    });

    harness.startResize(outside, "end");
    harness.movePointer(100, 0);
    await harness.dropPointer();

    expect(harness.onResizeElement).toHaveBeenCalledTimes(1);
    expect(harness.onResizeElement).toHaveBeenCalledWith(
      outside,
      expect.objectContaining({ start: 7, duration: 3 }),
    );

    harness.unmount();
  });

  it("passes a new-lane stacking intent when a vertical drag targets an overlapping lane", async () => {
    const front = timelineElement({ id: "front", track: 0, zIndex: 3 });
    const middle = timelineElement({ id: "middle", track: 1, zIndex: 2 });
    const back = timelineElement({ id: "back", track: 2, zIndex: 1 });
    const harness = renderDragHarness([front, middle, back]);

    harness.startDrag(back, 2);
    harness.movePointer(0, -2 * TRACK_H);
    await harness.dropPointer();

    expect(harness.onMoveElement).toHaveBeenCalledTimes(1);
    expect(harness.onMoveElement.mock.calls[0]![1]).toMatchObject({
      start: 0,
      track: 2,
      stackingReorder: {
        contextKey: "root",
        placement: { type: "above", layerId: harness.layers[0]!.id },
        zIndexChanges: [{ key: "back", zIndex: 4 }],
      },
    });

    harness.unmount();
  });

  it("resolves lane stacking from the authored time span, independent of horizontal drag", async () => {
    const front = timelineElement({ id: "front", track: 0, zIndex: 3 });
    const back = timelineElement({ id: "back", track: 1, zIndex: 1 });
    back.start = 0;
    front.start = 0;
    const harness = renderDragHarness([front, back]);

    // Drag up one row AND rightward in time. The horizontal drift moves the
    // clip out of overlap, but the two axes never fight: the vertical restack
    // is resolved from the authored (overlapping) span, so it still inserts
    // above the target lane rather than silently joining it.
    harness.startDrag(back, 1);
    harness.movePointer(200, -TRACK_H);
    await harness.dropPointer();

    expect(harness.onMoveElement).toHaveBeenCalledTimes(1);
    expect(harness.onMoveElement.mock.calls[0]![1]).toMatchObject({
      start: 2,
      track: 1,
      stackingReorder: {
        contextKey: "root",
        placement: { type: "above", layerId: harness.layers[0]!.id },
        zIndexChanges: [{ key: "back", zIndex: 4 }],
      },
    });

    harness.unmount();
  });
});
