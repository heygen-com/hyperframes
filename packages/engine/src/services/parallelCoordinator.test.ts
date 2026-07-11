import { describe, it, expect } from "vitest";
import {
  calculateOptimalWorkers,
  distributeFrames,
  formatWorkerFailure,
  selectWorkerDiagnostics,
  shouldDisableBrowserPoolForParallelWorker,
  shouldVerifyWorkerGpu,
  resolveParallelDeVerifySamples,
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

describe("shouldDisableBrowserPoolForParallelWorker", () => {
  const linuxHeadlessWorker = {
    parallel: true,
    platform: "linux" as NodeJS.Platform,
    deviceScaleFactor: 1,
    headlessShellPath: "/tmp/chrome-headless-shell",
  };

  it.each([
    ["BeginFrame", false],
    ["forced screenshot", true],
  ])(
    "disables the browser pool for parallel Linux/headless %s workers",
    (_mode, forceScreenshot) => {
      expect(
        shouldDisableBrowserPoolForParallelWorker({
          ...linuxHeadlessWorker,
          forceScreenshot,
        }),
      ).toBe(true);
    },
  );

  it.each([
    ["non-parallel", { parallel: false, forceScreenshot: true }],
    ["non-linux", { platform: "darwin" as NodeJS.Platform, forceScreenshot: true }],
    ["no headless shell", { headlessShellPath: undefined, forceScreenshot: true }],
    ["supersampled", { deviceScaleFactor: 2, forceScreenshot: false }],
  ])("keeps the shared pool for %s workers", (_case, overrides) => {
    expect(
      shouldDisableBrowserPoolForParallelWorker({
        ...linuxHeadlessWorker,
        ...overrides,
      }),
    ).toBe(false);
  });
});

describe("worker failure diagnostics", () => {
  it("keeps only actionable worker diagnostics and caps the tail", () => {
    const diagnostics = selectWorkerDiagnostics(
      [
        "[Browser] harmless log",
        "[Browser:WARN] noisy warning",
        "[Browser:REQUESTFAILED] GET https://cdn.example.com/a.mp4 resource=media error=net::ERR_FAILED",
        "[Browser:HTTP404] GET https://cdn.example.com/missing.png resource=image Not Found",
        "[FrameCapture:ERROR] page.goto failed mode=screenshot timeoutMs=60000 elapsedMs=60001 url=http://127.0.0.1:4173/index.html error=timeout",
      ],
      2,
    );

    expect(diagnostics).toEqual([
      "[Browser:HTTP404] GET https://cdn.example.com/missing.png resource=image Not Found",
      "[FrameCapture:ERROR] page.goto failed mode=screenshot timeoutMs=60000 elapsedMs=60001 url=http://127.0.0.1:4173/index.html error=timeout",
    ]);
  });

  it("adds compact diagnostics to the worker failure message", () => {
    expect(
      formatWorkerFailure({
        workerId: 1,
        framesCaptured: 0,
        startFrame: 0,
        endFrame: 30,
        durationMs: 60_100,
        error: "Navigation timeout of 60000 ms exceeded",
        diagnostics: ["[FrameCapture:ERROR] page.goto failed\n  mode=screenshot timeoutMs=60000"],
      }),
    ).toBe(
      "Worker 1: Navigation timeout of 60000 ms exceeded; diagnostics: [FrameCapture:ERROR] page.goto failed mode=screenshot timeoutMs=60000",
    );
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

describe("resolveParallelDeVerifySamples", () => {
  it("densifies with worker count: 4 base + 2 per extra worker", () => {
    expect(resolveParallelDeVerifySamples(undefined, 2)).toBe(6);
    expect(resolveParallelDeVerifySamples(undefined, 3)).toBe(8);
  });

  it("clamps at the verify path's max of 8", () => {
    expect(resolveParallelDeVerifySamples(undefined, 5)).toBe(8);
    expect(resolveParallelDeVerifySamples(undefined, 16)).toBe(8);
  });

  it("leaves single-worker capture on the session default", () => {
    expect(resolveParallelDeVerifySamples(undefined, 1)).toBeUndefined();
    expect(resolveParallelDeVerifySamples(undefined, 0)).toBeUndefined();
  });

  it("passes a caller-set value through untouched", () => {
    expect(resolveParallelDeVerifySamples(2, 3)).toBe(2);
  });
});
