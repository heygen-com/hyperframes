import { describe, expect, it } from "bun:test";
import { type BilledLambdaInvocation, computeRenderCost } from "./costAccounting.js";

describe("computeRenderCost", () => {
  it("returns zero when nothing is billed", () => {
    const result = computeRenderCost([], 0);
    expect(result.accruedSoFarUsd).toBe(0);
    expect(result.displayCost).toBe("$0.0000");
    expect(result.breakdown.estimated).toBe(false);
  });

  it("computes Lambda GB-seconds × USD per GB-s", () => {
    // 10 GiB × 6 s = 60 GB-s × $0.0000166667 = $0.001.
    const invs: BilledLambdaInvocation[] = [
      { billedDurationMs: 6_000, memorySizeMb: 10_240, estimated: false },
    ];
    const result = computeRenderCost(invs, 0);
    expect(result.breakdown.lambdaUsd).toBeCloseTo(0.001, 4);
    expect(result.breakdown.stepFunctionsUsd).toBe(0);
  });

  it("sums multiple Lambda invocations", () => {
    const invs: BilledLambdaInvocation[] = [
      { billedDurationMs: 1_000, memorySizeMb: 1_024, estimated: false }, // 1 GB-s
      { billedDurationMs: 2_000, memorySizeMb: 2_048, estimated: false }, // 4 GB-s
    ];
    const result = computeRenderCost(invs, 0);
    // (1 + 4) × $0.0000166667 ≈ $0.0000833335 → rounds to $0.0001 at 4 dp.
    expect(result.breakdown.lambdaUsd).toBe(0.0001);
  });

  it("adds Step Functions transition costs", () => {
    const result = computeRenderCost([], 200);
    expect(result.breakdown.stepFunctionsUsd).toBeCloseTo(200 * 0.000025, 6);
    expect(result.breakdown.stepFunctionsUsd).toBeCloseTo(0.005, 4);
  });

  it("flags estimated=true when any invocation was estimated", () => {
    const result = computeRenderCost(
      [
        { billedDurationMs: 1_000, memorySizeMb: 1_024, estimated: true },
        { billedDurationMs: 1_000, memorySizeMb: 1_024, estimated: false },
      ],
      10,
    );
    expect(result.breakdown.estimated).toBe(true);
  });

  it("formats USD to four decimal places", () => {
    const result = computeRenderCost([], 1);
    expect(result.displayCost).toBe("$0.0000");
    const result2 = computeRenderCost([], 4_000);
    expect(result2.displayCost).toBe("$0.1000");
  });

  it("does not include S3 in the breakdown", () => {
    const result = computeRenderCost([], 0);
    expect(result.breakdown.s3Estimate).toBe("not-included");
  });
});
