/**
 * `getRenderProgress` unit tests — state mapping + parsing the accumulated
 * workflow result into frame totals, output file, and cost.
 */

import { describe, expect, it } from "bun:test";
import {
  type ExecutionRecord,
  type ExecutionsGetClientLike,
  getRenderProgress,
  type StepEntriesListerLike,
  type StepEntryRecord,
} from "./getRenderProgress.js";

function fakeExecutions(record: ExecutionRecord): ExecutionsGetClientLike {
  return {
    async getExecution(_req: { name: string }) {
      return [record] as [ExecutionRecord];
    },
  };
}

function fakeStepEntries(entries: StepEntryRecord[]): StepEntriesListerLike {
  return {
    async listStepEntries(_executionName: string) {
      return entries;
    },
  };
}

function succeeded(step: string, count = 1): StepEntryRecord[] {
  return Array.from({ length: count }, () => ({ step, state: "STATE_SUCCEEDED" }));
}

const accumulated = JSON.stringify({
  Plan: { TotalFrames: 90, DurationMs: 4000 },
  Chunks: [
    { FramesEncoded: 30, DurationMs: 8000 },
    { FramesEncoded: 30, DurationMs: 8000 },
    { FramesEncoded: 30, DurationMs: 8000 },
  ],
  Assemble: { OutputGcsUri: "gs://b/renders/r1/output.mp4", FileSize: 123456, DurationMs: 3000 },
});

describe("getRenderProgress", () => {
  it("reports running with no frame data while ACTIVE and no step entries yet", async () => {
    const p = await getRenderProgress({
      executionName: "x",
      executions: fakeExecutions({ state: "ACTIVE", startTime: { seconds: 1700000000 } }),
      stepEntries: fakeStepEntries([]),
    });
    expect(p.status).toBe("running");
    expect(p.overallProgress).toBe(0);
    expect(p.totalFrames).toBeNull();
    expect(p.chunksCompleted).toBe(0);
    expect(p.totalChunks).toBeNull();
    expect(p.fatalErrorEncountered).toBe(false);
  });

  it("reports chunk-based mid-flight progress from step entries", async () => {
    const p = await getRenderProgress({
      executionName: "x",
      executions: fakeExecutions({ state: "ACTIVE", startTime: { seconds: 1700000000 } }),
      stepEntries: fakeStepEntries([
        ...succeeded("plan"),
        ...succeeded("appendSlots", 4),
        ...succeeded("renderOneChunk", 2),
        { step: "renderOneChunk", state: "STATE_IN_PROGRESS" },
      ]),
    });
    expect(p.status).toBe("running");
    // 10% plan + 80% * (2/4 chunks)
    expect(p.overallProgress).toBeCloseTo(0.5, 10);
    expect(p.chunksCompleted).toBe(2);
    expect(p.totalChunks).toBe(4);
    expect(p.invocationsObserved).toBe(3); // plan + 2 chunks
    expect(p.framesRendered).toBe(0); // step entries carry no frame counts
  });

  it("caps mid-flight progress below 1 once assemble succeeds", async () => {
    const p = await getRenderProgress({
      executionName: "x",
      executions: fakeExecutions({ state: "ACTIVE" }),
      stepEntries: fakeStepEntries([
        ...succeeded("plan"),
        ...succeeded("appendSlots", 2),
        ...succeeded("renderOneChunk", 2),
        ...succeeded("assemble"),
      ]),
    });
    expect(p.overallProgress).toBe(0.99);
    expect(p.chunksCompleted).toBe(2);
  });

  it("reports plan-only progress once plan succeeds but before the chunk list exists", async () => {
    const p = await getRenderProgress({
      executionName: "x",
      executions: fakeExecutions({ state: "ACTIVE" }),
      stepEntries: fakeStepEntries(succeeded("plan")),
    });
    expect(p.overallProgress).toBeCloseTo(0.1, 10);
    expect(p.totalChunks).toBeNull();
  });

  it("degrades to the coarse snapshot when the step-entries read fails", async () => {
    const p = await getRenderProgress({
      executionName: "x",
      executions: fakeExecutions({ state: "ACTIVE" }),
      stepEntries: {
        async listStepEntries() {
          throw new Error("PERMISSION_DENIED");
        },
      },
    });
    expect(p.status).toBe("running");
    expect(p.overallProgress).toBe(0);
    expect(p.chunksCompleted).toBe(0);
  });

  it("skips the step-entries read when midFlightProgress is false", async () => {
    let called = false;
    const p = await getRenderProgress({
      executionName: "x",
      executions: fakeExecutions({ state: "ACTIVE" }),
      midFlightProgress: false,
      stepEntries: {
        async listStepEntries() {
          called = true;
          return [];
        },
      },
    });
    expect(called).toBe(false);
    expect(p.overallProgress).toBe(0);
  });

  it("reports succeeded with parsed frames + cost", async () => {
    const p = await getRenderProgress({
      executionName: "x",
      vcpu: 4,
      memoryGib: 16,
      executions: fakeExecutions({
        state: "SUCCEEDED",
        result: accumulated,
        startTime: { seconds: 1700000000 },
        endTime: { seconds: 1700000031 },
      }),
    });
    expect(p.status).toBe("succeeded");
    expect(p.overallProgress).toBe(1);
    expect(p.totalFrames).toBe(90);
    expect(p.framesRendered).toBe(90);
    expect(p.invocationsObserved).toBe(5); // plan + 3 chunks + assemble
    expect(p.chunksCompleted).toBe(3);
    expect(p.totalChunks).toBe(3);
    expect(p.outputFile).toEqual({ gcsUri: "gs://b/renders/r1/output.mp4", bytes: 123456 });
    expect(p.costs.accruedSoFarUsd).toBeGreaterThan(0);
    expect(p.costs.breakdown.estimated).toBe(false);
  });

  it("maps FAILED to a fatal error and surfaces the error payload", async () => {
    const p = await getRenderProgress({
      executionName: "x",
      executions: fakeExecutions({
        state: "FAILED",
        error: { payload: "boom", context: "renderChunk" },
      }),
    });
    expect(p.status).toBe("failed");
    expect(p.fatalErrorEncountered).toBe(true);
    expect(p.errors[0]?.cause).toBe("boom");
    expect(p.errors[0]?.state).toBe("renderChunk");
  });

  it("extracts the handler error name from a wrapped http failure payload", async () => {
    // Workflows wraps an http step failure as { code, message, body }, where
    // body is the handler's JSON { error, message }.
    const payload = JSON.stringify({
      code: 400,
      message: "HTTP server responded with error code 400",
      body: JSON.stringify({ error: "PLAN_HASH_MISMATCH", message: "mismatch" }),
    });
    const p = await getRenderProgress({
      executionName: "x",
      executions: fakeExecutions({ state: "FAILED", error: { payload, context: "renderChunk" } }),
    });
    expect(p.errors[0]?.error).toBe("PLAN_HASH_MISMATCH");
  });

  it("maps CANCELLED", async () => {
    const p = await getRenderProgress({
      executionName: "x",
      executions: fakeExecutions({ state: "CANCELLED" }),
    });
    expect(p.status).toBe("cancelled");
    expect(p.fatalErrorEncountered).toBe(true);
  });

  it("requires an executionName", async () => {
    await expect(
      getRenderProgress({ executionName: "", executions: fakeExecutions({}) }),
    ).rejects.toThrow(/executionName is required/);
  });
});
