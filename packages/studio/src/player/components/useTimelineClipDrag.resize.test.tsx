// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { usePlayerStore } from "../store/playerStore";
import type { BlockedClipState, DraggedClipState, ResizingClipState } from "./useTimelineClipDrag";
import { useTimelineClipDrag } from "./useTimelineClipDrag";
import { mountReactHarness } from "../../hooks/domSelectionTestHarness";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function el(id: string, over: Partial<TimelineElement> = {}): TimelineElement {
  return {
    id,
    key: id,
    tag: "video",
    start: 0,
    duration: 2,
    track: 0,
    domId: id,
    ...over,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.getState().reset();
});

function renderResizeHarness(
  elements: TimelineElement[],
  selected: string[],
  options: {
    wireGroupResize?: boolean;
    snap?: boolean;
    onSeek?: (time: number, seekOptions?: { keepPlaying?: boolean }) => void;
  } = {},
) {
  usePlayerStore.getState().setElements(elements);
  usePlayerStore.setState({ timelineSnapEnabled: options.snap === true });
  usePlayerStore.getState().setSelectedElementIds(new Set(selected));

  const scroll = document.createElement("div");
  const setPointerCapture = vi.fn();
  scroll.setPointerCapture = setPointerCapture;
  document.body.append(scroll);
  const onResizeElement = vi.fn();
  const onMoveElement = vi.fn();
  const onBlockedEditAttempt = vi.fn();
  const onResizeElements = vi.fn().mockResolvedValue(undefined);
  let setResizingClip: ((s: ResizingClipState | null) => void) | null = null;
  let setDraggedClip: ((s: DraggedClipState | null) => void) | null = null;
  let resizingClip: ResizingClipState | null = null;
  let blockedClipRef: React.RefObject<BlockedClipState | null> | null = null;
  let epoch = 0;

  function Harness({ sessionEpoch }: { sessionEpoch: number }) {
    const hook = useTimelineClipDrag({
      scrollRef: { current: scroll },
      ppsRef: { current: 100 },
      durationRef: { current: 100 },
      trackOrderRef: { current: [0, 1] },
      onResizeElement,
      onMoveElement,
      onBlockedEditAttempt,
      onResizeElements: options.wireGroupResize === false ? undefined : onResizeElements,
      onSeek: options.onSeek,
      setShowPopover: vi.fn(),
      setRangeSelectionRef: { current: vi.fn() },
      sessionEpoch,
    });
    setResizingClip = hook.setResizingClip;
    setDraggedClip = hook.setDraggedClip;
    resizingClip = hook.resizingClip;
    blockedClipRef = hook.blockedClipRef;
    return null;
  }

  const root = mountReactHarness(<Harness sessionEpoch={epoch} />);
  const apply = setResizingClip!;
  const dispatchPointer = (type: string, clientX: number, pointerId = 0) => {
    const event = new MouseEvent(type, { bubbles: true, clientX, clientY: 0 });
    Object.defineProperty(event, "pointerId", { value: pointerId });
    window.dispatchEvent(event);
  };

  return {
    onResizeElement,
    onMoveElement,
    onBlockedEditAttempt,
    onResizeElements,
    setPointerCapture,
    storeById(id: string) {
      return usePlayerStore.getState().elements.find((e) => e.id === id)!;
    },
    getResizeProjection() {
      return resizingClip?.groupPreview ?? [];
    },
    getResizingClip() {
      return resizingClip;
    },
    getBlockedClip() {
      return blockedClipRef?.current ?? null;
    },
    startBlocked(element: TimelineElement, pointerId = 0) {
      blockedClipRef!.current = {
        pointerId,
        element,
        intent: "move",
        originClientX: 0,
        originClientY: 0,
        started: false,
      };
    },
    startResize(element: TimelineElement, edge: "start" | "end", pointerId = 0) {
      act(() => {
        apply({
          pointerId,
          element,
          edge,
          originClientX: 0,
          previewStart: element.start,
          previewDuration: element.duration,
          previewPlaybackStart: element.playbackStart,
          started: false,
        });
      });
    },
    startDrag(element: TimelineElement, pointerId = 0) {
      act(() =>
        setDraggedClip?.({
          pointerId,
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
          insertRow: null,
          snapTime: null,
          snapType: null,
          started: false,
        }),
      );
    },
    movePointer(clientX: number, pointerId = 0) {
      act(() => {
        dispatchPointer("pointermove", clientX, pointerId);
      });
    },
    async dropPointer(pointerId = 0) {
      await act(async () => {
        dispatchPointer("pointerup", 0, pointerId);
      });
    },
    async moveAndDropPointer(clientX: number, pointerId = 0) {
      await act(async () => {
        dispatchPointer("pointermove", clientX, pointerId);
        dispatchPointer("pointerup", clientX, pointerId);
      });
    },
    cancelPointer(pointerId = 0) {
      act(() => dispatchPointer("pointercancel", 0, pointerId));
    },
    losePointerCapture(pointerId = 0) {
      act(() => dispatchPointer("lostpointercapture", 0, pointerId));
    },
    setSessionEpoch(next: number) {
      epoch = next;
      act(() => root.render(<Harness sessionEpoch={epoch} />));
    },
    pressEscape() {
      act(() => {
        scroll.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

// Two clips a(0,2) + b(5,3) selected as a group, with a's END edge grabbed and
// dragged +0.5s (50px @ 100pps). `bOver` customizes b (e.g. locking it).
function startGroupResize(bOver: Partial<TimelineElement> = {}) {
  const a = el("a", { start: 0, duration: 2 });
  const b = el("b", { start: 5, duration: 3, ...bOver });
  const h = renderResizeHarness([a, b], ["a", "b"]);
  h.startResize(a, "end");
  h.movePointer(50);
  return { a, b, h };
}

// Drop the pointer and assert exactly one resize persisted: the grabbed clip `a`
// grown to 2.5s (the +0.5 gesture), with no other member patched.
async function expectSingleResizeToA(
  h: ReturnType<typeof renderResizeHarness>,
  a: TimelineElement,
): Promise<void> {
  await h.dropPointer();
  expect(h.onResizeElement).toHaveBeenCalledTimes(1);
  expect(h.onResizeElement).toHaveBeenCalledWith(a, expect.objectContaining({ duration: 2.5 }));
}

describe("useTimelineClipDrag — single-clip resize (unchanged path)", () => {
  it("resizes only the grabbed clip and persists once", async () => {
    const a = el("a", { start: 0, duration: 2 });
    const b = el("b", { start: 5, duration: 2 });
    const h = renderResizeHarness([a, b], []); // no multi-selection

    h.startResize(a, "end");
    h.movePointer(50); // +0.5s at 100 pps
    await expectSingleResizeToA(h, a);
    expect(h.storeById("a").duration).toBe(2.5);
    expect(h.storeById("b").duration).toBe(2); // untouched
    h.unmount();
  });

  it("does not let an older rejected resize roll back a newer optimistic gesture", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = el("a", { start: 0, duration: 2 });
    const h = renderResizeHarness([a], []);
    let rejectFirst!: (error: Error) => void;
    h.onResizeElement
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => (rejectFirst = reject)))
      .mockResolvedValueOnce(undefined);

    h.startResize(a, "end");
    h.movePointer(50);
    await h.dropPointer();
    h.startResize(a, "end");
    h.movePointer(100);
    await h.dropPointer();
    rejectFirst(new Error("older resize failed"));
    await act(async () => Promise.resolve());

    expect(h.storeById("a").duration).toBe(3);
    errorSpy.mockRestore();
    h.unmount();
  });
});

describe("useTimelineClipDrag — gesture lifecycle", () => {
  it("does not capture a stationary click before the drag threshold", () => {
    const a = el("a", { duration: 2 });
    const h = renderResizeHarness([a], []);
    h.startDrag(a, 7);
    expect(h.setPointerCapture).not.toHaveBeenCalled();

    h.movePointer(3, 7);
    expect(h.setPointerCapture).not.toHaveBeenCalled();

    h.movePointer(5, 7);
    expect(h.setPointerCapture).toHaveBeenCalledOnce();
    expect(h.setPointerCapture).toHaveBeenCalledWith(7);
    h.unmount();
  });

  it("commits the final drag position exactly once", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = el("a", { duration: 2 });
    const h = renderResizeHarness([a], []);
    h.startDrag(a, 7);
    await h.moveAndDropPointer(50, 7);
    await h.dropPointer(7);
    expect(h.onMoveElement).toHaveBeenCalledTimes(1);
    expect(h.onMoveElement).toHaveBeenCalledWith(a, expect.objectContaining({ start: 0.5 }));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("only single-clip onMoveElement wired"),
    );
    warnSpy.mockRestore();
    h.unmount();
  });

  it("ignores a foreign pointer cancellation during a blocked gesture", async () => {
    const a = el("a", { duration: 2 });
    const h = renderResizeHarness([a], []);
    h.startBlocked(a, 7);
    h.movePointer(5, 7);
    expect(h.onBlockedEditAttempt).toHaveBeenCalledOnce();

    h.cancelPointer(8);
    expect(h.getBlockedClip()?.pointerId).toBe(7);

    await h.dropPointer(7);
    expect(h.getBlockedClip()).toBeNull();
    h.unmount();
  });

  it("commits the final same-turn pointer move exactly once", async () => {
    const a = el("a", { duration: 2 });
    const h = renderResizeHarness([a], []);
    h.startResize(a, "end", 7);
    await h.moveAndDropPointer(75, 7);
    await h.dropPointer(7);
    expect(h.onResizeElement).toHaveBeenCalledTimes(1);
    expect(h.onResizeElement).toHaveBeenCalledWith(a, expect.objectContaining({ duration: 2.75 }));
    h.unmount();
  });

  it("ignores another pointer and cancels without committing", async () => {
    const a = el("a", { duration: 2 });
    const h = renderResizeHarness([a], []);
    h.startResize(a, "end", 7);
    h.movePointer(50, 8);
    await h.dropPointer(8);
    expect(h.onResizeElement).not.toHaveBeenCalled();
    h.cancelPointer(7);
    await h.dropPointer(7);
    expect(h.onResizeElement).not.toHaveBeenCalled();
    expect(h.storeById("a").duration).toBe(2);
    h.unmount();
  });

  it("cancels an active projection when the project epoch changes", () => {
    const a = el("a", { duration: 2 });
    const h = renderResizeHarness([a], []);
    h.startResize(a, "end", 7);
    h.movePointer(50, 7);
    h.setSessionEpoch(1);
    expect(h.getResizeProjection()).toHaveLength(0);
    expect(h.onResizeElement).not.toHaveBeenCalled();
    expect(h.storeById("a").duration).toBe(2);
    h.unmount();
  });

  it("does not commit a stale clip deleted during the gesture", async () => {
    const a = el("a", { duration: 2 });
    const h = renderResizeHarness([a], []);
    h.startResize(a, "end", 7);
    h.movePointer(50, 7);
    act(() => usePlayerStore.getState().setElements([]));
    await h.dropPointer(7);
    expect(h.onResizeElement).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().elements).toEqual([]);
    h.unmount();
  });

  it("treats lost capture and unmount as cancellation", async () => {
    const a = el("a", { duration: 2 });
    const lost = renderResizeHarness([a], []);
    lost.startResize(a, "end", 7);
    lost.movePointer(50, 7);
    lost.losePointerCapture(7);
    await lost.dropPointer(7);
    expect(lost.onResizeElement).not.toHaveBeenCalled();
    lost.unmount();

    const unmounted = renderResizeHarness([a], []);
    unmounted.startResize(a, "end", 9);
    unmounted.movePointer(50, 9);
    unmounted.unmount();
    expect(unmounted.onResizeElement).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().elements[0]?.duration).toBe(2);
  });
});

describe("useTimelineClipDrag — multi-select group resize (restored)", () => {
  it("previews every member without mutating canonical elements", () => {
    const { h } = startGroupResize(); // grabbed asks +0.5

    expect(h.getResizeProjection()).toEqual([
      expect.objectContaining({ key: "a", duration: 2.5 }),
      expect.objectContaining({ key: "b", duration: 3.5 }),
    ]);
    expect(h.storeById("a").duration).toBe(2);
    expect(h.storeById("b").duration).toBe(3);
    h.unmount();
  });

  it("commits the whole group — persists every member by the shared delta", async () => {
    const { a, b, h } = startGroupResize();
    await h.dropPointer();

    expect(h.onResizeElement).not.toHaveBeenCalled();
    expect(h.onResizeElements).toHaveBeenCalledTimes(1);
    expect(h.onResizeElements).toHaveBeenCalledWith(
      [
        expect.objectContaining({ element: a, duration: 2.5 }),
        expect.objectContaining({ element: b, duration: 3.5 }),
      ],
      { coalesceKey: expect.stringMatching(/^clip-group-resize:/) },
    );
    expect(h.storeById("a").duration).toBe(2.5);
    expect(h.getResizeProjection()).toHaveLength(0);
    expect(h.storeById("b").duration).toBe(3.5);
    h.unmount();
  });

  it("rolls the whole group back when the atomic resize batch rejects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { h } = startGroupResize();
    h.onResizeElements.mockRejectedValueOnce(new Error("batch failed"));
    await h.dropPointer();
    await act(async () => Promise.resolve());
    expect(h.onResizeElements).toHaveBeenCalledTimes(1);
    expect(h.onResizeElement).not.toHaveBeenCalled();
    expect(h.storeById("a").duration).toBe(2);
    expect(h.storeById("b").duration).toBe(3);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
    h.unmount();
  });

  it("rolls the whole group back when no atomic resize callback is wired", async () => {
    const a = el("a", { start: 0, duration: 2 });
    const b = el("b", { start: 5, duration: 3 });
    const h = renderResizeHarness([a, b], ["a", "b"], {
      wireGroupResize: false,
    });
    h.startResize(a, "end");
    h.movePointer(50);
    expect(h.getResizeProjection()).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "b", duration: 3.5 })]),
    );
    expect(h.storeById("b").duration).toBe(3);

    await h.dropPointer();
    expect(h.storeById("a").duration).toBe(2);
    expect(h.storeById("b").duration).toBe(3);
    expect(h.onResizeElement).not.toHaveBeenCalled();
    h.unmount();
  });

  it("degrades to single-clip when a selected member is locked — locked clip untouched", async () => {
    const { a, h } = startGroupResize({ timelineLocked: true });
    await expectSingleResizeToA(h, a);
    expect(h.storeById("b").duration).toBe(3); // locked member never patched
    h.unmount();
  });

  it("Escape discards the projection and persists nothing", () => {
    const { h } = startGroupResize();
    expect(h.getResizeProjection()).toHaveLength(2);
    const sawEscape = vi.fn();
    document.addEventListener("keydown", sawEscape, { once: true });

    h.pressEscape();
    expect(sawEscape).toHaveBeenCalledOnce();
    expect(h.getResizeProjection()).toHaveLength(0);
    expect(h.storeById("b").duration).toBe(3);
    expect(h.onResizeElement).not.toHaveBeenCalled();
    h.unmount();
  });
});

describe("useTimelineClipDrag — trim guide and preview frame", () => {
  /** Playhead at 1.25s that follows preview seeks; clip a's end edge grabbed and dragged once. */
  function trimEndWithSeekingPlayhead(state: { isPlaying?: boolean } = {}) {
    usePlayerStore.setState({ currentTime: 1.25, ...state });
    const onSeek = vi.fn((t: number) => usePlayerStore.setState({ currentTime: t }));
    const a = el("a", { start: 1, duration: 2 });
    const h = renderResizeHarness([a], [], { onSeek });
    h.startResize(a, "end");
    h.movePointer(50);
    return { onSeek, h };
  }

  /** Clip a (0-2s) with neighbour b starting at 5s, snapping on, a's end edge grabbed. */
  function trimAEndBesideB() {
    const a = el("a", { start: 0, duration: 2 });
    const b = el("b", { start: 5, duration: 2 });
    const h = renderResizeHarness([a, b], [], { snap: true });
    h.startResize(a, "end");
    return h;
  }

  it("publishes the snap target while a trimmed edge is on a neighbour edge", () => {
    const h = trimAEndBesideB();
    h.movePointer(296); // a's end lands at 4.96s, 4px from b's start
    expect(h.getResizingClip()).toMatchObject({ snapTime: 5, snapType: "clip-edge" });
    h.unmount();
  });

  it("keeps the guide when the trimmed edge sits exactly on the neighbour edge", () => {
    const h = trimAEndBesideB();
    h.movePointer(300);
    expect(h.getResizingClip()).toMatchObject({ snapTime: 5, previewDuration: 5 });
    h.unmount();
  });

  it("publishes no snap target when the trimmed edge is free", () => {
    const h = trimAEndBesideB();
    h.movePointer(150);
    expect(h.getResizingClip()).toMatchObject({ snapTime: null, snapType: null });
    h.unmount();
  });

  it("never snaps a trimmed edge to the playhead — the edge drives its own seek", () => {
    usePlayerStore.setState({ currentTime: 5 }); // no clip edge or beat nearby, only the playhead
    const a = el("a", { start: 0, duration: 2 });
    const h = renderResizeHarness([a], [], { snap: true });
    h.startResize(a, "end");
    h.movePointer(296); // a's end lands at 4.96s, 4px from the playhead
    expect(h.getResizingClip()).toMatchObject({
      snapTime: null,
      snapType: null,
      previewDuration: 4.96,
    });
    h.unmount();
  });

  it("shows the frame at the dragged edge, then puts the playhead back on release", async () => {
    usePlayerStore.setState({ currentTime: 1.25 });
    const onSeek = vi.fn();
    const a = el("a", { start: 1, duration: 2 });
    const h = renderResizeHarness([a], [], { onSeek });
    h.startResize(a, "end");
    h.movePointer(50);
    expect(onSeek).toHaveBeenLastCalledWith(3.5 - 1 / 30, { keepPlaying: true });
    await h.dropPointer();
    expect(onSeek).toHaveBeenLastCalledWith(1.25, { keepPlaying: true });
    h.unmount();
  });

  it("previews the new in-point when the start edge is trimmed", () => {
    const onSeek = vi.fn();
    const a = el("a", { start: 1, duration: 2 });
    const h = renderResizeHarness([a], [], { onSeek });
    h.startResize(a, "start");
    h.movePointer(50);
    expect(onSeek).toHaveBeenLastCalledWith(1.5, { keepPlaying: true });
    h.unmount();
  });

  it("publishes the guide when the start edge snaps to a neighbour's end", () => {
    // playbackStart leaves source to reveal when the in-point moves left.
    const a = el("a", { start: 3, duration: 2, playbackStart: 5 });
    const b = el("b", { start: 0, duration: 2 });
    const h = renderResizeHarness([a, b], [], { snap: true });
    h.startResize(a, "start");
    h.movePointer(-96); // a's start lands at 2.04s, 4px from b's end
    expect(h.getResizingClip()).toMatchObject({ snapTime: 2, previewStart: 2 });
    h.unmount();
  });

  it("restores the playhead it had before the first preview seek, not a seeked time", async () => {
    const { onSeek, h } = trimEndWithSeekingPlayhead();
    h.movePointer(80);
    h.movePointer(120);
    await h.dropPointer();
    expect(onSeek).toHaveBeenLastCalledWith(1.25, { keepPlaying: true });
    h.unmount();
  });

  it("leaves the playhead where playback is when a trim is released while playing", async () => {
    const { onSeek, h } = trimEndWithSeekingPlayhead({ isPlaying: true });
    h.movePointer(120);
    const callsBeforeRelease = onSeek.mock.calls.length;
    await h.dropPointer();
    expect(onSeek).toHaveBeenCalledTimes(callsBeforeRelease);
    expect(onSeek).not.toHaveBeenCalledWith(1.25, expect.anything());
    usePlayerStore.setState({ isPlaying: false });
    h.unmount();
  });

  it("draws no guide and seeks to the rendered edge when a group member clamps the trim", () => {
    const onSeek = vi.fn();
    const a = el("a", { start: 0, duration: 4 });
    const b = el("b", { start: 0, duration: 1 });
    const c = el("c", { start: 2, duration: 1 });
    const h = renderResizeHarness([a, b, c], ["a", "b"], { snap: true, onSeek });
    h.startResize(a, "end");
    h.movePointer(-198); // a's raw end 2.02s snaps to c at 2s; b clamps the shared delta
    const clip = h.getResizingClip()!;
    expect(clip.previewStart + clip.previewDuration).toBeCloseTo(3.1, 3);
    expect(clip).toMatchObject({ snapTime: null, snapType: null });
    expect(onSeek).toHaveBeenLastCalledWith(expect.closeTo(3.1 - 1 / 30, 3), { keepPlaying: true });
    h.unmount();
  });
});
