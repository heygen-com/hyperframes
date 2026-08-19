import { describe, expect, it } from "vitest";
import type { WorkerSizing } from "@hyperframes/engine";
import { buildHeapAdvisoryWarning } from "./captureCost.js";

function sizing(overrides: Partial<WorkerSizing>): WorkerSizing {
  return {
    workers: 6,
    boundBy: "max_workers",
    cpuBasedWorkers: 16,
    memoryBasedWorkers: 8,
    frameBasedWorkers: 24,
    effectiveMaxWorkers: 6,
    heapBasedWorkers: 4,
    heapLimitMb: 4096,
    totalMemoryMb: 24576,
    cpuCount: 18,
    captureCostMultiplier: 1,
    exceedsHeapAdvisory: true,
    ...overrides,
  };
}

describe("buildHeapAdvisoryWarning", () => {
  it("names the chosen count, heap limit, safe count, and both remediation knobs", () => {
    const message = buildHeapAdvisoryWarning(sizing({}), undefined);
    expect(message).toContain("6 capture workers");
    expect(message).toContain("limit 4096MB");
    expect(message).toContain("~4");
    expect(message).toContain("NODE_OPTIONS=--max-old-space-size=8192");
    expect(message).toContain("--workers 4");
  });

  it("stays silent for explicit --workers requests (operator's own call)", () => {
    expect(buildHeapAdvisoryWarning(sizing({}), 6)).toBeUndefined();
  });

  it("stays silent when the chosen count fits the heap budget", () => {
    expect(
      buildHeapAdvisoryWarning(sizing({ exceedsHeapAdvisory: false }), undefined),
    ).toBeUndefined();
  });
});
