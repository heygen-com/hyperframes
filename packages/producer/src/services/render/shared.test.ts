import { describe, expect, it, setSystemTime } from "bun:test";
import type { ParallelProgress } from "@hyperframes/engine";
import type { RenderJob } from "../renderOrchestrator.js";
import { reportWorkerStartup, resolveBrowserMediaEnd } from "./shared.js";

describe("resolveBrowserMediaEnd", () => {
  it("prefers a runtime duration over a stale compiler-clamped end", () => {
    expect(resolveBrowserMediaEnd(0, 5.04, 56.738)).toBe(56.738);
  });

  it("projects a runtime duration from the browser-local start", () => {
    expect(resolveBrowserMediaEnd(2, 7.04, 56.738)).toBe(58.738);
  });

  it("falls back to data-end when runtime duration is unavailable", () => {
    expect(resolveBrowserMediaEnd(0, 5.04, Number.NaN)).toBe(5.04);
    expect(resolveBrowserMediaEnd(0, 5.04, 0)).toBe(5.04);
  });
});

describe("reportWorkerStartup", () => {
  it("counts ready workers and drops ids past a smaller retry's worker count", () => {
    const job = { progress: 25 } as RenderJob;
    const stages: string[] = [];
    const phase = (workerId: number, name: string, activeWorkers: number) => {
      setSystemTime(Date.now() + 1_000);
      reportWorkerStartup(
        job,
        {
          activeWorkers,
          latestWorkerPhase: { workerId, phase: name },
        } as unknown as ParallelProgress,
        (_job, stage) => {
          stages.push(stage);
        },
      );
    };
    try {
      phase(0, "browser_launch", 3);
      phase(2, "frame_capture", 3);
      phase(0, "frame_capture", 3);
      phase(0, "browser_launch", 2);
      phase(1, "frame_capture", 2);
    } finally {
      setSystemTime();
    }
    expect(stages).toEqual([
      "Starting browsers (0/3 ready)",
      "Starting browsers (1/3 ready)",
      "Starting browsers (2/3 ready)",
      "Starting browsers (0/2 ready)",
      "Starting browsers (1/2 ready)",
    ]);
  });
});
