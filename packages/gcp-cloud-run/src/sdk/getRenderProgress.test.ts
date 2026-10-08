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

  it.each(["", "not-json", "null", "true", "[]", '{"Chunks":{}}', '{"Chunks":"invalid"}'])(
    "keeps a successful execution readable with malformed result %s",
    async (result) => {
      const progress = await getRenderProgress({
        executionName: "x",
        executions: fakeExecutions({ state: "SUCCEEDED", result }),
      });
      expect(progress.status).toBe("succeeded");
      expect(progress.overallProgress).toBe(1);
      expect(progress.framesRendered).toBe(0);
      expect(progress.totalFrames).toBeNull();
      expect(progress.outputFile).toBeNull();
      expect(progress.invocationsObserved).toBe(0);
      expect(progress.costs.accruedSoFarUsd).toBeFinite();
    },
  );

  it("retains valid stages and ignores non-object chunks", async () => {
    const progress = await getRenderProgress({
      executionName: "x",
      executions: fakeExecutions({
        state: "SUCCEEDED",
        result: JSON.stringify({
          Plan: { TotalFrames: 30, DurationMs: 500 },
          Chunks: [null, true, "invalid", [], { FramesEncoded: 30, DurationMs: 1000 }],
          Assemble: { OutputGcsUri: "gs://b/output.mp4", FileSize: 42, DurationMs: 250 },
        }),
      }),
    });
    expect(progress.totalFrames).toBe(30);
    expect(progress.framesRendered).toBe(30);
    expect(progress.invocationsObserved).toBe(3);
    expect(progress.outputFile).toEqual({ gcsUri: "gs://b/output.mp4", bytes: 42 });
    expect(progress.costs.breakdown.estimated).toBe(false);
  });

  it("does not coerce frame counts or expose non-string output paths", async () => {
    const progress = await getRenderProgress({
      executionName: "x",
      executions: fakeExecutions({
        state: "SUCCEEDED",
        result: JSON.stringify({
          Plan: { TotalFrames: "30" },
          Chunks: [
            { FramesEncoded: "30", DurationMs: "1000" },
            { FramesEncoded: 12, DurationMs: 0 },
          ],
          Assemble: { OutputGcsUri: 42, FileSize: "123" },
        }),
      }),
    });
    expect(progress.totalFrames).toBeNull();
    expect(progress.framesRendered).toBe(12);
    expect(progress.outputFile).toBeNull();
    expect(progress.costs.breakdown.estimated).toBe(true);
  });

  it.each(["-30", "1e400"])("ignores invalid numeric result fields %s", async (value) => {
    const result = `{"Plan":{"TotalFrames":${value},"DurationMs":${value}},"Chunks":[{"FramesEncoded":${value},"DurationMs":${value}}],"Assemble":{"OutputGcsUri":"gs://b/output.mp4","FileSize":${value},"DurationMs":${value}}}`;
    const progress = await getRenderProgress({
      executionName: "x",
      executions: fakeExecutions({ state: "SUCCEEDED", result }),
    });
    expect(progress.totalFrames).toBeNull();
    expect(progress.framesRendered).toBe(0);
    expect(progress.outputFile).toEqual({ gcsUri: "gs://b/output.mp4", bytes: null });
    expect(progress.costs.accruedSoFarUsd).toBeGreaterThanOrEqual(0);
    expect(progress.costs.accruedSoFarUsd).toBeFinite();
    expect(progress.costs.breakdown.estimated).toBe(true);
  });

  it.each([{ stage: true }, { stage: [] }, { stage: "invalid" }])(
    "ignores non-object stage result %j",
    async ({ stage }) => {
      const progress = await getRenderProgress({
        executionName: "x",
        executions: fakeExecutions({
          state: "SUCCEEDED",
          result: JSON.stringify({ Plan: stage, Chunks: [], Assemble: stage }),
        }),
      });
      expect(progress.totalFrames).toBeNull();
      expect(progress.outputFile).toBeNull();
      expect(progress.invocationsObserved).toBe(0);
    },
  );

  it.each([{ chunks: {} }, { chunks: "invalid" }])(
    "preserves valid stages when the chunk list is malformed %j",
    async ({ chunks }) => {
      const progress = await getRenderProgress({
        executionName: "x",
        executions: fakeExecutions({
          state: "SUCCEEDED",
          result: JSON.stringify({
            Plan: { TotalFrames: 30, DurationMs: 500 },
            Chunks: chunks,
            Assemble: { OutputGcsUri: "gs://b/output.mp4", FileSize: 42, DurationMs: 250 },
          }),
        }),
      });
      expect(progress.totalFrames).toBe(30);
      expect(progress.framesRendered).toBe(0);
      expect(progress.invocationsObserved).toBe(2);
      expect(progress.outputFile).toEqual({ gcsUri: "gs://b/output.mp4", bytes: 42 });
      expect(progress.costs.breakdown.estimated).toBe(false);
    },
  );

  it("preserves zero-valued result fields", async () => {
    const progress = await getRenderProgress({
      executionName: "x",
      executions: fakeExecutions({
        state: "SUCCEEDED",
        result: JSON.stringify({
          Plan: { TotalFrames: 0, DurationMs: 0 },
          Chunks: [{ FramesEncoded: 0, DurationMs: 0 }],
          Assemble: { OutputGcsUri: "gs://b/output.mp4", FileSize: 0, DurationMs: 0 },
        }),
      }),
    });
    expect(progress.totalFrames).toBe(0);
    expect(progress.framesRendered).toBe(0);
    expect(progress.invocationsObserved).toBe(3);
    expect(progress.outputFile).toEqual({ gcsUri: "gs://b/output.mp4", bytes: 0 });
    expect(progress.costs.breakdown.estimated).toBe(false);
  });

  it("requires an executionName", async () => {
    await expect(
      getRenderProgress({ executionName: "", executions: fakeExecutions({}) }),
    ).rejects.toThrow(/executionName is required/);
  });
});
