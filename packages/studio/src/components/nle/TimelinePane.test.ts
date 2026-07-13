import { describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../../player";
import {
  forwardRebasedTimelineMoveElements,
  forwardRebasedTimelineResizeElements,
} from "./TimelinePane";

describe("TimelinePane move wrapper", () => {
  it("rebases expanded edits and forwards track-insert as the third argument", async () => {
    const onMoveElements = vi.fn().mockResolvedValue(undefined);
    const element: TimelineElement = {
      id: "expanded-a",
      domId: "a",
      tag: "div",
      start: 12,
      duration: 2,
      track: 0,
      expandedParentStart: 10,
    };
    await forwardRebasedTimelineMoveElements(
      [{ element, updates: { start: 14, track: 2 } }],
      "clip-lane-move:7",
      "track-insert",
      onMoveElements,
    );
    expect(onMoveElements).toHaveBeenCalledWith(
      [
        {
          element: expect.objectContaining({ id: "a", start: 2 }),
          updates: { start: 4, track: 2 },
        },
      ],
      "clip-lane-move:7",
      "track-insert",
    );
  });

  it("forwards one rebased resize batch with the shared gesture key", async () => {
    const onResizeElements = vi.fn().mockResolvedValue(undefined);
    const element: TimelineElement = {
      id: "expanded-a",
      domId: "a",
      tag: "div",
      start: 12,
      duration: 2,
      track: 0,
      expandedParentStart: 10,
    };
    await forwardRebasedTimelineResizeElements(
      [{ element, start: 13, duration: 3 }],
      { coalesceKey: "clip-group-resize:a:b" },
      onResizeElements,
    );
    expect(onResizeElements).toHaveBeenCalledTimes(1);
    expect(onResizeElements).toHaveBeenCalledWith(
      [{ element: expect.objectContaining({ id: "a", start: 2 }), start: 3, duration: 3 }],
      { coalesceKey: "clip-group-resize:a:b" },
    );
  });
});
