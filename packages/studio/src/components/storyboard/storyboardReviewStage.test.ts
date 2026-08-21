import { describe, expect, it } from "vitest";
import { deriveStoryboardHandoffStep, deriveStoryboardReviewStage } from "./storyboardReviewStage";

describe("deriveStoryboardReviewStage", () => {
  it.each([
    [[], "empty"],
    [["outline", "outline"], "plan-review"],
    [["outline", "built"], "sketch-in-progress"],
    [["outline", "animated"], "sketch-in-progress"],
    [["built", "built"], "sketch-review"],
    [["built", "animated"], "animation-in-progress"],
    [["animated", "animated"], "final-review"],
  ] as const)("maps %j to %s", (statuses, expected) => {
    expect(deriveStoryboardReviewStage(statuses.map((status) => ({ status }))).stage).toBe(
      expected,
    );
  });

  it("returns counts for the visible progress summary", () => {
    expect(
      deriveStoryboardReviewStage([
        { status: "outline" },
        { status: "built" },
        { status: "animated" },
        { status: "animated" },
      ]).counts,
    ).toEqual({ outline: 1, built: 1, animated: 2 });
  });
});

describe("storyboard review handoff", () => {
  it.each([
    [0, 0, 1],
    [2, 0, 2],
    [0, 3, 3],
    [1, 3, 2],
  ] as const)("maps %i drafts and %i pending comments to step %i", (drafts, pending, step) => {
    expect(deriveStoryboardHandoffStep(drafts, pending)).toBe(step);
  });
});
