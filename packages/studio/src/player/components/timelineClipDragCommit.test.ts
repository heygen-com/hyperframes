import { describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import type { DraggedClipState } from "./useTimelineClipDrag";
import { commitDraggedClipMove, type TimelineMoveEdit } from "./timelineClipDragCommit";

function el(
  id: string,
  track: number,
  start: number,
  duration: number,
  tag = "video",
): TimelineElement {
  return { id, key: id, tag, start, duration, track };
}

function drag(
  element: TimelineElement,
  opts: { previewStart: number; previewTrack: number; insertRow?: number | null },
): DraggedClipState {
  return {
    element,
    originClientX: 0,
    originClientY: 0,
    originScrollLeft: 0,
    originScrollTop: 0,
    pointerClientX: 0,
    pointerClientY: 0,
    pointerOffsetX: 0,
    pointerOffsetY: 0,
    previewStart: opts.previewStart,
    previewTrack: opts.previewTrack,
    insertRow: opts.insertRow ?? null,
    snapTime: null,
    snapType: null,
    started: true,
  };
}

function editMap(edits: TimelineMoveEdit[]): Record<string, { start: number; track: number }> {
  const out: Record<string, { start: number; track: number }> = {};
  for (const e of edits)
    out[e.element.key ?? e.element.id] = { start: e.updates.start, track: e.updates.track };
  return out;
}

describe("commitDraggedClipMove", () => {
  it("pure time-move (same lane) persists just the dragged clip (single, SDK-aware)", () => {
    const elements = [el("v1", 1, 0, 5)];
    const onMoveElement = vi.fn();
    const onMoveElements = vi.fn();
    // previewTrack === element.track → no topology change → single move.
    commitDraggedClipMove(drag(elements[0], { previewStart: 6, previewTrack: 1 }), {
      elements,
      trackOrder: [1],
      updateElement: vi.fn(),
      onMoveElement,
      onMoveElements,
    });
    expect(onMoveElements).not.toHaveBeenCalled();
    expect(onMoveElement).toHaveBeenCalledTimes(1);
    expect(onMoveElement.mock.calls[0][1]).toEqual({ start: 6, track: 1 });
  });

  it("a lane change re-normalizes and persists EVERY clip atomically (fixes raw-vs-normalized collision)", () => {
    // Move 'a' from lane 0 down onto lane 1 (b's lane) at a non-overlapping time.
    const elements = [el("a", 0, 0, 3), el("b", 1, 10, 3)];
    const onMoveElement = vi.fn();
    const onMoveElements = vi.fn();
    commitDraggedClipMove(drag(elements[0], { previewStart: 20, previewTrack: 1 }), {
      elements,
      trackOrder: [0, 1],
      updateElement: vi.fn(),
      onMoveElement,
      onMoveElements,
    });
    expect(onMoveElement).not.toHaveBeenCalled();
    expect(onMoveElements).toHaveBeenCalledTimes(1);
    // BOTH clips are persisted with consistent normalized tracks (both visual → lane 0).
    const map = editMap(onMoveElements.mock.calls[0][0]);
    expect(map.a).toEqual({ start: 20, track: 0 });
    expect(map.b).toEqual({ start: 10, track: 0 });
  });

  it("multi-selection time-move shifts EVERY selected clip by the drag delta (atomic)", () => {
    const elements = [el("a", 0, 2, 3), el("b", 1, 10, 3), el("c", 2, 20, 3)];
    const onMoveElement = vi.fn();
    const onMoveElements = vi.fn();
    // Drag 'a' +5s on its own lane while {a, b} are marquee-selected.
    commitDraggedClipMove(drag(elements[0], { previewStart: 7, previewTrack: 0 }), {
      elements,
      trackOrder: [0, 1, 2],
      updateElement: vi.fn(),
      onMoveElement,
      onMoveElements,
      selectedKeys: new Set(["a", "b"]),
    });
    expect(onMoveElement).not.toHaveBeenCalled();
    expect(onMoveElements).toHaveBeenCalledTimes(1);
    const map = editMap(onMoveElements.mock.calls[0][0]);
    expect(map.a).toEqual({ start: 7, track: 0 });
    expect(map.b).toEqual({ start: 15, track: 1 }); // same +5 delta, keeps its lane
    expect(map.c).toBeUndefined(); // unselected clips untouched
  });

  it("multi-selection move clamps shifted clips at 0 and applies the store update optimistically", () => {
    const elements = [el("a", 0, 6, 3), el("b", 1, 2, 3)];
    const updateElement = vi.fn();
    const onMoveElements = vi.fn();
    // Drag 'a' −5s: b would land at −3 → clamps to 0.
    commitDraggedClipMove(drag(elements[0], { previewStart: 1, previewTrack: 0 }), {
      elements,
      trackOrder: [0, 1],
      updateElement,
      onMoveElements,
      selectedKeys: new Set(["a", "b"]),
    });
    const map = editMap(onMoveElements.mock.calls[0][0]);
    expect(map.a).toEqual({ start: 1, track: 0 });
    expect(map.b).toEqual({ start: 0, track: 1 });
    expect(updateElement).toHaveBeenCalledWith("a", { start: 1, track: 0 });
    expect(updateElement).toHaveBeenCalledWith("b", { start: 0, track: 1 });
  });

  it("a multi-selection that does NOT include the dragged clip moves only the dragged clip", () => {
    const elements = [el("a", 0, 0, 3), el("b", 1, 10, 3)];
    const onMoveElement = vi.fn();
    const onMoveElements = vi.fn();
    commitDraggedClipMove(drag(elements[0], { previewStart: 6, previewTrack: 0 }), {
      elements,
      trackOrder: [0, 1],
      updateElement: vi.fn(),
      onMoveElement,
      onMoveElements,
      selectedKeys: new Set(["b", "x"]),
    });
    expect(onMoveElements).not.toHaveBeenCalled();
    expect(onMoveElement).toHaveBeenCalledTimes(1);
    expect(onMoveElement.mock.calls[0][1]).toEqual({ start: 6, track: 0 });
  });

  it("multi-selection lane change: dragged clip changes track, the rest of the selection shifts in time only", () => {
    const elements = [el("a", 0, 0, 3), el("b", 1, 10, 3), el("c", 2, 20, 3)];
    const onMoveElements = vi.fn();
    // Drag 'a' +4s down onto lane 1 (non-overlapping with b) while {a, c} selected.
    commitDraggedClipMove(drag(elements[0], { previewStart: 4, previewTrack: 1 }), {
      elements,
      trackOrder: [0, 1, 2],
      updateElement: vi.fn(),
      onMoveElements,
      selectedKeys: new Set(["a", "c"]),
    });
    const map = editMap(onMoveElements.mock.calls[0][0]);
    expect(map.a.start).toBe(4); // dragged: new time + new (normalized) lane
    expect(map.c.start).toBe(24); // selected passenger: same +4 delta
    expect(map.c.track).not.toBe(map.a.track); // passenger keeps its own lane
    expect(map.b.start).toBe(10); // unselected: time untouched
  });

  it("inserting a new lane slots the dragged clip in and shifts the rest (fractional → normalized)", () => {
    const elements = [el("a", 0, 0, 5), el("b", 1, 0, 5), el("c", 2, 0, 5)];
    const onMoveElement = vi.fn();
    const onMoveElements = vi.fn();
    // insert a new lane at row 1 (between a and b) with c.
    commitDraggedClipMove(drag(elements[2], { previewStart: 0, previewTrack: 2, insertRow: 1 }), {
      elements,
      trackOrder: [0, 1, 2],
      updateElement: vi.fn(),
      onMoveElement,
      onMoveElements,
    });
    expect(onMoveElements).toHaveBeenCalledTimes(1);
    const map = editMap(onMoveElements.mock.calls[0][0]);
    expect(map.a.track).toBe(0); // unchanged top
    expect(map.c.track).toBe(1); // slots between a and b
    expect(map.b.track).toBe(2); // pushed down
  });
});
