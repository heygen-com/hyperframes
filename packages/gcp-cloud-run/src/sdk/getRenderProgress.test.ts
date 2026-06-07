/**
 * `getRenderProgress` unit tests — state mapping + parsing the accumulated
 * workflow result into frame totals, output file, and cost.
 */

import { describe, expect, it } from "bun:test";
import {
  type ExecutionRecord,
  type ExecutionsGetClientLike,
  getRenderProgress,
} from "./getRenderProgress.js";

function fakeExecutions(record: ExecutionRecord): ExecutionsGetClientLike {
  return {
    async getExecution(_req: { name: string }) {
      return [record] as [ExecutionRecord];
    },
  };
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
  it("reports running with no frame data while ACTIVE", async () => {
    const p = await getRenderProgress({
      executionName: "x",
      executions: fakeExecutions({ state: "ACTIVE", startTime: { seconds: 1700000000 } }),
    });
    expect(p.status).toBe("running");
    expect(p.overallProgress).toBe(0);
    expect(p.totalFrames).toBeNull();
    expect(p.fatalErrorEncountered).toBe(false);
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
