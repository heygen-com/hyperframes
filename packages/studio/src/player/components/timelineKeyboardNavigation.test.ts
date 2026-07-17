import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { resolveTimelineKeyboardTarget } from "./timelineKeyboardNavigation";

function clip(id: string, track: number, start: number): TimelineElement {
  return { id, track, start, duration: 2, tag: "div" };
}

describe("resolveTimelineKeyboardTarget", () => {
  const tracks: [number, TimelineElement[]][] = [
    [1, [clip("a", 1, 0), clip("b", 1, 5)]],
    [2, []],
    [3, [clip("c", 3, 1), clip("d", 3, 8)]],
  ];

  it("moves by time within a logical row", () => {
    expect(resolveTimelineKeyboardTarget(tracks, [1, 2, 3], "a", "ArrowRight")?.id).toBe("b");
    expect(resolveTimelineKeyboardTarget(tracks, [1, 2, 3], "b", "Home")?.id).toBe("a");
  });

  it("crosses unmounted or empty rows using nearest clip time", () => {
    expect(resolveTimelineKeyboardTarget(tracks, [1, 2, 3], "b", "ArrowDown")?.id).toBe("d");
  });
});
