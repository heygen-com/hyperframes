/**
 * Per-render cost accounting for {@link getRenderProgress}.
 *
 * AWS bills Lambda by **GB-seconds** (billed-duration × memory-in-GiB)
 * and Step Functions standard workflows by **state transitions**. Both
 * inputs are recoverable from the SFN execution history without an
 * extra CloudWatch query — the history events carry
 * `billedDurationInMillis` and `memorySizeInMB` on each Lambda
 * invocation, and the transition count is simply `history.length`
 * filtered to transition-worthy events.
 *
 * The math is documented inline so the constants stay close to the
 * pricing source they came from. Cost is **best-effort**: AWS pricing
 * varies by region + commitment plan; we use on-demand `us-east-1`
 * rates as of 2026-05 and label the result `displayCost` so callers
 * see the dollar value but downstream automation can also read the
 * raw number.
 */

/** On-demand Lambda price, us-east-1, x86_64, on-demand: USD per GB-second. */
const LAMBDA_USD_PER_GB_SECOND = 0.0000166667;
/** Step Functions Standard Workflows, us-east-1: USD per state transition. */
const SFN_USD_PER_TRANSITION = 0.000025;

/** Raw history event subset the cost calc cares about. Caller filters from `getExecutionHistory`. */
export interface BilledLambdaInvocation {
  /** Millis of Lambda billed duration. Carried on `TaskSucceeded`/`TaskFailed` events. */
  billedDurationMs: number;
  /** Memory size in MB the function was configured with at invocation time. */
  memorySizeMb: number;
  /** `true` if the event payload did NOT carry a billed duration and we fell back to `Duration` or a constant. */
  estimated: boolean;
}

/** Result of {@link computeRenderCost}. */
export interface RenderCost {
  /** USD accrued to date. */
  accruedSoFarUsd: number;
  /** Human-readable USD string, e.g. `"$0.0214"`. */
  displayCost: string;
  breakdown: {
    lambdaUsd: number;
    stepFunctionsUsd: number;
    /** S3 transfer + storage cost varies by tier; we don't try to compute it here. */
    s3Estimate: "not-included";
    /** `true` if any Lambda invocation fell back to estimated billing. */
    estimated: boolean;
  };
}

/**
 * Sum Lambda GB-seconds + SFN transitions into an aggregate USD figure.
 *
 * `stateTransitions` is the count of billable state-machine transitions
 * — every successful state entry transitions once for standard
 * workflows. Express workflows price differently and are out of scope.
 */
export function computeRenderCost(
  lambdaInvocations: BilledLambdaInvocation[],
  stateTransitions: number,
): RenderCost {
  let lambdaUsd = 0;
  let anyEstimated = false;
  for (const inv of lambdaInvocations) {
    const gbSeconds = (inv.memorySizeMb / 1024) * (inv.billedDurationMs / 1000);
    lambdaUsd += gbSeconds * LAMBDA_USD_PER_GB_SECOND;
    if (inv.estimated) anyEstimated = true;
  }
  const stepFunctionsUsd = stateTransitions * SFN_USD_PER_TRANSITION;
  const accruedSoFarUsd = roundUsd(lambdaUsd + stepFunctionsUsd);
  return {
    accruedSoFarUsd,
    displayCost: formatUsd(accruedSoFarUsd),
    breakdown: {
      lambdaUsd: roundUsd(lambdaUsd),
      stepFunctionsUsd: roundUsd(stepFunctionsUsd),
      s3Estimate: "not-included",
      estimated: anyEstimated,
    },
  };
}

function roundUsd(usd: number): number {
  // Four decimal places — enough resolution for per-chunk granularity on
  // a 10 GB Lambda. Anything finer is noise vs AWS' own rounding.
  return Math.round(usd * 10_000) / 10_000;
}

function formatUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}
