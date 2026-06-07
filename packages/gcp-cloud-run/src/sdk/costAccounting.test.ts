/**
 * `computeRenderCost` unit tests — Cloud Run vCPU/GiB-second + Workflows
 * step math.
 */

import { describe, expect, it } from "bun:test";
import { type BilledCloudRunInvocation, computeRenderCost } from "./costAccounting.js";

describe("computeRenderCost", () => {
  it("returns zero for no invocations", () => {
    const cost = computeRenderCost([], 0);
    expect(cost.accruedSoFarUsd).toBe(0);
    expect(cost.displayCost).toBe("$0.0000");
  });

  it("sums vCPU + memory seconds plus per-request and step charges", () => {
    const invs: BilledCloudRunInvocation[] = [
      { durationMs: 10_000, vcpu: 4, memoryGib: 16, estimated: false },
      { durationMs: 10_000, vcpu: 4, memoryGib: 16, estimated: false },
    ];
    const cost = computeRenderCost(invs, 6);
    // 2 × 10s: vCPU 80 vcpu-s × 0.000024 = 0.00192; mem 320 GiB-s × 0.0000025 = 0.0008;
    // requests 2 × 4e-7 ≈ 0 → raw 0.0027208, rounded to 4 dp = 0.0027.
    // workflows 6 × 1e-5 = 0.00006 → rounds up to 0.0001 at 4 dp.
    expect(cost.breakdown.cloudRunUsd).toBeCloseTo(0.0027, 4);
    expect(cost.breakdown.workflowsUsd).toBeCloseTo(0.0001, 4);
    expect(cost.accruedSoFarUsd).toBeGreaterThan(0);
    expect(cost.breakdown.gcsEstimate).toBe("not-included");
  });

  it("flags estimated when any invocation was estimated", () => {
    const cost = computeRenderCost([{ durationMs: 0, vcpu: 4, memoryGib: 16, estimated: true }], 4);
    expect(cost.breakdown.estimated).toBe(true);
  });
});
