import { describe, expect, it } from "bun:test";
import {
  DescribeExecutionCommand,
  GetExecutionHistoryCommand,
  type HistoryEvent,
  type SFNClient,
} from "@aws-sdk/client-sfn";
import { getRenderProgress } from "./getRenderProgress.js";

interface DescribeShape {
  status?: string;
  startDate?: Date;
  stopDate?: Date;
}

class FakeSFN {
  describe: DescribeShape = {};
  // Pages of history events; FakeSFN walks them in order, paginating with `nextToken`.
  historyPages: HistoryEvent[][] = [];
  async send(command: unknown): Promise<unknown> {
    const cmdName = (command as { constructor: { name: string } }).constructor.name;
    if (cmdName === "DescribeExecutionCommand") {
      return {
        status: this.describe.status ?? "RUNNING",
        startDate: this.describe.startDate ?? new Date("2026-05-16T00:00:00Z"),
        stopDate: this.describe.stopDate,
      };
    }
    if (cmdName === "GetExecutionHistoryCommand") {
      const input = (command as { input: { nextToken?: string } }).input;
      const idx = input.nextToken ? Number.parseInt(input.nextToken, 10) : 0;
      const page = this.historyPages[idx] ?? [];
      const nextToken = idx + 1 < this.historyPages.length ? String(idx + 1) : undefined;
      return { events: page, nextToken };
    }
    throw new Error(`FakeSFN: unexpected command ${cmdName}`);
  }
}

function lambdaSucceeded(payload: unknown): HistoryEvent {
  return {
    type: "LambdaFunctionSucceeded",
    id: 1,
    timestamp: new Date(),
    lambdaFunctionSucceededEventDetails: { output: JSON.stringify(payload) },
  } as HistoryEvent;
}

function stateEntered(name: string): HistoryEvent {
  return {
    type: "TaskStateEntered",
    id: 1,
    timestamp: new Date(),
    stateEnteredEventDetails: { name },
  } as HistoryEvent;
}

function stateExited(name: string, output?: unknown): HistoryEvent {
  return {
    type: "TaskStateExited",
    id: 1,
    timestamp: new Date(),
    stateExitedEventDetails: {
      name,
      output: output === undefined ? undefined : JSON.stringify(output),
    },
  } as HistoryEvent;
}

// Optimized `lambda:invoke` integration's wire shape: Task* events with
// the handler payload at `.Payload`. Helpers below fabricate these so
// tests cover the same events a real CDK-deployed render produces.
function taskScheduled(): HistoryEvent {
  return {
    type: "TaskScheduled",
    id: 1,
    timestamp: new Date(),
    taskScheduledEventDetails: {
      resource: "invoke",
      resourceType: "lambda",
      region: "us-east-1",
      parameters: "{}",
    },
  } as HistoryEvent;
}

function taskSucceeded(payload: unknown): HistoryEvent {
  return {
    type: "TaskSucceeded",
    id: 1,
    timestamp: new Date(),
    taskSucceededEventDetails: {
      resource: "invoke",
      resourceType: "lambda",
      output: JSON.stringify({
        ExecutedVersion: "$LATEST",
        Payload: payload,
        StatusCode: 200,
      }),
    },
  } as HistoryEvent;
}

function taskFailed(error: string, cause: string): HistoryEvent {
  return {
    type: "TaskFailed",
    id: 1,
    timestamp: new Date(),
    taskFailedEventDetails: {
      resource: "invoke",
      resourceType: "lambda",
      error,
      cause,
    },
  } as HistoryEvent;
}

describe("getRenderProgress", () => {
  it("reports 0 progress before Plan completes", async () => {
    const sfn = new FakeSFN();
    sfn.historyPages = [[]];
    const progress = await getRenderProgress({
      executionArn: "arn",
      sfn: sfn as unknown as SFNClient,
    });
    expect(progress.status).toBe("RUNNING");
    expect(progress.overallProgress).toBe(0);
    expect(progress.totalFrames).toBeNull();
    expect(progress.framesRendered).toBe(0);
  });

  it("reports 0.1 once Plan completes (totalFrames known, no chunks done)", async () => {
    const sfn = new FakeSFN();
    sfn.historyPages = [
      [
        lambdaSucceeded({
          Action: "plan",
          TotalFrames: 240,
          DurationMs: 1_000,
        }),
      ],
    ];
    const progress = await getRenderProgress({
      executionArn: "arn",
      sfn: sfn as unknown as SFNClient,
    });
    expect(progress.totalFrames).toBe(240);
    expect(progress.overallProgress).toBeCloseTo(0.1, 6);
    expect(progress.framesRendered).toBe(0);
  });

  it("advances chunk progress proportionally", async () => {
    const sfn = new FakeSFN();
    sfn.historyPages = [
      [
        stateEntered("Plan"),
        lambdaSucceeded({ Action: "plan", TotalFrames: 100, DurationMs: 1_000 }),
        stateEntered("RenderChunk"),
        lambdaSucceeded({ Action: "renderChunk", FramesEncoded: 50, DurationMs: 2_000 }),
      ],
    ];
    const progress = await getRenderProgress({
      executionArn: "arn",
      sfn: sfn as unknown as SFNClient,
    });
    // 0.1 + 0.8 × 0.5 = 0.5
    expect(progress.overallProgress).toBeCloseTo(0.5, 6);
    expect(progress.framesRendered).toBe(50);
  });

  it("does not double-count Assemble's FramesEncoded toward framesRendered", async () => {
    const sfn = new FakeSFN();
    sfn.historyPages = [
      [
        stateEntered("Plan"),
        lambdaSucceeded({ Action: "plan", TotalFrames: 100, DurationMs: 1_000 }),
        stateEntered("RenderChunk"),
        lambdaSucceeded({ Action: "renderChunk", FramesEncoded: 100, DurationMs: 2_000 }),
        stateEntered("Assemble"),
        lambdaSucceeded({
          Action: "assemble",
          FramesEncoded: 100,
          FileSize: 9_000_000,
          OutputS3Uri: "s3://b/k.mp4",
          DurationMs: 1_500,
        }),
        stateExited("Assemble", {
          Output: { OutputS3Uri: "s3://b/k.mp4", FileSize: 9_000_000, FramesEncoded: 100 },
        }),
      ],
    ];
    sfn.describe.status = "SUCCEEDED";
    sfn.describe.stopDate = new Date("2026-05-16T00:05:00Z");
    const progress = await getRenderProgress({
      executionArn: "arn",
      sfn: sfn as unknown as SFNClient,
    });
    expect(progress.framesRendered).toBe(100);
    expect(progress.overallProgress).toBe(1);
    expect(progress.outputFile).toEqual({ s3Uri: "s3://b/k.mp4", bytes: 9_000_000 });
    expect(progress.endedAt).not.toBeNull();
  });

  it("computes cost from observed billed duration", async () => {
    const sfn = new FakeSFN();
    sfn.historyPages = [[lambdaSucceeded({ Action: "plan", TotalFrames: 30, DurationMs: 6_000 })]];
    const progress = await getRenderProgress({
      executionArn: "arn",
      defaultMemorySizeMb: 10_240,
      sfn: sfn as unknown as SFNClient,
    });
    // 1 transition event + 1 invocation × 60 GB-s × $0.0000166667 ≈ $0.001
    expect(progress.costs.breakdown.lambdaUsd).toBeCloseTo(0.001, 4);
  });

  it("captures Lambda failures with the enclosing state name", async () => {
    const sfn = new FakeSFN();
    const failed: HistoryEvent = {
      type: "LambdaFunctionFailed",
      id: 2,
      timestamp: new Date(),
      lambdaFunctionFailedEventDetails: {
        error: "PLAN_HASH_MISMATCH",
        cause: "bad plan",
      },
    } as HistoryEvent;
    sfn.historyPages = [[stateEntered("RenderChunk"), failed]];
    const progress = await getRenderProgress({
      executionArn: "arn",
      sfn: sfn as unknown as SFNClient,
    });
    expect(progress.errors).toEqual([
      { state: "RenderChunk", error: "PLAN_HASH_MISMATCH", cause: "bad plan" },
    ]);
  });

  it("marks fatalErrorEncountered when execution ends FAILED", async () => {
    const sfn = new FakeSFN();
    sfn.historyPages = [[]];
    sfn.describe.status = "FAILED";
    const progress = await getRenderProgress({
      executionArn: "arn",
      sfn: sfn as unknown as SFNClient,
    });
    expect(progress.fatalErrorEncountered).toBe(true);
  });

  it("paginates the history", async () => {
    const sfn = new FakeSFN();
    sfn.historyPages = [
      [
        stateEntered("Plan"),
        lambdaSucceeded({ Action: "plan", TotalFrames: 4, DurationMs: 1_000 }),
      ],
      [
        stateEntered("RenderChunk"),
        lambdaSucceeded({ Action: "renderChunk", FramesEncoded: 4, DurationMs: 2_000 }),
      ],
    ];
    sfn.describe.status = "SUCCEEDED";
    const progress = await getRenderProgress({
      executionArn: "arn",
      sfn: sfn as unknown as SFNClient,
    });
    expect(progress.framesRendered).toBe(4);
    expect(progress.totalFrames).toBe(4);
    expect(progress.overallProgress).toBe(1);
  });

  it("requires executionArn", async () => {
    await expect(getRenderProgress({ executionArn: "" })).rejects.toThrow(/executionArn/);
  });

  describe("optimized lambda:invoke integration", () => {
    it("counts a single TaskSucceeded as one Lambda invocation", async () => {
      const sfn = new FakeSFN();
      sfn.historyPages = [
        [
          stateEntered("Plan"),
          taskScheduled(),
          taskSucceeded({ Action: "plan", TotalFrames: 240, DurationMs: 1_000 }),
        ],
      ];
      const progress = await getRenderProgress({
        executionArn: "arn",
        defaultMemorySizeMb: 10_240,
        sfn: sfn as unknown as SFNClient,
      });
      expect(progress.lambdasInvoked).toBe(1);
      expect(progress.totalFrames).toBe(240);
      // computeRenderCost rounds to 4 decimals; precision=4 not 6.
      expect(progress.costs.breakdown.lambdaUsd).toBeCloseTo(0.0002, 4);
      expect(progress.costs.breakdown.lambdaUsd).toBeGreaterThan(0);
    });

    it("attributes RenderChunk FramesEncoded but ignores Plan/Assemble FramesEncoded", async () => {
      const sfn = new FakeSFN();
      sfn.historyPages = [
        [
          stateEntered("Plan"),
          taskScheduled(),
          taskSucceeded({ Action: "plan", TotalFrames: 100, DurationMs: 1_000 }),
          stateEntered("RenderChunk"),
          taskScheduled(),
          taskSucceeded({ Action: "renderChunk", FramesEncoded: 50, DurationMs: 2_000 }),
          stateEntered("Assemble"),
          taskScheduled(),
          taskSucceeded({
            Action: "assemble",
            FramesEncoded: 100, // would double-count if Assemble's count bled in
            FileSize: 9_000_000,
            OutputS3Uri: "s3://b/k.mp4",
            DurationMs: 1_500,
          }),
        ],
      ];
      const progress = await getRenderProgress({
        executionArn: "arn",
        sfn: sfn as unknown as SFNClient,
      });
      expect(progress.framesRendered).toBe(50);
      expect(progress.lambdasInvoked).toBe(3);
    });

    it("captures TaskFailed errors with the enclosing state name", async () => {
      const sfn = new FakeSFN();
      sfn.historyPages = [
        [
          stateEntered("RenderChunk"),
          taskScheduled(),
          taskFailed("Sandbox.Timedout", "Task timed out after 900.00 seconds"),
        ],
      ];
      const progress = await getRenderProgress({
        executionArn: "arn",
        sfn: sfn as unknown as SFNClient,
      });
      expect(progress.errors).toEqual([
        {
          state: "RenderChunk",
          error: "Sandbox.Timedout",
          cause: "Task timed out after 900.00 seconds",
        },
      ]);
    });

    it("sums billed seconds across plan + chunks + assemble", async () => {
      const sfn = new FakeSFN();
      const renderChunkSucceeded = (frames: number, ms: number) => [
        stateEntered("RenderChunk"),
        taskScheduled(),
        taskSucceeded({ Action: "renderChunk", FramesEncoded: frames, DurationMs: ms }),
      ];
      // 1 plan + 16 chunks @ 217s + 1 assemble = 3492.7s billed.
      sfn.historyPages = [
        [
          stateEntered("Plan"),
          taskScheduled(),
          taskSucceeded({ Action: "plan", TotalFrames: 1349, DurationMs: 13_000 }),
          ...Array.from({ length: 16 }, () => renderChunkSucceeded(84, 217_000)).flat(),
          stateEntered("Assemble"),
          taskScheduled(),
          taskSucceeded({
            Action: "assemble",
            FileSize: 81_000_000,
            OutputS3Uri: "s3://b/k.mp4",
            DurationMs: 7_700,
          }),
        ],
      ];
      sfn.describe.status = "SUCCEEDED";
      const progress = await getRenderProgress({
        executionArn: "arn",
        defaultMemorySizeMb: 10_240,
        sfn: sfn as unknown as SFNClient,
      });
      // 3492.7s × 10GB × $0.0000166667/GB-s ≈ $0.582.
      expect(progress.costs.breakdown.lambdaUsd).toBeCloseTo(0.582, 2);
      expect(progress.framesRendered).toBe(84 * 16);
      expect(progress.lambdasInvoked).toBe(18);
    });
  });
});

void DescribeExecutionCommand;
void GetExecutionHistoryCommand;
