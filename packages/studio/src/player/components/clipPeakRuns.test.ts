import { describe, expect, it } from "vitest";
import { clipPeakRuns } from "./clipPeakRuns";

const map = (bins: number[]) => ({ binSeconds: 1, bins });

describe("clipPeakRuns", () => {
  it("marks bins at or above -1 dBFS after the clip's gain and names the loudest", () => {
    const { runs, peakDbfs } = clipPeakRuns(
      map([0.1, 0.95, 0.99, 0.2, 0.9]),
      { mediaStart: 0, sourceSpan: 5 },
      1,
    );
    expect(runs).toEqual([
      { from: 0.2, to: 0.6 },
      { from: 0.8, to: 1 },
    ]);
    expect(peakDbfs).toBeCloseTo(20 * Math.log10(0.99), 6);
  });

  it("puts nothing on a -12 dBFS clip, and marks it once boosted by +12 dB", () => {
    const quiet = map([0.25, 0.25]);
    expect(clipPeakRuns(quiet, { mediaStart: 0, sourceSpan: 2 }, 1)).toEqual({
      runs: [],
      peakDbfs: null,
    });
    expect(clipPeakRuns(quiet, { mediaStart: 0, sourceSpan: 2 }, 4).runs).toHaveLength(1);
  });

  it("only reads the trimmed window, positioned within the clip", () => {
    const { runs } = clipPeakRuns(map([1, 0, 0, 1, 0]), { mediaStart: 2, sourceSpan: 2 }, 1);
    expect(runs).toEqual([{ from: 0.5, to: 1 }]);
  });

  it("is empty for a muted clip or an empty window", () => {
    expect(clipPeakRuns(map([1]), { mediaStart: 0, sourceSpan: 1 }, 0).runs).toEqual([]);
    expect(clipPeakRuns(map([1]), { mediaStart: 0, sourceSpan: 0 }, 1).runs).toEqual([]);
  });
});
