import { describe, expect, it } from "vitest";
import { TIMELINE_VIEWPORT_BUDGETS } from "../../src/player/lib/timelineViewportBudgets";
import {
  attemptPassed,
  gatePassed,
  judgeResponsiveness,
  percentile,
  responsivenessLimits,
} from "./timeline-viewport-verdict.mjs";

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

describe("the CI virtualized arm's limits", () => {
  const limits = {
    samplesPerRun: 63,
    ...responsivenessLimits(TIMELINE_VIEWPORT_BUDGETS, "ci", "on"),
  };
  // Two frames is a normal step, four a step two frames late; one frame is a normal interval, two a dropped one.
  const steps = (count, normal, slow) =>
    Array.from({ length: 5 }, (_, run) =>
      Array.from({ length: 63 }, (_, step) => (run * 63 + step < count ? slow : normal)),
    );
  const interactionRuns = (count) =>
    steps(count, 33.3, 66.7).map((interactions) => ({
      interactions,
      frameIntervals: interactions.map(() => 16.7),
    }));
  const frameRuns = (count) =>
    steps(count, 16.7, 33.3).map((frameIntervals) => ({
      interactions: frameIntervals.map(() => 33.3),
      frameIntervals,
    }));

  it("fails 16 of 315 steps two frames late and passes 15", () => {
    expect(judgeResponsiveness(interactionRuns(16), limits).passed).toBe(false);
    expect(judgeResponsiveness(interactionRuns(15), limits).passed).toBe(true);
  });

  it("fails 16 of 315 frame intervals that drop a frame and passes 15", () => {
    expect(judgeResponsiveness(frameRuns(16), limits).passed).toBe(false);
    expect(judgeResponsiveness(frameRuns(15), limits).passed).toBe(true);
  });

  it("leaves the unvirtualized arm and the other constrained tiers at 75 ms", () => {
    const loose = { interactionLimitMs: 75, frameIntervalLimitMs: 75 };
    expect(responsivenessLimits(TIMELINE_VIEWPORT_BUDGETS, "ci", "off")).toEqual(loose);
    expect(responsivenessLimits(TIMELINE_VIEWPORT_BUDGETS, "low-resource", "on")).toEqual(loose);
    expect(responsivenessLimits(TIMELINE_VIEWPORT_BUDGETS, "primary", "on")).toEqual({
      interactionLimitMs: 50,
      frameIntervalLimitMs: 33.3,
    });
  });
});

describe("attemptPassed", () => {
  const passing = { responsivenessPassed: true, passingRuns: 5, requiredPassingRuns: 4 };

  it("needs pooled responsiveness and enough passing runs", () => {
    expect(attemptPassed(passing)).toBe(true);
    expect(attemptPassed({ ...passing, responsivenessPassed: false })).toBe(false);
    expect(attemptPassed({ ...passing, passingRuns: 3 })).toBe(false);
  });
});

describe("gatePassed", () => {
  const pass = { passed: true };
  const fail = { passed: false };
  const passing = {
    directScrollApproved: true,
    attempts: [pass],
    memoryReturned: true,
    zoomOutBlankFrames: 0,
  };

  it("passes only when every check holds", () => {
    expect(gatePassed(passing)).toBe(true);
    expect(gatePassed({ ...passing, directScrollApproved: false })).toBe(false);
    expect(gatePassed({ ...passing, memoryReturned: false })).toBe(false);
    expect(gatePassed({ ...passing, zoomOutBlankFrames: 1 })).toBe(false);
  });

  it("fails timing only when the attempt and its one rerun both fail", () => {
    expect(gatePassed({ ...passing, attempts: [fail, pass] })).toBe(true);
    expect(gatePassed({ ...passing, attempts: [fail, fail] })).toBe(false);
    expect(gatePassed({ ...passing, attempts: [fail, fail, pass] })).toBe(false);
    expect(gatePassed({ ...passing, attempts: [] })).toBe(false);
  });
});
