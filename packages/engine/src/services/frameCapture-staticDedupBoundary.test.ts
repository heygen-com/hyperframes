import { describe, expect, it, vi } from "vitest";
import { computeClipBoundaryFrames } from "./frameCapture.js";

describe("computeClipBoundaryFrames", () => {
  it("protects the normalized authored-duration disappearance neighborhood", async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue([
        {
          start: "0",
          duration: null,
          authoredDuration: "3.5",
          end: null,
          authoredEnd: null,
        },
      ]),
    };

    const frames = await computeClipBoundaryFrames(
      page as unknown as Parameters<typeof computeClipBoundaryFrames>[0],
      25,
    );

    expect([...frames].sort((a, b) => a - b)).toEqual([0, 1, 87, 88, 89]);
  });

  it("rounds fractional-fps start and end edges and applies precedence", async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue([
        {
          start: "0.1",
          duration: "0",
          authoredDuration: "0.2",
          end: "9",
          authoredEnd: "10",
        },
      ]),
    };

    const frames = await computeClipBoundaryFrames(
      page as unknown as Parameters<typeof computeClipBoundaryFrames>[0],
      23.976,
    );

    expect(frames).toEqual(new Set([1, 2, 3, 6, 7, 8]));
  });

  it("matches runtime clamping for a negative absolute start", () => {
    const frames = computeAuthoredClipBoundaryFrames([{ start: "-1", duration: "3" }], 25);
    expect(frames).toEqual(new Set([0, 1, 74, 75, 76]));
  });
});
