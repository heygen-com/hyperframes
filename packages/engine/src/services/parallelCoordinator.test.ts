import { describe, it, expect } from "vitest";
import {
  calculateOptimalWorkers,
  distributeFrames,
  shouldVerifyWorkerGpu,
} from "./parallelCoordinator.js";
import type { EngineConfig } from "../config.js";

describe("distributeFrames", () => {
  it("distributes frames evenly across workers", () => {
    const tasks = distributeFrames(100, 4, "/tmp/work");
    expect(tasks).toHaveLength(4);

    // First worker: frames 0-24
    expect(tasks[0]?.startFrame).toBe(0);
    expect(tasks[0]?.endFrame).toBe(25);

    // Last worker: frames 75-99
    expect(tasks[3]?.startFrame).toBe(75);
    expect(tasks[3]?.endFrame).toBe(100);
  });

  it("handles single worker", () => {
    const tasks = distributeFrames(50, 1, "/tmp/work");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.startFrame).toBe(0);
    expect(tasks[0]?.endFrame).toBe(50);
  });

  it("does not create empty tasks when workers exceed frames", () => {
    const tasks = distributeFrames(3, 10, "/tmp/work");
    // Can't have more tasks than frames
    expect(tasks.length).toBeLessThanOrEqual(3);
    // All frames are covered
    const totalFrames = tasks.reduce((sum, t) => sum + (t.endFrame - t.startFrame), 0);
    expect(totalFrames).toBe(3);
  });

  it("assigns worker output directories", () => {
    const tasks = distributeFrames(60, 2, "/tmp/my-work");
    expect(tasks[0]?.outputDir).toContain("worker-0");
    expect(tasks[1]?.outputDir).toContain("worker-1");
  });

  it("assigns sequential worker IDs", () => {
    const tasks = distributeFrames(100, 3, "/tmp/work");
    expect(tasks.map((t) => t.workerId)).toEqual([0, 1, 2]);
  });
});

describe("calculateOptimalWorkers", () => {
  it("lets high-cost auto renders fall back to one worker when CPU budget requires it", () => {
    const workers = calculateOptimalWorkers(180, undefined, {
      concurrency: 6,
      coresPerWorker: 100,
      minParallelFrames: 120,
      largeRenderThreshold: 1000,
      captureCostMultiplier: 4,
    });

    expect(workers).toBe(1);
  });

  it("does not apply capture cost to explicit worker requests", () => {
    const workers = calculateOptimalWorkers(180, 4, {
      concurrency: 6,
      coresPerWorker: 100,
      minParallelFrames: 120,
      largeRenderThreshold: 1000,
      captureCostMultiplier: 4,
    });

    expect(workers).toBe(4);
  });
});

describe("shouldVerifyWorkerGpu", () => {
  const softwareConfig: Partial<EngineConfig> = { browserGpuMode: "software" };

  it("returns true for worker 0 when GPU mode is software", () => {
    expect(shouldVerifyWorkerGpu(0, softwareConfig)).toBe(true);
  });

  it("returns false for non-zero workers when GPU mode is software", () => {
    expect(shouldVerifyWorkerGpu(1, softwareConfig)).toBe(false);
    expect(shouldVerifyWorkerGpu(5, softwareConfig)).toBe(false);
    expect(shouldVerifyWorkerGpu(17, softwareConfig)).toBe(false);
  });

  it("returns false for any worker when GPU mode is not software", () => {
    expect(shouldVerifyWorkerGpu(0, { browserGpuMode: "hardware" } as Partial<EngineConfig>)).toBe(
      false,
    );
    expect(shouldVerifyWorkerGpu(0, {})).toBe(false);
  });

  it("returns false when config is undefined", () => {
    expect(shouldVerifyWorkerGpu(0, undefined)).toBe(false);
    expect(shouldVerifyWorkerGpu(3, undefined)).toBe(false);
  });
});
