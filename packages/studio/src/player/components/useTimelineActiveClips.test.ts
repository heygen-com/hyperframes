import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { isTimelineClipActive } from "./useTimelineActiveClips";

function clip(id: string, start: number, duration: number, hidden = false): TimelineElement {
  return { id, tag: "div", start, duration, track: 1, hidden };
}

describe("timeline active clips", () => {
  it("uses model timing and keeps the end boundary inclusive", () => {
    const element = clip("hero", 2, 3);
    expect(isTimelineClipActive(element, 2)).toBe(true);
    expect(isTimelineClipActive(element, 5)).toBe(true);
    expect(isTimelineClipActive(element, 5.001)).toBe(false);
  });

  it("never activates hidden or invalid clips", () => {
    expect(isTimelineClipActive(clip("hidden", 0, 5, true), 2)).toBe(false);
    expect(isTimelineClipActive(clip("invalid", Number.NaN, 5), 2)).toBe(false);
  });
});
