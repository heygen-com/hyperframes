/**
 * Per-render cost accounting for {@link getRenderProgress}.
 *
 * Google bills the render service two ways:
 *
 *  - **Cloud Run** by **vCPU-seconds** and **GiB-seconds** of request
 *    processing time, plus a flat per-request charge. Each handler
 *    invocation returns its own `DurationMs` in the result body, so the
 *    progress reader can recover billed time per step without a separate
 *    Cloud Monitoring query — multiply by the service's configured vCPU /
 *    memory to get the resource-seconds.
 *  - **Cloud Workflows** by **steps executed**. The orchestration is a
 *    fixed shape (Plan + N×RenderChunk + Assemble + a handful of control
 *    steps), so the step count scales with chunk count.
 *
 * The math is documented inline so the constants stay close to the pricing
 * source they came from. Cost is **best-effort**: GCP pricing varies by
 * region + committed-use discounts; we use on-demand `us-central1` (Tier 1)
 * rates as of 2026-06 and label the result `displayCost` so callers see the
 * dollar value but downstream automation can also read the raw number.
 */

/** Cloud Run request-based billing, us-central1 Tier 1: USD per vCPU-second. */
const CLOUD_RUN_USD_PER_VCPU_SECOND = 0.000024;
/** Cloud Run request-based billing, us-central1 Tier 1: USD per GiB-second. */
const CLOUD_RUN_USD_PER_GIB_SECOND = 0.0000025;
/** Cloud Run: USD per request ($0.40 per million). */
const CLOUD_RUN_USD_PER_REQUEST = 0.0000004;
/** Cloud Workflows: USD per internal step ($0.01 per 1,000, after a free tier). */
const WORKFLOWS_USD_PER_STEP = 0.00001;

/** Per-invocation billed slice the cost calc cares about. */
export interface BilledCloudRunInvocation {
  /** Wall-clock the handler reported via `DurationMs` in its result body. */
  durationMs: number;
  /** vCPU the Cloud Run service was configured with at invocation time. */
  vcpu: number;
  /** Memory in GiB the Cloud Run service was configured with. */
  memoryGib: number;
  /** `true` if the duration was inferred (step result missing) rather than read from the handler payload. */
  estimated: boolean;
}

/**
 * Result of {@link computeRenderCost}.
 *
 * NOTE: `displayCost` / `accruedSoFarUsd` cover Cloud Run compute + Cloud
 * Workflows steps only. They EXCLUDE GCS storage + network egress for the
 * plan tarball (which can be ~100 MB), chunk artifacts, and the final output
 * — see `breakdown.gcsEstimate`. Treat the figure as a compute-cost floor,
 * not the authoritative total bill.
 */
export interface RenderCost {
  /** USD accrued to date (Cloud Run + Workflows only; excludes GCS — see note above). */
  accruedSoFarUsd: number;
  /** Human-readable USD string, e.g. `"$0.0214"`. Excludes GCS storage/egress. */
  displayCost: string;
  breakdown: {
    cloudRunUsd: number;
    workflowsUsd: number;
    /** GCS transfer + storage cost varies by tier; we don't try to compute it here. */
    gcsEstimate: "not-included";
    /** `true` if any invocation fell back to estimated billing. */
    estimated: boolean;
  };
}

/**
 * Sum Cloud Run vCPU-seconds + GiB-seconds + per-request charges and Cloud
 * Workflows steps into an aggregate USD figure.
 *
 * `workflowSteps` is the count of Workflows steps executed so far — Plan
 * (1) + RenderChunk (chunkCount) + Assemble (1) + the control steps
 * (BuildChunkList, AssertChunkCount, …). Pass the count the progress reader
 * derived from the execution; a rough constant overhead is fine since the
 * step charge is a rounding error next to Cloud Run compute.
 */
export function computeRenderCost(
  invocations: BilledCloudRunInvocation[],
  workflowSteps: number,
): RenderCost {
  let cloudRunUsd = 0;
  let anyEstimated = false;
  for (const inv of invocations) {
    const seconds = inv.durationMs / 1000;
    cloudRunUsd += seconds * inv.vcpu * CLOUD_RUN_USD_PER_VCPU_SECOND;
    cloudRunUsd += seconds * inv.memoryGib * CLOUD_RUN_USD_PER_GIB_SECOND;
    cloudRunUsd += CLOUD_RUN_USD_PER_REQUEST;
    if (inv.estimated) anyEstimated = true;
  }
  const workflowsUsd = workflowSteps * WORKFLOWS_USD_PER_STEP;
  const accruedSoFarUsd = roundUsd(cloudRunUsd + workflowsUsd);
  return {
    accruedSoFarUsd,
    displayCost: formatUsd(accruedSoFarUsd),
    breakdown: {
      cloudRunUsd: roundUsd(cloudRunUsd),
      workflowsUsd: roundUsd(workflowsUsd),
      gcsEstimate: "not-included",
      estimated: anyEstimated,
    },
  };
}

function roundUsd(usd: number): number {
  // Four decimal places — enough resolution for per-chunk granularity.
  // Anything finer is noise vs GCP's own rounding.
  return Math.round(usd * 10_000) / 10_000;
}

function formatUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}
