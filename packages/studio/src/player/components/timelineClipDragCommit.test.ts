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

  it("inserting a new lane re-packs the whole set into contiguous lanes (single atomic persist)", () => {
    // a,b,c all start=0 dur=5 → mutually overlapping, all equal z (absent ⇒ 0).
    // The insert drops c at a fractional lane between a and b. Under the per-clip
    // constrained pack, equal-z overlapping clips lay out by DOM order (later on
    // top): c (last in DOM) → lane 0, b → lane 1, a → lane 2. (Was pinned to
    // a=0/c=1/b=2 by the old whole-track packer, which used the fractional-track
    // value for ordering; the new pack encodes insert INTENT via the z-sync path
    // instead, and lanes reflect true canvas paint order.) Contiguous 0..2, one
    // atomic persist for all three.
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
    // Lanes are contiguous and distinct (no two overlapping clips share a lane).
    expect(new Set([map.a.track, map.b.track, map.c.track])).toEqual(new Set([0, 1, 2]));
    expect(map.c.track).toBe(0); // last in DOM → top lane
    expect(map.b.track).toBe(1);
    expect(map.a.track).toBe(2);
  });

  describe("lane ↔ stacking sync", () => {
    it("lane change raises the edited clip's z above a time-overlapping lower-lane clip", () => {
      // a & b overlap in time. Elements carry their authored z (as real discovery
      // populates TimelineElement.zIndex from the DOM), so the per-clip pack lays
      // them out by z: b (z=5) tops, a (z=1) below. The user drags a UP onto the
      // TOP lane (row 0, above b) via an insert — expressing "a should stack above
      // b". The z-sync must lift a above b (5) → 6 so the lane move is realised.
      // (Was: equal-z candidate + drop onto b's track; that relied on the old
      // key-order tie-break placing a on top, which contradicted canvas paint for
      // equal z — the elements now carry z and the drop intent is an insert above.)
      const elements: TimelineElement[] = [
        { id: "a", key: "a", tag: "video", start: 0, duration: 10, track: 1, zIndex: 1 },
        { id: "b", key: "b", tag: "video", start: 0, duration: 10, track: 0, zIndex: 5 },
      ];
      const z: Record<string, number> = { a: 1, b: 5 };
      const onStackingPatches = vi.fn();
      // Insert a new lane at row 0 (above the top lane) with a → a lands above b.
      commitDraggedClipMove(drag(elements[0], { previewStart: 0, previewTrack: 1, insertRow: 0 }), {
        elements,
        trackOrder: [0, 1],
        updateElement: vi.fn(),
        onMoveElements: vi.fn(),
        readZIndex: (e) => z[e.key ?? e.id] ?? 0,
        onStackingPatches,
      });
      // Only `a` (the edited clip) is patched, lifted above b(5) → 6.
      expect(onStackingPatches).toHaveBeenCalledTimes(1);
      expect(onStackingPatches.mock.calls[0][0]).toEqual([{ key: "a", zIndex: 6 }]);
    });

    it("no z-sync deps → no stacking side-effects (pure time-move path safe)", () => {
      const elements = [el("a", 1, 0, 10), el("b", 0, 0, 10)];
      // No readZIndex/onStackingPatches supplied → must not throw, no patches.
      commitDraggedClipMove(drag(elements[0], { previewStart: 0, previewTrack: 0 }), {
        elements,
        trackOrder: [0, 1],
        updateElement: vi.fn(),
        onMoveElements: vi.fn(),
      });
      // (nothing to assert beyond "did not throw")
    });

    it("no time overlap → no stacking patch even on a lane change", () => {
      const elements = [el("a", 1, 0, 5), el("b", 0, 10, 5)];
      const onStackingPatches = vi.fn();
      commitDraggedClipMove(drag(elements[0], { previewStart: 0, previewTrack: 0 }), {
        elements,
        trackOrder: [0, 1],
        updateElement: vi.fn(),
        onMoveElements: vi.fn(),
        readZIndex: () => 0,
        onStackingPatches,
      });
      expect(onStackingPatches).not.toHaveBeenCalled();
    });

    it("pure time-move (no lane change) never triggers a stacking patch", () => {
      const elements = [el("a", 0, 0, 10), el("b", 0, 0, 10)];
      const onStackingPatches = vi.fn();
      // same track → not a topology change → z-sync branch not reached.
      commitDraggedClipMove(drag(elements[0], { previewStart: 3, previewTrack: 0 }), {
        elements,
        trackOrder: [0],
        updateElement: vi.fn(),
        onMoveElement: vi.fn(),
        readZIndex: () => 0,
        onStackingPatches,
      });
      expect(onStackingPatches).not.toHaveBeenCalled();
    });
  });
});
