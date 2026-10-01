/**
 * The timeline viewport gate's verdict, kept apart from the script that drives Chrome so it can be tested.
 */

/** Nearest-rank percentile: `ratio` 0.95 of 315 values is the 16th-worst. */
export function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

/** The p95 pair a tier is held to; the CI virtualized arm has its own, tighter one. */
export function responsivenessLimits(budgets, tier, rowVirtualization) {
  if (tier === "primary")
    return {
      interactionLimitMs: budgets.interactionP95Ms,
      frameIntervalLimitMs: budgets.frameIntervalP95Ms,
    };
  if (tier === "ci" && rowVirtualization === "on")
    return {
      interactionLimitMs: budgets.ciVirtualizedInteractionP95Ms,
      frameIntervalLimitMs: budgets.ciVirtualizedFrameIntervalP95Ms,
    };
  return {
    interactionLimitMs: budgets.constrainedInteractionP95Ms,
    frameIntervalLimitMs: budgets.constrainedFrameIntervalP95Ms,
  };
}

function assertSampleCount(expected, interactions, frameIntervals) {
  if (expected > 0 && interactions.length === expected && frameIntervals.length === expected)
    return;
  throw new Error(
    `Expected ${expected} scroll samples, measured ${interactions.length} interactions ` +
      `and ${frameIntervals.length} frame intervals`,
  );
}

/**
 * p95 over every measured step pooled: one run's p95 is only its 4th-worst step, so a brief runner stall failed it.
 * Throws when any run is short of samples, so a missing measurement cannot read as a fast one.
 */
export function judgeResponsiveness(
  runs,
  { samplesPerRun, interactionLimitMs, frameIntervalLimitMs },
) {
  const interactions = runs.flatMap((run) => run.interactions);
  const frameIntervals = runs.flatMap((run) => run.frameIntervals);
  assertSampleCount(runs.length * samplesPerRun, interactions, frameIntervals);
  const interactionP95Ms = percentile(interactions, 0.95);
  const frameIntervalP95Ms = percentile(frameIntervals, 0.95);
  return {
    interactionP95Ms,
    frameIntervalP95Ms,
    passed: interactionP95Ms <= interactionLimitMs && frameIntervalP95Ms <= frameIntervalLimitMs,
  };
}

export function gatePassed({
  directScrollApproved,
  responsivenessPassed,
  passingRuns,
  requiredPassingRuns,
  memoryReturned,
}) {
  return (
    directScrollApproved &&
    responsivenessPassed &&
    passingRuns >= requiredPassingRuns &&
    memoryReturned
  );
}
