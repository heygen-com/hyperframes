import { describe, expect, it } from "vitest";
import { deriveTimelineTransitionSeams } from "./timelineTransitionSeams";
import type { TimelineElement } from "../store/playerStore";

const clip = (
  id: string,
  start: number,
  duration: number,
  track = 0,
  transitionLabel?: string,
): TimelineElement => ({
  id,
  tag: "video",
  start,
  duration,
  track,
  transitionLabel,
});

describe("deriveTimelineTransitionSeams", () => {
  it("finds a labelled transition and centers the seam in the shared time", () => {
    const label = "hf:transition:out:in:crossfade";
    const [seam] = deriveTimelineTransitionSeams([
      clip("in", 1.8, 2, 0, label),
      clip("out", 0, 2, 0, label),
    ]);
    expect(seam?.outgoing).toEqual(clip("out", 0, 2, 0, label));
    expect(seam?.incoming).toEqual(clip("in", 1.8, 2, 0, label));
    expect(seam?.centerTime).toBeCloseTo(1.9);
    expect(seam?.duration).toBeCloseTo(0.2);
  });

  it("does not badge an unlabelled overlap", () => {
    expect(deriveTimelineTransitionSeams([clip("out", 0, 2), clip("in", 1.8, 2)])).toEqual([]);
  });

  it("does not badge a cross-track overlap", () => {
    const label = "hf:transition:out:in:crossfade";
    expect(
      deriveTimelineTransitionSeams([
        clip("out", 0, 2, 0, label),
        clip("in", 1.8, 2, 1, label),
      ]),
    ).toEqual([]);
  });

  it("rejects crisp gaps and touching edges", () => {
    expect(deriveTimelineTransitionSeams([clip("a", 0, 2), clip("b", 2.04, 1)])).toEqual([]);
    expect(deriveTimelineTransitionSeams([clip("a", 0, 2), clip("b", 2, 1)])).toEqual([]);
  });
});
