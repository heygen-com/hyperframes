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
  it("main-track drop ripples the whole lane in ONE batched call (no per-clip persist)", () => {
    const elements = [el("v1", 1, 0, 5), el("v2", 1, 5, 4)]; // contiguous main lane (track 1)
    const onMoveElement = vi.fn();
    const onMoveElements = vi.fn();
    // Drag v1 past v2 (drop at 6) → reorder: v2 to 0, v1 flush after at 4.
    commitDraggedClipMove(drag(elements[0], { previewStart: 6, previewTrack: 1 }), {
      elements,
      trackOrder: [1],
      updateElement: vi.fn(),
      onMoveElement,
      onMoveElements,
    });
    expect(onMoveElement).not.toHaveBeenCalled();
    expect(onMoveElements).toHaveBeenCalledTimes(1);
    expect(editMap(onMoveElements.mock.calls[0][0])).toEqual({
      v2: { start: 0, track: 1 },
      v1: { start: 4, track: 1 },
    });
  });

  it("track insert persists the dragged clip + shifts as ONE batched call", () => {
    const elements = [el("a", 0, 0, 5), el("b", 1, 0, 5)];
    const onMoveElement = vi.fn();
    const onMoveElements = vi.fn();
    // insertRow 0 = new lane above the top: dragged 'a' takes top index, 'b' shifts down.
    commitDraggedClipMove(drag(elements[0], { previewStart: 0, previewTrack: 0, insertRow: 0 }), {
      elements,
      trackOrder: [0, 1],
      updateElement: vi.fn(),
      onMoveElement,
      onMoveElements,
    });
    expect(onMoveElement).not.toHaveBeenCalled();
    expect(onMoveElements).toHaveBeenCalledTimes(1);
    const map = editMap(onMoveElements.mock.calls[0][0]);
    expect(map.a.track).toBe(0);
    expect(map.b.track).toBe(2);
  });

  it("plain move on a non-main lane uses the single SDK-aware persist", () => {
    const elements = [el("v", 1, 0, 5, "video"), el("cap", 0, 0, 3, "div")]; // main = track 1 (video)
    const onMoveElement = vi.fn();
    const onMoveElements = vi.fn();
    // Move the caption within overlay lane 0 (not the main track) → single persist.
    commitDraggedClipMove(drag(elements[1], { previewStart: 2, previewTrack: 0 }), {
      elements,
      trackOrder: [0, 1],
      updateElement: vi.fn(),
      onMoveElement,
      onMoveElements,
    });
    expect(onMoveElements).not.toHaveBeenCalled();
    expect(onMoveElement).toHaveBeenCalledTimes(1);
    expect(onMoveElement.mock.calls[0][1]).toEqual({ start: 2, track: 0 });
  });
});
