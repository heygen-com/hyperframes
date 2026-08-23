import { describe, expect, it } from "vitest";
import { computeAuthoredClipBoundaryFrames } from "./frameCapture.js";

describe("computeClipBoundaryFrames", () => {
  it("protects the normalized authored-duration disappearance neighborhood", async () => {
    const frames = computeAuthoredClipBoundaryFrames(
      [
        {
          start: "0",
          duration: null,
          authoredDuration: "3.5",
          end: null,
          authoredEnd: null,
        },
      ],
      25,
    );

    expect([...frames].sort((a, b) => a - b)).toEqual([0, 1, 87, 88, 89]);
  });

  it("rounds fractional-fps start and end edges and applies precedence", async () => {
    const frames = computeAuthoredClipBoundaryFrames(
      [
        {
          start: "0.1",
          duration: "0",
          authoredDuration: "0.2",
          end: "9",
          authoredEnd: "10",
        },
      ],
      23.976,
    );

    expect(frames).toEqual(new Set([1, 2, 3, 6, 7, 8]));
  });

  it("matches runtime clamping for a negative absolute start", () => {
    const frames = computeAuthoredClipBoundaryFrames([{ start: "-1", duration: "3" }], 25);
    expect(frames).toEqual(new Set([0, 1, 74, 75, 76]));
  });
});
