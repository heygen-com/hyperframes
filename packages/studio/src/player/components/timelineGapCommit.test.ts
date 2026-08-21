import { describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import type { DragCommitDeps } from "./timelineClipDragCommit";
import {
  canShiftTrackGapClips,
  commitCloseAllTrackGaps,
  commitCloseTrackGap,
} from "./timelineGapCommit";
import { resolveAllTrackGaps } from "./timelineGaps";

function el(id: string, start: number, duration: number, track = 0): TimelineElement {
  // domId + video tag → getTimelineEditCapabilities(...).canMove === true
  return { id, tag: "video", start, duration, track, domId: id };
}

function lockedEl(id: string, start: number, duration: number): TimelineElement {
  return { ...el(id, start, duration), timelineLocked: true };
}

function makeDeps(laneElements: TimelineElement[]) {
  const onMoveElements = vi.fn(() => Promise.resolve());
  const updateElement = vi.fn();
  const deps: DragCommitDeps = {
    elements: laneElements,
    trackOrder: [0],
    updateElement,
    onMoveElements,
  };
  return { deps, onMoveElements, updateElement };
}

/** Assert exactly ONE atomic persist batch; return its flattened edits + coalesce key. */
function singleBatch(onMoveElements: ReturnType<typeof vi.fn>) {
  expect(onMoveElements).toHaveBeenCalledTimes(1);
  const [edits, coalesceKey] = onMoveElements.mock.calls[0] as unknown as [
    Array<{ element: TimelineElement; updates: { start: number; track: number } }>,
    string,
  ];
  return { coalesceKey, edits: edits.map((e) => ({ id: e.element.id, ...e.updates })) };
}

describe("commitCloseTrackGap", () => {
  it("persists ONE atomic batch shifting the next clip and every clip after it", () => {
    const lane = [el("a", 0, 2), el("b", 5, 3), el("c", 10, 1)];
    const { deps, onMoveElements } = makeDeps(lane);

    expect(commitCloseTrackGap(lane, 3, deps)).toBe(true);

    const { edits, coalesceKey } = singleBatch(onMoveElements);
    // Gap is [2, 5) → width 3; b and c shift left by 3, tracks unchanged.
    expect(edits).toEqual([
      { id: "b", start: 2, track: 0 },
      { id: "c", start: 7, track: 0 },
    ]);
    expect(typeof coalesceKey).toBe("string");
    expect(coalesceKey).toMatch(/^track-gap-close:\d+$/);
  });

  it("optimistically applies the same starts to the store", () => {
    const lane = [el("a", 0, 2), el("b", 5, 3)];
    const { deps, updateElement } = makeDeps(lane);
    commitCloseTrackGap(lane, 3, deps);
    expect(updateElement).toHaveBeenCalledWith("b", { start: 2, track: 0 });
  });

  it("closes the leading gap (first clip lands at 0)", () => {
    const lane = [el("a", 2, 3), el("b", 6, 1)];
    const { deps, onMoveElements } = makeDeps(lane);

    expect(commitCloseTrackGap(lane, 1, deps)).toBe(true);
    const [edits] = onMoveElements.mock.calls[0] as unknown as [
      Array<{ element: TimelineElement; updates: { start: number; track: number } }>,
    ];
    expect(edits.map((e) => ({ id: e.element.id, start: e.updates.start }))).toEqual([
      { id: "a", start: 0 },
      { id: "b", start: 4 },
    ]);
  });

  it("uses a fresh coalesce key per gesture", () => {
    const lane = [el("a", 0, 2), el("b", 5, 3)];
    const first = makeDeps(lane);
    const second = makeDeps(lane);
    commitCloseTrackGap(lane, 3, first.deps);
    commitCloseTrackGap(lane, 3, second.deps);
    const keyA = first.onMoveElements.mock.calls[0][1 as never];
    const keyB = second.onMoveElements.mock.calls[0][1 as never];
    expect(keyA).not.toEqual(keyB);
  });

  it("refuses (no write) when there is no clip right of the point", () => {
    const lane = [el("a", 0, 2)];
    const { deps, onMoveElements, updateElement } = makeDeps(lane);
    expect(commitCloseTrackGap(lane, 5, deps)).toBe(false);
    expect(onMoveElements).not.toHaveBeenCalled();
    expect(updateElement).not.toHaveBeenCalled();
  });

  it("refuses (no partial compaction) when ANY shifting clip is unmovable", () => {
    const lane = [el("a", 0, 2), el("b", 5, 3), lockedEl("c", 10, 1)];
    const { deps, onMoveElements, updateElement } = makeDeps(lane);
    expect(commitCloseTrackGap(lane, 3, deps)).toBe(false);
    expect(onMoveElements).not.toHaveBeenCalled();
    expect(updateElement).not.toHaveBeenCalled();
  });
});

describe("commitCloseAllTrackGaps", () => {
  it("compacts the whole lane in ONE atomic batch (leading gap included)", () => {
    const lane = [el("a", 1, 2), el("b", 5, 3), el("c", 10, 1)];
    const { deps, onMoveElements } = makeDeps(lane);

    expect(commitCloseAllTrackGaps(lane, deps)).toBe(true);

    const { edits, coalesceKey } = singleBatch(onMoveElements);
    expect(edits).toEqual([
      { id: "a", start: 0, track: 0 },
      { id: "b", start: 2, track: 0 },
      { id: "c", start: 5, track: 0 },
    ]);
    expect(coalesceKey).toMatch(/^track-gap-close:\d+$/);
  });

  it("refuses when the track is already contiguous (no gaps)", () => {
    const lane = [el("a", 0, 2), el("b", 2, 3)];
    const { deps, onMoveElements } = makeDeps(lane);
    expect(commitCloseAllTrackGaps(lane, deps)).toBe(false);
    expect(onMoveElements).not.toHaveBeenCalled();
  });

  it("refuses when any shifting clip is unmovable, even if others could move", () => {
    const lane = [lockedEl("a", 1, 2), el("b", 5, 3)];
    const { deps, onMoveElements, updateElement } = makeDeps(lane);
    expect(commitCloseAllTrackGaps(lane, deps)).toBe(false);
    expect(onMoveElements).not.toHaveBeenCalled();
    expect(updateElement).not.toHaveBeenCalled();
  });

  it("proceeds when an unmovable clip does NOT need to shift", () => {
    // Locked clip already sits flush at 0 — only movable clips shift.
    const lane = [lockedEl("a", 0, 2), el("b", 4, 1)];
    const { deps, onMoveElements } = makeDeps(lane);
    expect(commitCloseAllTrackGaps(lane, deps)).toBe(true);
    const [edits] = onMoveElements.mock.calls[0] as unknown as [
      Array<{ element: TimelineElement; updates: { start: number } }>,
    ];
    expect(edits.map((e) => ({ id: e.element.id, start: e.updates.start }))).toEqual([
      { id: "b", start: 2 },
    ]);
  });
});

describe("canShiftTrackGapClips", () => {
  it("is true only when every named clip is movable", () => {
    const lane = [el("a", 1, 2), lockedEl("b", 5, 3)];
    expect(canShiftTrackGapClips(lane, [{ key: "a", newStart: 0 }])).toBe(true);
    expect(canShiftTrackGapClips(lane, resolveAllTrackGaps(lane))).toBe(false);
  });

  it("is false for unknown keys", () => {
    expect(canShiftTrackGapClips([el("a", 0, 1)], [{ key: "ghost", newStart: 0 }])).toBe(false);
  });
});
