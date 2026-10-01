/**
 * The timeline viewport gate's verdict, kept apart from the script that drives Chrome so it can be tested.
 */

/** Nearest-rank percentile: `ratio` 0.95 of 315 values is the 16th-worst. */
export function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
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
  const expected = runs.length * samplesPerRun;
  if (expected === 0 || interactions.length !== expected || frameIntervals.length !== expected) {
    throw new Error(
      `Expected ${expected} scroll samples, measured ${interactions.length} interactions ` +
        `and ${frameIntervals.length} frame intervals`,
    );
  }
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
