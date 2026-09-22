import { describe, expect, it } from "vitest";
import { deriveTimelineTransitionSeams } from "./timelineTransitionSeams";
import type { TimelineElement } from "../store/playerStore";

const clip = (id: string, start: number, duration: number): TimelineElement => ({
  id,
  tag: "video",
  start,
  duration,
  track: 0,
});

describe("deriveTimelineTransitionSeams", () => {
  it("finds an overlap and centers the seam in the shared time", () => {
    const [seam] = deriveTimelineTransitionSeams([clip("in", 1.8, 2), clip("out", 0, 2)]);
    expect(seam?.outgoing).toEqual(clip("out", 0, 2));
    expect(seam?.incoming).toEqual(clip("in", 1.8, 2));
    expect(seam?.centerTime).toBeCloseTo(1.9);
    expect(seam?.duration).toBeCloseTo(0.2);
  });

  it("rejects crisp gaps and touching edges", () => {
    expect(deriveTimelineTransitionSeams([clip("a", 0, 2), clip("b", 2.04, 1)])).toEqual([]);
    expect(deriveTimelineTransitionSeams([clip("a", 0, 2), clip("b", 2, 1)])).toEqual([]);
  });
});
