import { describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../player";
import { persistTimelineMoveEditsAtomically } from "./timelineMoveAdapter";

const element = (id: string, track: number): TimelineElement => ({
  id,
  key: id,
  tag: "div",
  start: 0,
  duration: 2,
  track,
});

describe("persistTimelineMoveEditsAtomically", () => {
  it("persists two vertical edits as one group with the gesture coalesce key", async () => {
    const handleTimelineGroupMove = vi.fn().mockResolvedValue(undefined);
    const edits = [
      { element: element("a", 0), updates: { start: 1, track: 1 } },
      { element: element("b", 1), updates: { start: 3, track: 2 } },
    ];
    await persistTimelineMoveEditsAtomically(edits, "clip-lane-move:7", "track-insert", {
      handleTimelineGroupMove,
    });
    expect(handleTimelineGroupMove).toHaveBeenCalledTimes(1);
    expect(handleTimelineGroupMove).toHaveBeenCalledWith(
      [
        { element: edits[0].element, start: 1, track: 1 },
        { element: edits[1].element, start: 3, track: 2 },
      ],
      { coalesceKey: "clip-lane-move:7" },
    );
  });

  it("does not persist track attrs for a single z-only lane reorder", async () => {
    const handleTimelineGroupMove = vi.fn().mockResolvedValue(undefined);
    const edit = { element: element("a", 0), updates: { start: 1, track: 1 } };
    await persistTimelineMoveEditsAtomically([edit], "clip-lane-move:7", "lane-reorder", {
      handleTimelineGroupMove,
    });
    expect(handleTimelineGroupMove).toHaveBeenCalledWith([{ element: edit.element, start: 1 }], {
      coalesceKey: "clip-lane-move:7",
    });
  });

  it("does not persist track attrs for a multi-selection lane drag", async () => {
    const handleTimelineGroupMove = vi.fn().mockResolvedValue(undefined);
    const edits = [
      { element: element("a", 0), updates: { start: 1, track: 1 } },
      { element: element("b", 2), updates: { start: 3, track: 2 } },
    ];
    await persistTimelineMoveEditsAtomically(edits, "clip-lane-move:7", "lane-reorder", {
      handleTimelineGroupMove,
    });
    expect(handleTimelineGroupMove).toHaveBeenCalledWith(
      [
        { element: edits[0].element, start: 1 },
        { element: edits[1].element, start: 3 },
      ],
      { coalesceKey: "clip-lane-move:7" },
    );
  });

  it("rejects without retrying individual members when the atomic batch fails", async () => {
    const failure = new Error("batch failed");
    const handleTimelineGroupMove = vi.fn().mockRejectedValue(failure);
    const edits = [
      { element: element("a", 0), updates: { start: 1, track: 1 } },
      { element: element("b", 1), updates: { start: 3, track: 2 } },
    ];
    await expect(
      persistTimelineMoveEditsAtomically(edits, "clip-lane-move:7", "track-insert", {
        handleTimelineGroupMove,
      }),
    ).rejects.toBe(failure);
    expect(handleTimelineGroupMove).toHaveBeenCalledTimes(1);
  });
});
