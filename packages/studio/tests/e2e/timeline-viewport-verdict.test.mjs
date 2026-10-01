import { describe, expect, it } from "vitest";
import { gatePassed, judgeResponsiveness, percentile } from "./timeline-viewport-verdict.mjs";

const LIMITS = { samplesPerRun: 63, interactionLimitMs: 75, frameIntervalLimitMs: 75 };
const FAST = 49;
const SLOW = 83;

/** Five runs of 63 steps; `slowAt(run, step)` marks the steps that take five frames. */
function runs(slowAt) {
  return Array.from({ length: 5 }, (_, run) => {
    const interactions = Array.from({ length: 63 }, (_, step) => (slowAt(run, step) ? SLOW : FAST));
    return { interactions, frameIntervals: interactions.map(() => 33.3) };
  });
}

const slowSteps = (count) => (run, step) => run * 63 + step < count;

describe("percentile", () => {
  it("takes the nearest rank, so the p95 of 315 steps is the 16th-worst", () => {
    const values = Array.from({ length: 315 }, (_, index) => index);
    expect(percentile(values, 0.95)).toBe(299);
    expect(percentile([3, 1, 2], 0.95)).toBe(3);
  });
});

describe("judgeResponsiveness", () => {
  it("fails 16 slow steps of 315 and passes 15", () => {
    expect(judgeResponsiveness(runs(slowSteps(16)), LIMITS)).toMatchObject({
      interactionP95Ms: SLOW,
      passed: false,
    });
    expect(judgeResponsiveness(runs(slowSteps(15)), LIMITS)).toMatchObject({
      interactionP95Ms: FAST,
      passed: true,
    });
  });

  it("passes two slow steps in every run, 10 of 315", () => {
    expect(
      judgeResponsiveness(
        runs((_, step) => step < 2),
        LIMITS,
      ).passed,
    ).toBe(true);
  });

  it("fails one run that is slow throughout", () => {
    expect(
      judgeResponsiveness(
        runs((run) => run === 2),
        LIMITS,
      ).passed,
    ).toBe(false);
  });

  it("fails on the frame interval alone", () => {
    const measured = runs(() => false).map((run) => ({
      ...run,
      frameIntervals: run.frameIntervals.map(() => 83),
    }));
    expect(judgeResponsiveness(measured, LIMITS).passed).toBe(false);
  });

  it("throws on a run short of samples instead of reading it as fast", () => {
    const measured = runs(() => false);
    measured[1] = { interactions: [], frameIntervals: [] };
    expect(() => judgeResponsiveness(measured, LIMITS)).toThrow("Expected 315 scroll samples");
    expect(() => judgeResponsiveness([], LIMITS)).toThrow("Expected 0 scroll samples");
  });
});

describe("gatePassed", () => {
  const passing = {
    directScrollApproved: true,
    responsivenessPassed: true,
    passingRuns: 5,
    requiredPassingRuns: 4,
    memoryReturned: true,
  };

  it("passes only when every check holds", () => {
    expect(gatePassed(passing)).toBe(true);
    expect(gatePassed({ ...passing, responsivenessPassed: false })).toBe(false);
    expect(gatePassed({ ...passing, directScrollApproved: false })).toBe(false);
    expect(gatePassed({ ...passing, passingRuns: 3 })).toBe(false);
    expect(gatePassed({ ...passing, memoryReturned: false })).toBe(false);
  });
});
