import { describe, it, expect } from "vitest";
import { distributeFrames } from "./parallelCoordinator.js";

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
