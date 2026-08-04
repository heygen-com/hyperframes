import { describe, expect, it } from "vitest";
import {
  STUDIO_RUNTIME_BUDGETS,
  findIdleQuiescentWindow,
  resolveStudioRuntimeBudgets,
} from "./studioRuntimeBudgets";

describe("resolveStudioRuntimeBudgets", () => {
  it("returns the frozen defaults when nothing is overridden", () => {
    const resolved = resolveStudioRuntimeBudgets();
    expect(resolved).toEqual(STUDIO_RUNTIME_BUDGETS);
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it("rejects negative and non-finite values", () => {
    expect(() => resolveStudioRuntimeBudgets({ idleWindowMs: -1 })).toThrow(RangeError);
    expect(() => resolveStudioRuntimeBudgets({ idleCpuFractionOfCore: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() =>
      resolveStudioRuntimeBudgets({ switchHeapBytesPerCycle: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
  });

  it("rejects fractional counts and out-of-range ratios", () => {
    expect(() => resolveStudioRuntimeBudgets({ switchCycles: 2.5 })).toThrow(RangeError);
    expect(() => resolveStudioRuntimeBudgets({ idleCpuFractionOfCore: 1.5 })).toThrow(RangeError);
    expect(() => resolveStudioRuntimeBudgets({ idleQuiescenceToleranceRatio: 2 })).toThrow(
      RangeError,
    );
  });

  it("rejects a quiescence condition that cannot be reached", () => {
    expect(() =>
      resolveStudioRuntimeBudgets({ idleMaxWindows: 2, idleQuiescenceStableWindows: 2 }),
    ).toThrow(RangeError);
    expect(() => resolveStudioRuntimeBudgets({ idleQuiescenceStableWindows: 0 })).toThrow(
      RangeError,
    );
  });

  it("rejects a drag with fewer than two steps and a switch that never alternates", () => {
    expect(() => resolveStudioRuntimeBudgets({ scrubSteps: 1 })).toThrow(RangeError);
    expect(() => resolveStudioRuntimeBudgets({ switchCycles: 1 })).toThrow(RangeError);
  });

  it("rejects a request ratio below one, which no build can reach", () => {
    expect(() => resolveStudioRuntimeBudgets({ openMediaRequestsPerDistinctSource: 0.5 })).toThrow(
      RangeError,
    );
  });

  it("accepts an override and leaves the defaults untouched", () => {
    const resolved = resolveStudioRuntimeBudgets({ idleWindowMs: 2_000 });
    expect(resolved.idleWindowMs).toBe(2_000);
    expect(STUDIO_RUNTIME_BUDGETS.idleWindowMs).toBe(10_000);
  });
});

describe("findIdleQuiescentWindow", () => {
  // The measured shape on a real media project: the first window drains the
  // thumbnail-extraction backlog at 801 recalcs, then the steady state is flat
  // at exactly 1,200 per ten seconds.
  const BACKLOG_THEN_STEADY = [801, 1_200, 1_200, 1_200];

  it("does not settle while the backlog is still draining", () => {
    expect(findIdleQuiescentWindow([801])).toBeNull();
    expect(findIdleQuiescentWindow([801, 1_200])).toBeNull();
    // Two windows agree here, but the pair before them does not: one matching
    // pair is a coincidence away from a transient, which is why the condition
    // requires two. This is the case a fixed sleep would have reported.
    expect(findIdleQuiescentWindow([801, 1_200, 1_200])).toBeNull();
  });

  it("settles on the first window past the backlog", () => {
    expect(findIdleQuiescentWindow(BACKLOG_THEN_STEADY)).toBe(3);
  });

  it("never settles on a monotonically climbing series", () => {
    expect(findIdleQuiescentWindow([100, 200, 400, 800, 1_600])).toBeNull();
  });

  it("settles on a flat series as early as the stable-window count allows", () => {
    expect(findIdleQuiescentWindow([1_200, 1_200, 1_200])).toBe(2);
  });

  it("tolerates jitter inside the tolerance and rejects it outside", () => {
    expect(findIdleQuiescentWindow([1_200, 1_250, 1_180])).toBe(2);
    expect(findIdleQuiescentWindow([1_200, 1_250, 1_800])).toBeNull();
  });

  it("treats an all-zero series as settled, because zero work is the target", () => {
    expect(findIdleQuiescentWindow([0, 0, 0])).toBe(2);
  });

  it("honours an overridden stability requirement", () => {
    const strict = resolveStudioRuntimeBudgets({ idleQuiescenceStableWindows: 3 });
    expect(findIdleQuiescentWindow([801, 1_200, 1_200, 1_200], strict)).toBeNull();
    expect(findIdleQuiescentWindow([801, 1_200, 1_200, 1_200, 1_200], strict)).toBe(4);
  });
});
